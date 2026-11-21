#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/scripts/environment.sh"
mkdir -p .runtime data
exec 9>.runtime/lock
flock -n 9 || { printf 'ORION is already running.\n' >&2; exit 1; }
[[ -x .venv/bin/uvicorn && -x frontend/node_modules/.bin/vite ]] || { printf 'Run bash setup.sh first.\n' >&2; exit 1; }
port_free() {
  python3 - "$1" "${2:-127.0.0.1}" <<'PYTHON'
import socket, sys
try:
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((sys.argv[2], int(sys.argv[1])))
        listener.listen(1)
except (OSError, ValueError) as error:
    sys.exit(str(error))
PYTHON
}
for port in 8000 5173; do
  port_free "$port" || { printf 'Cannot bind ORION port %s.\n' "$port" >&2; exit 1; }
done
children=()
cleanup() {
  trap - EXIT INT TERM
  if (( ${#children[@]} )); then
    kill "${children[@]}" 2>/dev/null || true
    wait "${children[@]}" 2>/dev/null || true
  fi
  rm -f .runtime/supervisor
}
trap cleanup EXIT
trap 'exit 0' INT TERM
printf '%s %s\n' "$$" "$(awk '{print $22}' /proc/$$/stat)" > .runtime/supervisor
backend_python=.venv/bin/python
if [[ ${ORION_ENABLE_YOLO:-0} == 1 && -f .runtime/yolo-ready && -x .venv-yolo/bin/python ]]; then
  backend_python=.venv-yolo/bin/python
fi
(cd backend && exec "../$backend_python" -m uvicorn main:app --host 127.0.0.1 --port 8000) 9>&- >.runtime/backend.log 2>&1 &
children+=("$!")
(cd frontend && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort) 9>&- >.runtime/frontend.log 2>&1 &
children+=("$!")
if [[ $ORION_WATCH_RECEIVER == "http://127.0.0.1:$ORION_WATCH_PORT" &&
      ${ORION_WATCH_ATHLETE_ID:-} =~ ^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$ ]] &&
   [[ -r $ORION_WATCH_TOKEN_FILE || -n ${ORION_WATCH_TOKEN:-} ]]; then
  if port_free "$ORION_WATCH_PORT" "${ORION_WATCH_HOST:-127.0.0.1}"; then
    export ORION_WATCH_DB_PATH="${ORION_WATCH_DB_PATH:-$orion_root/data/watch-$ORION_WATCH_ATHLETE_ID.sqlite}"
    node wearable/receiver/server/watch-server.mjs 9>&- >.runtime/wear.log 2>&1 &
    wear_pid=$!
  else
    printf 'Optional Wear receiver skipped. Cannot bind ORION port %s.\n' "$ORION_WATCH_PORT"
  fi
fi
core=("${children[@]}")
if [[ -n ${wear_pid:-} ]]; then children+=("$wear_pid"); fi
wait_http() {
  local attempt
  for attempt in {1..50}; do
    curl -fsS --max-time 1 "$1" >/dev/null 2>&1 && return 0
    kill -0 "${core[@]}" 2>/dev/null || break
    sleep .2
  done
  printf 'Service unavailable at %s. Check .runtime logs.\n' "$1" >&2
  return 1
}
wait_http http://127.0.0.1:8000/ready
wait_http http://127.0.0.1:5173/
printf 'ORION available at http://127.0.0.1:5173/\nLogs: %s/.runtime\n' "$orion_root"
wait -n "${core[@]}"
