"""
modules/train_space_pose.py
===============================================================================
Incremental training (adaptation to microgravity / ISS)  |  Orion Project
Part 1 - Physical Exercise Module (astronaut health support)

Goal
----
Adapt the YOLO-Pose model trained in the terrestrial environment (`best_exercise_pose.pt`)
to the space context, combining:
  1) the original terrestrial dataset (labeled, 183 imgs);
  2) the frames extracted from the astronaut videos (unlabeled).

Since the space frames have no manual annotation, we use **pseudo-labeling**:
the current model automatically generates the keypoints/bbox on the space frames,
filtering by confidence. These pseudo-labels are then used in the fine-tuning
together with the real terrestrial labels (self-training / semi-supervised).

Pipeline
--------
  1. Pseudo-label the space frames with `best_exercise_pose.pt`
     (writes YOLOv5-Pose labels into `space_dataset/<split>/labels/`).
  2. Build combined image lists (terrestrial + space) in `.txt` files
     (Ultralytics accepts `train: path/to/list.txt`).
  3. Create a combined `data.yaml` with `kpt_shape: [15, 3]`.
  4. Incremental fine-tuning from `models/best_exercise_pose.pt`,
     with few epochs and low LR so as not to forget the terrestrial learning.
  5. Save the adapted weights to `models/best_space_pose.pt`.

WARNING
-------
Pseudo-labels carry the error of the current model. They are useful to adapt the
model to new appearances/scenarios (ISS, microgravity, equipment), but
they do not replace quality manual labeling. The space frames should be
reviewed/labeled manually in a future iteration.

Usage
-----
    # Full pipeline (pseudo-label + incremental training)
    python modules/train_space_pose.py

    # Pseudo-label only (without training)
    python modules/train_space_pose.py --pseudo-only

    # Train only (uses already existing pseudo-labels)
    python modules/train_space_pose.py --train-only

    # Customize
    python modules/train_space_pose.py --epochs 25 --batch 16 --kp-conf 0.4
"""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
from pathlib import Path

import cv2
import numpy as np
import yaml

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
PROJECT_ROOT = Path(__file__).resolve().parents[1]   # .../fitness_pose
MODELS_DIR = PROJECT_ROOT / "models"

# Starting weights (trained terrestrial model) -> used as the training starting point.
PREVIOUS_WEIGHTS = MODELS_DIR / "best_exercise_pose.pt"
# Output weights (model adapted to space).
SPACE_WEIGHTS_NAME = "best_space_pose.pt"

# "Teacher" model to pseudo-label the space frames.
# Since the space frames have poses/scenarios very different from the squat
# dataset, the (specialized) terrestrial model does not detect the astronauts.
# We use the generic COCO model (17 keypoints) as the teacher and map the
# 17 COCO keypoints to the 15 keypoints of our dataset.
PSEUDO_TEACHER_WEIGHTS = "yolov8n-pose.pt"

# Mapping COCO(17) -> our dataset(15).
# COCO: 0 nose, 1/2 eyes, 3/4 ears, 5/6 shoulders, 7/8 elbows, 9/10 wrists,
#       11/12 hips, 13/14 knees, 15/16 ankles.
# Ours: 0 head, 1/2 shoulders, 3/4 arm(elbow), 5/6 wrists, 7/8 hips,
#       9/10 knees, 11/12 ankles, 13/14 hands.
COCO_TO_DATASET = [
    0,   # 0  head        <- nose (approximation for the head)
    5,   # 1  L shoulder  <- L shoulder
    6,   # 2  R shoulder  <- R shoulder
    7,   # 3  L arm       <- L elbow
    8,   # 4  R arm       <- R elbow
    9,   # 5  L wrist     <- L wrist
    10,  # 6  R wrist     <- R wrist
    11,  # 7  L hip       <- L hip
    12,  # 8  R hip       <- R hip
    13,  # 9  L knee      <- L knee
    14,  # 10 R knee      <- R knee
    15,  # 11 L ankle     <- L ankle
    16,  # 12 R ankle     <- R ankle
    9,   # 13 L hand      <- L wrist (COCO has no hand; uses wrist as a proxy)
    10,  # 14 R hand      <- R wrist
]

# Datasets.
# The roots can be overridden by an environment variable. This allows pointing
# to writable copies (e.g.: /tmp) when the original dataset folder is
# read-only in the execution environment (Ultralytics writes a
# `labels.cache` next to the labels).
TERRESTRIAL_ROOT = Path(os.environ.get(
    "ORION_TERRESTRIAL_ROOT", "/home/rehlovestowrite/Orion_dataset"))
SPACE_ROOT = Path(os.environ.get(
    "ORION_SPACE_ROOT", "/home/rehlovestowrite/Orion_dataset/space_dataset"))

TERRESTRIAL_TRAIN = TERRESTRIAL_ROOT / "train" / "images"
TERRESTRIAL_VAL = TERRESTRIAL_ROOT / "valid" / "images"

SPACE_TRAIN_IMG = SPACE_ROOT / "train" / "images"
SPACE_TRAIN_LBL = SPACE_ROOT / "train" / "labels"
SPACE_VAL_IMG = SPACE_ROOT / "valid" / "images"
SPACE_VAL_LBL = SPACE_ROOT / "valid" / "labels"

NUM_KEYPOINTS = 15
KP_SHAPE = [NUM_KEYPOINTS, 3]

# Incremental training hyperparameters.
DEFAULT_EPOCHS = 25
DEFAULT_IMGSZ = 640
DEFAULT_BATCH = 16
DEFAULT_PATIENCE = 10
DEFAULT_SEED = 42
DEFAULT_LR0 = 0.001   # lower LR than the original training (0.002) so as not to forget

# Detection confidence threshold for pseudo-labeling.
DEFAULT_DET_CONF = 0.35
# Confidence threshold of each keypoint to mark it as visible.
DEFAULT_KP_CONF = 0.35


# --------------------------------------------------------------------------- #
# 1) Pseudo-labeling
# --------------------------------------------------------------------------- #
def _xyxy_to_cxcywh_norm(xyxy: np.ndarray, w: int, h: int) -> list[float]:
    """Convert a bbox xyxy (pixels) to normalized cx cy w h [0,1]."""
    x1, y1, x2, y2 = xyxy
    cx = (x1 + x2) / 2.0 / w
    cy = (y1 + y2) / 2.0 / h
    bw = (x2 - x1) / w
    bh = (y2 - y1) / h
    return [float(cx), float(cy), float(bw), float(bh)]


def pseudo_label_split(
    images_dir: Path,
    labels_dir: Path,
    teacher_weights: str | Path = PSEUDO_TEACHER_WEIGHTS,
    det_conf: float = DEFAULT_DET_CONF,
    kp_conf: float = DEFAULT_KP_CONF,
) -> int:
    """
    Generate YOLOv5-Pose pseudo-labels (15-keypoint format) for all the
    images in `images_dir` using the "teacher" model (COCO, 17 keypoints).

    The 17 COCO keypoints are mapped to the dataset's 15 keypoints
    through `COCO_TO_DATASET`.

    Returns the number of images successfully pseudo-labeled (at least one
    detection above the threshold).
    """
    from ultralytics import YOLO

    if not images_dir.exists():
        print(f"[pseudo] images folder does not exist: {images_dir}")
        return 0

    labels_dir.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(teacher_weights))

    images = sorted(images_dir.glob("*.jpg")) + sorted(images_dir.glob("*.png"))
    n_labeled = 0

    for img_path in images:
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        h, w = img.shape[:2]

        results = model.predict(img, conf=det_conf, verbose=False)
        result = results[0]
        if result.boxes is None or len(result.boxes) == 0:
            # No detection: skip (do not write an empty label to avoid noise).
            continue

        boxes_xyxy = result.boxes.xyxy.cpu().numpy()
        # Teacher keypoints: (N, 17, 2) and (N, 17).
        kps_xy = result.keypoints.xy.cpu().numpy()
        kps_conf = (result.keypoints.conf.cpu().numpy()
                    if result.keypoints.conf is not None
                    else np.ones(kps_xy.shape[:2]))

        # Keep only the largest-area person (main athlete).
        areas = (boxes_xyxy[:, 2] - boxes_xyxy[:, 0]) * (boxes_xyxy[:, 3] - boxes_xyxy[:, 1])
        best = int(np.argmax(areas))

        bbox = _xyxy_to_cxcywh_norm(boxes_xyxy[best], w, h)

        # Map 17 COCO keypoints -> 15 dataset keypoints.
        kp_line: list[float] = []
        for our_idx in range(NUM_KEYPOINTS):
            coco_idx = COCO_TO_DATASET[our_idx]
            kx, ky = kps_xy[best, coco_idx]
            kc = kps_conf[best, coco_idx]
            v = 2 if kc >= kp_conf else 0   # 2 = visible, 0 = not labeled
            kp_line.extend([float(kx / w), float(ky / h), float(v)])

        # class_id (0 = lifter) cx cy w h  +  15 * (x, y, v)
        label_line = "0 " + " ".join(f"{v:.6f}" for v in bbox + kp_line)

        label_path = labels_dir / f"{img_path.stem}.txt"
        with open(label_path, "w") as f:
            f.write(label_line + "\n")
        n_labeled += 1

    print(f"[pseudo] {images_dir.name}: {n_labeled}/{len(images)} images labeled "
          f"(det_conf>={det_conf}, teacher={teacher_weights})")
    return n_labeled


# --------------------------------------------------------------------------- #
# 2) Combined lists and data.yaml
# --------------------------------------------------------------------------- #
def _list_images(d: Path) -> list[Path]:
    if not d.exists():
        return []
    return sorted(d.glob("*.jpg")) + sorted(d.glob("*.png"))


def build_combined_dataset(
    combined_yaml: Path,
    combined_train_txt: Path,
    combined_val_txt: Path,
) -> Path:
    """
    Build `.txt` files with all the images (terrestrial + space) and generate
    a combined `data.yaml` pointing to these lists.
    """
    terrestrial_train = _list_images(TERRESTRIAL_TRAIN)
    terrestrial_val = _list_images(TERRESTRIAL_VAL)
    space_train = _list_images(SPACE_TRAIN_IMG)
    space_val = _list_images(SPACE_VAL_IMG)

    all_train = terrestrial_train + space_train
    all_val = terrestrial_val + space_val

    combined_train_txt.parent.mkdir(parents=True, exist_ok=True)
    with open(combined_train_txt, "w") as f:
        f.write("\n".join(str(p) for p in all_train) + "\n")
    with open(combined_val_txt, "w") as f:
        f.write("\n".join(str(p) for p in all_val) + "\n")

    data = {
        "train": str(combined_train_txt),
        "val": str(combined_val_txt),
        "kpt_shape": KP_SHAPE,
        "flip_idx": list(range(NUM_KEYPOINTS)),
        "nc": 1,
        "names": ["lifter"],
        "path": str(combined_yaml.parent),
    }
    with open(combined_yaml, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)

    print(f"[combined] train: {len(all_train)} imgs "
          f"({len(terrestrial_train)} terrestrial + {len(space_train)} space)")
    print(f"[combined] val:   {len(all_val)} imgs "
          f"({len(terrestrial_val)} terrestrial + {len(space_val)} space)")
    print(f"[combined] yaml -> {combined_yaml}")
    return combined_yaml


# --------------------------------------------------------------------------- #
# 3) Incremental training
# --------------------------------------------------------------------------- #
def train_space_pose(
    epochs: int = DEFAULT_EPOCHS,
    imgsz: int = DEFAULT_IMGSZ,
    batch: int = DEFAULT_BATCH,
    patience: int = DEFAULT_PATIENCE,
    device: str | None = None,
    project: Path | None = None,
    name: str = "space_finetune",
    det_conf: float = DEFAULT_DET_CONF,
    kp_conf: float = DEFAULT_KP_CONF,
    do_pseudo: bool = True,
    do_train: bool = True,
) -> Path | None:
    """
    Run the full space adaptation pipeline.
    Returns the path of the adapted weights (or None if `do_train=False`).
    """
    from ultralytics import YOLO

    if not PREVIOUS_WEIGHTS.exists():
        raise FileNotFoundError(
            f"Previous weights not found: {PREVIOUS_WEIGHTS}\n"
            "Run first: python modules/train_pose.py"
        )

    # --- 1) Pseudo-labeling of the space frames (COCO teacher) ---
    if do_pseudo:
        print("\n=== Pseudo-labeling of the space frames ===")
        pseudo_label_split(SPACE_TRAIN_IMG, SPACE_TRAIN_LBL,
                           teacher_weights=PSEUDO_TEACHER_WEIGHTS,
                           det_conf=det_conf, kp_conf=kp_conf)
        pseudo_label_split(SPACE_VAL_IMG, SPACE_VAL_LBL,
                           teacher_weights=PSEUDO_TEACHER_WEIGHTS,
                           det_conf=det_conf, kp_conf=kp_conf)

    # --- 2) Combined dataset ---
    combined_yaml = Path(tempfile.gettempdir()) / "orion_combined_data.yaml"
    combined_train_txt = Path(tempfile.gettempdir()) / "orion_combined_train.txt"
    combined_val_txt = Path(tempfile.gettempdir()) / "orion_combined_val.txt"
    build_combined_dataset(combined_yaml, combined_train_txt, combined_val_txt)

    if not do_train:
        print("\n[info] --train-only / --pseudo-only: training ignored.")
        return None

    # --- 3) Incremental fine-tuning ---
    print("\n=== Incremental fine-tuning (space adaptation) ===")
    project_dir = Path(project) if project is not None else PROJECT_ROOT / "runs" / "pose"

    print(f"[model] Loading previous weights: {PREVIOUS_WEIGHTS}")
    model = YOLO(str(PREVIOUS_WEIGHTS))

    model.train(
        data=str(combined_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        patience=patience,
        seed=DEFAULT_SEED,
        device=device,
        project=str(project_dir),
        name=name,
        exist_ok=True,
        pretrained=True,
        cos_lr=True,
        close_mosaic=5,
        lr0=DEFAULT_LR0,          # reduced LR: adaptation, not re-training
        plots=True,
        verbose=True,
    )

    # --- 4) Copy final weights ---
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    best_weights = project_dir / name / "weights" / "best.pt"
    target = MODELS_DIR / SPACE_WEIGHTS_NAME

    if not best_weights.exists():
        raise FileNotFoundError(f"Output weights not found: {best_weights}")

    shutil.copy2(best_weights, target)
    print(f"\n[ok] Space adaptation complete. Weights saved at: {target}")
    return target


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Incremental training: adaptation of YOLO-Pose to microgravity/ISS."
    )
    p.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    p.add_argument("--imgsz", type=int, default=DEFAULT_IMGSZ)
    p.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    p.add_argument("--patience", type=int, default=DEFAULT_PATIENCE)
    p.add_argument("--device", type=str, default=None,
                   help="'0' for GPU, 'cpu' for CPU (default: auto)")
    p.add_argument("--project", type=Path, default=PROJECT_ROOT / "runs" / "pose")
    p.add_argument("--name", type=str, default="space_finetune")
    p.add_argument("--det-conf", type=float, default=DEFAULT_DET_CONF,
                   help="minimum detection confidence for the pseudo-label")
    p.add_argument("--kp-conf", type=float, default=DEFAULT_KP_CONF,
                   help="minimum keypoint confidence to mark it visible")
    p.add_argument("--pseudo-only", action="store_true",
                   help="only generates pseudo-labels, does not train")
    p.add_argument("--train-only", action="store_true",
                   help="only trains (uses existing pseudo-labels)")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    do_pseudo = not args.train_only
    do_train = not args.pseudo_only
    train_space_pose(
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=args.patience,
        device=args.device,
        project=args.project,
        name=args.name,
        det_conf=args.det_conf,
        kp_conf=args.kp_conf,
        do_pseudo=do_pseudo,
        do_train=do_train,
    )
