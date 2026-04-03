#!/bin/sh
set -eu

child_pids=""

cleanup() {
  for pid in $child_pids; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup TERM INT

/usr/local/bin/CLIProxyAPI -port 8317 -data-dir "${DATA_DIR:-/data}" &
proxy_pid=$!
child_pids="$child_pids $proxy_pid"

i=0
while [ "$i" -lt 30 ]; do
  if curl -sf http://127.0.0.1:8317/v1/models >/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

echo "Dana available at http://localhost:${PORT:-3000}"
exec bun run app/backend/src/index.ts
