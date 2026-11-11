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

# Opens a GitHub item in the triage UI, so that the triager can adjust and
# apply its triage suggestion.
#
# If the triage UI is running, sends the item to it. Otherwise starts the app on
# macOS with the item. See
# tools/internal/triage_new/blueprints/features/advisor.blueprint.md.
#
# Usage: tools/internal/triage_new/triage_ui.sh <item URL>
# Example: tools/internal/triage_new/triage_ui.sh https://github.com/a2ui-project/a2ui/issues/123

set -euo pipefail

# The port the triage UI listens on, on 127.0.0.1 only.
readonly port=47123
readonly item_pattern='^https://github\.com/a2ui-project/a2ui/(issues|pull)/[0-9]+$'

if [[ $# -ne 1 || ! "$1" =~ $item_pattern ]]; then
  echo "Usage: $0 <item URL>" >&2
  echo "The URL must look like https://github.com/a2ui-project/a2ui/issues/123" >&2
  echo "or https://github.com/a2ui-project/a2ui/pull/123." >&2
  exit 2
fi
readonly item="$1"

# curl exits with 7 when nothing listens on the port, which means the app is
# not running. Any other failure means the app is running but did not accept
# the item, and starting a second app would not help.
status=0
error=$(curl --silent --show-error --fail --max-time 5 \
  --data-urlencode "item=$item" "http://127.0.0.1:$port/open" 2>&1 >/dev/null) ||
  status=$?

case $status in
  0)
    echo "Sent $item to the running triage UI."
    ;;
  7)
    echo "The triage UI is not running. Starting it with $item."
    cd "$(dirname "$0")/pkgs/triage_ui"
    exec flutter run -d macos --dart-entrypoint-args "$item"
    ;;
  *)
    echo "The running triage UI did not accept $item: $error" >&2
    exit 1
    ;;
esac
