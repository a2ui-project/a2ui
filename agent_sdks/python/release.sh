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
  echo "  $0 agent_sdks/python/a2ui_core"
  echo "  $0 python/a2ui_core/v0.1.1"
  exit 1
fi

INPUT_ARG="$1"
DRY_RUN=false
if [ "$2" == "--dry-run" ] || [ "$3" == "--dry-run" ]; then
  DRY_RUN=true
fi

# Parse tag inputs like 'python/a2ui_core/v0.1.1' or path inputs like 'agent_sdks/python/a2ui_core'
if [[ "$INPUT_ARG" == "python/"* ]]; then
  PKG_NAME=$(echo "$INPUT_ARG" | sed -E 's|python/([^/]+)/v.*|\1|')
else
  PKG_NAME=$(basename "$INPUT_ARG")
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
TARGET_DIR="${SCRIPT_DIR}/${PKG_NAME}"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: Directory '$TARGET_DIR' does not exist."
  exit 1
fi

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
uv build --out-dir dist

echo "--- Uploading the package ---"
uv run twine --version
uv run twine check dist/*

if [ "$DRY_RUN" = true ]; then
  echo "⚠️ DRY-RUN ENABLED: Skipping PyPI twine upload and Exit Gate manifest upload."
  echo "--- Dry Run finished for $PACKAGE_NAME ($VERSION) ---"
  exit 0
fi

# Check Google Cloud CLI authentication
if ! gcloud auth print-access-token > /dev/null 2>&1; then
  echo "❌ ERROR: Google Cloud CLI authentication token is missing or expired."
  echo "   To fix, run: gcloud auth login --update-adc"
  exit 1
fi

# Check if the version already exists in the staging repository
if gcloud artifacts versions describe "$VERSION" --package="$PACKAGE_NAME" --repository="$REPOSITORY" --location="$LOCATION" --project="$PROJECT" > /dev/null 2>&1; then
  echo "Version $VERSION of $PACKAGE_NAME already exists in Artifact Registry. Skip the release."
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
