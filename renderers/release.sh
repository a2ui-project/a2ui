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
  echo "Usage: $0 <package_path_or_name>"
  echo "Examples:"
  echo "  $0 renderers/web_core"
  echo "  $0 renderers/lit"
  exit 1
fi

# Extract package directory basename (e.g. renderers/web_core -> web_core, @a2ui/web_core -> web_core)
PKG_INPUT="$1"
PKG_NAME=$(basename "$PKG_INPUT" | sed 's/^@a2ui\///')

# Ensure we are in a clean git repository
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: This script must be run inside a git repository."
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "Error: There are uncommitted changes in the repository. Please commit or stash them before releasing."
  exit 1
fi

# Determine the remote name (prefer 'upstream' if it exists, fallback to 'origin')
REMOTE_NAME="origin"
if git remote | grep -q "^upstream$"; then
  REMOTE_NAME="upstream"
fi

MAIN_BRANCH="main"

echo "Checking synchronization with ${REMOTE_NAME}/${MAIN_BRANCH}..."
if ! git fetch "${REMOTE_NAME}" "${MAIN_BRANCH}" --quiet 2>/dev/null; then
  echo "Error: Failed to fetch from remote '${REMOTE_NAME}'."
  exit 1
fi

if ! REMOTE_COMMIT=$(git rev-parse "${REMOTE_NAME}/${MAIN_BRANCH}" 2>/dev/null); then
  echo "Error: Cannot find remote branch ${REMOTE_NAME}/${MAIN_BRANCH}."
  exit 1
fi

LOCAL_COMMIT=$(git rev-parse HEAD)
if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
  echo "Error: Local HEAD is not in sync with ${REMOTE_NAME}/${MAIN_BRANCH}. Please push or merge your changes upstream first."
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
WORKSPACE_ROOT="${SCRIPT_DIR}/.."

cd "$WORKSPACE_ROOT"

echo "=== Stage 1: Publishing $PKG_NAME to Artifact Registry staging ==="
./renderers/scripts/publish_npm.mjs -p "$PKG_NAME" --no-dry-run

echo "=== Stage 2: Uploading release manifest for $PKG_NAME ==="
./renderers/scripts/upload_manifest.mjs -p "$PKG_NAME" --no-dry-run

echo "--- Release script finished for $PKG_NAME ---"
