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

"""Response construction helpers for A2UI over MCP."""

import json
from typing import Any
import mcp.types as types
from a2ui.mcp.constants import A2UI_MIME_TYPE


def _normalize_json_payload(payload: list[dict[str, Any]] | dict[str, Any] | str) -> str:
    """Serializes dictionaries or lists into JSON strings if needed."""
    if isinstance(payload, str):
        return payload
    return json.dumps(payload)


def create_a2ui_tool_result(
    a2ui_messages: list[dict[str, Any]] | dict[str, Any] | str,
    text_fallback: str = "",
    resource_uri: str = "a2ui://tool-result",
) -> types.CallToolResult:
    """Wraps an A2UI payload into an MCP CallToolResult with an EmbeddedResource.

    Args:
        a2ui_messages: A list of A2UI message dicts, a single message dict,
            or a JSON-formatted string.
        text_fallback: An optional human-readable text fallback for non-UI clients.
        resource_uri: The URI to identify the embedded A2UI resource.

    Returns:
        A types.CallToolResult containing the EmbeddedResource.
    """
    json_text = _normalize_json_payload(a2ui_messages)
    contents: list[types.Content] = []

    if text_fallback:
        contents.append(types.TextContent(type="text", text=text_fallback))

    contents.append(
        types.EmbeddedResource(
            type="resource",
            resource=types.TextResourceContents(
                uri=resource_uri,
                mimeType=A2UI_MIME_TYPE,
                text=json_text,
            ),
        )
    )

    return types.CallToolResult(content=contents)


def create_a2ui_resource_contents(
    a2ui_messages: list[dict[str, Any]] | dict[str, Any] | str,
    uri: str = "a2ui://resource",
) -> types.TextResourceContents:
    """Creates an MCP TextResourceContents payload with application/a2ui+json.

    Args:
        a2ui_messages: A list of A2UI message dicts, a single message dict,
            or a JSON-formatted string.
        uri: The resource URI.

    Returns:
        A types.TextResourceContents with the A2UI MIME type.
    """
    json_text = _normalize_json_payload(a2ui_messages)
    return types.TextResourceContents(
        uri=uri,
        mimeType=A2UI_MIME_TYPE,
        text=json_text,
    )
