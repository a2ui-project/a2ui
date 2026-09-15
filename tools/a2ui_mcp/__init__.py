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

"""A2UI FastMCP perception-action loop server package."""

from .server import (
    a2ui_list_components,
    a2ui_render,
    a2ui_simulate_action,
    a2ui_validate,
    mcp,
)

__all__ = [
    "mcp",
    "a2ui_list_components",
    "a2ui_validate",
    "a2ui_render",
    "a2ui_simulate_action",
]
