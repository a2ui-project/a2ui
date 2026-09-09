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

REACT_PKG="${REACT_DIR}/package.json"
EXPLORER_PKG="${REACT_DIR}/a2ui_explorer/package.json"
ROOT_LOCK="${REPO_ROOT}/yarn.lock"

# Dependency files temporarily modified during React 18 testing
SWAPPED_FILES=("${REACT_PKG}" "${EXPLORER_PKG}" "${ROOT_LOCK}")

echo "=== Testing @a2ui/react with React 18 ==="

# Preflight: ensure no uncommitted changes in dependency files
if ! git -C "${REPO_ROOT}" diff --quiet HEAD -- "${SWAPPED_FILES[@]}"; then
  echo "Error: Uncommitted changes detected in package.json or yarn.lock."
  echo "Please commit or stash your changes before running the React 18 test matrix."
  exit 1
fi

DEPS_SWAPPED=false

cleanup() {
  trap - EXIT INT TERM
  echo "=== Restoring original React 19 dependencies ==="
  git -C "${REPO_ROOT}" checkout -- "${SWAPPED_FILES[@]}"
  if [[ "${DEPS_SWAPPED}" == "true" ]]; then
    yarn --cwd "${REPO_ROOT}" install
  fi
}
trap cleanup EXIT INT TERM

# Temporarily swap devDependencies to React 18 before building
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

DEPS_SWAPPED=true

# Run test suite under real React 18 (wireit handles build, test:unit, and test:integration)
echo "=== Running tests under React 18 ==="
TZ=UTC yarn --cwd "${REACT_DIR}" test

echo "=== React 18 test matrix passed successfully! ==="
