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

"""A2UI over MCP (Model Context Protocol) Apps extension helpers."""

from a2ui.mcp.constants import (
    A2UI_MIME_TYPE,
    EXTENSION_URI,
    MCP_APPS_MIME_TYPE,
    MCP_UI_EXTENSION_KEY,
)
from a2ui.mcp.negotiation import supports_native_a2ui
from a2ui.mcp.responses import (
    create_a2ui_resource_contents,
    create_a2ui_tool_result,
)

__all__ = [
    "A2UI_MIME_TYPE",
    "EXTENSION_URI",
    "MCP_APPS_MIME_TYPE",
    "MCP_UI_EXTENSION_KEY",
    "supports_native_a2ui",
    "create_a2ui_resource_contents",
    "create_a2ui_tool_result",
]
