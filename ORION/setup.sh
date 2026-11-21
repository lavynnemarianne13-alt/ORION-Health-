#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/scripts/environment.sh"
for program in python3 node npm curl flock; do
  command -v "$program" >/dev/null || { printf 'Required command missing: %s\n' "$program" >&2; exit 1; }
done
python3 -c 'import sys; assert sys.version_info[:2] == (3,12), "Use Python 3.12"'
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw Error("Use Node.js 24 or later")'
mkdir -p data .runtime "$(dirname -- "$ORION_DB_PATH")"
exec 9>.runtime/lock
flock -n 9 || { printf 'Stop ORION before changing its environment.\n' >&2; exit 1; }
[[ -e .env ]] || cp .env.example .env
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
(cd frontend && npm ci)
if [[ -s "$ORION_DB_PATH" ]]; then
  .venv/bin/python - "$ORION_DB_PATH" <<'PY'
import sqlite3, sys
from datetime import UTC, datetime
from pathlib import Path
from contextlib import closing
path = Path(sys.argv[1])
backup = path.with_name(f"{path.name}.{datetime.now(UTC):%Y%m%dT%H%M%S%f}.bak")
with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)) as src, closing(sqlite3.connect(backup)) as dst:
    src.backup(dst)
PY
fi
(cd backend && ../.venv/bin/alembic upgrade head)
install_yolo() {
  local index=${ORION_TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}
  python3 -m venv .venv-yolo &&
    .venv-yolo/bin/pip install --index-url "$index" 'torch==2.15.0' 'torchvision==0.29.2' &&
    .venv-yolo/bin/pip install -r backend/requirements-pose.txt &&
    .venv-yolo/bin/pip check &&
    .venv-yolo/bin/python -c 'import torch, torchvision, ultralytics'
}
if [[ ${ORION_ENABLE_YOLO:-0} == 1 ]]; then
  rm -f .runtime/yolo-ready
  if install_yolo; then
    touch .runtime/yolo-ready
  else
    printf 'Optional YOLO dependencies unavailable. Core setup completed.\n' >&2
  fi
fi
if [[ -n ${ORION_DATASET_DIR:-} ]]; then
  python3 scripts/audit_dataset.py "$ORION_DATASET_DIR" || printf 'Dataset audit needs attention. Core services remain available.\n'
  weights=${ORION_POSE_WEIGHTS:-fitness_pose/runs/pose/squat_finetune/weights/best.pt}
  [[ $weights = /* ]] || weights="$ORION_DATASET_DIR/$weights"
  [[ -s $weights ]] || printf 'Optional YOLO checkpoint unavailable.\n'
  [[ -s "$ORION_DATASET_DIR/fitness_pose/models/mediapipe/pose_landmarker_full.task" ]] || printf 'Optional local MediaPipe model unavailable.\n'
else
  printf 'Optional vision dataset unconfigured.\n'
fi
[[ ${ORION_ENABLE_YOLO:-0} == 1 ]] || printf 'Optional YOLO runtime installation disabled.\n'
[[ -r $ORION_WATCH_TOKEN_FILE || -n ${ORION_WATCH_TOKEN:-} ]] || printf 'Optional ORION Wear token unavailable.\n'
printf 'Run bash start.sh to open ORION.\n'
