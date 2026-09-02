#!/bin/bash
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# About this script:
#
# Verifies the 4 Getting Started Restaurant Finder demo clients (Lit, React, Angular, Flutter)
# against the Python A2A agent backend.
#
# Usage:
#   export GEMINI_API_KEY="your_api_key"
#   ./scripts/test_demos.sh [--build-only] [--demo lit|react|angular|flutter|all]

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEMO_TARGET="${2:-all}"
BUILD_ONLY=false

if [ "$1" = "--build-only" ]; then
  BUILD_ONLY=true
fi

echo "========================================="
echo " A2UI Getting Started Demos Verification"
echo " Target: $DEMO_TARGET (Build only: $BUILD_ONLY)"
echo "========================================="

# 1. Build common renderer packages first (only for web demos)
if [ "$DEMO_TARGET" != "flutter" ]; then
  echo ""
  echo "--> Building web renderers..."
  (
    cd "$REPO_ROOT"
    yarn workspace @a2ui/web_core build
    yarn workspace @a2ui/markdown-it build
    case "$DEMO_TARGET" in
      lit)
        yarn workspace @a2ui/lit build
        ;;
      react)
        yarn workspace @a2ui/react build
        ;;
      angular)
        yarn workspace @a2ui/angular build
        ;;
      all)
        yarn workspace @a2ui/lit build
        yarn workspace @a2ui/react build
        yarn workspace @a2ui/angular build
        ;;
    esac
  )
fi

# 2. Build specified client(s)
build_lit() {
  echo ""
  echo "--> [1/4] Building Lit Shell Demo..."
  cd "$REPO_ROOT/samples/client/lit/shell"
  yarn build
  echo "✔ Lit shell built successfully."
}

build_react() {
  echo ""
  echo "--> [2/4] Building React Shell Demo..."
  cd "$REPO_ROOT/samples/client/react/shell"
  yarn build
  echo "✔ React shell built successfully."
}

build_angular() {
  echo ""
  echo "--> [3/4] Building Angular Demo..."
  cd "$REPO_ROOT/samples/client/angular"
  yarn ng build restaurant
  echo "✔ Angular restaurant demo built successfully."
}

build_flutter() {
  echo ""
  echo "--> [4/4] Building Flutter Web Demo..."
  cd "$REPO_ROOT"
  flutter pub get
  cd "$REPO_ROOT/samples/client/flutter/restaurant_finder/app"
  flutter build web
  echo "✔ Flutter web demo built successfully."
}

case "$DEMO_TARGET" in
  lit)
    build_lit
    ;;
  react)
    build_react
    ;;
  angular)
    build_angular
    ;;
  flutter)
    build_flutter
    ;;
  all)
    build_lit
    build_react
    build_angular
    build_flutter
    ;;
  *)
    echo "Unknown demo target: $DEMO_TARGET. Choose from: lit, react, angular, flutter, all"
    exit 1
    ;;
esac

if [ "$BUILD_ONLY" = true ]; then
  echo ""
  echo "✔ All requested demo builds completed successfully (build-only mode)."
  exit 0
fi

# 3. Live Server & Integration Checks (requires GEMINI_API_KEY)
if [ -z "$GEMINI_API_KEY" ]; then
  echo ""
  echo "WARNING: GEMINI_API_KEY is not set. Skipping live agent interaction."
  echo "To run live integration tests, export GEMINI_API_KEY and re-run."
  exit 0
fi

echo ""
echo "--> Starting Python Restaurant Finder Agent on port 10002..."
AGENT_DIR="$REPO_ROOT/samples/agent/adk/restaurant_finder"
(
  cd "$AGENT_DIR"
  uv run . &
  echo $! > /tmp/a2ui_agent_pid.txt
)

cleanup() {
  if [ -f /tmp/a2ui_agent_pid.txt ]; then
    AGENT_PID=$(cat /tmp/a2ui_agent_pid.txt)
    echo "Shutting down agent process (PID: $AGENT_PID)..."
    kill -9 "$AGENT_PID" 2>/dev/null || true
    rm -f /tmp/a2ui_agent_pid.txt
  fi
  fuser -k 10002/tcp 2>/dev/null || true
}
trap cleanup EXIT

echo "--> Waiting for agent card readiness at http://127.0.0.1:10002/.well-known/agent-card.json..."
READY=false
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:10002/.well-known/agent-card.json | grep -q "capabilities"; then
    READY=true
    echo "✔ Agent server is ready! (Attempt $i)"
    break
  fi
  sleep 1
done

if [ "$READY" = false ]; then
  echo "ERROR: Agent server failed to start within 30 seconds."
  exit 1
fi

# Probe agent card
echo "--> Verifying agent capabilities..."
CARD_RESPONSE=$(curl -s http://127.0.0.1:10002/.well-known/agent-card.json)
if ! echo "$CARD_RESPONSE" | grep -q "A2UI"; then
  echo "ERROR: Agent card does not declare A2UI capability."
  exit 1
fi
echo "✔ Agent card declares A2UI capability."

# Probe live JSON-RPC query
echo "--> Testing agent message processing..."
QUERY_PAYLOAD='{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{"text": "Find me 3 italian restaurants in New York"}],
      "messageId": "ci-check-1"
    }
  }
}'

MSG_RESPONSE=$(curl -s -X POST http://127.0.0.1:10002/ \
  -H "Content-Type: application/json" \
  -d "$QUERY_PAYLOAD")

if ! echo "$MSG_RESPONSE" | grep -q "parts"; then
  echo "ERROR: Agent response did not contain expected parts:"
  echo "$MSG_RESPONSE"
  exit 1
fi
echo "✔ Agent responded with valid A2A message payload."

# If Flutter was requested, run Flutter e2e test
if [ "$DEMO_TARGET" = "flutter" ] || [ "$DEMO_TARGET" = "all" ]; then
  echo ""
  echo "--> Running Flutter E2E session test..."
  "$REPO_ROOT/scripts/e2e_test.sh"
  echo "✔ Flutter E2E session test passed."
fi

# If Lit was requested, run Lit compilation/smoke test
if [ "$DEMO_TARGET" = "lit" ] || [ "$DEMO_TARGET" = "all" ]; then
  echo ""
  echo "--> Running Lit Shell smoke tests..."
  (
    cd "$REPO_ROOT/samples/client/lit/shell"
    yarn test:vite-compilation
  )
  echo "✔ Lit Shell smoke tests passed."
fi

echo ""
echo "=========================================================="
echo "✔ ALL REQUESTED DEMO VERIFICATIONS COMPLETED SUCCESSFULLY!"
echo "=========================================================="
