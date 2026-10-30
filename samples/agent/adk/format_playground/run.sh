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

# Starts the A2UI format playground agent in the requested mode/backend preset.

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

Starts the A2UI Format Playground agent with a preset decision backend and
initial render mode. Extra flags (such as --port or --host) are forwarded to
the server entrypoint.

Presets:
  mock        (default) Deterministic offline mock backend in decision mode.
  jev         Remote TypeSafe Jev (/v1/systemone) in decision mode.
              Uses A2UI_DECISION_AUTH or JEV_API_KEY.
  gev         Local Gev server (/v1/systemone, default model: vertex/decision-gemma)
              in decision mode. Starts the local Gev server on port 8790 if not
              already running.
  express     Starts in `express` render mode (decision backend defaults to mock).
  direct      Starts in `direct` render mode (decision backend defaults to mock).
  tool        Starts in `tool` render mode (decision backend defaults to mock).

Environment variables:
  GEMINI_API_KEY          Gemini API key (or set GOOGLE_GENAI_USE_VERTEXAI=TRUE)
  MODEL_NAME              Stage-1/Stage-2 Gemini model (default: gemini-3.6-flash)
  JEV_API_KEY             API key for the `jev` preset (or set A2UI_DECISION_AUTH)
  GEV_PORT                Local Gev server port for the `gev` preset (default: 8790)
  GEV_SERVER_BIN          Path to prebuilt Gev server binary (auto-detected if unset)
  A2UI_DECISION_URL       Override the HTTP endpoint URL for `jev` / `gev`
  A2UI_DECISION_MODEL     Override the decision model ID (default for `gev`: vertex/decision-gemma)

Examples:
  ./run.sh mock
  JEV_API_KEY=... ./run.sh jev
  ./run.sh gev
  ./run.sh express --port 10011
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
      # Only options were passed; keep the default preset.
      ;;
    *)
      PRESET="$1"
      shift
      ;;
  esac
fi

RENDER_MODE="decision"
GEV_SERVER_PID=""

cleanup_gev_server() {
  if [[ -n "${GEV_SERVER_PID}" ]] && kill -0 "${GEV_SERVER_PID}" 2>/dev/null; then
    echo "Stopping local Gev server (pid ${GEV_SERVER_PID})..."
    kill -INT "${GEV_SERVER_PID}" 2>/dev/null || true
    wait "${GEV_SERVER_PID}" 2>/dev/null || true
  fi
}

find_or_build_gev_server() {
  if [[ -n "${GEV_SERVER_BIN:-}" && -x "${GEV_SERVER_BIN}" ]]; then
    echo "${GEV_SERVER_BIN}"
    return 0
  fi

  return 1
}

start_gev_server_if_needed() {
  local host="${GEV_HOST:-127.0.0.1}"
  local port="${GEV_PORT:-8790}"
  local model="$1"
  local healthz_url="$2"

  if curl -fsS --max-time 1 "${healthz_url}" >/dev/null 2>&1; then
    echo "Using running Gev server at ${healthz_url%/healthz}/v1/systemone (model: ${model})"
    return 0
  fi

  local gev_bin
  if ! gev_bin="$(find_or_build_gev_server)"; then
    echo "Error: Could not find or build //prototypes/projects/gev:server." >&2
    echo "Set GEV_SERVER_BIN or start the server manually on port ${port}." >&2
    exit 1
  fi

  echo "Starting local Gev server (${gev_bin}) on ${host}:${port} (model: ${model})..."
  "${gev_bin}" --host="${host}" --port="${port}" --model="${model}" &
  GEV_SERVER_PID="$!"
  trap cleanup_gev_server EXIT INT TERM

  local i
  for ((i = 0; i < 120; i++)); do
    if ! kill -0 "${GEV_SERVER_PID}" 2>/dev/null; then
      echo "Error: Local Gev server exited prematurely." >&2
      exit 1
    fi
    if curl -fsS --max-time 1 "${healthz_url}" >/dev/null 2>&1; then
      echo "Local Gev server ready at http://${host}:${port}/v1/systemone"
      return 0
    fi
    sleep 0.25
  done

  echo "Error: Timed out waiting for local Gev server at ${healthz_url}." >&2
  exit 1
}

case "${PRESET}" in
  mock)
    export A2UI_DECISION_BACKEND="mock"
    RENDER_MODE="decision"
    ;;
  jev|systemone)
    export A2UI_DECISION_BACKEND="systemone"
    export A2UI_DECISION_AUTH="${A2UI_DECISION_AUTH:-${JEV_API_KEY:-${TYPESAFE_API_KEY:-}}}"
    if [[ -z "${A2UI_DECISION_AUTH}" && -z "${A2UI_DECISION_TOKEN:-}" ]]; then
      echo "Error: 'jev' preset requires JEV_API_KEY or A2UI_DECISION_AUTH to be set (use './run.sh gev' for the local Gev server)." >&2
      exit 1
    fi
    if [[ "${A2UI_DECISION_AUTH}" == vcp_* ]]; then
      export A2UI_DECISION_URL="${A2UI_DECISION_URL:-https://ai-gateway.vercel.sh/typesafe/v1/systemone}"
      export A2UI_DECISION_MODEL="${A2UI_DECISION_MODEL:-${JEV_MODEL:-jev}}"
    else
      export A2UI_DECISION_URL="${A2UI_DECISION_URL:-https://api.typesafe.ai/v1/systemone}"
      export A2UI_DECISION_MODEL="${A2UI_DECISION_MODEL:-${JEV_MODEL:-jev-latest}}"
    fi
    RENDER_MODE="decision"
    ;;
  gev)
    GEV_HOST="${GEV_HOST:-127.0.0.1}"
    GEV_PORT="${GEV_PORT:-8790}"
    export A2UI_DECISION_BACKEND="systemone"
    export A2UI_DECISION_URL="${A2UI_DECISION_URL:-http://${GEV_HOST}:${GEV_PORT}/v1/systemone}"
    export A2UI_DECISION_MODEL="${A2UI_DECISION_MODEL:-${JEV_MODEL:-vertex/decision-gemma}}"
    GEV_HEALTHZ_URL="${A2UI_DECISION_URL%/v1/systemone}/healthz"
    start_gev_server_if_needed "${A2UI_DECISION_MODEL}" "${GEV_HEALTHZ_URL}"
    RENDER_MODE="decision"
    ;;
  express)
    export A2UI_DECISION_BACKEND="${A2UI_DECISION_BACKEND:-mock}"
    RENDER_MODE="express"
    ;;
  direct)
    export A2UI_DECISION_BACKEND="${A2UI_DECISION_BACKEND:-mock}"
    RENDER_MODE="direct"
    ;;
  tool)
    export A2UI_DECISION_BACKEND="${A2UI_DECISION_BACKEND:-mock}"
    RENDER_MODE="tool"
    ;;
  decision)
    RENDER_MODE="decision"
    ;;
  *)
    echo "Error: Unknown preset '${PRESET}'. Choose from: mock, jev, gev, express, direct, tool." >&2
    usage >&2
    exit 1
    ;;
esac

if [[ -n "${GEV_SERVER_PID}" ]]; then
  "${UV_BIN}" run --no-sync . --mode "${RENDER_MODE}" "$@"
else
  exec "${UV_BIN}" run --no-sync . --mode "${RENDER_MODE}" "$@"
fi
