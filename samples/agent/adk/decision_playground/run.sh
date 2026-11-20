#!/usr/bin/env bash
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

# Starts the A2UI decision playground agent in the requested preset.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [[ -f "${HOME}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${HOME}/.env"
  set +a
fi

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

if [[ -x "${HOME}/.local/bin/uv" ]]; then
  UV_BIN="${HOME}/.local/bin/uv"
else
  UV_BIN="uv"
fi

usage() {
  cat <<'EOF'
Usage: ./run.sh [PRESET] [OPTIONS...]

Starts the A2UI Decision Playground agent with a preset decision backend and
initial render mode. Extra flags (such as --port or --host) are forwarded to
the server entrypoint.

Presets:
  mock        (default) Deterministic offline heuristic backend in cascade mode.
  gemini      Google Gemini Decisions API (/v1beta/decisions, default model:
              gemini-decision-1) in cascade mode. Uses GEMINI_API_KEY or
              GOOGLE_API_KEY.
  jev         Remote TypeSafe Jev (/v1/systemone) in cascade mode.
              Uses A2UI_DECISION_AUTH or JEV_API_KEY.
  step0       Step-0 single-token logprob endpoint in cascade mode.
              Requires A2UI_DECISION_URL.
  cascade     Starts in `cascade` mode (backend defaults to mock).
  binder      Starts in `binder` mode (backend defaults to mock).
  rpc         Starts in `rpc` mode (backend defaults to mock).
  express     Starts in `express` baseline mode (requires GEMINI_API_KEY).
  direct      Starts in `direct` baseline mode (requires GEMINI_API_KEY).

Environment variables:
  GEMINI_API_KEY          Gemini API key (optional for offline mock mode)
  MODEL_NAME              Gemini model for express/direct/pruned Express (default: gemini-3.6-flash)
  JEV_API_KEY             API key for the `jev` preset (or set A2UI_DECISION_AUTH)
  A2UI_DECISION_URL       Override the HTTP endpoint URL for `jev`, `gemini`, or `step0`
  A2UI_DECISION_MODEL     Override the decision model ID (default for `gemini`: gemini-decision-1)

Examples:
  ./run.sh mock
  ./run.sh gemini
  JEV_API_KEY=... ./run.sh jev
  A2UI_DECISION_URL=http://localhost:8000/v1/completions ./run.sh step0
  ./run.sh binder --port 10011
EOF
}

PRESET="mock"
if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    --*)
      ;;
    *)
      PRESET="$1"
      shift
      ;;
  esac
fi

RENDER_MODE="cascade"

case "${PRESET}" in
  mock)
    export A2UI_DECISION_BACKEND="mock"
    RENDER_MODE="cascade"
    ;;
  gemini)
    export A2UI_DECISION_BACKEND="gemini"
    export A2UI_DECISION_AUTH="${A2UI_DECISION_AUTH:-${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}}"
    if [[ -z "${A2UI_DECISION_AUTH}" && -z "${A2UI_DECISION_TOKEN:-}" ]]; then
      echo "Error: 'gemini' preset requires GEMINI_API_KEY, GOOGLE_API_KEY, or A2UI_DECISION_AUTH." >&2
      exit 1
    fi
    export A2UI_DECISION_URL="${A2UI_DECISION_URL:-${GEMINI_DECISION_URL:-https://generativelanguage.googleapis.com/v1beta/decisions}}"
    export A2UI_DECISION_MODEL="${A2UI_DECISION_MODEL:-${GEMINI_DECISION_MODEL:-gemini-decision-1}}"
    RENDER_MODE="cascade"
    ;;
  jev|systemone)
    export A2UI_DECISION_BACKEND="systemone"
    export A2UI_DECISION_AUTH="${A2UI_DECISION_AUTH:-${JEV_API_KEY:-${TYPESAFE_API_KEY:-}}}"
    if [[ -z "${A2UI_DECISION_AUTH}" && -z "${A2UI_DECISION_TOKEN:-}" ]]; then
      echo "Error: 'jev' preset requires JEV_API_KEY or A2UI_DECISION_AUTH." >&2
      exit 1
    fi
    if [[ "${A2UI_DECISION_AUTH}" == vcp_* ]]; then
      export A2UI_DECISION_URL="${A2UI_DECISION_URL:-https://ai-gateway.vercel.sh/typesafe/v1/systemone}"
      export A2UI_DECISION_MODEL="${A2UI_DECISION_MODEL:-${JEV_MODEL:-jev}}"
    else
      export A2UI_DECISION_URL="${A2UI_DECISION_URL:-https://api.typesafe.ai/v1/systemone}"
      export A2UI_DECISION_MODEL="${A2UI_DECISION_MODEL:-${JEV_MODEL:-jev-1.14.0}}"
    fi
    RENDER_MODE="cascade"
    ;;
  step0)
    export A2UI_DECISION_BACKEND="step0"
    if [[ -z "${A2UI_DECISION_URL:-}" ]]; then
      echo "Error: 'step0' preset requires A2UI_DECISION_URL to be set." >&2
      exit 1
    fi
    RENDER_MODE="cascade"
    ;;
  cascade|binder|rpc|express|direct)
    export A2UI_DECISION_BACKEND="${A2UI_DECISION_BACKEND:-mock}"
    RENDER_MODE="${PRESET}"
    ;;
  *)
    echo "Error: Unknown preset '${PRESET}'. Choose from: mock, gemini, jev, step0, cascade, binder, rpc, express, direct." >&2
    usage >&2
    exit 1
    ;;
esac

exec "${UV_BIN}" run . --mode "${RENDER_MODE}" "$@"
