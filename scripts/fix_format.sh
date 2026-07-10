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

YARN_CMD=(yarn)
if command -v corepack >/dev/null 2>&1; then
  YARN_CMD=(corepack yarn)
fi

echo "Running Prettier formatting for Node/Web assets..."
if [ -f ".yarn/install-state.gz" ]; then
  # Local Node environment already installed; invoke standard script targets
  if [ "$CHECK_ONLY" = true ]; then
    "${YARN_CMD[@]}" format:check:all
  else
    "${YARN_CMD[@]}" format:all
  fi
else
  # Non-Node contributor or CI; run standalone Prettier via dlx without full monorepo install
  if [ "$CHECK_ONLY" = true ]; then
    "${YARN_CMD[@]}" dlx prettier@3.8.4 --config .prettierrc --check .
  else
    "${YARN_CMD[@]}" dlx prettier@3.8.4 --config .prettierrc --write .
  fi
fi

echo "Running Pyink for Python files..."
if [ "$CHECK_ONLY" = true ]; then
  uv run pyink --check .
else
  uv run pyink .
fi

echo "Running Dart format..."
cd "$REPO_ROOT"
# Check if dart is available before running
if command -v dart >/dev/null 2>&1; then

  # Run "dart pub get" silently, to resolve Dart dependencies. This will resolve
  # the analysis_options.yaml includes if the person running this script hasn't
  # run dart or flutter "pub get" yet.
  #
  # Running "dart pub get" is not a NECESSARY thing for the formatting to work
  # (dart format is entirely AST-based), but if someone runs the formatting
  # script locally, then we don't want confusion about the warnings if they
  # haven't run "dart pub get" (which is equivalent to "flutter pub get" if the
  # dart executable is in a Flutter SDK directory).
  #
  # In CI, we want to be able to only install the lightweight Dart image, not
  # the much heavier Flutter image, which quadruples the time it takes to run
  # the formatting check. In that case, since the dart executable isn't part of
  # a Flutter SDK directory, "dart pub get" will give errors about the monorepo
  # depending on Flutter and not running "flutter pub get", so we want to
  # suppress that failure here so it doesn't cause the fix_format.sh script to
  # exit. The dart format run will still have warnings because pub get wasn't
  # run, but it won't affect the CI build outcome.
  if [ ! -f ".dart_tool/package_config.json" ]; then
    dart pub get >/dev/null 2>&1 || true
  fi

  if [ "$CHECK_ONLY" = true ]; then
    dart format --output=none --set-exit-if-changed samples/client/flutter renderers/flutter
  else
    dart format samples/client/flutter renderers/flutter
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
