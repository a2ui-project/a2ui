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

# Runs flutter with the triager's GitHub token in --dart-define=GITHUB_TOKEN,
# so that the triage UI on the web starts signed in. The token is GITHUB_TOKEN
# or GH_TOKEN, or else the one that `gh auth token` prints. Without one, flutter
# runs as is, and the app shows the sign-in.
#
# The `triage_ui` launch configuration in .vscode/launch.json runs this in place
# of flutter, with flutter's arguments, such as `run --machine -d chrome ...`.

set -euo pipefail

token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [[ -z "$token" ]]; then
  # VS Code started from the Dock may not have gh on the PATH.
  for gh in gh /opt/homebrew/bin/gh /usr/local/bin/gh; do
    if token=$("$gh" auth token 2>/dev/null) && [[ -n "$token" ]]; then
      break
    fi
    token=""
  done
fi

# The define goes right after the command, `run`, before the app's arguments.
if [[ -n "$token" && $# -gt 0 ]]; then
  set -- "$1" "--dart-define=GITHUB_TOKEN=$token" "${@:2}"
fi

if ! command -v flutter >/dev/null; then
  echo "Cannot find flutter. Add Flutter's bin folder to the PATH." >&2
  exit 1
fi
exec flutter "$@"
