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

# Runs flutter, and for `flutter run` on a web device, gives the app the
# triager's GitHub token as GITHUB_TOKEN, so that the triage UI on the web
# starts signed in. The token is GITHUB_TOKEN or GH_TOKEN, or else the one that
# `gh auth token` prints. Without one, flutter runs as is, and the app shows
# the sign-in.
#
# The token goes in a file that only the user can read, passed with
# --dart-define-from-file, so that it is not in the arguments that other
# processes can see. It is not given to other commands, so that `flutter build
# web` cannot put it in the built app, nor to the macOS app, which reads the
# token itself.
#
# The `triage_ui` launch configuration in .vscode/launch.json runs this in place
# of flutter, with flutter's arguments, such as `run --machine -d chrome ...`.

set -euo pipefail

if ! command -v flutter >/dev/null; then
  echo "Cannot find flutter. Add Flutter's bin folder to the PATH." >&2
  exit 1
fi

# The command, after any global options, its position, and the device.
command=""
command_index=-1
device=""
expect_device=false
args=("$@")
for i in "${!args[@]}"; do
  arg="${args[$i]}"
  if $expect_device; then
    device="$arg"
    expect_device=false
    continue
  fi
  case "$arg" in
    -d | --device-id) expect_device=true ;;
    --device-id=*) device="${arg#--device-id=}" ;;
    -d?*) device="${arg#-d}" ;;
    -*) ;;
    *)
      if [[ -z "$command" ]]; then
        command="$arg"
        command_index=$i
      fi
      ;;
  esac
done

case "$device" in
  chrome | edge | web-server) web=true ;;
  *) web=false ;;
esac
if [[ "$command" != run || "$web" != true ]]; then
  exec flutter "$@"
fi

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
if [[ -z "$token" ]]; then
  exec flutter "$@"
fi

tmp="${TMPDIR:-/tmp}"
defines="$(mktemp "${tmp%/}/triage_ui_defines.XXXXXX")"
chmod 600 "$defines"
token="${token//\\/\\\\}"
token="${token//\"/\\\"}"
printf '{"GITHUB_TOKEN": "%s"}\n' "$token" >"$defines"

# flutter replaces this shell, keeping its process ID, so that VS Code's
# signals and input reach it. A background job deletes the file once that
# process ends.
(
  while kill -0 "$$" 2>/dev/null; do sleep 5; done
  rm -f "$defines"
) </dev/null >/dev/null 2>&1 &

# The option goes right after the command, before the app's arguments.
exec flutter "${args[@]:0:command_index+1}" \
  "--dart-define-from-file=$defines" "${args[@]:command_index+1}"
