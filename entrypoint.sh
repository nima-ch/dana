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

mkdir -p "${DATA_DIR:-/data}"
cat > /tmp/cli-proxy-config.yaml <<EOF
port: 8317
auth-dir: "${DATA_DIR:-/data}/.cli-proxy-api"
EOF

/usr/local/bin/CLIProxyAPI -config /tmp/cli-proxy-config.yaml &
proxy_pid=$!
child_pids="$child_pids $proxy_pid"

i=0
while [ "$i" -lt 30 ]; do
  if wget -qO- http://127.0.0.1:8317/v1/models >/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

echo "Dana available at http://localhost:${PORT:-3000}"
exec bun run app/backend/src/index.ts
