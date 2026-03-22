#!/usr/bin/env bash
set -euo pipefail

DANA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN="$HOME/.bun/bin/bun"
BACKEND_DIR="$DANA_ROOT/app/backend"
FRONTEND_DIR="$DANA_ROOT/app/frontend"
LOG_DIR="$DANA_ROOT/.logs"
PID_FILE="$DANA_ROOT/.pids"
ENV_FILE="$DANA_ROOT/.env"

BACKEND_PORT=3000
FRONTEND_PORT=5173

mkdir -p "$LOG_DIR"

# ── helpers ──────────────────────────────────────────────────────────────────

bold()  { printf '\033[1m%s\033[0m' "$*"; }
green() { printf '\033[32m%s\033[0m' "$*"; }
red()   { printf '\033[31m%s\033[0m' "$*"; }
yellow(){ printf '\033[33m%s\033[0m' "$*"; }
cyan()  { printf '\033[36m%s\033[0m' "$*"; }
dim()   { printf '\033[2m%s\033[0m' "$*"; }

save_pid() { echo "$1=$2" >> "$PID_FILE"; }

read_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  grep "^$1=" "$PID_FILE" 2>/dev/null | cut -d= -f2
}

is_running() {
  local pid
  pid=$(read_pid "$1") || return 1
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

wait_for_port() {
  local port=$1 timeout=${2:-20} i=0
  while ! curl -s "http://localhost:$port" -o /dev/null -w "%{http_code}" --max-time 1 2>/dev/null | grep -qE "^[0-9]"; do
    sleep 0.5; i=$((i+1))
    [[ $i -ge $((timeout*2)) ]] && return 1
  done
  # One extra second for stability
  sleep 1
}

# ── commands ─────────────────────────────────────────────────────────────────

cmd_start() {
  echo ""
  echo "$(bold "Dana") — starting services"
  echo ""

  # Load env
  [[ -f "$ENV_FILE" ]] && set -a && source "$ENV_FILE" && set +a

  # Check bun
  if [[ ! -x "$BUN" ]]; then
    echo "$(red "ERROR:") bun not found at $BUN"
    echo "  Install: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi

  # Kill anything still on our ports from a previous run
  fuser -k ${BACKEND_PORT}/tcp 2>/dev/null || true
  fuser -k ${FRONTEND_PORT}/tcp 2>/dev/null || true
  sleep 0.5

  # Reset PID file
  rm -f "$PID_FILE"

  # ── Backend ──
  if is_running backend; then
    echo "$(yellow "⚠") Backend already running (pid $(read_pid backend))"
  else
    echo "  Starting backend..."
    DATA_DIR="$DANA_ROOT/data" \
    PROXY_BASE_URL="${PROXY_BASE_URL:-http://127.0.0.1:8317}" \
    PORT="$BACKEND_PORT" \
      "$BUN" run "$BACKEND_DIR/src/index.ts" \
        > "$LOG_DIR/backend.log" 2>&1 &
    save_pid backend $!
    if wait_for_port $BACKEND_PORT 15; then
      echo "  $(green "✓") Backend    http://localhost:$BACKEND_PORT  $(dim "(log: .logs/backend.log)")"
    else
      echo "  $(red "✗") Backend failed to start — check .logs/backend.log"
      exit 1
    fi
  fi

  # ── Frontend ──
  if is_running frontend; then
    echo "$(yellow "⚠") Frontend already running (pid $(read_pid frontend))"
  else
    echo "  Starting frontend..."
    "$BUN" run --cwd "$FRONTEND_DIR" dev \
        > "$LOG_DIR/frontend.log" 2>&1 &
    save_pid frontend $!
    if wait_for_port $FRONTEND_PORT 20; then
      echo "  $(green "✓") Frontend   http://localhost:$FRONTEND_PORT  $(dim "(log: .logs/frontend.log)")"
    else
      echo "  $(red "✗") Frontend failed to start — check .logs/frontend.log"
      exit 1
    fi
  fi

  echo ""
  echo "  $(bold "App:")     $(cyan "http://localhost:$FRONTEND_PORT")"
  echo "  $(bold "API docs:") $(cyan "http://localhost:$BACKEND_PORT/docs")"
  echo "  $(bold "Health:  ") $(cyan "http://localhost:$BACKEND_PORT/health")"
  echo ""
  echo "  $(dim "Run './manage.sh stop' to shut down")"
  echo ""
}

cmd_stop() {
  echo ""
  echo "$(bold "Dana") — stopping services"
  echo ""

  for svc in frontend backend; do
    if is_running "$svc"; then
      local _pid
      _pid=$(read_pid "$svc")
      kill "$_pid" 2>/dev/null && echo "  $(green "✓") $svc stopped (pid $_pid)"
    else
      echo "  $(dim "-") $svc not running"
    fi
  done

  rm -f "$PID_FILE"
  echo ""
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  echo ""
  echo "$(bold "Dana") — service status"
  echo ""

  local _spid _sport
  for svc in backend frontend; do
    if is_running "$svc"; then
      _spid=$(read_pid "$svc")
      _sport=$([[ $svc == backend ]] && echo $BACKEND_PORT || echo $FRONTEND_PORT)
      echo "  $(green "●") $svc   running  pid=$_spid  port=$_sport"
    else
      echo "  $(red "○") $svc   stopped"
    fi
  done

  echo ""

  # Check LLM proxy
  if (echo >/dev/tcp/localhost/8317) 2>/dev/null; then
    echo "  $(green "●") claudeapiproxy   running  port=8317"
  else
    echo "  $(yellow "○") claudeapiproxy   not detected on port 8317"
  fi

  echo ""

  # Show URLs if running
  if is_running backend && is_running frontend; then
    echo "  $(bold "App:")      $(cyan "http://localhost:$FRONTEND_PORT")"
    echo "  $(bold "API docs:") $(cyan "http://localhost:$BACKEND_PORT/docs")"
    echo "  $(bold "Health:  ") $(cyan "http://localhost:$BACKEND_PORT/health")"
    echo ""
  fi
}

cmd_logs() {
  local svc="${1:-}"
  if [[ -z "$svc" ]]; then
    echo "Usage: ./manage.sh logs <backend|frontend>"
    exit 1
  fi
  local logfile="$LOG_DIR/${svc}.log"
  if [[ ! -f "$logfile" ]]; then
    echo "No log file for $svc yet."
    exit 1
  fi
  tail -f "$logfile"
}

cmd_test() {
  echo ""
  echo "$(bold "Dana") — running fast backend tests"
  echo ""
  cd "$BACKEND_DIR"
  "$BUN" test \
    tests/topicManager.test.ts \
    tests/storeClue.test.ts \
    tests/stream.test.ts \
    tests/internalTools.test.ts \
    tests/contextBuilder.test.ts \
    tests/stateManager.test.ts \
    tests/forumTools.test.ts \
    tests/pipeline.test.ts \
    tests/expertAgent.test.ts \
    tests/deltaPipeline.test.ts
}

cmd_test_llm() {
  echo ""
  echo "$(bold "Dana") — running LLM tests (requires proxy on :8317)"
  echo ""
  cd "$BACKEND_DIR"
  "$BUN" test \
    tests/proxyClient.test.ts \
    tests/clueProcessor.test.ts \
    tests/weightCalculator.test.ts \
    tests/forumAgents.test.ts
}

cmd_help() {
  echo ""
  echo "$(bold "Dana manage.sh") — dev management script"
  echo ""
  echo "  $(bold "Usage:")  ./manage.sh <command>"
  echo ""
  echo "  $(bold "Commands:")"
  echo "    $(cyan "start")       Start backend + frontend in background"
  echo "    $(cyan "stop")        Stop all services"
  echo "    $(cyan "restart")     Stop then start"
  echo "    $(cyan "status")      Show running services and URLs"
  echo "    $(cyan "logs") <svc>  Tail logs  (backend | frontend)"
  echo "    $(cyan "test")        Run fast unit tests (no LLM)"
  echo "    $(cyan "test-llm")    Run LLM tests (requires proxy on :8317)"
  echo "    $(cyan "help")        Show this help"
  echo ""
  echo "  $(bold "URLs (when running):")"
  echo "    App:      http://localhost:$FRONTEND_PORT"
  echo "    API docs: http://localhost:$BACKEND_PORT/docs"
  echo "    Health:   http://localhost:$BACKEND_PORT/health"
  echo ""
}

# ── dispatch ──────────────────────────────────────────────────────────────────

CMD="${1:-help}"
shift || true

case "$CMD" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${1:-}" ;;
  test)    cmd_test ;;
  test-llm) cmd_test_llm ;;
  help|--help|-h) cmd_help ;;
  *)
    echo "$(red "Unknown command:") $CMD"
    cmd_help
    exit 1
    ;;
esac
