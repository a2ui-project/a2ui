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

"""Unit tests for the Dual-Mode MCP Server sample."""

import json
import pathlib
import sys
import pytest
import mcp.types as types

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from a2ui.mcp import A2UI_MIME_TYPE, MCP_APPS_MIME_TYPE
from server import create_server, get_counter_a2ui


@pytest.mark.anyio
async def test_server_resources():
    server = create_server()
    resources = await server.list_resources()
    assert len(resources) == 2

    # Check reading fallback app resource
    fallback_res = await server.read_resource("ui://counter/app")
    assert len(fallback_res) == 1
    assert fallback_res[0].mime_type == MCP_APPS_MIME_TYPE
    assert "MCP App Fallback Counter View" in fallback_res[0].content

    # Check reading native a2ui resource
    native_res = await server.read_resource("a2ui://counter")
    assert len(native_res) == 1
    assert native_res[0].mime_type == A2UI_MIME_TYPE
    parsed = json.loads(native_res[0].content)
    assert parsed[0]["version"] == "v1.0"
    assert parsed[0]["createSurface"]["surfaceId"] == "counter-surface"


@pytest.mark.anyio
async def test_server_tools_lifecycle():
    server = create_server()
    tools = await server.list_tools()
    tool_names = [t.name for t in tools]
    assert "get_counter_app" in tool_names
    assert "increment_counter" in tool_names
    assert "decrement_counter" in tool_names
    assert "reset_counter" in tool_names

    # 1. Reset
    reset_res = await server.call_tool("reset_counter", {})
    assert isinstance(reset_res, types.CallToolResult)
    embedded = [c for c in reset_res.content if c.type == "resource"][0]
    payload = json.loads(embedded.resource.text)
    assert payload[0]["updateDataModel"]["value"] == 0

    # 2. Get initial counter app
    init_res = await server.call_tool("get_counter_app", {"native": True})
    assert isinstance(init_res, types.CallToolResult)
    embedded = [c for c in init_res.content if c.type == "resource"][0]
    payload = json.loads(embedded.resource.text)
    assert payload[0]["createSurface"]["dataModel"]["count"] == 0

    # 3. Increment
    inc_res = await server.call_tool("increment_counter", {"step": 3})
    embedded = [c for c in inc_res.content if c.type == "resource"][0]
    payload = json.loads(embedded.resource.text)
    assert payload[0]["updateDataModel"]["value"] == 3

    # 4. Decrement
    dec_res = await server.call_tool("decrement_counter", {"step": 1})
    embedded = [c for c in dec_res.content if c.type == "resource"][0]
    payload = json.loads(embedded.resource.text)
    assert payload[0]["updateDataModel"]["value"] == 2
