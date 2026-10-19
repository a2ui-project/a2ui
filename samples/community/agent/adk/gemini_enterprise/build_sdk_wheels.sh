#!/bin/bash
# Copyright 2026 Google LLC
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

# Builds wheels of the A2UI Python SDKs in this repository (a2ui-core,
# a2ui-agent-sdk and a2ui-a2a) into <PROJECT_DIR>/wheels.
#
# The Gemini Enterprise samples need SDK releases that aren't on PyPI yet.
# Locally they run on the SDK sources through the path entries in
# `[tool.uv.sources]`, which point outside the sample directory. A deployment
# only uploads the sample directory, so the deploy scripts ship these wheels
# instead.
#
# With --use-wheels, the script also points the a2ui entries in
# <PROJECT_DIR>/pyproject.toml's `[tool.uv.sources]` at the wheels and runs
# `uv lock` in <PROJECT_DIR>. It edits those files in place, so only run it on
# a copy of a sample, as deploy.sh does.
#
# The wheel versions come from the repository's git tags, so run this from a
# clone that has them.

set -euo pipefail

usage() {
    echo "Usage: $0 <PROJECT_DIR> [--use-wheels]"
    exit 1
}

[[ "$#" -ge 1 && "$#" -le 2 ]] || usage
USE_WHEELS=false
if [[ "$#" -eq 2 ]]; then
    [[ "$2" == "--use-wheels" ]] || usage
    USE_WHEELS=true
fi

PROJECT_DIR=$(cd "$1" && pwd)
WHEEL_DIR="$PROJECT_DIR/wheels"
REPO_ROOT=$(cd "$(dirname "$0")/../../../../.." && pwd)
PACKAGES=(a2ui-core a2ui-agent-sdk a2ui-a2a)

mkdir -p "$WHEEL_DIR"
rm -f "$WHEEL_DIR"/a2ui_*.whl
for package in "${PACKAGES[@]}"; do
    (cd "$REPO_ROOT" && uv build --quiet --package "$package" --wheel --out-dir "$WHEEL_DIR")
done
echo "Built SDK wheels in $WHEEL_DIR:"
ls -1 "$WHEEL_DIR"

if [[ "$USE_WHEELS" == true ]]; then
    PYPROJECT="$PROJECT_DIR/pyproject.toml"
    for package in "${PACKAGES[@]}"; do
        wheel=$(cd "$WHEEL_DIR" && ls ${package//-/_}-*.whl)
        sed -i -E "s|^${package} = \{ path = .*$|${package} = { path = \"wheels/${wheel}\" }|" "$PYPROJECT"
        if ! grep -q "^${package} = { path = \"wheels/${wheel}\" }$" "$PYPROJECT"; then
            echo "$PYPROJECT has no [tool.uv.sources] path entry for $package." >&2
            exit 1
        fi
    done
    (cd "$PROJECT_DIR" && uv lock --quiet)
    echo "Pointed $PYPROJECT at the wheels and updated its uv.lock."
fi
