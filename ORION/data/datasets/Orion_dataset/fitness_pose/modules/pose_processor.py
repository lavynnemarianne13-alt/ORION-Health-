"""
modules/pose_processor.py
===============================================================================
Biomechanical Analysis Module  |  Orion Project
Part 1 - Physical Exercise Module (astronaut health support)

Goal
----
Use the trained YOLO-Pose model (`models/best_exercise_pose.pt`) to:
  1) Detect the athlete's skeleton in images, videos or webcam;
  2) Compute real joint angles via trigonometry (Hip-Knee-Ankle
     and Shoulder-Hip-Knee);
  3) Validate the squat posture and display "CORRECT" / "INCORRECT" on screen,
     with the reason and the repetition count.

Hybrid mode (YOLOv8-Pose + MediaPipe Pose)
------------------------------------------
In `--mode hybrid` (default) the processing combines both models:

  * YOLO detects the ATHLETE and provides the box — this keeps the domain
    robustness (Earth/Space) already trained in our model;
  * MediaPipe Pose extracts 33 SMOOTHED 3D landmarks
    (`static_image_mode=False, model_complexity=2, smooth_landmarks=True,
    min_detection_confidence=0.6, min_tracking_confidence=0.6`), running over
    the crop of the athlete's box (focus + more pixels per joint);
  * the angles (knee, hip and spine) are computed over the MediaPipe smoothed
    points. In profile/side view the side with the HIGHEST visibility is
    chosen automatically, avoiding the "shadow" of the hidden side;
  * the `yolo` side remains available for the old behavior.

Skeleton format (dataset "Squat data" - Roboflow, 15 keypoints)
---------------------------------------------------------------
The export does NOT publish the official order of the 15 points. The order
below was INFERRED and VALIDATED by statistical analysis of the 183 training
labels:

  * 7/8  = hips    | 9/10 = knees | 11/12 = ankles
    -> the chain hip->knee->ankle is monotonic in 100% of the frames.
  * 1/2  = shoulders (shoulder/hip width ratio ~1.24, compatible with anatomy).
  * 0    = head/nose; 3/4 and 5/6 = upper limbs (arm);
    13/14 = hands (the most lateral points).

If your annotator used a different order, just adjust the KEYPOINT_NAMES
dictionary and the SKELETON list below — all the angle logic uses these indices.

Usage
-----
    # Single image
    python modules/pose_processor.py --source path/photo.jpg

    # Video
    python modules/pose_processor.py --source path/video.mp4 --output output.mp4

    # Webcam (camera 0) in hybrid mode, 1280x720
    python modules/pose_processor.py --source 0

    # Webcam in fullscreen, reading the settings from a JSON file
    python modules/pose_processor.py --config config.json

    # Fine adjustment via CLI (has priority over the config file)
    python modules/pose_processor.py --source 1 --fullscreen --size 1280x720 \
        --conf 0.5 --stand-knee-angle 165 --max-torso-lean 40

    # Go back to the old behavior (YOLO only)
    python modules/pose_processor.py --source 0 --mode yolo

Configuration:
    The default values live in DEFAULTS. A JSON file (--config) can override
    them and the CLI arguments have priority over both.

Report:
    On exit ('q' key or end of the video) a detailed session JSON is saved,
    with the posture summary, angle statistics, repetitions and alerts.

Requirements:
    pip install ultralytics opencv-python numpy mediapipe
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np

# --------------------------------------------------------------------------- #
# 1) Skeleton definition (indices of the 15 dataset keypoints)
# --------------------------------------------------------------------------- #
KEYPOINT_NAMES: dict[int, str] = {
    0: "head",
    1: "left_shoulder", 2: "right_shoulder",
    3: "left_arm", 4: "right_arm",
    5: "left_wrist", 6: "right_wrist",
    7: "left_hip", 8: "right_hip",
    9: "left_knee", 10: "right_knee",
    11: "left_ankle", 12: "right_ankle",
    13: "left_hand", 14: "right_hand",
}

# Limb chains used to draw the skeleton (pairs of indices).
SKELETON: list[tuple[int, int]] = [
    (0, 1), (0, 2),            # head -> shoulders
    (1, 3), (3, 5), (5, 13),   # left arm
    (2, 4), (4, 6), (6, 14),   # right arm
    (1, 7), (2, 8),            # shoulders -> hips (torso)
    (7, 8),                    # hip line
    (7, 9), (9, 11),           # left leg
    (8, 10), (10, 12),         # right leg
]

# Joint indices (eases reading / switching the convention).
L_HIP, R_HIP = 7, 8
L_KNEE, R_KNEE = 9, 10
L_ANKLE, R_ANKLE = 11, 12
L_SHOULDER, R_SHOULDER = 1, 2

# Minimum confidence threshold to consider a keypoint usable.
KP_CONF_THRESHOLD = 0.35

# Working resolution (width, height). Video/webcam frames are resized to this
# size BEFORE inference: the webcam usually delivers 720p/1080p, and reducing
# the input is the main cost relief on the CPU.
PROCESS_SIZE: tuple[int, int] = (1280, 720)

# --------------------------------------------------------------------------- #
# 1b) MediaPipe Pose (33 landmarks) -> our dataset (15 keypoints)
# --------------------------------------------------------------------------- #
# MediaPipe: 0 nose | 11/12 shoulders | 13/14 elbows | 15/16 wrists |
#            23/24 hips | 25/26 knees | 27/28 ankles.
MP_SIDES: dict[str, dict[str, int]] = {
    "left":  {"shoulder": 11, "elbow": 13, "wrist": 15, "hip": 23, "knee": 25, "ankle": 27},
    "right": {"shoulder": 12, "elbow": 14, "wrist": 16, "hip": 24, "knee": 26, "ankle": 28},
}
# Joints used to decide which side is more "facing" the camera
# (essential in profile/side view, where one of the sides is occluded).
MP_VIS_CHAIN: tuple[str, ...] = ("shoulder", "hip", "knee", "ankle")
# Minimum `visibility` to trust a MediaPipe landmark.
MP_VIS_THRESHOLD = 0.5

# Connections to draw the 33-point skeleton (same as MediaPipe's).
MP_CONNECTIONS: list[tuple[int, int]] = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),          # arms
    (11, 23), (12, 24), (23, 24),                              # torso
    (23, 25), (25, 27), (24, 26), (26, 28),                    # legs
    (27, 29), (29, 31), (27, 31), (28, 30), (30, 32), (28, 32),  # feet
    (0, 11), (0, 12),                                          # head -> shoulders
]

# MediaPipe Pose parameters (as specified for the hybrid mode).
MP_MIN_DETECTION_CONF = 0.6
MP_MIN_TRACKING_CONF = 0.6
# Slack applied to the YOLO box before the crop sent to MediaPipe.
HYBRID_BOX_MARGIN = 0.15

# MediaPipe `.task` models of the new API (used if `mp.solutions` does not exist).
MP_MODELS_DIR = Path(__file__).resolve().parents[1] / "models" / "mediapipe"

# Colors of the hybrid mode rendering (BGR).
MP_BONE_COLOR = (0, 255, 180)
MP_POINT_COLOR = (0, 220, 255)


class MediaPoseExtractor:
    """
    Extracts the 33 smoothed landmarks from MediaPipe Pose.

    We prefer the classic `mp.solutions.pose.Pose` API with exactly the
    requested parameters::

        static_image_mode=False, model_complexity=2, smooth_landmarks=True,
        min_detection_confidence=0.6, min_tracking_confidence=0.6

    From MediaPipe 1.x onward the `solutions` API was removed. In that case we
    use the modern equivalent `tasks.vision.PoseLandmarker` in `RunningMode.VIDEO`
    (tracking + temporal smoothing), with the lite/full/heavy model
    corresponding to model_complexity 0/1/2.
    """

    def __init__(self, model_complexity: int = 2) -> None:
        import mediapipe as mp

        self._mp = mp
        self.api = "solutions"

        if hasattr(mp, "solutions") and hasattr(mp.solutions, "pose"):
            self._pose = mp.solutions.pose.Pose(
                static_image_mode=False,
                model_complexity=model_complexity,
                smooth_landmarks=True,
                enable_segmentation=False,
                min_detection_confidence=MP_MIN_DETECTION_CONF,
                min_tracking_confidence=MP_MIN_TRACKING_CONF,
            )
            self._connections = [(int(a), int(b))
                                 for a, b in mp.solutions.pose.POSE_CONNECTIONS]
            return

        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python import vision

        self.api = "tasks"
        name = {0: "lite", 1: "full", 2: "heavy"}.get(int(model_complexity), "full")
        model_path = MP_MODELS_DIR / f"pose_landmarker_{name}.task"
        if not model_path.exists():
            raise FileNotFoundError(
                f"MediaPipe model not found: {model_path}\n"
                "Download the corresponding .task file (pose_landmarker_lite/full/heavy) "
                f"to {MP_MODELS_DIR}"
            )
        options = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=MP_MIN_DETECTION_CONF,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=MP_MIN_TRACKING_CONF,
            output_segmentation_masks=False,
        )
        self._pose = vision.PoseLandmarker.create_from_options(options)
        self._ts_ms = 0            # monotonic timestamp (int, required by the API)
        # The new API publishes the connections; we use ours as a fallback.
        try:
            self._connections = [(int(c.start), int(c.end))
                                 for c in vision.PoseLandmarksConnections.POSE_LANDMARKS]
        except Exception:
            self._connections = list(MP_CONNECTIONS)

    def extract(self, img_bgr: np.ndarray,
                offset: tuple[int, int] = (0, 0)) -> dict | None:
        """
        Runs MediaPipe on `img_bgr` and returns the coordinates in the ORIGINAL frame:
            {"xy": (33, 2) px, "vis": (33,), "z": (33,)}
        Returns None if no pose is found.
        """
        h, w = img_bgr.shape[:2]
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        if self.api == "solutions":
            res = self._pose.process(rgb)
            if res.pose_landmarks is None:
                return None
            landmarks = res.pose_landmarks.landmark
        else:
            mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB,
                                      data=np.ascontiguousarray(rgb))
            self._ts_ms += 33          # just monotonic (~30 fps), integer
            res = self._pose.detect_for_video(mp_image, int(self._ts_ms))
            if not res.pose_landmarks:
                return None
            landmarks = res.pose_landmarks[0]

        xy = np.array([[lm.x * w + offset[0], lm.y * h + offset[1]] for lm in landmarks],
                      dtype=np.float64)
        vis = np.array([float(getattr(lm, "visibility", 1.0)) for lm in landmarks])
        z = np.array([float(getattr(lm, "z", 0.0)) for lm in landmarks])
        return {"xy": xy, "vis": vis, "z": z}

    def connections(self) -> list[tuple[int, int]]:
        return self._connections

    def close(self) -> None:
        try:
            self._pose.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# 2) Trigonometry: joint angle computation
# --------------------------------------------------------------------------- #
def calculate_angle(a: tuple[float, float],
                    b: tuple[float, float],
                    c: tuple[float, float]) -> float:
    """
    Computes the angle (in degrees) at vertex `b`, formed by the vectors b->a and b->c.

    Used, for example, for:
        * Knee angle = calculate_angle(hip, knee, ankle)
        * Hip angle  = calculate_angle(shoulder, hip, knee)

    Formula: angle = arccos( (BA . BC) / (|BA| * |BC|) )

    Parameters
    ----------
    a, b, c : tuples (x, y) in pixels. `b` is the vertex (the joint).

    Returns
    -------
    float : angle in degrees in the range [0, 180].
    """
    # Vectors originating at vertex b.
    ba = np.array([a[0] - b[0], a[1] - b[1]], dtype=np.float64)
    bc = np.array([c[0] - b[0], c[1] - b[1]], dtype=np.float64)

    norm_ba = np.linalg.norm(ba)
    norm_bc = np.linalg.norm(bc)
    if norm_ba == 0 or norm_bc == 0:
        return float("nan")  # coincident points -> undefined angle

    # Clip guarantees numerical stability of arccos within [-1, 1].
    cos_theta = float(np.clip(np.dot(ba, bc) / (norm_ba * norm_bc), -1.0, 1.0))
    return float(math.degrees(math.acos(cos_theta)))


def _angle_from_vertical(p_low: tuple[float, float],
                         p_high: tuple[float, float]) -> float:
    """
    Angle (degrees) of a segment relative to the image vertical (the -y axis).

    E.g.: torso lean = _angle_from_vertical(hip, shoulder).
    0° = fully upright; larger values = increasingly leaning torso.
    """
    dx = p_high[0] - p_low[0]
    dy = p_high[1] - p_low[1]
    # In image coordinates, "up" is -y.
    return float(math.degrees(math.atan2(abs(dx), abs(dy))))


# --------------------------------------------------------------------------- #
# 3) Squat postural validation rules
# --------------------------------------------------------------------------- #
class SquatRules:
    """
    Biomechanical thresholds of the squat (adjustable per athlete).

    Knee angle convention (hip-knee-ankle):
        180° = fully extended leg (standing)
        ~90° = thigh parallel to the ground (bottom of the squat)

    Each threshold can be overridden via a config file (--config) or by a CLI
    argument. The values below are just the defaults.
    """

    def __init__(self, stand_knee_angle: float = 160.0,
                 bottom_knee_angle_ok: float = 105.0,
                 bottom_knee_angle_min: float = 100.0,
                 max_torso_lean_deg: float = 45.0,
                 max_knee_asymmetry_deg: float = 15.0) -> None:
        # Above this -> considered "standing".
        self.STAND_KNEE_ANGLE = stand_knee_angle
        # At the bottom, the knee must reach UP TO this value.
        self.BOTTOM_KNEE_ANGLE_OK = bottom_knee_angle_ok
        # Below this it is no longer required (very deep is ok).
        self.BOTTOM_KNEE_ANGLE_MIN = bottom_knee_angle_min
        # Maximum acceptable torso lean.
        self.MAX_TORSO_LEAN_DEG = max_torso_lean_deg
        # Maximum asymmetry between the left and right leg at the bottom (knee).
        self.MAX_KNEE_ASYMMETRY_DEG = max_knee_asymmetry_deg


# --------------------------------------------------------------------------- #
# 4) Main analyzer
# --------------------------------------------------------------------------- #
class SquatPoseAnalyzer:
    """
    Encapsulates the YOLO-Pose model and the squat evaluation logic.

    `mode`:
        "hybrid" (default) -> YOLO detects the athlete + MediaPipe extracts the
                              smoothed landmarks (angles computed on the
                              MediaPipe points, with automatic side selection);
        "yolo"             -> only the 15 keypoints of our model.
    """

    def __init__(self, weights: str | Path, conf: float = 0.4,
                 rules: SquatRules | None = None, mode: str = "hybrid",
                 mp_complexity: int = 2):
        # Local import: keeps the module importable without Ultralytics installed.
        from ultralytics import YOLO

        self.weights_path = Path(weights)
        self.model = YOLO(str(weights))
        self.conf = conf
        self.rules = rules or SquatRules()
        self.mode = mode

        # MediaPipe is created on demand: if it is not installed (or the `.task`
        # model is missing), we automatically fall back to the "yolo" mode.
        self._pose_extractor: MediaPoseExtractor | None = None
        if mode == "hybrid":
            try:
                self._pose_extractor = MediaPoseExtractor(mp_complexity)
            except Exception as exc:      # pragma: no cover - depends on the environment
                print(f"[warning] MediaPipe unavailable ({exc}); using 'yolo' mode.")
                self.mode = "yolo"

        # Simple state machine for repetition counting.
        self.rep_count = 0
        self._stage = "stand"          # "stand" | "down"
        self._reached_depth = False    # reached minimum depth on the descent

        # Accumulation of the detailed session report.
        self.mp_complexity = int(mp_complexity)
        self._frame_idx = 0
        self._angle_samples: dict[str, list[float]] = {
            "knee": [], "hip": [], "torso_lean": []}
        self._report = self._new_report()

    def close(self) -> None:
        """Releases the MediaPipe resources (if in use)."""
        if self._pose_extractor is not None:
            self._pose_extractor.close()
            self._pose_extractor = None

    # -------------------------------- report ------------------------------- #
    def _new_report(self) -> dict:
        """Empty structure of the detailed session report."""
        return {
            "mode": self.mode,
            "mediapipe": {
                "api": (self._pose_extractor.api
                        if self._pose_extractor is not None else None),
                "model_complexity": self.mp_complexity,
            },
            "frames_processed": 0,
            "frames_with_detection": 0,
            "status_count": {"CORRECT": 0, "INCORRECT": 0, "NO DATA": 0},
            "reason_count": {},
            "chosen_side": {"left": 0, "right": 0},
            "angle_statistics": {},
            "repetitions": 0,
            "alerts": [],
        }

    def _accumulate(self, metrics: dict) -> None:
        """Updates the report with the metrics of one processed frame."""
        rep = self._report
        rep["frames_processed"] += 1
        if metrics.get("detected"):
            rep["frames_with_detection"] += 1

        status = metrics.get("status", "NO DATA")
        rep["status_count"][status] = rep["status_count"].get(status, 0) + 1

        angles = metrics.get("angles") or {}
        side = angles.get("side")
        if side in rep["chosen_side"]:
            rep["chosen_side"][side] += 1

        for key, samples in self._angle_samples.items():
            value = angles.get(key)
            if value is not None and math.isfinite(value):
                samples.append(float(value))

        reason = metrics.get("reason")
        if status == "INCORRECT" and reason:
            rep["reason_count"][reason] = rep["reason_count"].get(reason, 0) + 1
            if len(rep["alerts"]) < 5000:      # safety ceiling
                rep["alerts"].append({
                    "frame": self._frame_idx,
                    "status": status,
                    "reason": reason,
                    "angles": {k: round(v, 1) for k, v in angles.items()
                               if isinstance(v, (int, float))},
                })
        rep["repetitions"] = self.rep_count

    def save_report(self, path: str | Path) -> Path:
        """Computes the final statistics and writes the session JSON report."""
        rep = self._report

        for key, samples in self._angle_samples.items():
            if not samples:
                rep["angle_statistics"][key] = {
                    "n": 0, "mean": None, "min": None, "max": None}
                continue
            arr = np.asarray(samples, dtype=np.float64)
            rep["angle_statistics"][key] = {
                "n": int(arr.size),
                "mean": round(float(arr.mean()), 1),
                "min": round(float(arr.min()), 1),
                "max": round(float(arr.max()), 1),
            }

        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(rep, f, ensure_ascii=False, indent=2)
        print(f"[report] Session saved to: {out}")
        return out

    # ------------------------------- geometry ------------------------------ #
    @staticmethod
    def _best_box(result) -> np.ndarray | None:
        """xyxy bbox (pixels) of the largest-area athlete detected by YOLO."""
        if result.boxes is None or len(result.boxes) == 0:
            return None
        boxes = result.boxes.xyxy.cpu().numpy()
        areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
        return boxes[int(np.argmax(areas))]

    @staticmethod
    def _kps_xy_conf(result) -> tuple[np.ndarray, np.ndarray]:
        """
        Extracts keypoints (x,y) and confidences from the first detected result.

        Returns arrays in the (K, 2) and (K,) formats.
        """
        if result.keypoints is None or result.keypoints.xy is None:
            return np.empty((0, 2)), np.empty((0,))

        xy = result.keypoints.xy.cpu().numpy()          # (n_people, K, 2)
        conf = (result.keypoints.conf.cpu().numpy()     # (n_people, K)
                if result.keypoints.conf is not None
                else np.ones(xy.shape[:2]))

        if xy.shape[0] == 0:
            return np.empty((0, 2)), np.empty((0,))

        # Keep only the largest-area person (main athlete).
        if xy.shape[0] > 1:
            boxes_xyxy = result.boxes.xyxy.cpu().numpy()
            areas = ((boxes_xyxy[:, 2] - boxes_xyxy[:, 0]) *
                     (boxes_xyxy[:, 3] - boxes_xyxy[:, 1]))
            best = int(np.argmax(areas))
        else:
            best = 0

        return xy[best], conf[best]

    def _leg_angles(self, kxy: np.ndarray, kconf: np.ndarray) -> dict:
        """
        Computes the knee and hip angles for each leg.

        Returns a dictionary with the valid angles (reliable keypoints).
        """
        def ok(*idxs: int) -> bool:
            return all(kconf[i] >= KP_CONF_THRESHOLD for i in idxs)

        out: dict[str, float] = {}

        # Left leg (indices 7,9,11) and right leg (8,10,12).
        if ok(L_HIP, L_KNEE, L_ANKLE):
            out["knee_left"] = calculate_angle(kxy[L_HIP], kxy[L_KNEE], kxy[L_ANKLE])
            out["hip_left"] = calculate_angle(kxy[L_SHOULDER], kxy[L_HIP], kxy[L_KNEE])
        if ok(R_HIP, R_KNEE, R_ANKLE):
            out["knee_right"] = calculate_angle(kxy[R_HIP], kxy[R_KNEE], kxy[R_ANKLE])
            out["hip_right"] = calculate_angle(kxy[R_SHOULDER], kxy[R_HIP], kxy[R_KNEE])

        # Torso: lean relative to the vertical (uses the most reliable hip).
        if ok(L_HIP, L_SHOULDER):
            out["torso_lean"] = _angle_from_vertical(kxy[L_HIP], kxy[L_SHOULDER])
        elif ok(R_HIP, R_SHOULDER):
            out["torso_lean"] = _angle_from_vertical(kxy[R_HIP], kxy[R_SHOULDER])

        return out

    # --------------------- MediaPipe geometry (hybrid mode) ---------------- #
    @staticmethod
    def _side_visibility(vis: np.ndarray, side: str) -> float:
        """Mean visibility of the key joints (shoulder/hip/knee/ankle)."""
        return float(np.mean([vis[MP_SIDES[side][j]] for j in MP_VIS_CHAIN]))

    def _pick_side(self, vis: np.ndarray) -> tuple[str, float]:
        """
        Automatically chooses the side (left/right) with the HIGHEST mean visibility.

        In profile/side view the side facing the camera has high visibility and
        the hidden side drops; choosing the highest avoids the "shadow" of the
        blocked side and stabilizes the triangulation.
        """
        l = self._side_visibility(vis, "left")
        r = self._side_visibility(vis, "right")
        return ("left", l) if l >= r else ("right", r)

    def _mp_angles(self, xy: np.ndarray, vis: np.ndarray) -> dict:
        """
        Biomechanical angles (knee, hip and spine) from the 33 smoothed
        MediaPipe landmarks, using the side with the highest visibility.

        Returns a dict compatible with `evaluate()` (keys knee_left/knee_right
        + torso_lean) and with the rendering (keys knee/hip/side).
        """
        side, side_vis = self._pick_side(vis)
        ids = MP_SIDES[side]

        def ok(*names: str) -> bool:
            return all(vis[ids[n]] >= MP_VIS_THRESHOLD for n in names)

        out: dict = {"side": side, "side_visibility": round(side_vis, 3)}

        # Knee: hip -> knee -> ankle.
        if ok("hip", "knee", "ankle"):
            out["knee"] = calculate_angle(xy[ids["hip"]], xy[ids["knee"]], xy[ids["ankle"]])
            out["knee_left" if side == "left" else "knee_right"] = out["knee"]

        # Hip: shoulder -> hip -> knee.
        if ok("shoulder", "hip", "knee"):
            out["hip"] = calculate_angle(xy[ids["shoulder"]], xy[ids["hip"]], xy[ids["knee"]])

        # Spine: torso lean relative to the vertical (hip -> shoulder).
        if ok("hip", "shoulder"):
            out["torso_lean"] = _angle_from_vertical(xy[ids["hip"]], xy[ids["shoulder"]])

        return out

    # ----------------------------- biometrics ------------------------------ #
    def evaluate(self, angles: dict) -> tuple[str, str, float | None]:
        """
        Evaluates the posture based on the angles and returns:
            (status, reason, reference_knee_angle)

        status: "CORRECT" | "INCORRECT" | "NO DATA"
        """
        knee_l = angles.get("knee_left")
        knee_r = angles.get("knee_right")
        valid_knees = [a for a in (knee_l, knee_r) if a is not None]

        if not valid_knees:
            return "NO DATA", "Skeleton not detected", None

        # Reference angle: mean of the visible legs.
        knee = float(np.mean(valid_knees))
        torso_lean = angles.get("torso_lean")

        reasons: list[str] = []

        # (a) Asymmetry between the legs.
        if knee_l is not None and knee_r is not None:
            if abs(knee_l - knee_r) > self.rules.MAX_KNEE_ASYMMETRY_DEG:
                reasons.append("asymmetric execution")

        # (b) Torso leaning too much.
        if torso_lean is not None and torso_lean > self.rules.MAX_TORSO_LEAN_DEG:
            reasons.append("torso leaning too much")

        # (c) Depth at the bottom of the movement.
        if knee < self.rules.STAND_KNEE_ANGLE:
            if knee > self.rules.BOTTOM_KNEE_ANGLE_OK:
                reasons.append("go lower (depth)")

        # (d) Hyperextended knee (should not exceed ~180).
        if knee > 185.0:
            reasons.append("hyperextended knee")

        status = "CORRECT" if not reasons else "INCORRECT"
        reason = "Good posture" if not reasons else " | ".join(reasons)
        return status, reason, knee

    # ----------------------------- rendering ------------------------------- #
    def _draw_no_detection_warning(self, frame: np.ndarray) -> None:
        """
        Large visual warning when no skeleton is detected.

        Helps distinguish a FRAMING problem (athlete out of frame, too far or
        poorly lit) from a model failure.
        """
        h, w = frame.shape[:2]

        msg1 = "NO SKELETON DETECTED"
        msg2 = "Adjust the framing: keep the whole body in the frame"

        # Scales the text with the width and guarantees it fits the image.
        scale = max(0.7, w / 700.0)
        thick = max(2, int(round(scale * 2)))
        (t1, _), _ = cv2.getTextSize(msg1, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
        if t1 > w - 20:
            scale *= (w - 20) / t1
            thick = max(2, int(round(scale * 2)))
            (t1, _), _ = cv2.getTextSize(msg1, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
        (t2, _), _ = cv2.getTextSize(msg2, cv2.FONT_HERSHEY_SIMPLEX, scale * 0.6, thick)

        # Semitransparent central strip + yellow border to draw attention.
        y0, y1 = int(h * 0.35), int(h * 0.65)
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, y0), (w, y1), (0, 0, 180), -1)
        cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)
        cv2.rectangle(frame, (0, y0), (w - 1, y1), (0, 215, 255), 4)

        cv2.putText(frame, msg1, ((w - t1) // 2, y0 + 55),
                    cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), thick, cv2.LINE_AA)
        cv2.putText(frame, msg2, ((w - t2) // 2, y0 + 55 + int(40 * scale)),
                    cv2.FONT_HERSHEY_SIMPLEX, scale * 0.6, (255, 255, 255), thick, cv2.LINE_AA)

    def _draw_skeleton(self, frame: np.ndarray,
                       kxy: np.ndarray, kconf: np.ndarray) -> None:
        """Draws the bones and the reliable joints."""
        for i, j in SKELETON:
            if kconf[i] >= KP_CONF_THRESHOLD and kconf[j] >= KP_CONF_THRESHOLD:
                p1 = tuple(int(v) for v in kxy[i])
                p2 = tuple(int(v) for v in kxy[j])
                cv2.line(frame, p1, p2, (0, 200, 255), 2, cv2.LINE_AA)

        for k in range(len(kxy)):
            if kconf[k] >= KP_CONF_THRESHOLD:
                cv2.circle(frame, tuple(int(v) for v in kxy[k]),
                           4, (0, 255, 0), -1, cv2.LINE_AA)

    def _draw_angle(self, frame: np.ndarray, kxy: np.ndarray, kconf: np.ndarray,
                    i_vertex: int, angle: float | None, color: tuple) -> None:
        """Writes the angle value next to the joint (vertex)."""
        if angle is None or kconf[i_vertex] < KP_CONF_THRESHOLD:
            return
        pos = (int(kxy[i_vertex][0]) + 8, int(kxy[i_vertex][1]) - 8)
        cv2.putText(frame, f"{angle:.0f}o", pos, cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, color, 2, cv2.LINE_AA)

    # -------------------- hybrid mode rendering ---------------------------- #
    def _draw_mp_skeleton(self, frame: np.ndarray,
                          xy: np.ndarray, vis: np.ndarray) -> None:
        """Draws the 33 smoothed MediaPipe landmarks (stabilized points)."""
        conns = (self._pose_extractor.connections()
                 if self._pose_extractor is not None else MP_CONNECTIONS)
        for i, j in conns:
            if i >= len(vis) or j >= len(vis):
                continue
            if vis[i] >= MP_VIS_THRESHOLD and vis[j] >= MP_VIS_THRESHOLD:
                p1 = tuple(int(v) for v in xy[i])
                p2 = tuple(int(v) for v in xy[j])
                cv2.line(frame, p1, p2, MP_BONE_COLOR, 2, cv2.LINE_AA)

        for k in range(len(xy)):
            if vis[k] >= MP_VIS_THRESHOLD:
                cv2.circle(frame, tuple(int(v) for v in xy[k]),
                           3, MP_POINT_COLOR, -1, cv2.LINE_AA)

    @staticmethod
    def _put_angle(frame: np.ndarray, point: np.ndarray,
                   angle: float, color: tuple) -> None:
        """Writes the angle value next to the point (joint)."""
        pos = (int(point[0]) + 8, int(point[1]) - 8)
        cv2.putText(frame, f"{angle:.0f}o", pos, cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, color, 2, cv2.LINE_AA)

    def _draw_mp_angles(self, frame: np.ndarray, xy: np.ndarray, vis: np.ndarray,
                        angles: dict) -> None:
        """Writes the knee, hip and spine lean of the chosen side."""
        side = angles.get("side")
        if side not in MP_SIDES:
            return
        ids = MP_SIDES[side]
        if "knee" in angles and vis[ids["knee"]] >= MP_VIS_THRESHOLD:
            self._put_angle(frame, xy[ids["knee"]], angles["knee"], (255, 255, 0))
        if "hip" in angles and vis[ids["hip"]] >= MP_VIS_THRESHOLD:
            self._put_angle(frame, xy[ids["hip"]], angles["hip"], (255, 0, 255))
        if "torso_lean" in angles and vis[ids["shoulder"]] >= MP_VIS_THRESHOLD:
            self._put_angle(frame, xy[ids["shoulder"]], angles["torso_lean"], (0, 200, 255))

    def _draw_status_panel(self, frame: np.ndarray, status: str,
                           reason: str, angles: dict | None = None) -> None:
        """Top panel: green/red status, reps and, in hybrid, the side."""
        color = (0, 200, 0) if status == "CORRECT" else (0, 0, 255)
        cv2.rectangle(frame, (10, 10), (520, 110), (0, 0, 0), -1)
        cv2.putText(frame, status, (20, 48), cv2.FONT_HERSHEY_SIMPLEX,
                    1.0, color, 2, cv2.LINE_AA)
        cv2.putText(frame, f"Reps: {self.rep_count}", (20, 85),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(frame, reason, (250, 48), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5, (255, 255, 255), 1, cv2.LINE_AA)
        if angles and angles.get("side"):
            vis = angles.get("side_visibility")
            txt = f"mode: {self.mode} | side: {angles['side']}"
            if vis is not None:
                txt += f" (vis {vis:.2f})"
            cv2.putText(frame, txt, (250, 85), cv2.FONT_HERSHEY_SIMPLEX,
                        0.5, (200, 200, 200), 1, cv2.LINE_AA)

    def _update_reps(self, knee: float | None) -> None:
        """State machine to count complete repetitions."""
        if knee is None:
            return
        r = self.rules
        if knee > r.STAND_KNEE_ANGLE:                # went up
            if self._stage == "down":
                self.rep_count += 1
            self._stage = "stand"
            self._reached_depth = False
        elif knee <= r.BOTTOM_KNEE_ANGLE_OK:         # went down to the valid bottom
            self._stage = "down"
            self._reached_depth = True

    # ------------------------------ pipeline ------------------------------- #
    def process_frame(self, frame: np.ndarray,
                      size: tuple[int, int] | None = None) -> tuple[np.ndarray, dict]:
        """
        Processes a single BGR frame: resizes (if `size` is given), detects the
        pose, computes the angles, validates the posture and returns the
        annotated frame + metrics dictionary.

        `size` = (width, height) of work; the reduction happens BEFORE
        inference, which is the most expensive step on the CPU.
        """
        if size is not None:
            frame = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)

        self._frame_idx += 1
        if self.mode == "hybrid" and self._pose_extractor is not None:
            annotated, metrics = self._process_hybrid(frame)
        else:
            annotated, metrics = self._process_yolo(frame)

        self._accumulate(metrics)
        metrics["reps"] = self.rep_count
        return annotated, metrics

    def _process_yolo(self, frame: np.ndarray) -> tuple[np.ndarray, dict]:
        """Old path: only the 15 keypoints of our YOLO-Pose model."""
        result = self.model.predict(frame, conf=self.conf, verbose=False)[0]
        kxy, kconf = self._kps_xy_conf(result)

        metrics: dict = {"angles": {}, "status": "NO DATA",
                         "reason": "Skeleton not detected",
                         "reps": self.rep_count, "detected": False}
        if kxy.size == 0:
            self._draw_no_detection_warning(frame)
            return frame, metrics

        angles = self._leg_angles(kxy, kconf)
        status, reason, knee_ref = self.evaluate(angles)
        self._update_reps(knee_ref)

        self._draw_skeleton(frame, kxy, kconf)
        self._draw_angle(frame, kxy, kconf, L_KNEE, angles.get("knee_left"), (255, 255, 0))
        self._draw_angle(frame, kxy, kconf, R_KNEE, angles.get("knee_right"), (255, 255, 0))
        self._draw_angle(frame, kxy, kconf, L_HIP, angles.get("hip_left"), (255, 0, 255))
        self._draw_angle(frame, kxy, kconf, R_HIP, angles.get("hip_right"), (255, 0, 255))
        self._draw_status_panel(frame, status, reason)

        metrics.update(angles=angles, status=status, reason=reason,
                       reps=self.rep_count, detected=True)
        return frame, metrics

    def _process_hybrid(self, frame: np.ndarray) -> tuple[np.ndarray, dict]:
        """
        Hybrid path: YOLO detects the athlete (Earth/Space domain robustness)
        and MediaPipe extracts the 33 smoothed 3D landmarks in the box crop;
        the angles are computed over these stabilized points.
        """
        h, w = frame.shape[:2]
        metrics: dict = {"angles": {}, "status": "NO DATA",
                         "reason": "Skeleton not detected",
                         "reps": self.rep_count, "detected": False}

        # 1) YOLO -> athlete box (keeps the domain robustness).
        result = self.model.predict(frame, conf=self.conf, verbose=False)[0]
        box = self._best_box(result)
        if box is None:
            self._draw_no_detection_warning(frame)
            return frame, metrics

        # 2) Crop with margin; MediaPipe runs with more pixels per joint.
        mx = HYBRID_BOX_MARGIN * (box[2] - box[0])
        my = HYBRID_BOX_MARGIN * (box[3] - box[1])
        x0 = int(max(0, box[0] - mx)); y0 = int(max(0, box[1] - my))
        x1 = int(min(w, box[2] + mx)); y1 = int(min(h, box[3] + my))
        crop = frame[y0:y1, x0:x1]
        if crop.size == 0:
            crop, x0, y0 = frame, 0, 0

        det = self._pose_extractor.extract(crop, offset=(x0, y0))
        if det is None:
            self._draw_no_detection_warning(frame)
            metrics["reason"] = "MediaPipe did not find the pose"
            return frame, metrics

        xy, vis = det["xy"], det["vis"]

        # 3) Biomechanical angles over the smoothed points (automatic side).
        angles = self._mp_angles(xy, vis)
        metrics["angles"] = angles
        metrics["detected"] = True

        # 4) Postural validation + repetition counting.
        status, reason, knee_ref = self.evaluate(angles)
        self._update_reps(knee_ref)

        # 5) Rendering: YOLO box + smoothed skeleton + alerts.
        cv2.rectangle(frame, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])),
                      (120, 120, 120), 1, cv2.LINE_AA)
        self._draw_mp_skeleton(frame, xy, vis)
        self._draw_mp_angles(frame, xy, vis, angles)
        self._draw_status_panel(frame, status, reason, angles)

        metrics.update(status=status, reason=reason, reps=self.rep_count)
        return frame, metrics


# --------------------------------------------------------------------------- #
# 5) Input / output: image, video or webcam
# --------------------------------------------------------------------------- #
def process_image(analyzer: SquatPoseAnalyzer, src: Path, dst: Path) -> dict:
    img = cv2.imread(str(src))
    if img is None:
        raise FileNotFoundError(f"Could not read the image: {src}")
    annotated, metrics = analyzer.process_frame(img)
    cv2.imwrite(str(dst), annotated)
    print(f"[img] {src.name} -> {dst.name} | {metrics['status']} | {metrics['reason']}")
    return metrics


WINDOW_NAME = "Orion - Squat Analysis (q to quit)"


def _fit_to_window(win: str, frame: np.ndarray) -> np.ndarray:
    """
    Resizes `frame` to fill the `win` window WITHOUT distorting (keeps the
    aspect ratio) and centers the result on a black screen. Used in fullscreen.
    """
    rect = cv2.getWindowImageRect(win)
    w, h = rect[2], rect[3]
    fh, fw = frame.shape[:2]
    if w <= 0 or h <= 0:
        return frame

    scale = min(w / fw, h / fh)
    nw, nh = max(1, int(fw * scale)), max(1, int(fh * scale))
    resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)

    canvas = np.zeros((h, w, 3), dtype=frame.dtype)
    y0, x0 = (h - nh) // 2, (w - nw) // 2
    canvas[y0:y0 + nh, x0:x0 + nw] = resized
    return canvas


def process_video(analyzer: SquatPoseAnalyzer, src: str, dst: Path | None,
                  size: tuple[int, int] = PROCESS_SIZE,
                  fullscreen: bool = False,
                  max_frames: int | None = None,
                  report: Path | None = None) -> None:
    cap = cv2.VideoCapture(int(src) if str(src).isdigit() else str(src))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open the video source: {src}")

    # Resizable window; in fullscreen the frame is adjusted without distortion.
    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    if fullscreen:
        cv2.setWindowProperty(WINDOW_NAME, cv2.WND_PROP_FULLSCREEN,
                              cv2.WINDOW_FULLSCREEN)

    writer = None
    fps = cap.get(cv2.CAP_PROP_FPS) or 25

    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        # Resize to the working resolution before inference.
        annotated, _ = analyzer.process_frame(frame, size=size)

        # The writer is created on the 1st frame, already with the working resolution.
        if dst is not None and writer is None:
            h, w = annotated.shape[:2]
            writer = cv2.VideoWriter(str(dst), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        if writer is not None:
            writer.write(annotated)

        display = _fit_to_window(WINDOW_NAME, annotated) if fullscreen else annotated
        cv2.imshow(WINDOW_NAME, display)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

        idx += 1
        if max_frames and idx >= max_frames:
            break

    cap.release()
    if writer is not None:
        writer.release()
    cv2.destroyAllWindows()
    print(f"[video] Processed {idx} frames | Reps detected: {analyzer.rep_count}")

    # Detailed session JSON report + resource release.
    if report is not None:
        analyzer.save_report(report)
    analyzer.close()


# Default settings. They can be overridden by a JSON file (--config)
# and, finally, by the CLI arguments (which have the highest priority).
DEFAULTS: dict = {
    "weights": None,          # None -> models/best_exercise_pose.pt (see __main__)
    "source": None,           # image, video or webcam index (e.g.: 0)
    "output": None,
    "conf": 0.4,
    "size": "1280x720",       # "WIDTHxHEIGHT" (real webcam resolution)
    "fullscreen": False,
    "mode": "hybrid",         # "hybrid" (YOLO + MediaPipe) | "yolo"
    "mp_complexity": 2,       # MediaPipe: 0=lite, 1=full, 2=heavy
    "report": None,           # path of the JSON report (default: next to the video)
    "stand_knee_angle": 160.0,
    "bottom_knee_ok": 105.0,
    "bottom_knee_min": 100.0,
    "max_torso_lean": 45.0,
    "max_knee_asymmetry": 15.0,
}


def _load_config(path: Path | None) -> dict:
    """Reads a JSON config file (returns {} if `path` is None)."""
    if path is None:
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _parse_size(value) -> tuple[int, int]:
    """Converts '1280x720' (or a list [1280, 720]) into (width, height)."""
    if isinstance(value, (list, tuple)):
        return int(value[0]), int(value[1])
    w, h = str(value).lower().replace(" ", "").split("x")
    return int(w), int(h)


def _resolve_config(args: argparse.Namespace) -> dict:
    """Merges: defaults < JSON file < CLI arguments (CLI wins)."""
    cfg = {**DEFAULTS, **_load_config(Path(args.config) if args.config else None)}
    values: dict = {}
    for key in DEFAULTS:
        cli_value = getattr(args, key)
        values[key] = cli_value if cli_value is not None else cfg.get(key, DEFAULTS[key])
    return values


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Squat biomechanical analysis (Orion).")
    p.add_argument("--config", type=str, default=None,
                   help="JSON file with the settings. The CLI has priority over it.")
    p.add_argument("--weights", type=str, default=None,
                   help="Trained YOLO-Pose weights (default: models/best_exercise_pose.pt)")
    p.add_argument("--source", type=str, default=None,
                   help="Image, video, or webcam index (e.g.: 0)")
    p.add_argument("--output", type=str, default=None,
                   help="Output file (annotated image or video). Optional.")
    p.add_argument("--conf", type=float, default=None, help="Minimum detection confidence.")
    p.add_argument("--size", type=str, default=None,
                   help="Working resolution WIDTHxHEIGHT (e.g.: 1280x720).")
    p.add_argument("--fullscreen", action="store_true", default=None,
                   help="Displays the window in fullscreen.")
    p.add_argument("--mode", type=str, default=None, choices=["hybrid", "yolo"],
                   help="'hybrid' (YOLO + MediaPipe) or 'yolo' (YOLO only).")
    p.add_argument("--mp-complexity", type=int, default=None,
                   help="MediaPipe Pose complexity: 0=lite, 1=full, 2=heavy.")
    p.add_argument("--report", type=str, default=None,
                   help="Path of the session JSON report (default: next to the video).")
    p.add_argument("--stand-knee-angle", type=float, default=None,
                   help="Knee angle above which the athlete is considered standing.")
    p.add_argument("--bottom-knee-ok", type=float, default=None,
                   help="Maximum knee angle at the bottom of the squat.")
    p.add_argument("--bottom-knee-min", type=float, default=None,
                   help="Minimum required knee angle (below this it is not penalized).")
    p.add_argument("--max-torso-lean", type=float, default=None,
                   help="Maximum acceptable torso lean (degrees).")
    p.add_argument("--max-knee-asymmetry", type=float, default=None,
                   help="Maximum asymmetry between the legs at the bottom (degrees).")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    values = _resolve_config(args)

    if values["source"] is None:
        raise SystemExit("Provide the source with --source (e.g.: --source 0) or in the config file.")
    if values["weights"] is None:
        values["weights"] = str(Path(__file__).resolve().parents[1]
                                / "models" / "best_exercise_pose.pt")

    rules = SquatRules(
        stand_knee_angle=float(values["stand_knee_angle"]),
        bottom_knee_angle_ok=float(values["bottom_knee_ok"]),
        bottom_knee_angle_min=float(values["bottom_knee_min"]),
        max_torso_lean_deg=float(values["max_torso_lean"]),
        max_knee_asymmetry_deg=float(values["max_knee_asymmetry"]),
    )
    analyzer = SquatPoseAnalyzer(weights=values["weights"],
                                 conf=float(values["conf"]), rules=rules,
                                 mode=str(values["mode"]),
                                 mp_complexity=int(values["mp_complexity"]))

    src = values["source"]
    src_path = Path(str(src))
    is_image = src_path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    report_cfg = values["report"]

    if is_image:
        out = Path(values["output"]) if values["output"] else src_path.with_name(
            f"{src_path.stem}_annotated{src_path.suffix}")
        process_image(analyzer, src_path, out)
        report = Path(report_cfg) if report_cfg else out.with_name(
            f"{out.stem}_report.json")
        analyzer.save_report(report)
        analyzer.close()
    else:
        out = Path(values["output"]) if values["output"] else None
        if report_cfg:
            report = Path(report_cfg)
        elif out is not None:
            report = out.with_name(f"{out.stem}_report.json")
        else:
            report = Path("session_report.json")
        process_video(analyzer, src, out, size=_parse_size(values["size"]),
                      fullscreen=bool(values["fullscreen"]), report=report)
