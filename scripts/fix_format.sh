#!/usr/bin/env bash
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -eEuo pipefail

failure() {
  local exit_code=$?
  echo "===================================================="
  echo "❌ ERROR: fix_format.sh failed on line ${BASH_LINENO[0]} with exit status $exit_code"
  echo "Command: ${BASH_COMMAND}"
  echo "===================================================="
  exit "$exit_code"
}
trap 'failure' ERR

CHECK_ONLY=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=true
fi

# Get repo root
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "Running Prettier formatting for Node/Web assets..."
if command -v corepack >/dev/null 2>&1; then
  corepack enable 2>/dev/null || true
fi
if [ -f ".yarn/install-state.gz" ]; then
  # Local Node environment already installed; invoke standard script targets
  if [ "$CHECK_ONLY" = true ]; then
    yarn format:check:all
  else
    yarn format:all
  fi
else
  # Non-Node contributor or CI; run standalone Prettier via dlx without full monorepo install
  if [ "$CHECK_ONLY" = true ]; then
    yarn dlx prettier@^3.5.0 --config .prettierrc --check .
  else
    yarn dlx prettier@^3.5.0 --config .prettierrc --write .
  fi
fi

echo "Running Pyink for Python Agent SDK..."
cd "$REPO_ROOT/agent_sdks/python/a2ui_agent" || exit 1
if [ "$CHECK_ONLY" = true ]; then
  uv run pyink --check .
else
  uv run pyink .
fi

echo "Running Pyink for Python Core SDK..."
cd "$REPO_ROOT/agent_sdks/python/a2ui_core" || exit 1
if [ "$CHECK_ONLY" = true ]; then
  uv run pyink --check .
else
  uv run pyink .
fi

echo "Running Pyink for Python Samples..."
cd "$REPO_ROOT/samples/agent/adk"
if [ "$CHECK_ONLY" = true ]; then
  uv run pyink --check .
else
  uv run pyink .
fi

echo "Running Pyink for Python Specification Proposals..."
cd "$REPO_ROOT"
if [ "$CHECK_ONLY" = true ]; then
  uv run --with pyink pyink --check "$REPO_ROOT/specification/proposals"
else
  uv run --with pyink pyink "$REPO_ROOT/specification/proposals"
fi

echo "Running Dart format..."
cd "$REPO_ROOT"
# Check if dart is available before running
if command -v dart >/dev/null 2>&1; then
  echo "Resolving Dart workspace dependencies..."
  flutter pub get || echo "Warning: 'flutter pub get' failed. Formatting might have package resolution warnings."
  if [ "$CHECK_ONLY" = true ]; then
    dart format --output=none --set-exit-if-changed .
  else
    dart format .
  fi
else
  echo "Warning: dart command not found. Skipping Dart formatting."
fi

echo "Running swift-format..."
if command -v swift-format >/dev/null 2>&1; then
  if [ "$CHECK_ONLY" = true ]; then
    echo "Linting Swift files..."
    swift-format lint -r Package.swift swift/core
  else
    echo "Formatting Swift files..."
    swift-format format -i -r Package.swift swift/core
  fi
else
  echo "Warning: swift-format command not found. Skipping Swift formatting."
fi

echo "Done."
