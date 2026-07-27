#!/bin/bash
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -e # Exit on error

# Check arguments
if [ -z "$1" ]; then
  echo "Usage: $0 <a2ui_agent|a2ui_core>"
  exit 1
fi

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
TARGET_DIR="${SCRIPT_DIR}/${1}"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: Directory '$TARGET_DIR' does not exist."
  exit 1
fi

# Read package name from pyproject.toml
if [ ! -f "${TARGET_DIR}/pyproject.toml" ]; then
  echo "Error: pyproject.toml not found in '$TARGET_DIR'."
  exit 1
fi

WORKSPACE_ROOT="${SCRIPT_DIR}/../.."
PACKAGE_NAME=$(python3 -c "import tomllib; print(tomllib.load(open('${TARGET_DIR}/pyproject.toml', 'rb'))['project']['name'])")

echo "--- Syncing release tools at workspace root ---"
uv sync --group release --directory "$WORKSPACE_ROOT"

cd "$TARGET_DIR"
VERSION=$(uv run hatch version)

echo "Releasing package: $PACKAGE_NAME ($VERSION) from folder: $TARGET_DIR"

REPOSITORY="a2ui--pypi"
PROJECT="oss-exit-gate-prod"
LOCATION="us"
REPOSITORY_URL="https://us-python.pkg.dev/${PROJECT}/${REPOSITORY}"
GCS_URI="gs://oss-exit-gate-prod-projects-bucket/a2ui/pypi/manifests"


echo "--- Building the package ---"
rm -rf dist
# In a uv workspace, the default build output goes to the workspace root, but we want to scope it to the package directory.
uv build --out-dir dist

echo "--- Uploading the package ---"
uv run twine --version
uv run twine check dist/*

# Authenticate with Google Cloud
if ! gcloud auth application-default print-access-token --quiet > /dev/null; then
  gcloud auth application-default login
fi

# Check if the version already exists in the staging repository
if gcloud artifacts versions describe "$VERSION" --package="$PACKAGE_NAME" --repository="$REPOSITORY" --location="$LOCATION" --project="$PROJECT" > /dev/null 2>&1; then
  echo "Version $VERSION of $PACKAGE_NAME already exists in Artifact Registry. Skip the release."
  echo "Hint: If you intended to release a new version, please update its version in pyproject.toml or version.py."
  exit 0
fi

uv run twine upload --repository-url "$REPOSITORY_URL" dist/*
echo "Version $VERSION of $PACKAGE_NAME uploaded to Artifact Registry."

echo "--- Creating manifest.json ---"
MANIFEST_FILE="manifest.json"
echo '{ "publish_all": true }' > $MANIFEST_FILE

echo "--- Uploading manifest to GCS to trigger OSS Exit Gate ---"
MANIFEST_NAME="manifest-${VERSION}-$(date +%Y%m%d%H%M%S).json"
gcloud storage cp $MANIFEST_FILE "${GCS_URI}/${MANIFEST_NAME}"
rm -rf $MANIFEST_FILE

echo "Manifest ${MANIFEST_NAME} uploaded."
echo "--- Build script finished ---"
