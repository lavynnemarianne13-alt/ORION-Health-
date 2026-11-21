"""
modules/train_pose.py
===============================================================================
YOLO-Pose Model Training Module  |  Orion Project
Part 1 - Physical Exercise Module (astronaut health support)

Goal
----
Fine-tune a pre-trained YOLOv8 pose model (`yolov8n-pose.pt`) on the attached
squat dataset (Squat), so that the model learns to detect the athlete's
skeleton ("lifter") and allows the computation of joint angles downstream
(see `pose_processor.py`).

Attached dataset
----------------
Roboflow "Squat data" v1 (workspace 21nk38), YOLOv5-PyTorch/Pose export:
    /home/rehlovestowrite/Orion_dataset/
        data.yaml          -> kpt_shape: [15, 3] | nc: 1 | names: ['lifter']
        train/images/      (183 images) + train/labels/
        valid/images/      (5 images)   + valid/labels/

IMPORTANT (Roboflow export peculiarity)
----------------------------------------
The Roboflow `data.yaml` uses relative paths in the `../train/images` format.
Ultralytics resolves relative paths from the YAML's own folder, which would
generate an invalid path (`/home/rehlovestowrite/train/images`).
That is why this script NORMALIZES the YAML, writing a copy with ABSOLUTE
paths before starting the training.

Usage
-----
    python modules/train_pose.py
    python modules/train_pose.py --data "/path/to/data.yaml" --epochs 40

Requirements (not installed in the current environment):
    pip install ultralytics
"""

from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

import yaml

# --------------------------------------------------------------------------- #
# Default configuration (can be overridden via the command line)
# --------------------------------------------------------------------------- #
PROJECT_ROOT = Path(__file__).resolve().parents[1]          # .../fitness_pose
MODELS_DIR = PROJECT_ROOT / "models"

# Dataset attached in this chat (contains data.yaml + train/ + valid/).
DEFAULT_DATA_YAML = Path("/home/rehlovestowrite/Orion_dataset/data.yaml")

# Pre-trained pose weights (COCO) that will serve as the starting point.
PRETRAINED_WEIGHTS = "yolov8n-pose.pt"

# Final name of the trained weights requested in the scope.
BEST_WEIGHTS_NAME = "best_exercise_pose.pt"

# Hyperparameters optimized for a small dataset (~180 images) with fine-tuning.
DEFAULT_EPOCHS = 40
DEFAULT_IMGSZ = 640
DEFAULT_BATCH = 16
DEFAULT_PATIENCE = 15       # early stopping if the validation does not improve
DEFAULT_SEED = 42


def _resolve_split(dataset_root: Path, rel: str) -> str:
    """
    Resolve the path of a split (train/val/test) to an EXISTING ABSOLUTE path,
    tolerating the Roboflow/YOLOv5 export pattern.

    The Roboflow `data.yaml` uses `../train/images`, but the dataset folders are
    located at `<root>/train/images`. Here we test candidates and return the
    first one that actually exists:
        1. absolute path, if that is the case;
        2. `<root>/../train/images`   ("literal" resolution);
        3. `<root>/train/images`      (Roboflow quirks: ignores the leading '..');
        4. `<parent_root>/../train/images` (yaml inside a subfolder).
    """
    p = Path(rel)
    candidates: list[Path] = []

    if p.is_absolute():
        candidates.append(p)
    else:
        candidates.append(dataset_root / p)
        # Remove the leading '..' (e.g.: "../train/images" -> "train/images").
        stripped_parts = [part for part in p.parts if part != ".."]
        if stripped_parts:
            candidates.append(dataset_root / Path(*stripped_parts))
        candidates.append(dataset_root.parent / p)

    for cand in candidates:
        if cand.exists():
            return str(cand.resolve())
    # Fallback: return the most likely candidate even if it does not exist.
    return str((dataset_root / p).resolve())


def _normalize_data_yaml(src_yaml: Path, dst_yaml: Path) -> Path:
    """
    Read the dataset `data.yaml` and write a version with ABSOLUTE paths.

    Fixes the classic problem of Roboflow/YOLOv5 exports, where
    `train: ../train/images` is resolved by Ultralytics relative to the YAML's
    folder, pointing to a non-existent directory.
    """
    src_yaml = src_yaml.resolve()
    dataset_root = src_yaml.parent

    with open(src_yaml, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    # Convert each split (train/val/test) to an absolute path, when it exists.
    for split in ("train", "val", "test"):
        rel = data.get(split)
        if not rel:
            continue
        resolved = _resolve_split(dataset_root, rel)
        if Path(resolved).exists():
            data[split] = resolved
        else:
            # E.g.: the attached export does not include the `test/` folder.
            print(f"[data] warning: non-existent split '{split}' ({resolved}) - ignored")
            data.pop(split, None)

    # Set the dataset root explicitly.
    data["path"] = str(dataset_root)

    dst_yaml.parent.mkdir(parents=True, exist_ok=True)
    with open(dst_yaml, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)

    print(f"[data] Normalized YAML -> {dst_yaml}")
    for split in ("train", "val", "test"):
        if data.get(split):
            print(f"[data]   {split:5s}: {data[split]}")
    print(f"[data]   kpt_shape: {data.get('kpt_shape')} | nc: {data.get('nc')} "
          f"| names: {data.get('names')}")
    return dst_yaml


def train_pose_model(
    data_yaml: Path = DEFAULT_DATA_YAML,
    epochs: int = DEFAULT_EPOCHS,
    imgsz: int = DEFAULT_IMGSZ,
    batch: int = DEFAULT_BATCH,
    patience: int = DEFAULT_PATIENCE,
    device: str | None = None,
    project: Path | None = None,
    name: str = "squat_finetune",
) -> Path:
    """
    Run the fine-tuning of YOLOv8-Pose and save the final weights to
    `models/best_exercise_pose.pt`.

    `project`/`name` define where the intermediate training artifacts are
    written (default: `runs/pose/squat_finetune`). Allows redirecting the
    output to another directory when the project folder is read-only.

    Returns the path of the best weights.
    """
    project_dir = Path(project) if project is not None else PROJECT_ROOT / "runs" / "pose"
    # Local import: keeps the module importable even without Ultralytics installed.
    from ultralytics import YOLO

    data_yaml = Path(data_yaml)
    if not data_yaml.exists():
        raise FileNotFoundError(f"data.yaml not found: {data_yaml}")

    # 1) Normalize the dataset paths.
    #    The normalized YAML is an intermediate artifact -> written to /tmp.
    normalized_yaml = Path(tempfile.gettempdir()) / "orion_squat_data_normalized.yaml"
    data_yaml = _normalize_data_yaml(data_yaml, normalized_yaml)

    # 2) Load the pre-trained pose model.
    #    Ultralytics automatically recreates the keypoint "head" for the
    #    dataset kpt_shape ([15, 3]), reusing the pre-trained backbone.
    print(f"[model] Loading pre-trained weights: {PRETRAINED_WEIGHTS}")
    model = YOLO(PRETRAINED_WEIGHTS)

    # 3) Fine-tuning.
    model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        patience=patience,
        seed=DEFAULT_SEED,
        device=device,                # None -> auto (CUDA if available, otherwise CPU)
        project=str(project_dir),
        name=name,
        exist_ok=True,
        pretrained=True,              # transfer learning from the COCO checkpoint
        cos_lr=True,                  # cosine LR schedule
        close_mosaic=10,              # disables mosaic in the last epochs (stability)
        plots=True,
        verbose=True,
    )

    # 4) Copy the best weights to models/best_exercise_pose.pt.
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    best_weights = project_dir / name / "weights" / "best.pt"
    target = MODELS_DIR / BEST_WEIGHTS_NAME

    if not best_weights.exists():
        raise FileNotFoundError(f"Output weights not found: {best_weights}")

    shutil.copy2(best_weights, target)
    print(f"\n[ok] Training complete. Best weights saved at: {target}")
    return target


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fine-tuning of YOLOv8-Pose on the squat dataset (Orion)."
    )
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA_YAML,
                        help="Path of the dataset data.yaml (default: %(default)s)")
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--imgsz", type=int, default=DEFAULT_IMGSZ)
    parser.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    parser.add_argument("--patience", type=int, default=DEFAULT_PATIENCE)
    parser.add_argument("--device", type=str, default=None,
                        help="'0' for GPU, 'cpu' for CPU (default: auto)")
    parser.add_argument("--project", type=Path, default=PROJECT_ROOT / "runs" / "pose",
                        help="Directory of the training artifacts (default: %(default)s)")
    parser.add_argument("--name", type=str, default="squat_finetune",
                        help="Name of the training run (default: %(default)s)")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    train_pose_model(
        data_yaml=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=args.patience,
        device=args.device,
        project=args.project,
        name=args.name,
    )
