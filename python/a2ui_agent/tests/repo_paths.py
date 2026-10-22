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

"""Test-only helper that locates the repository checkout the tests run from."""

from __future__ import annotations

import os


def find_repo_root(start_path: str | None = None) -> str | None:
    """Returns the repository root, the first ancestor with a `specification` directory.

    Args:
        start_path: The directory to search upwards from. Defaults to the
            directory of this file.

    Returns:
        The absolute path of the repository root, or None if there is none.
    """
    current = os.path.abspath(start_path or os.path.dirname(__file__))
    while True:
        if os.path.isdir(os.path.join(current, "specification")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent
