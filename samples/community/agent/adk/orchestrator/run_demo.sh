#!/bin/bash
# run_demo.sh - run the orchestrator and all 4 subagents with prefixes

# Kill all child processes when this script exits
trap 'kill $(jobs -p) 2>/dev/null' EXIT

BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
RED_BOLD='\033[1;31m'
NC='\033[0m'

run_with_prefix() {
  local color=$1
  local prefix=$2
  shift 2
  "$@" 2>&1 | while IFS= read -r line; do
    echo -e "${color}[${prefix}]${NC} ${line}"
  done &
}

uv sync

run_with_prefix "$BLUE"     "FRONT DESK  " uv run --no-sync subagent_front_desk.py --port=10011
run_with_prefix "$MAGENTA"  "HOUSEKEEPING" uv run --no-sync subagent_housekeeping.py --port=10012
run_with_prefix "$YELLOW"   "MAINTENANCE " uv run --no-sync subagent_maintenance.py --port=10013
run_with_prefix "$GREEN"    "ROOM SERVICE" uv run --no-sync subagent_room_service.py --port=10014

run_orchestrator() {
  sleep 2 && \
  uv run --no-sync . --port=10002 \
    --subagent_urls=http://localhost:10011 \
    --subagent_urls=http://localhost:10012 \
    --subagent_urls=http://localhost:10013 \
    --subagent_urls=http://localhost:10014
}
run_with_prefix "$RED_BOLD" "ORCHESTRATOR" run_orchestrator

wait
