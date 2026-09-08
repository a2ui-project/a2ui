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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REACT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${REACT_DIR}/../.." && pwd)"

echo "=== Testing @a2ui/react with React 18 ==="

# Save backups so we restore the exact starting state
cp "${REACT_DIR}/package.json" "${REACT_DIR}/package.json.bak"
cp "${REACT_DIR}/a2ui_explorer/package.json" "${REACT_DIR}/a2ui_explorer/package.json.bak"
cp "${REPO_ROOT}/yarn.lock" "${REPO_ROOT}/yarn.lock.bak"

cleanup() {
  echo "=== Restoring original React 19 dependencies ==="
  if [[ -f "${REACT_DIR}/package.json.bak" ]]; then
    mv -f "${REACT_DIR}/package.json.bak" "${REACT_DIR}/package.json"
  fi
  if [[ -f "${REACT_DIR}/a2ui_explorer/package.json.bak" ]]; then
    mv -f "${REACT_DIR}/a2ui_explorer/package.json.bak" "${REACT_DIR}/a2ui_explorer/package.json"
  fi
  if [[ -f "${REPO_ROOT}/yarn.lock.bak" ]]; then
    mv -f "${REPO_ROOT}/yarn.lock.bak" "${REPO_ROOT}/yarn.lock"
  fi
  yarn --cwd "${REPO_ROOT}" install
}
trap cleanup EXIT INT TERM

# Ensure dependencies are built first
echo "=== Building @a2ui/react ==="
yarn --cwd "${REACT_DIR}" build

# Temporarily swap devDependencies to React 18
echo "=== Swapping to React 18 dependencies ==="
yarn --cwd "${REACT_DIR}" add -D \
  "react@^18.3.1" \
  "react-dom@^18.3.1" \
  "@types/react@^18.3.1" \
  "@types/react-dom@^18.3.1" \
  "@testing-library/react@^14.3.1"

yarn --cwd "${REACT_DIR}/a2ui_explorer" add \
  "react@^18.3.1" \
  "react-dom@^18.3.1" \
  "@types/react@^18.3.1" \
  "@types/react-dom@^18.3.1"

# Run unit tests under real React 18
echo "=== Running unit tests under React 18 ==="
yarn --cwd "${REACT_DIR}" test:unit

# Run integration tests under real React 18
echo "=== Running integration tests under React 18 ==="
TZ=UTC yarn --cwd "${REACT_DIR}" test:integration

echo "=== React 18 test matrix passed successfully! ==="
