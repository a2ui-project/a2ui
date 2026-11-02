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

"""Protocol-versioned wire helpers shared by the decision format modules.

These are pure functions with no dependency on the synthesizer, so the
pattern expander and layout planner can emit wire forms without importing it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def is_v10(protocol_version: str) -> bool:
    """Returns whether `protocol_version` targets A2UI v1.0 or later."""
    clean = protocol_version.lstrip("v")
    return clean == "1" or clean.startswith("1.")


def make_data_binding(path: str, *, is_v10: bool) -> dict[str, Any]:
    """Creates a protocol-versioned A2UI DataBinding dictionary."""
    return {"@path": path} if is_v10 else {"path": path}


def make_function_call(
    name: str, args: Mapping[str, Any], *, is_v10: bool
) -> dict[str, Any]:
    """Creates a protocol-versioned A2UI catalog function call dictionary."""
    call_key = "@call" if is_v10 else "call"
    return {call_key: name, "args": dict(args)}
