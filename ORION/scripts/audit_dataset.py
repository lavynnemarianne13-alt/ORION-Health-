"""Read-only audit of the team's active YOLO-Pose splits and recorded runs."""
import csv
import hashlib
import math
import sys
import zipfile
from pathlib import Path


def audit(root):
    try:
        from PIL import Image
    except ImportError:
        Image = None
        print("Pillow unavailable: checking JPEG signatures only.")
    errors = 0
    for dataset in (root, root / "custom_dataset", root / "space_dataset"):
        seen = {}
        for split in ("train", "valid", "test"):
            directory = dataset / split
            if not directory.is_dir():
                continue
            images = sorted(path for path in (directory / "images").glob("*") if path.suffix.lower() in (".jpg", ".jpeg", ".png"))
            labels = sorted((directory / "labels").glob("*.txt"))
            image_stems, label_stems = {path.stem for path in images}, {path.stem for path in labels}
            unmatched = len(image_stems ^ label_stems)
            invalid = 0
            overlap = 0
            for path in images:
                try:
                    if Image:
                        with Image.open(path) as image:
                            image.load()
                    else:
                        content = path.read_bytes()
                        if not (content.startswith(b"\xff\xd8") and content.endswith(b"\xff\xd9") or content.startswith(b"\x89PNG\r\n\x1a\n")):
                            raise ValueError("Invalid image signature")
                    digest = hashlib.sha256(path.read_bytes()).digest()
                    overlap += seen.setdefault(digest, split) != split
                except (OSError, ValueError):
                    invalid += 1
            for path in labels:
                try:
                    for line in path.read_text().splitlines():
                        row = [float(value) for value in line.split()]
                        if len(row) != 50 or row[0] != 0 or not all(map(math.isfinite, row)):
                            raise ValueError("Expected class 0 and 15 three-component keypoints")
                        if not all(0 <= value <= 1 for value in row[1:5]) or min(row[3:5]) <= 0:
                            raise ValueError("Invalid box")
                        for x, y, visibility in zip(row[5::3], row[6::3], row[7::3]):
                            if not (0 <= x <= 1 and 0 <= y <= 1 and visibility in (0, 1, 2)):
                                raise ValueError("Invalid keypoint")
                except (OSError, ValueError):
                    invalid += 1
            errors += unmatched + invalid + overlap
            print(f"{dataset.name}/{split}: {len(images)} images, {len(labels)} labels, {unmatched} unmatched, {invalid} invalid, {overlap} identical across splits")
    for path in sorted((root / "fitness_pose").rglob("*.pt")):
        intact = zipfile.is_zipfile(path) and zipfile.ZipFile(path).testzip() is None
        errors += not intact
        print(f"{path.relative_to(root)}: {'ZIP CRC ok' if intact else 'unverified archive'} {hashlib.sha256(path.read_bytes()).hexdigest()[:12]}")
    for path in sorted((root / "fitness_pose").rglob("results.csv")):
        with path.open() as stream:
            rows = list(csv.DictReader(stream))
        best = max(rows, key=lambda row: float(row["metrics/mAP50-95(P)"]))
        print(f"{path.parent.name}: peak pose mAP50-95 {best['metrics/mAP50-95(P)']} at epoch {best['epoch']}")
    return int(errors != 0)


if __name__ == "__main__":
    directory = Path(sys.argv[1])
    if not (directory / "data.yaml").is_file():
        sys.exit("Orion Dataset data.yaml was not found.")
    sys.exit(audit(directory))
