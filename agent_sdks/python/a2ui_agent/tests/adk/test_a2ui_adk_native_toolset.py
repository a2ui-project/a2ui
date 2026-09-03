# Copyright 2026 Google LLC
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

import json
from unittest.mock import MagicMock, call

import pytest

from a2ui.adk.a2ui_adk_native_toolset import A2uiAdkNativeToolset
from a2ui.schema.catalog import A2uiCatalog
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools.tool_context import ToolContext
from google.adk.events.ui_widget import UiWidget

# region A2uiAdkNativeToolset Tests
"""Tests for the A2uiAdkNativeToolset class."""


@pytest.mark.asyncio
async def test_toolset_init_bool():
    catalog_mock = MagicMock(spec=A2uiCatalog)
    toolset = A2uiAdkNativeToolset(
        a2ui_enabled=True, a2ui_catalog=catalog_mock, a2ui_examples="examples"
    )
    ctx = MagicMock(spec=ReadonlyContext)
    assert await toolset._resolve_a2ui_enabled(ctx)

    # Access the tool to check schema resolution
    tool = toolset._ui_tools[0]
    assert await tool._resolve_a2ui_catalog(ctx) == catalog_mock


@pytest.mark.asyncio
async def test_toolset_init_callable():
    enabled_mock = MagicMock(return_value=True)
    catalog_mock = MagicMock(spec=A2uiCatalog)
    examples_mock = MagicMock(return_value="examples")
    toolset = A2uiAdkNativeToolset(
        a2ui_enabled=enabled_mock,
        a2ui_catalog=catalog_mock,
        a2ui_examples=examples_mock,
    )
    ctx = MagicMock(spec=ReadonlyContext)
    assert await toolset._resolve_a2ui_enabled(ctx)

    # Access the tool to check schema resolution
    tool = toolset._ui_tools[0]
    assert await tool._resolve_a2ui_catalog(ctx) == catalog_mock
    assert await tool._resolve_a2ui_examples(ctx) == "examples"
    enabled_mock.assert_called_once_with(ctx)
    catalog_mock.assert_not_called()
    examples_mock.assert_called_once_with(ctx)


@pytest.mark.asyncio
async def test_toolset_get_tools_enabled():
    toolset = A2uiAdkNativeToolset(
        a2ui_enabled=True, a2ui_catalog=MagicMock(spec=A2uiCatalog), a2ui_examples=""
    )
    tools = await toolset.get_tools(MagicMock(spec=ReadonlyContext))
    assert len(tools) == 1
    assert isinstance(tools[0], A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool)


@pytest.mark.asyncio
async def test_toolset_get_tools_disabled():
    toolset = A2uiAdkNativeToolset(
        a2ui_enabled=False,
        a2ui_catalog=MagicMock(spec=A2uiCatalog),
        a2ui_examples="",
    )
    tools = await toolset.get_tools(MagicMock(spec=ReadonlyContext))
    assert len(tools) == 0


# endregion

# region _SendA2uiJsonToAdkWidgetTool Tests
"""Tests for the _SendA2uiJsonToAdkWidgetTool class."""


def test_send_tool_init():
    catalog_mock = MagicMock(spec=A2uiCatalog)
    tool = A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool(
        catalog_mock, "examples", "a2ui"
    )
    assert tool.name == A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool.TOOL_NAME
    assert tool._a2ui_catalog == catalog_mock
    assert tool._a2ui_examples == "examples"
    assert tool._provider_name == "a2ui"


def test_send_tool_get_declaration():
    catalog_mock = MagicMock(spec=A2uiCatalog)
    tool = A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool(
        catalog_mock, "examples", "a2ui"
    )
    declaration = tool._get_declaration()
    assert declaration is not None
    assert (
        declaration.name
        == A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool.TOOL_NAME
    )
    assert (
        A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool.A2UI_JSON_ARG_NAME
        in declaration.parameters.properties
    )
    assert (
        A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool.A2UI_JSON_ARG_NAME
        in declaration.parameters.required
    )


@pytest.mark.asyncio
async def test_send_tool_resolve_catalog():
    catalog_mock = MagicMock(spec=A2uiCatalog)
    tool = A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool(
        catalog_mock, "examples", "a2ui"
    )
    catalog = await tool._resolve_a2ui_catalog(MagicMock(spec=ReadonlyContext))
    assert catalog == catalog_mock


@pytest.mark.asyncio
async def test_send_tool_run_async_valid_single():
    # Setup mock catalog, validator, and tool_context
    catalog_mock = MagicMock(spec=A2uiCatalog)
    catalog_mock.validator = MagicMock()
    tool = A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool(
        catalog_mock, "examples", "a2ui"
    )

    tc_mock = MagicMock(spec=ToolContext)
    tc_mock.run_id = "test-run-123"
    tc_mock.actions = MagicMock()

    # Valid single payload
    single_payload = {"id": "my-id", "type": "Button", "properties": {}}
    a2ui_json_str = json.dumps(single_payload)

    # Run tool
    result = await tool.run_async(
        args={tool.A2UI_JSON_ARG_NAME: a2ui_json_str}, tool_context=tc_mock
    )

    # Assertions
    catalog_mock.validator.validate.assert_called_once_with([single_payload])
    assert tc_mock.actions.skip_summarization is True

    # Assert that tool_context.render_ui_widget was called with the correct UiWidget
    assert tc_mock.render_ui_widget.call_count == 1
    rendered_widget = tc_mock.render_ui_widget.call_args[0][0]
    assert isinstance(rendered_widget, UiWidget)
    assert rendered_widget.id == "my-id"
    assert rendered_widget.provider == "a2ui"
    assert rendered_widget.payload == single_payload

    assert result == {tool.VALIDATED_A2UI_JSON_KEY: [single_payload]}


@pytest.mark.asyncio
async def test_send_tool_run_async_valid_list():
    # Setup mock catalog, validator, and tool_context
    catalog_mock = MagicMock(spec=A2uiCatalog)
    catalog_mock.validator = MagicMock()
    tool = A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool(
        catalog_mock, "examples", "a2ui-custom"
    )

    tc_mock = MagicMock(spec=ToolContext)
    tc_mock.run_id = "test-run-456"
    tc_mock.actions = MagicMock()

    # Valid list of payloads
    list_payload = [
        {"id": "id-1", "type": "Label"},
        {"id": "id-2", "type": "Input"},
    ]
    a2ui_json_str = json.dumps(list_payload)

    # Run tool
    result = await tool.run_async(
        args={tool.A2UI_JSON_ARG_NAME: a2ui_json_str}, tool_context=tc_mock
    )

    # Assertions
    catalog_mock.validator.validate.assert_called_once_with(list_payload)
    assert tc_mock.actions.skip_summarization is True

    # Assert that tool_context.render_ui_widget was called with correct widgets
    assert tc_mock.render_ui_widget.call_count == 2
    calls = tc_mock.render_ui_widget.call_args_list

    w1 = calls[0][0][0]
    assert isinstance(w1, UiWidget)
    assert w1.id == "id-1"
    assert w1.provider == "a2ui-custom"
    assert w1.payload == {"id": "id-1", "type": "Label"}

    w2 = calls[1][0][0]
    assert isinstance(w2, UiWidget)
    assert w2.id == "id-2"
    assert w2.provider == "a2ui-custom"
    assert w2.payload == {"id": "id-2", "type": "Input"}

    assert result == {tool.VALIDATED_A2UI_JSON_KEY: list_payload}


@pytest.mark.asyncio
async def test_send_tool_run_async_missing_arg():
    tool = A2uiAdkNativeToolset._SendA2uiJsonToAdkWidgetTool(
        MagicMock(spec=A2uiCatalog), "examples", "a2ui"
    )
    tc_mock = MagicMock(spec=ToolContext)

    result = await tool.run_async(args={}, tool_context=tc_mock)
    assert tool.TOOL_ERROR_KEY in result
    assert "missing required arg" in result[tool.TOOL_ERROR_KEY]


# endregion
