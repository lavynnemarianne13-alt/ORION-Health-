#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ -s .runtime/supervisor ]]; then
  read -r pid started < .runtime/supervisor
  if [[ $pid =~ ^[0-9]+$ && -n $started && -r /proc/$pid/stat ]] &&
     [[ $(awk '{print $22}' "/proc/$pid/stat") == "$started" ]]; then
    kill -TERM "$pid"
    for attempt in {1..100}; do
      [[ -e .runtime/supervisor ]] || exit 0
      sleep .1
    done
    printf 'ORION is still shutting down.\n' >&2
    exit 1
  fi
fi
printf 'ORION is already stopped.\n'
