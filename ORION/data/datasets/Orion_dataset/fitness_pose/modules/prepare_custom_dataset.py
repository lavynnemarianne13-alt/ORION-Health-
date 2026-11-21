"""
modules/prepare_custom_dataset.py
===============================================================================
High-resolution custom dataset pipeline  |  Orion Project
Part 1 - Physical Exercise Module (astronaut health support)

Goal
----
Process the new real captures (photos and videos from the front, sides and back,
recorded at the real webcam scale/distance) and turn them into a dataset
unified with the previous material (Earth + Space), ready for fine-tuning
at high resolution.

Why high resolution?
--------------------
The current model was trained with small frames (640 px). At real webcam
distance the athlete occupies a small fraction of the frame; compressing the
image too much destroys the pixel density over the body and amplifies the
keypoint error ("triangulation anomalies"). Here the photos are COPIED without
recompression and the video frames are saved as JPEG at quality 95 in the
NATIVE resolution.

Pipeline
--------
  1. Collect the media (photos + videos) from the captures folder.
     - Photos: copied byte by byte (zero recompression).
     - Videos: sliced into frames at the native resolution (JPEG q=95).
  2. Automatic pre-labeling (pseudo-labeling) in YOLO format:
     - `models/best_space_pose.pt` detects the ATHLETE and provides the bounding box;
     - MediaPipe Pose extracts the landmarks (33 points) and they are mapped to
       the 15 keypoints of our dataset (same convention as the previous training);
     - The result is written to `custom_dataset/<split>/labels/*.txt`.
  3. Merge with the previous dataset (Earth + Space) -> `unified_dataset/`
     (files `train.txt` / `valid.txt` + unified `data.yaml`, without copying
     images: disk savings and no duplication).
  4. Fine-tuning from `models/best_space_pose.pt` with `imgsz=960`
     (or 1280 depending on VRAM) and scale data augmentation (`scale=0.5`),
     calibrating the model for the real webcam distance.

WARNING
-------
The pseudo-labels carry the error of the current model + MediaPipe. They serve
to calibrate scale/depth and reduce anomalies, but they do not replace
manual labeling. Review the labels of `custom_dataset/` when possible.

Usage
-----
    # Full pipeline (frames + pseudo-labels + merge + fine-tuning)
    python modules/prepare_custom_dataset.py

    # Using the default captures folder (C:\\Users\\Lavynne\\Documents\\videos joão mario)
    python modules/prepare_custom_dataset.py --media-dir "C:\\path\\captures"

    # Prepare the dataset only (without training)
    python modules/prepare_custom_dataset.py --prepare-only

    # Train only (uses the already labeled custom dataset)
    python modules/prepare_custom_dataset.py --train-only --imgsz 1280

Requirements:
    pip install ultralytics opencv-python numpy mediapipe pyyaml
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import tempfile
import unicodedata
from pathlib import Path

import cv2
import numpy as np
import yaml

# Ultralytics writes cache/fonts into AppData\Roaming\Ultralytics by default, which
# may be blocked by sandbox. We redirect it to a project folder.
os.environ.setdefault(
    "YOLO_CONFIG_DIR", str(Path(__file__).resolve().parents[2] / ".ultralytics"))

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
PROJECT_ROOT = Path(__file__).resolve().parents[1]      # .../fitness_pose
ORION_ROOT = PROJECT_ROOT.parent                        # .../Orion_dataset
MODELS_DIR = PROJECT_ROOT / "models"
MP_MODELS_DIR = MODELS_DIR / "mediapipe"

# Default folder of the new real captures (front, sides, back).
DEFAULT_MEDIA_DIR = Path(
    r"C:\Users\Lavynne\Documents\videos joão mario")

# Outputs.
DEFAULT_CUSTOM_ROOT = ORION_ROOT / "custom_dataset"     # only the new data
DEFAULT_UNIFIED_ROOT = ORION_ROOT / "unified_dataset"   # Earth + Space + new

# Starting weights of the fine-tuning (current space model) and result name.
DEFAULT_START_WEIGHTS = MODELS_DIR / "best_space_pose.pt"
OUTPUT_WEIGHTS_NAME = "best_custom_pose.pt"

# Previous datasets (merged into the new one).
TERRESTRIAL_ROOT = ORION_ROOT
SPACE_ROOT = ORION_ROOT / "space_dataset"

# Label format (same as the previous training).
NUM_KEYPOINTS = 15
KP_SHAPE = [NUM_KEYPOINTS, 3]
FLIP_IDX = list(range(NUM_KEYPOINTS))
CLASS_NAME = "lifter"

# Mapping MediaPipe(33) -> our dataset(15).
# MediaPipe: 0 nose | 11/12 shoulders | 13/14 elbows | 15/16 wrists |
#            23/24 hips | 25/26 knees | 27/28 ankles.
# Ours:      0 head | 1/2 shoulders | 3/4 elbows | 5/6 wrists |
#            7/8 hips | 9/10 knees | 11/12 ankles | 13/14 hands.
# Note: 13/14 (hands) use the wrists as a proxy, exactly as in the previous
# COCO mapping -> keeps the convention the model has already learned.
MP_TO_DATASET = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 15, 16]

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}

# Default hyperparameters.
DEFAULT_FPS = 2.0            # frames extracted per second of video
DEFAULT_QUALITY = 95         # JPEG quality (preserves pixel density)
DEFAULT_VAL_RATIO = 0.15     # fraction of the new data destined to validation
DEFAULT_DET_CONF = 0.35      # minimum confidence for the YOLO bbox
DEFAULT_KP_CONF = 0.35       # minimum confidence/visibility for the keypoint
DEFAULT_MP_COMPLEXITY = 2    # 0=lite, 1=full, 2=heavy

DEFAULT_EPOCHS = 25
DEFAULT_IMGSZ = 960          # high resolution (use 1280 depending on VRAM)
DEFAULT_BATCH = 8            # conservative batch for CPU
DEFAULT_SCALE = 0.5          # scale augmentation (calibrates real distance)
DEFAULT_LR0 = 0.001          # reduced LR: adaptation, not re-training


# --------------------------------------------------------------------------- #
# 0) Utilities (names, accent-free I/O, deterministic split)
# --------------------------------------------------------------------------- #
def _imread(path: Path) -> np.ndarray | None:
    """
    Read an image on Windows even with accented characters in the path.

    `cv2.imread` uses the ANSI locale and fails (returns None) on non-ASCII
    paths. Here we read the bytes with `np.fromfile` and decode them in memory.
    """
    try:
        buf = np.fromfile(str(path), dtype=np.uint8)
    except OSError:
        return None
    if buf.size == 0:
        return None
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def _imwrite(path: Path, img: np.ndarray, quality: int = DEFAULT_QUALITY) -> bool:
    """Write an image as JPEG preserving the quality (avoids `cv2.imwrite`)."""
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    buf.tofile(str(path))
    return True


def _safe_stem(path: Path, max_len: int = 32) -> str:
    """Generate a short, safe ASCII file name from the original name."""
    # Remove accents and special characters.
    text = unicodedata.normalize("NFKD", path.stem)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = "".join(c if c.isalnum() or c in "_-" else "_" for c in text).strip("_")
    text = "_".join(p for p in text.split("_") if p)
    return text[:max_len] or "media"


def _dest_name(path: Path, ext: str) -> str:
    """Unique destination name: <stem>_<hash8><ext> (avoids collisions)."""
    h = hashlib.md5(str(path).encode("utf-8")).hexdigest()[:8]
    return f"{_safe_stem(path)}_{h}{ext}"


def _deterministic_split(name: str, val_ratio: float) -> str:
    """Split train/valid by name hash (re-runs give the same split)."""
    if val_ratio <= 0:
        return "train"
    digest = int(hashlib.md5(name.encode("utf-8")).hexdigest(), 16)
    return "valid" if (digest % 1000) < int(val_ratio * 1000) else "train"


# --------------------------------------------------------------------------- #
# 1) MediaPipe extractor (classic or modern API)
# --------------------------------------------------------------------------- #
def _create_pose(model_complexity: int, video_mode: bool) -> dict:
    """
    Create the MediaPipe pose extractor.

    We prefer the classic API `mp.solutions.pose.Pose` (which accepts
    `smooth_landmarks` and `model_complexity`). If the installed version does
    not offer it, we fall back to the modern API `tasks.vision.PoseLandmarker`
    (equivalent: VIDEO mode = temporal smoothing; lite/full/heavy = 0/1/2).

    `video_mode=True` enables tracking/smoothing between frames.
    """
    import mediapipe as mp

    if hasattr(mp, "solutions") and hasattr(mp.solutions, "pose"):
        return {
            "api": "solutions",
            "pose": mp.solutions.pose.Pose(
                static_image_mode=not video_mode,
                model_complexity=model_complexity,
                smooth_landmarks=video_mode,
                enable_segmentation=False,
                min_detection_confidence=0.6,
                min_tracking_confidence=0.6,
            ),
        }

    # Modern API (tasks).
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python import vision

    name = {0: "lite", 1: "full", 2: "heavy"}.get(model_complexity, "full")
    model_path = MP_MODELS_DIR / f"pose_landmarker_{name}.task"
    if not model_path.exists():
        raise FileNotFoundError(
            f"MediaPipe model not found: {model_path}\n"
            "Download from https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
            f"pose_landmarker_{name}/float16/latest/pose_landmarker_{name}.task"
        )
    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO if video_mode else vision.RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.6,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.6,
        output_segmentation_masks=False,
    )
    return {
        "api": "tasks",
        "pose": vision.PoseLandmarker.create_from_options(options),
        "video_mode": video_mode,
        "ts_ms": 0,
    }


def _pose_detect(handle: dict, img_bgr: np.ndarray,
                 offset: tuple[int, int] = (0, 0)) -> tuple[np.ndarray, np.ndarray] | None:
    """
    Run MediaPipe on `img_bgr` and return (xy, vis):
        xy  : (33, 2) in pixels of the ORIGINAL frame (applies the crop `offset`)
        vis : (33,)   visibility/presence of each landmark
    Returns None if no pose is found.
    """
    import mediapipe as mp

    h, w = img_bgr.shape[:2]
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    if handle["api"] == "solutions":
        res = handle["pose"].process(rgb)
        if res.pose_landmarks is None:
            return None
        landmarks = res.pose_landmarks.landmark
    else:
        rgb = np.ascontiguousarray(rgb)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        if handle["video_mode"]:
            handle["ts_ms"] += 33     # ~30 fps fictitious, just monotonic (int)
            res = handle["pose"].detect_for_video(mp_image, int(handle["ts_ms"]))
        else:
            res = handle["pose"].detect(mp_image)
        if not res.pose_landmarks:
            return None
        landmarks = res.pose_landmarks[0]

    xy = np.array([[lm.x * w + offset[0], lm.y * h + offset[1]] for lm in landmarks],
                  dtype=np.float64)
    vis = np.array([getattr(lm, "visibility", 1.0) for lm in landmarks], dtype=np.float64)
    return xy, vis


def _bbox_from_landmarks(xy: np.ndarray, vis: np.ndarray, w: int, h: int,
                         kp_conf: float) -> np.ndarray | None:
    """Derive a bbox (xyxy in pixels) from the visible landmarks."""
    idx = np.where(vis >= kp_conf)[0]
    if idx.size < 4:
        return None
    pts = xy[idx]
    x1, y1 = pts[:, 0].min(), pts[:, 1].min()
    x2, y2 = pts[:, 0].max(), pts[:, 1].max()
    # 10% margin (same slack used in the pose annotation).
    mx, my = 0.10 * (x2 - x1), 0.10 * (y2 - y1)
    return np.array([max(0.0, x1 - mx), max(0.0, y1 - my),
                     min(float(w - 1), x2 + mx), min(float(h - 1), y2 + my)])


# --------------------------------------------------------------------------- #
# 2) Media collection -> custom_dataset/<split>/images
# --------------------------------------------------------------------------- #
def _list_media(media_dir: Path) -> tuple[list[Path], list[Path]]:
    images, videos = [], []
    for p in sorted(media_dir.iterdir()):
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        if ext in IMAGE_EXTS:
            images.append(p)
        elif ext in VIDEO_EXTS:
            videos.append(p)
    return images, videos


def _open_capture(path: Path) -> tuple[cv2.VideoCapture, Path | None]:
    """
    Open a video on Windows working around accented paths.

    `cv2.VideoCapture` also uses the ANSI locale; if it fails, we copy the file
    to a temporary ASCII name and open that copy. Returns (capture, tmp):
    `tmp` must be removed by the caller after `cap.release()`.
    """
    cap = cv2.VideoCapture(str(path))
    if cap.isOpened():
        return cap, None
    cap.release()

    tmp = Path(tempfile.mkdtemp(prefix="orion_vid_")) / "video.mp4"
    shutil.copy2(path, tmp)
    return cv2.VideoCapture(str(tmp)), tmp


def copy_photos(images: list[Path], custom_root: Path, val_ratio: float) -> dict:
    """Copy the photos WITHOUT recompression (preserves the original HD resolution)."""
    counts = {"train": 0, "valid": 0}
    for src in images:
        split = _deterministic_split(src.name, val_ratio)
        dst = custom_root / split / "images" / _dest_name(src, src.suffix.lower())
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        counts[split] += 1
    print(f"[photos] {len(images)} copied without recompression "
          f"(train={counts['train']}, valid={counts['valid']})")
    return counts


def extract_video_frames(videos: list[Path], custom_root: Path, val_ratio: float,
                         fps: float, quality: int,
                         per_video: dict[str, dict] | None = None) -> dict:
    """
    Extract frames from the videos at the NATIVE resolution (JPEG q=`quality`).

    Returns/accumulates the map `per_video` = {video_dest_stem: {"frames": [names]}}
    so that the pseudo-labeling can reuse MediaPipe's temporal smoothing in
    VIDEO mode within each video.
    """
    counts = {"train": 0, "valid": 0}
    for src in videos:
        cap, tmp = _open_capture(src)
        if not cap.isOpened():
            print(f"[warning] could not open the video, skipping: {src.name}")
            continue

        src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        step = max(1, int(round(src_fps / fps))) if fps > 0 else 1
        stem = _dest_name(src, "")
        names: list[str] = []

        print(f"[video] {src.name} | {int(src_fps)} fps | {total / src_fps:.1f}s "
              f"| extracting {fps} fps (step={step})")

        idx = saved = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % step == 0:
                name = f"{stem}_f{saved:06d}"
                split = _deterministic_split(name, val_ratio)
                # Native resolution preserved: no resize here.
                _imwrite(custom_root / split / "images" / f"{name}.jpg", frame, quality)
                names.append(name)
                counts[split] += 1
                saved += 1
            idx += 1
        cap.release()
        if tmp is not None:
            shutil.rmtree(tmp.parent, ignore_errors=True)

        if per_video is not None:
            per_video[stem] = {"frames": names}
        print(f"        -> {saved} frames saved")

    print(f"[videos] {len(videos)} videos processed "
          f"(train={counts['train']}, valid={counts['valid']})")
    return counts


# --------------------------------------------------------------------------- #
# 3) Automatic pre-labeling (YOLO bbox + MediaPipe keypoints)
# --------------------------------------------------------------------------- #
def _best_box(result) -> np.ndarray | None:
    """Return the xyxy bbox (pixels) of the largest-area athlete detected by YOLO."""
    if result.boxes is None or len(result.boxes) == 0:
        return None
    boxes = result.boxes.xyxy.cpu().numpy()
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    return boxes[int(np.argmax(areas))]


def _label_line(box: np.ndarray, xy: np.ndarray, vis: np.ndarray,
                w: int, h: int, kp_conf: float) -> str:
    """Build the YOLO-pose line: `0 cx cy w h` + 15x `x y v` (normalized)."""
    x1, y1, x2, y2 = box
    cx = ((x1 + x2) / 2.0) / w
    cy = ((y1 + y2) / 2.0) / h
    bw = (x2 - x1) / w
    bh = (y2 - y1) / h

    parts = [f"{v:.6f}" for v in (cx, cy, bw, bh)]
    for our_idx in range(NUM_KEYPOINTS):
        mp_idx = MP_TO_DATASET[our_idx]
        kx, ky = xy[mp_idx]
        v = 2 if vis[mp_idx] >= kp_conf else 0
        parts.extend([f"{kx / w:.6f}", f"{ky / h:.6f}", f"{v}"])
    return "0 " + " ".join(parts)


def pseudo_label(custom_root: Path, start_weights: Path,
                 per_video: dict[str, dict] | None = None,
                 det_conf: float = DEFAULT_DET_CONF,
                 kp_conf: float = DEFAULT_KP_CONF,
                 mp_complexity: int = DEFAULT_MP_COMPLEXITY) -> dict:
    """
    Generate the pseudo-labels of the new data by combining:
      * YOLO (`start_weights`) -> athlete detection and bounding box;
      * MediaPipe Pose         -> 33 landmarks mapped to the dataset's 15.

    Frames of the same video are processed in sequence with MediaPipe in
    VIDEO mode (temporal smoothing), which reduces keypoint jitter. Isolated
    photos use IMAGE mode (deterministic, without contamination between subjects).
    """
    from ultralytics import YOLO

    model = YOLO(str(start_weights))
    stats = {"train": [0, 0], "valid": [0, 0]}   # [labeled, total]

    for split in ("train", "valid"):
        img_dir = custom_root / split / "images"
        lbl_dir = custom_root / split / "labels"
        lbl_dir.mkdir(parents=True, exist_ok=True)
        if not img_dir.exists():
            continue

        # Index frame -> video (for VIDEO mode) once per split.
        frame_to_video: dict[str, str] = {}
        for vstem, info in (per_video or {}).items():
            for fname in info["frames"]:
                frame_to_video[fname] = vstem

        # Group by video; isolated photos become groups of 1 element (IMAGE mode).
        groups: dict[str, list[str]] = {}
        for img in sorted(img_dir.iterdir()):
            if img.suffix.lower() not in IMAGE_EXTS:
                continue
            video = frame_to_video.get(img.stem)
            groups.setdefault(video or f"__photo__{img.stem}", []).append(str(img))

        for group, paths in groups.items():
            video_mode = not group.startswith("__photo__")
            pose = _create_pose(mp_complexity, video_mode=video_mode)
            for path in sorted(paths):
                img = _imread(Path(path))
                if img is None:
                    continue
                h, w = img.shape[:2]
                stats[split][1] += 1

                result = model.predict(img, conf=det_conf, verbose=False)[0]
                box = _best_box(result)

                # MediaPipe over the athlete box (focus + larger effective scale);
                # if YOLO does not detect, fall back to the whole frame.
                if box is not None:
                    mx = 0.15 * (box[2] - box[0])
                    my = 0.15 * (box[3] - box[1])
                    x0 = int(max(0, box[0] - mx))
                    y0 = int(max(0, box[1] - my))
                    x1 = int(min(w, box[2] + mx))
                    y1 = int(min(h, box[3] + my))
                    crop = img[y0:y1, x0:x1]
                    if crop.size == 0:
                        crop, x0, y0 = img, 0, 0
                    detected = _pose_detect(pose, crop, offset=(x0, y0))
                else:
                    detected = _pose_detect(pose, img)

                if detected is None:
                    continue
                xy, vis = detected

                if box is None:
                    box = _bbox_from_landmarks(xy, vis, w, h, kp_conf)
                    if box is None:
                        continue

                line = _label_line(box, xy, vis, w, h, kp_conf)
                with open(lbl_dir / f"{Path(path).stem}.txt", "w", encoding="utf-8") as f:
                    f.write(line + "\n")
                stats[split][0] += 1

            try:
                pose["pose"].close()
            except Exception:
                pass

    print(f"[pseudo] train: {stats['train'][0]}/{stats['train'][1]} labeled | "
          f"valid: {stats['valid'][0]}/{stats['valid'][1]} labeled")
    return stats


# --------------------------------------------------------------------------- #
# 4) Merge: Earth + Space + Custom -> unified_dataset
# --------------------------------------------------------------------------- #
def _list_images(d: Path) -> list[Path]:
    if not d.exists():
        return []
    out: list[Path] = []
    for p in sorted(d.iterdir()):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            out.append(p)
    return out


def _labelled_only(images: list[Path]) -> list[Path]:
    """Keep only images that have a label (`images/` -> `labels/`)."""
    keep = []
    for img in images:
        parts = list(img.parts)
        lbl = Path(*parts[:-2], "labels", f"{img.stem}.txt")
        if lbl.exists():
            keep.append(img)
    return keep


def build_unified_dataset(unified_root: Path, custom_root: Path) -> tuple[Path, dict]:
    """
    Build `train.txt`/`valid.txt` with ALL the images (Earth + Space + new)
    and a unified `data.yaml`. We do not copy images: Ultralytics locates the
    label by swapping `/images/` for `/labels/` in the image path.
    """
    sources = {
        "earth": (TERRESTRIAL_ROOT / "train" / "images",
                  TERRESTRIAL_ROOT / "valid" / "images"),
        "space": (SPACE_ROOT / "train" / "images", SPACE_ROOT / "valid" / "images"),
        "custom": (custom_root / "train" / "images", custom_root / "valid" / "images"),
    }

    train_imgs: list[Path] = []
    val_imgs: list[Path] = []
    counts: dict[str, dict] = {}

    for name, (tr, va) in sources.items():
        tr_i = _labelled_only(_list_images(tr))
        va_i = _labelled_only(_list_images(va))
        train_imgs += tr_i
        val_imgs += va_i
        counts[name] = {"train": len(tr_i), "valid": len(va_i)}

    unified_root.mkdir(parents=True, exist_ok=True)
    train_txt = unified_root / "train.txt"
    val_txt = unified_root / "valid.txt"
    train_txt.write_text("\n".join(str(p) for p in train_imgs) + "\n", encoding="utf-8")
    val_txt.write_text("\n".join(str(p) for p in val_imgs) + "\n", encoding="utf-8")

    data = {
        "path": str(unified_root),
        "train": str(train_txt),
        "val": str(val_txt),
        "kpt_shape": KP_SHAPE,
        "flip_idx": FLIP_IDX,
        "nc": 1,
        "names": [CLASS_NAME],
    }
    data_yaml = unified_root / "data.yaml"
    with open(data_yaml, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)

    print(f"[merge] train: {len(train_imgs)} images {counts}")
    print(f"[merge] valid: {len(val_imgs)} images")
    print(f"[merge] data.yaml -> {data_yaml}")
    return data_yaml, counts


# --------------------------------------------------------------------------- #
# 5) High-resolution fine-tuning
# --------------------------------------------------------------------------- #
def finetune(data_yaml: Path, start_weights: Path, imgsz: int, epochs: int,
             batch: int, scale: float, lr0: float, device: str | None,
             project: Path, name: str) -> Path:
    """
    Fine-tuning from `start_weights` with high `imgsz` and scale augmentation
    (`scale`) to calibrate the model at the real webcam distance.

    Copies the best checkpoint to `models/best_custom_pose.pt`.
    """
    from ultralytics import YOLO

    if not start_weights.exists():
        raise FileNotFoundError(f"Starting weights not found: {start_weights}")

    print(f"\n=== Fine-tuning (imgsz={imgsz}, scale={scale}) ===")
    print(f"[model] {start_weights}")
    model = YOLO(str(start_weights))
    model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        scale=scale,               # scale augmentation (real distance)
        lr0=lr0,
        device=device,
        project=str(project),
        name=name,
        exist_ok=True,
        pretrained=True,
        cos_lr=True,
        close_mosaic=5,
        seed=42,
        plots=True,
        verbose=True,
    )

    best = project / name / "weights" / "best.pt"
    if not best.exists():
        raise FileNotFoundError(f"Output weights not found: {best}")
    target = MODELS_DIR / OUTPUT_WEIGHTS_NAME
    shutil.copy2(best, target)
    print(f"[ok] Calibrated weights saved at: {target}")
    return target


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="High-resolution custom dataset + fine-tuning (Orion).")
    p.add_argument("--media-dir", type=Path, default=DEFAULT_MEDIA_DIR,
                   help="Folder with the new photos and videos.")
    p.add_argument("--custom-root", type=Path, default=DEFAULT_CUSTOM_ROOT,
                   help="Destination of the new labeled data.")
    p.add_argument("--unified-root", type=Path, default=DEFAULT_UNIFIED_ROOT,
                   help="Destination of the unified dataset (Earth + Space + new).")
    p.add_argument("--start-weights", type=Path, default=DEFAULT_START_WEIGHTS,
                   help="Starting weights of the fine-tuning and the pseudo-labeling.")
    p.add_argument("--fps", type=float, default=DEFAULT_FPS,
                   help="Frames per second extracted from each video.")
    p.add_argument("--quality", type=int, default=DEFAULT_QUALITY,
                   help="JPEG quality (1-100) of the extracted frames.")
    p.add_argument("--val-ratio", type=float, default=DEFAULT_VAL_RATIO,
                   help="Fraction of the new data for validation.")
    p.add_argument("--det-conf", type=float, default=DEFAULT_DET_CONF,
                   help="Minimum confidence of the YOLO bbox in the pseudo-labeling.")
    p.add_argument("--kp-conf", type=float, default=DEFAULT_KP_CONF,
                   help="Minimum visibility to mark the keypoint as visible.")
    p.add_argument("--mp-complexity", type=int, default=DEFAULT_MP_COMPLEXITY,
                   help="MediaPipe complexity: 0=lite, 1=full, 2=heavy.")
    p.add_argument("--imgsz", type=int, default=DEFAULT_IMGSZ,
                   help="Training resolution (960 recommended; 1280 depending on VRAM).")
    p.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    p.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    p.add_argument("--scale", type=float, default=DEFAULT_SCALE,
                   help="Scale augmentation (calibrates the real distance).")
    p.add_argument("--lr0", type=float, default=DEFAULT_LR0)
    p.add_argument("--device", type=str, default=None,
                   help="'0' for GPU, 'cpu' for CPU (default: auto).")
    p.add_argument("--project", type=Path, default=PROJECT_ROOT / "runs" / "pose")
    p.add_argument("--name", type=str, default="custom_finetune")
    p.add_argument("--prepare-only", action="store_true",
                   help="Build the dataset (frames + labels + merge) and do not train.")
    p.add_argument("--train-only", action="store_true",
                   help="Skip the generation and train directly on the unified dataset.")
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    do_prepare = not args.train_only
    do_train = not args.prepare_only

    if do_prepare:
        media_dir = args.media_dir
        if not media_dir.exists():
            raise SystemExit(f"Media folder not found: {media_dir}")

        images, videos = _list_media(media_dir)
        print(f"[media] {len(images)} photos | {len(videos)} videos in {media_dir}")
        if not images and not videos:
            raise SystemExit("No photo/video found in the given folder.")

        # 1) Collection at high resolution.
        print("\n=== 1) Media collection (high resolution) ===")
        copy_photos(images, args.custom_root, args.val_ratio)
        per_video: dict[str, dict] = {}
        extract_video_frames(videos, args.custom_root, args.val_ratio,
                             args.fps, args.quality, per_video)

        # 2) Automatic pre-labeling.
        print("\n=== 2) Pre-labeling (YOLO + MediaPipe) ===")
        pseudo_label(args.custom_root, args.start_weights, per_video,
                     det_conf=args.det_conf, kp_conf=args.kp_conf,
                     mp_complexity=args.mp_complexity)

    # 3) Merge with Earth + Space.
    print("\n=== 3) Unified dataset merge ===")
    data_yaml, _ = build_unified_dataset(args.unified_root, args.custom_root)

    # 4) Fine-tuning.
    target = None
    if do_train:
        target = finetune(
            data_yaml=data_yaml,
            start_weights=args.start_weights,
            imgsz=args.imgsz,
            epochs=args.epochs,
            batch=args.batch,
            scale=args.scale,
            lr0=args.lr0,
            device=args.device,
            project=args.project,
            name=args.name,
        )

    # Equivalent command (to re-run only the training later).
    cmd = (f"python modules/prepare_custom_dataset.py --train-only "
           f"--imgsz {args.imgsz} --epochs {args.epochs} --batch {args.batch} "
           f"--scale {args.scale}")
    print(f"\n[cmd] Equivalent training:\n    {cmd}")
    if target is not None:
        print(f"\nUse the calibrated model in pose_processor.py:\n"
              f"    --weights {target}")


if __name__ == "__main__":
    main()
