"""
modules/extract_frames.py
===============================================================================
Frame extraction from the astronaut videos for the space dataset (Orion).

Goal
----
Slice the attached videos (exercises in microgravity / ISS) into static
images, saving **1 frame per second** into the space dataset folder structure,
for later labeling / pseudo-labeling and fine-tuning.

Output structure
----------------
    <SPACE_ROOT>/
        train/images/   (e.g.: 90% of the frames)
        valid/images/   (e.g.: 10% of the frames)

Frames named as: <video_stem>_f<second_6digits>.jpg

Usage
-----
    # Default videos (the two attached), 1 fps, split 90/10
    python modules/extract_frames.py

    # Custom videos
    python modules/extract_frames.py --videos "video1.mp4" "video2.mp4"

    # Different rate (e.g.: 2 frames per second)
    python modules/extract_frames.py --fps 2

    # No split (everything goes to train)
    python modules/extract_frames.py --val-ratio 0.0

Requirements: opencv-python
"""

from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path

import cv2

# --------------------------------------------------------------------------- #
# Default configuration
# --------------------------------------------------------------------------- #
SPACE_ROOT = Path("/home/rehlovestowrite/Orion_dataset/space_dataset")
DEFAULT_VIDEOS = [
    Path("/home/rehlovestowrite/Downloads/WhatsApp Video 2026-11-15 at 02.12.05.mp4"),
    Path("/home/rehlovestowrite/Downloads/WhatsApp Video 2026-11-15 at 02.14.42.mp4"),
]


def _safe_stem(path: Path) -> str:
    """Generate a short, safe file name from the video path."""
    stem = path.stem
    # Remove special characters, keeping letters, numbers, _ and -.
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_")
    # Avoid excessively long names.
    return stem[:40]


def _deterministic_split(name: str, val_ratio: float) -> str:
    """
    Decide deterministically (by name hash) whether a frame goes to
    train or valid. This way, re-runs produce the same split.
    """
    if val_ratio <= 0:
        return "train"
    digest = int(hashlib.md5(name.encode("utf-8")).hexdigest(), 16)
    return "valid" if (digest % 1000) < int(val_ratio * 1000) else "train"


def extract_frames(
    videos: list[Path],
    space_root: Path = SPACE_ROOT,
    fps: float = 1.0,
    val_ratio: float = 0.1,
) -> dict[str, int]:
    """
    Extract frames from the videos and return the number of frames saved per split.
    """
    if fps <= 0:
        raise ValueError("fps must be > 0")

    train_dir = space_root / "train" / "images"
    valid_dir = space_root / "valid" / "images"
    train_dir.mkdir(parents=True, exist_ok=True)
    valid_dir.mkdir(parents=True, exist_ok=True)

    counts = {"train": 0, "valid": 0}

    for video_path in videos:
        if not video_path.exists():
            print(f"[warning] video not found, skipping: {video_path}")
            continue

        stem = _safe_stem(video_path)
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            print(f"[error] could not open: {video_path}")
            continue

        src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total / src_fps if src_fps else 0.0
        # Step in frames corresponding to the desired extraction rate.
        step = max(1, int(round(src_fps / fps)))

        print(f"[video] {video_path.name} | {int(src_fps)} fps | "
              f"{duration:.1f}s | extracting {fps} fps (step={step} frames)")

        frame_idx = 0
        saved = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_idx % step == 0:
                second = int(frame_idx // src_fps)
                fname = f"{stem}_f{second:06d}.jpg"
                split = _deterministic_split(fname, val_ratio)
                out_path = (train_dir if split == "train" else valid_dir) / fname
                cv2.imwrite(str(out_path), frame)
                counts[split] += 1
                saved += 1

            frame_idx += 1

        cap.release()
        print(f"        -> {saved} frames saved")

    print(f"\n[summary] train: {counts['train']} | valid: {counts['valid']}")
    print(f"[ok] frames in: {space_root}")
    return counts


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Extract frames from the astronaut videos.")
    p.add_argument("--videos", nargs="+", type=Path, default=DEFAULT_VIDEOS,
                   help="List of video paths to process.")
    p.add_argument("--space-root", type=Path, default=SPACE_ROOT,
                   help="Root of the space dataset (default: %(default)s)")
    p.add_argument("--fps", type=float, default=1.0,
                   help="Frames per second to extract (default: 1)")
    p.add_argument("--val-ratio", type=float, default=0.1,
                   help="Fraction of frames for validation (default: 0.1)")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    extract_frames(
        videos=args.videos,
        space_root=args.space_root,
        fps=args.fps,
        val_ratio=args.val_ratio,
    )
