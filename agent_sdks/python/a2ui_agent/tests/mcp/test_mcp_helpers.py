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

"""Tests for a2ui.mcp helpers."""

import json
from dataclasses import dataclass
import mcp.types as types
from a2ui.mcp import (
    A2UI_MIME_TYPE,
    MCP_APPS_MIME_TYPE,
    MCP_UI_EXTENSION_KEY,
    create_a2ui_resource_contents,
    create_a2ui_tool_result,
    supports_native_a2ui,
)


class TestMcpNegotiation:
    """Tests for supports_native_a2ui negotiation helper."""

    def test_supports_native_a2ui_with_valid_dict(self):
        caps = {
            "extensions": {
                MCP_UI_EXTENSION_KEY: {
                    "mimeTypes": [
                        MCP_APPS_MIME_TYPE,
                        A2UI_MIME_TYPE,
                    ]
                }
            }
        }
        assert supports_native_a2ui(caps) is True

    def test_supports_native_a2ui_with_only_a2ui(self):
        caps = {
            "extensions": {
                MCP_UI_EXTENSION_KEY: {
                    "mimeTypes": [A2UI_MIME_TYPE]
                }
            }
        }
        assert supports_native_a2ui(caps) is True

    def test_supports_native_a2ui_with_only_html_fallback(self):
        caps = {
            "extensions": {
                MCP_UI_EXTENSION_KEY: {
                    "mimeTypes": [MCP_APPS_MIME_TYPE]
                }
            }
        }
        assert supports_native_a2ui(caps) is False

    def test_supports_native_a2ui_nested_in_capabilities_dict(self):
        params = {
            "capabilities": {
                "extensions": {
                    MCP_UI_EXTENSION_KEY: {
                        "mimeTypes": [A2UI_MIME_TYPE]
                    }
                }
            }
        }
        assert supports_native_a2ui(params) is True

    def test_supports_native_a2ui_with_object_properties(self):
        @dataclass
        class MockUiExtension:
            mimeTypes: list[str]

        @dataclass
        class MockClientCapabilities:
            extensions: dict[str, MockUiExtension]

        caps = MockClientCapabilities(
            extensions={MCP_UI_EXTENSION_KEY: MockUiExtension(mimeTypes=[A2UI_MIME_TYPE])}
        )
        assert supports_native_a2ui(caps) is True

    def test_supports_native_a2ui_with_none_or_empty(self):
        assert supports_native_a2ui(None) is False
        assert supports_native_a2ui({}) is False
        assert supports_native_a2ui({"extensions": {}}) is False
        assert supports_native_a2ui({"extensions": {MCP_UI_EXTENSION_KEY: {}}}) is False


class TestMcpResponses:
    """Tests for create_a2ui_tool_result and create_a2ui_resource_contents."""

    def test_create_a2ui_tool_result_from_dict(self):
        sample_msg = {
            "version": "v1.0",
            "createSurface": {"surfaceId": "test-surface"},
        }
        result = create_a2ui_tool_result(sample_msg)
        assert isinstance(result, types.CallToolResult)
        assert len(result.content) == 1
        embedded = result.content[0]
        assert isinstance(embedded, types.EmbeddedResource)
        assert embedded.type == "resource"
        assert embedded.resource.mimeType == A2UI_MIME_TYPE
        assert str(embedded.resource.uri) == "a2ui://tool-result"
        assert json.loads(embedded.resource.text) == sample_msg

    def test_create_a2ui_tool_result_from_list_with_fallback(self):
        sample_messages = [
            {"version": "v1.0", "createSurface": {"surfaceId": "s1"}},
            {"version": "v1.0", "updateDataModel": {"surfaceId": "s1", "value": {"count": 1}}},
        ]
        result = create_a2ui_tool_result(
            sample_messages,
            text_fallback="Fallback description",
            resource_uri="a2ui://custom-uri",
        )
        assert isinstance(result, types.CallToolResult)
        assert len(result.content) == 2
        assert isinstance(result.content[0], types.TextContent)
        assert result.content[0].text == "Fallback description"

        embedded = result.content[1]
        assert isinstance(embedded, types.EmbeddedResource)
        assert str(embedded.resource.uri) == "a2ui://custom-uri"
        assert embedded.resource.mimeType == A2UI_MIME_TYPE
        assert json.loads(embedded.resource.text) == sample_messages

    def test_create_a2ui_tool_result_from_string(self):
        raw_json = '{"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}'
        result = create_a2ui_tool_result(raw_json)
        assert len(result.content) == 1
        embedded = result.content[0]
        assert isinstance(embedded, types.EmbeddedResource)
        assert embedded.resource.text == raw_json

    def test_create_a2ui_resource_contents(self):
        sample_msg = {"version": "v1.0", "createSurface": {"surfaceId": "res-surface"}}
        res = create_a2ui_resource_contents(sample_msg, uri="a2ui://my-resource")
        assert isinstance(res, types.TextResourceContents)
        assert str(res.uri) == "a2ui://my-resource"
        assert res.mimeType == A2UI_MIME_TYPE
        assert json.loads(res.text) == sample_msg
