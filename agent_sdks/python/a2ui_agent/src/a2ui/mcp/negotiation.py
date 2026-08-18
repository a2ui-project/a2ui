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

"""Negotiation helpers for A2UI over MCP Apps."""

from typing import Any
from a2ui.mcp.constants import A2UI_MIME_TYPE, MCP_UI_EXTENSION_KEY


def supports_native_a2ui(client_capabilities: Any) -> bool:
    """Determines whether an MCP client advertises native A2UI support.

    Inspects client capabilities or initialize parameters for the
    'io.modelcontextprotocol/ui' extension advertising 'application/a2ui+json'
    in its mimeTypes list.

    Args:
        client_capabilities: A dictionary, types.ClientCapabilities, or
            InitializeParams object representing client capabilities.

    Returns:
        True if the client explicitly supports application/a2ui+json, False otherwise.
    """
    if client_capabilities is None:
        return False

    # Extract dictionary representation if pydantic / custom model
    caps: dict[str, Any] = {}
    if isinstance(client_capabilities, dict):
        caps = client_capabilities
    elif hasattr(client_capabilities, "model_dump"):
        try:
            caps = client_capabilities.model_dump(by_alias=True)
        except Exception:
            caps = {}
    elif hasattr(client_capabilities, "dict"):
        try:
            caps = client_capabilities.dict()
        except Exception:
            caps = {}
    elif hasattr(client_capabilities, "__dict__"):
        caps = client_capabilities.__dict__

    # If wrapped under 'capabilities' (e.g. InitializeParams)
    if "capabilities" in caps and isinstance(caps["capabilities"], dict):
        caps = caps["capabilities"]

    # Extract extensions
    extensions = caps.get("extensions")
    if extensions is None and hasattr(client_capabilities, "extensions"):
        extensions = getattr(client_capabilities, "extensions")

    if not isinstance(extensions, dict):
        return False

    ui_ext = extensions.get(MCP_UI_EXTENSION_KEY)
    if ui_ext is None:
        return False

    if isinstance(ui_ext, dict):
        mime_types = ui_ext.get("mimeTypes") or ui_ext.get("mime_types")
    elif hasattr(ui_ext, "mimeTypes"):
        mime_types = getattr(ui_ext, "mimeTypes")
    elif hasattr(ui_ext, "mime_types"):
        mime_types = getattr(ui_ext, "mime_types")
    else:
        mime_types = None

    if isinstance(mime_types, (list, tuple, set)):
        return A2UI_MIME_TYPE in mime_types

    return False
