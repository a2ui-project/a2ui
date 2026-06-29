# Copyright 2025 Google LLC
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
from unittest.mock import MagicMock

import pytest

from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset
from a2ui.schema.catalog import A2uiCatalog
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools.tool_context import ToolContext
from google.genai import types as genai_types

# region SendA2uiToClientToolset Tests
"""Tests for the SendA2uiToClientToolset class."""


@pytest.mark.asyncio
async def test_toolset_init_bool():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  toolset = SendA2uiToClientToolset(
      a2ui_enabled=True, a2ui_catalog=catalog_mock, a2ui_examples="examples"
  )
  ctx = MagicMock(spec=ReadonlyContext)
  assert await toolset._resolve_a2ui_enabled(ctx) == True

  # Access the tool to check schema resolution
  tool = toolset._ui_tools[0]
  assert await tool._resolve_a2ui_catalog(ctx) == catalog_mock


@pytest.mark.asyncio
async def test_toolset_init_callable():
  enabled_mock = MagicMock(return_value=True)
  catalog_mock = MagicMock(spec=A2uiCatalog)
  examples_mock = MagicMock(return_value="examples")
  toolset = SendA2uiToClientToolset(
      a2ui_enabled=enabled_mock,
      a2ui_catalog=catalog_mock,
      a2ui_examples=examples_mock,
  )
  ctx = MagicMock(spec=ReadonlyContext)
  assert await toolset._resolve_a2ui_enabled(ctx) == True

  # Access the tool to check schema resolution
  tool = toolset._ui_tools[0]
  assert await tool._resolve_a2ui_catalog(ctx) == catalog_mock
  assert await tool._resolve_a2ui_examples(ctx) == "examples"
  enabled_mock.assert_called_once_with(ctx)
  catalog_mock.assert_not_called()  # It's an object, not a callable in this test
  examples_mock.assert_called_once_with(ctx)


@pytest.mark.asyncio
async def test_toolset_init_async_callable():
  async def async_enabled(_ctx):
    return True

  catalog_mock = MagicMock(spec=A2uiCatalog)

  async def async_catalog(_ctx):
    return catalog_mock

  async def async_examples(_ctx):
    return "examples"

  toolset = SendA2uiToClientToolset(
      a2ui_enabled=async_enabled,
      a2ui_catalog=async_catalog,
      a2ui_examples=async_examples,
  )
  ctx = MagicMock(spec=ReadonlyContext)
  assert await toolset._resolve_a2ui_enabled(ctx) == True

  # Access the tool to check schema resolution
  tool = toolset._ui_tools[0]
  assert await tool._resolve_a2ui_catalog(ctx) == catalog_mock
  assert await tool._resolve_a2ui_examples(ctx) == "examples"


@pytest.mark.asyncio
async def test_toolset_get_tools_enabled():
  toolset = SendA2uiToClientToolset(
      a2ui_enabled=True, a2ui_catalog=MagicMock(spec=A2uiCatalog), a2ui_examples=""
  )
  tools = await toolset.get_tools(MagicMock(spec=ReadonlyContext))
  assert len(tools) == 1
  assert isinstance(tools[0], SendA2uiToClientToolset._SendA2uiJsonToClientTool)


@pytest.mark.asyncio
async def test_toolset_get_tools_disabled():
  toolset = SendA2uiToClientToolset(
      a2ui_enabled=False,
      a2ui_catalog=MagicMock(spec=A2uiCatalog),
      a2ui_examples="",
  )
  tools = await toolset.get_tools(MagicMock(spec=ReadonlyContext))
  assert len(tools) == 0


# endregion

# region SendA2uiJsonToClientTool Tests
"""Tests for the _SendA2uiJsonToClientTool class."""


def test_send_tool_init():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(catalog_mock, "examples")
  assert tool.name == SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME
  assert tool._a2ui_catalog == catalog_mock
  assert tool._a2ui_examples == "examples"


def test_send_tool_get_declaration():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(catalog_mock, "examples")
  declaration = tool._get_declaration()
  assert declaration is not None
  assert declaration.name == SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME
  assert (
      SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME
      in declaration.parameters.properties
  )
  assert (
      SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME
      in declaration.parameters.required
  )


@pytest.mark.asyncio
async def test_send_tool_resolve_catalog():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(catalog_mock, "examples")
  catalog = await tool._resolve_a2ui_catalog(MagicMock(spec=ReadonlyContext))
  assert catalog == catalog_mock


@pytest.mark.asyncio
async def test_send_tool_resolve_examples():
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
      MagicMock(spec=A2uiCatalog), "examples"
  )
  examples = await tool._resolve_a2ui_examples(MagicMock(spec=ReadonlyContext))
  assert examples == "examples"


@pytest.mark.asyncio
async def test_send_tool_process_llm_request():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  catalog_mock.render_as_llm_instructions.return_value = "rendered_catalog"
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(catalog_mock, "examples")

  tool_context_mock = MagicMock(spec=ToolContext)
  tool_context_mock.state = {}
  llm_request_mock = MagicMock()
  llm_request_mock.append_instructions = MagicMock()

  await tool.process_llm_request(
      tool_context=tool_context_mock, llm_request=llm_request_mock
  )

  llm_request_mock.append_instructions.assert_called_once()
  args, _ = llm_request_mock.append_instructions.call_args
  instructions = args[0]
  assert "rendered_catalog" in instructions
  assert "examples" in instructions


@pytest.mark.asyncio
async def test_send_tool_run_async_valid():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(catalog_mock, "examples")
  tool_context_mock = MagicMock(spec=ToolContext)
  tool_context_mock.state = {}
  tool_context_mock.actions = MagicMock(skip_summarization=False)

  valid_a2ui = [{"type": "Text", "text": "Hello"}]
  catalog_mock.validator.validate.return_value = None
  args = {
      SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME: json.dumps(
          valid_a2ui
      )
  }

  result = await tool.run_async(args=args, tool_context=tool_context_mock)
  assert result == {
      SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY: (
          valid_a2ui
      )
  }
  assert tool_context_mock.actions.skip_summarization == True
  catalog_mock.validator.validate.assert_called_once_with(valid_a2ui)


@pytest.mark.asyncio
async def test_send_tool_run_async_valid_list():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(catalog_mock, "examples")
  tool_context_mock = MagicMock(spec=ToolContext)
  tool_context_mock.state = {}
  tool_context_mock.actions = MagicMock(skip_summarization=False)

  valid_a2ui = [{"type": "Text", "text": "Hello"}]
  catalog_mock.validator.validate.return_value = None
  args = {
      SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME: json.dumps(
          valid_a2ui
      )
  }

  result = await tool.run_async(args=args, tool_context=tool_context_mock)
  assert result == {
      SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY: (
          valid_a2ui
      )
  }
  assert tool_context_mock.actions.skip_summarization == True
  catalog_mock.validator.validate.assert_called_once_with(valid_a2ui)


@pytest.mark.asyncio
async def test_send_tool_run_async_missing_arg():
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
      MagicMock(spec=A2uiCatalog), "examples"
  )
  result = await tool.run_async(args={}, tool_context=MagicMock())
  assert "error" in result
  assert (
      SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME
      in result["error"]
  )


@pytest.mark.asyncio
async def test_send_tool_run_async_invalid_json():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(catalog_mock, "examples")
  args = {
      SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME: "{invalid"
  }
  result = await tool.run_async(args=args, tool_context=MagicMock())
  assert "error" in result
  assert "Failed to call A2UI tool" in result["error"]
  assert "Expecting property name enclosed in double quotes" in result["error"]


@pytest.mark.asyncio
async def test_send_tool_run_async_schema_validation_fail():
  catalog_mock = MagicMock(spec=A2uiCatalog)
  catalog_mock.validator.validate.side_effect = Exception(
      "'text' is a required property"
  )
  tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(catalog_mock, "examples")
  invalid_a2ui = [{"type": "Text"}]  # Missing 'text'
  args = {
      SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME: json.dumps(
          invalid_a2ui
      )
  }
  result = await tool.run_async(args=args, tool_context=MagicMock())
  assert "error" in result
  assert "Failed to call A2UI tool" in result["error"]
  assert "'text' is a required property" in result["error"]


# endregion
