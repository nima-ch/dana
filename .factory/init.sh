#!/usr/bin/env bash
set -euo pipefail

DANA_ROOT="/home/nima/dana"
BUN="/home/nima/.bun/bin/bun"

echo "=== Dana init: installing dependencies ==="

# Backend dependencies
cd "$DANA_ROOT/app/backend"
"$BUN" install --frozen-lockfile 2>/dev/null || "$BUN" install

# Frontend dependencies
cd "$DANA_ROOT/app/frontend"
"$BUN" install --frozen-lockfile 2>/dev/null || "$BUN" install

# Ensure data directory exists
mkdir -p "$DANA_ROOT/data"
mkdir -p "$DANA_ROOT/.logs"

# Ensure .env exists with defaults
if [ ! -f "$DANA_ROOT/.env" ]; then
  cat > "$DANA_ROOT/.env" << 'EOF'
PROXY_BASE_URL=http://127.0.0.1:8317
DATA_DIR=/home/nima/dana/data
PORT=3000
EOF
fi

echo "=== Dana init: complete ==="
