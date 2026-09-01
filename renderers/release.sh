#!/bin/bash
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -e # Exit on error

# Check arguments
if [ -z "$1" ]; then
  echo "Usage: $0 <package_path_or_tag> [--dry-run]"
  echo "Examples:"
  echo "  $0 renderers/web_core"
  echo "  $0 javascript/web_core/v0.10.7"
  exit 1
fi

INPUT_ARG="$1"
DRY_RUN_FLAG="--no-dry-run"
if [ "$2" == "--dry-run" ] || [ "$3" == "--dry-run" ]; then
  DRY_RUN_FLAG="--dry-run"
fi

# Parse tag inputs like 'javascript/web_core/v0.10.7' or path inputs like 'renderers/web_core'
if [[ "$INPUT_ARG" == "javascript/"* ]]; then
  # Format: javascript/web_core/v0.10.7 -> web_core
  PKG_NAME=$(echo "$INPUT_ARG" | sed -E 's|javascript/([^/]+)/v.*|\1|')
else
  PKG_NAME=$(basename "$INPUT_ARG" | sed 's/^@a2ui\///')
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
WORKSPACE_ROOT="${SCRIPT_DIR}/.."

cd "$WORKSPACE_ROOT"

echo "=== Stage 1: Publishing $PKG_NAME to Artifact Registry staging ==="
./renderers/scripts/publish_npm.mjs -p "$PKG_NAME" "$DRY_RUN_FLAG"

echo "=== Stage 2: Uploading release manifest for $PKG_NAME ==="
./renderers/scripts/upload_manifest.mjs -p "$PKG_NAME" "$DRY_RUN_FLAG"

echo "--- Release script finished for $PKG_NAME ---"
