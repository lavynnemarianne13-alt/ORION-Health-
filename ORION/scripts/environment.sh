# Load trusted local settings and normalize paths before starting services.
orion_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$orion_root"
umask 077
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
absolute_path() {
  case "$1" in /*) printf '%s\n' "$1";; *) printf '%s/%s\n' "$orion_root" "$1";; esac
}
export ORION_DB_PATH="$(absolute_path "${ORION_DB_PATH:-data/orion.sqlite}")"
export ORION_WATCH_TOKEN_FILE="$(absolute_path "${ORION_WATCH_TOKEN_FILE:-.watch-token}")"
if [[ -z ${ORION_DATASET_DIR:-} ]]; then
  shopt -s nullglob
  candidates=(data/datasets/Orion_dataset)
  if [[ ! -d ${candidates[0]} ]]; then candidates=(../*/Orion_dataset); fi
  if (( ${#candidates[@]} == 1 )); then ORION_DATASET_DIR=${candidates[0]}; fi
  shopt -u nullglob
fi
if [[ -n ${ORION_DATASET_DIR:-} ]]; then
  export ORION_DATASET_DIR="$(absolute_path "$ORION_DATASET_DIR")"
fi
export ORION_WATCH_PORT="${ORION_WATCH_PORT:-8001}"
export ORION_WATCH_RECEIVER="${ORION_WATCH_RECEIVER:-http://127.0.0.1:$ORION_WATCH_PORT}"
