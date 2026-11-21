"""
modules/visualize_keypoints.py
===============================================================================
Visual inspection of the markings (keypoints) of the squat dataset.

Goal
----
Load a few images from the training folder and draw on top:
  * the athlete's bounding-box ("lifter");
  * the skeleton (connections between joints);
  * the numbered keypoints.

Allows confirming whether the point indices (head, shoulders, hips, knees,
ankles etc.) are correct in the dataset before/after the training.

Usage
-----
    # Generate a PNG grid with 8 random samples
    python modules/visualize_keypoints.py --n 8 --seed 42

    # Show in a window (if there is a display), without saving a file
    python modules/visualize_keypoints.py --show

    # Choose specific images by name (without extension)
    python modules/visualize_keypoints.py --names frame_000000_jpg.rf.32a75d89...
"""

from __future__ import annotations

import argparse
import random
from pathlib import Path

import cv2
import numpy as np
import matplotlib

matplotlib.use("Agg")  # headless: allows running without a display; switch to "TkAgg" for a window
import matplotlib.pyplot as plt

# Reuse the skeleton and keypoint-name definitions from the biomechanical
# analysis module, avoiding duplication of the convention.
try:
    from pose_processor import SKELETON, KEYPOINT_NAMES  # noqa: E402
except ModuleNotFoundError:  # executed as a module (e.g.: `from modules.X import`)
    from modules.pose_processor import SKELETON, KEYPOINT_NAMES  # noqa: E402

# --------------------------------------------------------------------------- #
# Paths of the attached dataset
# --------------------------------------------------------------------------- #
DATASET_ROOT = Path("/home/rehlovestowrite/Orion_dataset")
TRAIN_IMAGES = DATASET_ROOT / "train" / "images"
TRAIN_LABELS = DATASET_ROOT / "train" / "labels"

NUM_KEYPOINTS = len(KEYPOINT_NAMES)  # 15


# --------------------------------------------------------------------------- #
# Reading the label in YOLOv5-Pose format (Roboflow)
# --------------------------------------------------------------------------- #
def parse_label(label_path: Path) -> tuple[list[float], np.ndarray, np.ndarray]:
    """
    Read a label file and return:
        (bbox_xywh, kps_xy, kps_v)
    where:
        bbox_xywh : [cx, cy, w, h] normalized [0,1]
        kps_xy    : (K, 2) normalized coordinates of the keypoints
        kps_v     : (K,)  visibility codes (0, 1 or 2)
    """
    with open(label_path, "r") as f:
        tokens = f.read().split()

    # class cx cy w h  +  K * (x, y, v)
    bbox = [float(t) for t in tokens[1:5]]
    rest = np.array([float(t) for t in tokens[5:]], dtype=np.float64)
    kps = rest.reshape(NUM_KEYPOINTS, 3)
    return bbox, kps[:, :2], kps[:, 2]


def denormalize(kps_xy: np.ndarray, w: int, h: int) -> np.ndarray:
    """Convert normalized coordinates [0,1] to pixels."""
    out = kps_xy.copy()
    out[:, 0] *= w
    out[:, 1] *= h
    return out


# --------------------------------------------------------------------------- #
# Drawing
# --------------------------------------------------------------------------- #
def draw_annotations(img: np.ndarray, bbox_xywh: list[float],
                     kps_px: np.ndarray, kps_v: np.ndarray) -> np.ndarray:
    """
    Draw the bbox, skeleton and numbered keypoints over a copy of the image.
    """
    h, w = img.shape[:2]
    out = img.copy()

    # 1) Bounding box (cx, cy, w, h normalized -> x1, y1, x2, y2 in pixels).
    cx, cy, bw, bh = bbox_xywh
    x1 = int((cx - bw / 2) * w)
    y1 = int((cy - bh / 2) * h)
    x2 = int((cx + bw / 2) * w)
    y2 = int((cy + bh / 2) * h)
    cv2.rectangle(out, (x1, y1), (x2, y2), (255, 255, 0), 2)

    def visible(i: int) -> bool:
        # v >= 1 means labeled keypoint (visible or hidden).
        return kps_v[i] >= 1 and 0 <= kps_px[i, 0] <= w and 0 <= kps_px[i, 1] <= h

    # 2) Skeleton (bones).
    for i, j in SKELETON:
        if visible(i) and visible(j):
            p1 = tuple(int(v) for v in kps_px[i])
            p2 = tuple(int(v) for v in kps_px[j])
            cv2.line(out, p1, p2, (0, 200, 255), 2, cv2.LINE_AA)

    # 3) Keypoints: point + index number for inspection.
    for i in range(NUM_KEYPOINTS):
        if not visible(i):
            continue
        px, py = int(kps_px[i, 0]), int(kps_px[i, 1])
        cv2.circle(out, (px, py), 5, (0, 255, 0), -1, cv2.LINE_AA)
        cv2.putText(out, str(i), (px + 7, py - 7),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)

    return out


# --------------------------------------------------------------------------- #
# Building the sample grid
# --------------------------------------------------------------------------- #
def collect_samples(n: int, seed: int | None, names: list[str]) -> list[Path]:
    """Select `n` training images for visualization."""
    if names:
        return [TRAIN_IMAGES / f"{nm}.jpg" for nm in names]

    all_imgs = sorted(TRAIN_IMAGES.glob("*.jpg"))
    if seed is not None:
        random.seed(seed)
    return random.sample(all_imgs, min(n, len(all_imgs)))


def plot_grid(images_paths: list[Path], cols: int = 4,
              out_path: Path | None = None) -> None:
    rows = int(np.ceil(len(images_paths) / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(5 * cols, 5 * rows))
    axes = np.atleast_2d(axes)

    for idx, img_path in enumerate(images_paths):
        ax = axes[idx // cols, idx % cols]
        img = cv2.imread(str(img_path))
        if img is None:
            ax.set_title(f"[failed to read] {img_path.name}", fontsize=8)
            ax.axis("off")
            continue

        label_path = TRAIN_LABELS / f"{img_path.stem}.txt"
        if not label_path.exists():
            ax.set_title("[no label] " + img_path.name[:30], fontsize=8)
            ax.imshow(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            ax.axis("off")
            continue

        bbox, kps_xy, kps_v = parse_label(label_path)
        h, w = img.shape[:2]
        kps_px = denormalize(kps_xy, w, h)
        annotated = draw_annotations(img, bbox, kps_px, kps_v)

        ax.imshow(cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB))
        ax.set_title(img_path.name[:32], fontsize=8)
        ax.axis("off")

    # Hide empty axes.
    for idx in range(len(images_paths), rows * cols):
        axes[idx // cols, idx % cols].axis("off")

    fig.suptitle("Visual inspection: keypoints + skeleton (squat dataset)",
                 fontsize=12, y=0.995)
    fig.tight_layout()

    if out_path is not None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out_path, dpi=130, bbox_inches="tight")
        print(f"[ok] grid saved at: {out_path}")
    plt.close(fig)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Visualize keypoints/skeleton of the dataset.")
    p.add_argument("--n", type=int, default=8, help="number of random images")
    p.add_argument("--seed", type=int, default=42, help="seed for sampling")
    p.add_argument("--cols", type=int, default=4, help="columns in the grid")
    p.add_argument("--names", nargs="*", default=None,
                   help="specific image names (without extension)")
    p.add_argument("--out", type=str, default="/tmp/orion_out/keypoints_grid.png",
                   help="output PNG file")
    p.add_argument("--show", action="store_true",
                   help="opens an interactive window (requires a display)")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()

    samples = collect_samples(args.n, args.seed, args.names)
    print(f"[info] {len(samples)} images selected")

    if args.show:
        # Override backend to allow a window.
        matplotlib.use("TkAgg", force=True)
        import matplotlib.pyplot as plt  # noqa: F811

    out = None if args.show else Path(args.out)
    plot_grid(samples, cols=args.cols, out_path=out)

    if args.show:
        plt.show()
