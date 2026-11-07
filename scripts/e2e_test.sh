#!/bin/bash
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

# About this script:
#
# This script runs all the tests that use non-stubbed AI models and thus require API key.
# It is invoked by GitHub Actions. But, it cannot be invoked by GitHub for fork branches.
#
# If your PR is from forked branch, please, run this script locally before merging.
# If the script fails both locally and
# [on the main branch](https://github.com/a2ui-project/a2ui/actions/workflows/e2e_test.yml?query=event%3Aschedule),
# file an issue and link in your PR.
#
# To run script locally, you need to set API key as an environment variable.
# Example: export GEMINI_API_KEY=your_api_key
#
# The tests record the model's replies under $A2UI_E2E_RECORD_DIR, and the
# script then compares what each recording renders with the golden scenario
# of the same name under conformance/e2e, writing the differences to
# $A2UI_E2E_RECORD_DIR/drift.md.
#
# Exit codes:
#   0  every test passed and every recording renders what its golden does
#   3  every test passed, but a recording renders something else
#   1  a test failed for another reason, or a recording could not be compared

# No exit on failure, because we want all tests to run
# regardless of previous test failures.
# set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Without `set -e`, the script would exit with the status of its last command,
# so a failure in an earlier test suite would be lost: the workflow would pass
# and no issue would be filed. STATUS records any failure, and the script exits
# with it at the end.
STATUS=0

# The model every live test asks. The workflow pins it; the code defaults to
# the same model for local runs.
export A2UI_E2E_MODEL="${A2UI_E2E_MODEL:-gemini-3.6-flash}"
# The Python restaurant agent reads its model from MODEL_NAME.
export MODEL_NAME="$A2UI_E2E_MODEL"

# Where the tests write their recordings. The v0.9 tests write under
# v0_9_1/, as the goldens are laid out under conformance/e2e.
export A2UI_E2E_RECORD_DIR="${A2UI_E2E_RECORD_DIR:-$REPO_ROOT/e2e-recordings}"
mkdir -p "$A2UI_E2E_RECORD_DIR"

DART_DEFINES=(
  --dart-define=GEMINI_API_KEY="$GEMINI_API_KEY"
  --dart-define=A2UI_E2E_MODEL="$A2UI_E2E_MODEL"
)

# A failed `cd` stops the script, because the tests would run in the wrong
# directory.
cd "$REPO_ROOT/samples/client/flutter/restaurant_finder/e2e_test" || exit 1
# Parallel tests are disabled to avoid conflicts on environment.
flutter test --concurrency=1 "${DART_DEFINES[@]}" \
  --dart-define=A2UI_E2E_RECORD_DIR="$A2UI_E2E_RECORD_DIR" || STATUS=1

cd "$REPO_ROOT/dart/a2ui_agent/e2e_test" || exit 1
dart test || STATUS=1

cd "$REPO_ROOT/dart/a2ui_flutter/e2e_test" || exit 1
flutter test "${DART_DEFINES[@]}" \
  --dart-define=A2UI_E2E_RECORD_DIR="$A2UI_E2E_RECORD_DIR" || STATUS=1

cd "$REPO_ROOT/dart/a2ui_flutter/e2e_test_v0_9" || exit 1
flutter test "${DART_DEFINES[@]}" \
  --dart-define=A2UI_E2E_RECORD_DIR="$A2UI_E2E_RECORD_DIR/v0_9_1" || STATUS=1

# Compares each recording with its golden. DRIFT records a recording whose
# outcome differs; a recording that cannot be imported or compared is a
# failure like any other.
DRIFT=0
DRIFT_REPORT="$A2UI_E2E_RECORD_DIR/drift.md"
{
  echo "# E2E outcome drift"
  echo
  echo "Model: \`$A2UI_E2E_MODEL\`"
  echo
} > "$DRIFT_REPORT"

cd "$REPO_ROOT" || exit 1
while IFS= read -r -d '' recording; do
  relative="${recording#"$A2UI_E2E_RECORD_DIR"/}"
  scenario="${relative%.json}"
  scenario="${scenario%.wire}"
  golden="$REPO_ROOT/conformance/e2e/$scenario.yaml"
  if [ ! -f "$golden" ]; then
    echo "## \`$relative\`: no golden at conformance/e2e/$scenario.yaml" >> "$DRIFT_REPORT"
    echo >> "$DRIFT_REPORT"
    continue
  fi
  name="$(uv run python -c \
    'import sys, yaml; print(yaml.safe_load(open(sys.argv[1]))[0]["name"])' \
    "$golden")" || { STATUS=1; continue; }
  imported="${recording%.json}.scenario.yaml"
  report="${recording%.json}.report.md"
  if ! uv run python conformance/scripts/import_recording.py \
      --input "$recording" --output "$imported" --name "$name"; then
    echo "## \`$relative\`: could not be imported" >> "$DRIFT_REPORT"
    echo >> "$DRIFT_REPORT"
    STATUS=1
    continue
  fi
  uv run python conformance/scripts/compare_e2e_outcome.py \
    --golden "$golden" --recorded "$imported" --report "$report"
  case $? in
    0) echo "## \`$relative\`: same outcome as \`$name\`" >> "$DRIFT_REPORT" ;;
    1)
      DRIFT=1
      echo "## \`$relative\`: outcome differs from \`$name\`" >> "$DRIFT_REPORT"
      echo >> "$DRIFT_REPORT"
      cat "$report" >> "$DRIFT_REPORT"
      ;;
    *)
      STATUS=1
      echo "## \`$relative\`: could not be compared with \`$name\`" >> "$DRIFT_REPORT"
      ;;
  esac
  echo >> "$DRIFT_REPORT"
done < <(find "$A2UI_E2E_RECORD_DIR" -name '*.json' -print0 | sort -z)

cat "$DRIFT_REPORT"

if [ "$STATUS" -ne 0 ]; then
  exit 1
fi
if [ "$DRIFT" -ne 0 ]; then
  exit 3
fi
exit 0
