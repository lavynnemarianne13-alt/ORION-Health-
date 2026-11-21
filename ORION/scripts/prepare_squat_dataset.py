"""Stage a portable copy of the team's squat splits so training caches stay separate."""
import argparse
import json
from pathlib import Path
import shutil

from audit_dataset import audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if output.exists() or output.is_relative_to(source):
        parser.error("Output must be a new directory outside the original dataset.")
    for split in ("train", "valid"):
        for kind in ("images", "labels"):
            if not (source / split / kind).is_dir():
                parser.error(f"Missing {split}/{kind}.")
    config = (source / "data.yaml").read_text().splitlines()
    if not all(line in config for line in ("kpt_shape: [15, 3]", "nc: 1", "names: ['lifter']")):
        parser.error("Expected the team's 15-keypoint squat dataset.")
    for split in ("train", "valid"):
        shutil.copytree(source / split, output / split, ignore=shutil.ignore_patterns("*.cache"))
    manifest = output / "data.yaml"
    manifest.write_text(
        f"path: {json.dumps(str(output))}\ntrain: train/images\nval: valid/images\n"
        "kpt_shape: [15, 3]\nflip_idx: [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13]\n"
        "nc: 1\nnames: ['lifter']\n"
    )
    if audit(output):
        parser.exit(1, "Staged dataset failed the audit. Inspect it before training.\n")
    print(manifest)


if __name__ == "__main__":
    main()
