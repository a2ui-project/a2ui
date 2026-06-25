#!/bin/bash
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

# About this script:
#
# Adds the Apache 2.0 / "Google LLC" license header to any file in the repo
# that's missing one. Mirrors the flags used by the `check_license.yml`
# GitHub Actions workflow, so running this locally produces output that
# satisfies the CI check.
#
# Requires `addlicense` (https://github.com/google/addlicense). To install:
#   go install github.com/google/addlicense@latest

set -euo pipefail

if ! command -v addlicense >/dev/null 2>&1; then
  # addlicense may live in $GOPATH/bin or $HOME/go/bin without being on PATH.
  if [ -x "${GOPATH:-$HOME/go}/bin/addlicense" ]; then
    export PATH="${GOPATH:-$HOME/go}/bin:$PATH"
  else
    echo "addlicense not found. Install it with:" >&2
    echo "  go install github.com/google/addlicense@latest" >&2
    exit 1
  fi
fi

cd "$(dirname "$0")/.."

addlicense \
  -l apache \
  -c "Google LLC" \
  -ignore "**/pnpm-lock.yaml" \
  -ignore "**/package-lock.json" \
  -ignore "**/yarn.lock" \
  -ignore "**/.venv/**" \
  -ignore "**/node_modules/**" \
  -ignore "**/build/**" \
  -ignore "**/.dart_tool/**" \
  -ignore "**/generated/**" \
  .
