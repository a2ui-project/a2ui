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
#set -x # Echo commands

PACKAGE_NAME="a2ui-agent-sdk"
REPOSITORY="a2ui--pypi"
PROJECT="oss-exit-gate-prod"
LOCATION="us"
REPOSITORY_URL="https://us-python.pkg.dev/${PROJECT}/${REPOSITORY}"
GCS_URI="gs://oss-exit-gate-prod-projects-bucket/a2ui/pypi/manifests"

echo "--- Installing helper packages ---"
uv tool install twine --with keyrings.google-artifactregistry-auth --with keyring
uv tool install keyring --with keyrings.google-artifactregistry-auth

echo "--- Building the package ---"
rm -rf dist
uv build

echo "--- Uploading the package ---"
twine --version
twine check dist/*

version=$(uv run python -c "import a2ui; print(a2ui.__version__)")

# Authenticate with Google Cloud
if ! gcloud auth application-default print-access-token --quiet > /dev/null; then
  gcloud auth application-default login
fi

# Check if the version already exists in the staging repository
if gcloud artifacts versions describe "$version" --package=$PACKAGE_NAME --repository=$REPOSITORY --location=$LOCATION --project=$PROJECT > /dev/null 2>&1; then
  echo "Version $version already exists in Artifact Registry. Skip the release."
  echo "Hint: If you intended to release a new version, please update 'src/a2ui/version.py'."
  exit 0
fi

twine upload --repository-url $REPOSITORY_URL dist/*
echo "Version $version uploaded to Artifact Registry."

echo "--- Creating manifest.json ---"
MANIFEST_FILE="manifest.json"
echo '{ "publish_all": true }' > $MANIFEST_FILE

echo "--- Uploading manifest to GCS to trigger OSS Exit Gate ---"
MANIFEST_NAME="manifest-${version}-$(date +%Y%m%d%H%M%S).json"
gcloud storage cp $MANIFEST_FILE "${GCS_URI}/${MANIFEST_NAME}"
rm -rf $MANIFEST_FILE

echo "Manifest ${MANIFEST_NAME} uploaded."
echo "--- Build script finished ---"
