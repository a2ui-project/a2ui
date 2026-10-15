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

import json
from unittest.mock import MagicMock, patch

from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools.tool_context import ToolContext
import pytest

from a2ui.adk import SendA2uiToClientToolset
from a2ui.constants import A2UI_SCHEMA_BLOCK_START
from a2ui.core import A2uiCatalogError, A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_format import InferenceFormatFactory
from a2ui.inference_formats import ExpressFormatFactory
from a2ui.parser import to_message_models

_Tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool


def _fake_format_factory(compiled=None):
    """Returns a format factory whose format and parser are mocks."""
    factory = MagicMock(spec=InferenceFormatFactory)
    inference_format = factory.create_format.return_value
    inference_format.prompt_generator.generate.return_value = "format_prompt"
    parser = inference_format.create_parser.return_value
    parser.has_format_content.return_value = False
    parser.compile.return_value = compiled if compiled is not None else []
    return factory


# region SendA2uiToClientToolset Tests
"""Tests for the SendA2uiToClientToolset class."""


@pytest.mark.asyncio
async def test_toolset_init_bool():
    catalog_mock = MagicMock(spec=Catalog)
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=True, a2ui_catalogs=[catalog_mock], a2ui_examples="examples"
    )
    ctx = MagicMock(spec=ReadonlyContext)
    assert await toolset._resolve_a2ui_enabled(ctx)

    # Access the tool to check schema resolution
    tool = toolset._ui_tools[0]
    assert await tool._resolve_a2ui_catalogs(ctx) == [catalog_mock]


@pytest.mark.asyncio
async def test_toolset_init_callable():
    enabled_mock = MagicMock(return_value=True)
    catalog_mock = MagicMock(spec=Catalog)
    examples_mock = MagicMock(return_value="examples")
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=enabled_mock,
        a2ui_catalogs=[catalog_mock],
        a2ui_examples=examples_mock,
    )
    ctx = MagicMock(spec=ReadonlyContext)
    assert await toolset._resolve_a2ui_enabled(ctx)

    # Access the tool to check schema resolution
    tool = toolset._ui_tools[0]
    assert await tool._resolve_a2ui_catalogs(ctx) == [catalog_mock]
    assert await tool._resolve_a2ui_examples(ctx) == "examples"
    enabled_mock.assert_called_once_with(ctx)
    catalog_mock.assert_not_called()  # It's in a list, not a provider, in this test
    examples_mock.assert_called_once_with(ctx)


@pytest.mark.asyncio
async def test_toolset_init_async_callable():
    async def async_enabled(_ctx):
        return True

    catalog_mock = MagicMock(spec=Catalog)

    async def async_catalogs(_ctx):
        return [catalog_mock]

    async def async_examples(_ctx):
        return "examples"

    toolset = SendA2uiToClientToolset(
        a2ui_enabled=async_enabled,
        a2ui_catalogs=async_catalogs,
        a2ui_examples=async_examples,
    )
    ctx = MagicMock(spec=ReadonlyContext)
    assert await toolset._resolve_a2ui_enabled(ctx)

    # Access the tool to check schema resolution
    tool = toolset._ui_tools[0]
    assert await tool._resolve_a2ui_catalogs(ctx) == [catalog_mock]
    assert await tool._resolve_a2ui_examples(ctx) == "examples"


@pytest.mark.asyncio
async def test_toolset_get_tools_enabled():
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=True, a2ui_catalogs=[MagicMock(spec=Catalog)], a2ui_examples=""
    )
    tools = await toolset.get_tools(MagicMock(spec=ReadonlyContext))
    assert len(tools) == 1
    assert isinstance(tools[0], SendA2uiToClientToolset._SendA2uiJsonToClientTool)


@pytest.mark.asyncio
async def test_toolset_get_tools_disabled():
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=False,
        a2ui_catalogs=[MagicMock(spec=Catalog)],
        a2ui_examples="",
    )
    tools = await toolset.get_tools(MagicMock(spec=ReadonlyContext))
    assert len(tools) == 0


@pytest.mark.asyncio
async def test_toolset_get_part_converter_uses_all_catalogs_and_format_parser():
    pytest.importorskip("a2a")
    first = MagicMock(spec=Catalog)
    second = MagicMock(spec=Catalog)
    factory = _fake_format_factory()
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=True,
        a2ui_catalogs=[first, second],
        a2ui_examples="",
        inference_format_factory=factory,
    )

    with patch("a2ui.adk.A2uiPartConverter") as converter_cls:
        converter = await toolset.get_part_converter(MagicMock(spec=ReadonlyContext))

    factory.create_format.assert_called_once_with([first, second], examples=None)
    converter_cls.assert_called_once_with(
        [first, second],
        parser=factory.create_format.return_value.create_parser.return_value,
    )
    assert converter is converter_cls.return_value


# endregion

# region SendA2uiJsonToClientTool Tests
"""Tests for the _SendA2uiJsonToClientTool class."""


def test_send_tool_init():
    catalog_mock = MagicMock(spec=Catalog)
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool([catalog_mock], "examples")
    assert tool.name == SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME
    assert tool._a2ui_catalogs == [catalog_mock]
    assert tool._a2ui_examples == "examples"


def test_send_tool_get_declaration():
    catalog_mock = MagicMock(spec=Catalog)
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool([catalog_mock], "examples")
    declaration = tool._get_declaration()
    assert declaration is not None
    assert (
        declaration.name == SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME
    )
    assert (
        SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME
        in declaration.parameters.properties
    )
    assert (
        SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME
        in declaration.parameters.required
    )


@pytest.mark.asyncio
async def test_send_tool_resolve_catalogs():
    catalog_mock = MagicMock(spec=Catalog)
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool([catalog_mock], "examples")
    catalogs = await tool._resolve_a2ui_catalogs(MagicMock(spec=ReadonlyContext))
    assert catalogs == [catalog_mock]


@pytest.mark.asyncio
async def test_send_tool_resolve_multiple_catalogs_preserves_order():
    first = MagicMock(spec=Catalog)
    second = MagicMock(spec=Catalog)
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
        (first, second), "examples"
    )
    catalogs = await tool._resolve_a2ui_catalogs(MagicMock(spec=ReadonlyContext))
    assert catalogs == [first, second]


@pytest.mark.asyncio
async def test_send_tool_resolve_multiple_catalogs_from_provider():
    first = MagicMock(spec=Catalog)
    second = MagicMock(spec=Catalog)
    ctx = MagicMock(spec=ReadonlyContext)
    provider = MagicMock(return_value=[first, second])
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(provider, "examples")
    catalogs = await tool._resolve_a2ui_catalogs(ctx)
    assert catalogs == [first, second]
    provider.assert_called_once_with(ctx)


def test_send_tool_init_rejects_empty_catalogs():
    with pytest.raises(A2uiCatalogError, match="at least one A2UI catalog"):
        SendA2uiToClientToolset._SendA2uiJsonToClientTool([], "examples")


@pytest.mark.asyncio
async def test_send_tool_resolve_catalogs_rejects_empty_from_provider():
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
        lambda _ctx: [], "examples"
    )
    with pytest.raises(A2uiCatalogError, match="at least one A2UI catalog"):
        await tool._resolve_a2ui_catalogs(MagicMock(spec=ReadonlyContext))


@pytest.mark.asyncio
async def test_send_tool_resolve_catalogs_from_generator_is_reusable():
    first = MagicMock(spec=Catalog)
    second = MagicMock(spec=Catalog)
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
        (c for c in (first, second)), "examples"
    )
    ctx = MagicMock(spec=ReadonlyContext)
    assert await tool._resolve_a2ui_catalogs(ctx) == [first, second]
    assert await tool._resolve_a2ui_catalogs(ctx) == [first, second]


@pytest.mark.parametrize(
    "not_a_sequence", [BasicCatalog("0.9"), "catalog"], ids=["catalog", "str"]
)
def test_send_tool_init_rejects_non_sequence(not_a_sequence):
    with pytest.raises(TypeError, match="expects a sequence of A2UI catalogs"):
        SendA2uiToClientToolset._SendA2uiJsonToClientTool(not_a_sequence, "examples")


@pytest.mark.asyncio
async def test_send_tool_resolve_catalogs_rejects_provider_returning_catalog():
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
        lambda _ctx: BasicCatalog("0.9"), "examples"
    )
    with pytest.raises(TypeError, match="expects a sequence of A2UI catalogs"):
        await tool._resolve_a2ui_catalogs(MagicMock(spec=ReadonlyContext))


@pytest.mark.asyncio
async def test_send_tool_process_llm_request_describes_all_catalogs():
    first = MagicMock(spec=Catalog)
    second = MagicMock(spec=Catalog)
    factory = _fake_format_factory()
    tool = _Tool([first, second], "examples", factory)
    llm_request_mock = MagicMock()

    await tool.process_llm_request(
        tool_context=MagicMock(spec=ToolContext), llm_request=llm_request_mock
    )

    factory.create_format.assert_called_once_with([first, second], examples=None)
    llm_request_mock.append_instructions.assert_called_once_with(
        ["format_prompt", _Tool.TOOL_USAGE_INSTRUCTION, "examples"]
    )


@pytest.mark.asyncio
async def test_send_tool_process_llm_request_skips_empty_examples():
    factory = _fake_format_factory()
    tool = _Tool([MagicMock(spec=Catalog)], "", factory)
    llm_request_mock = MagicMock()

    await tool.process_llm_request(
        tool_context=MagicMock(spec=ToolContext), llm_request=llm_request_mock
    )

    llm_request_mock.append_instructions.assert_called_once_with(
        ["format_prompt", _Tool.TOOL_USAGE_INSTRUCTION]
    )


@pytest.mark.asyncio
async def test_send_tool_process_llm_request_passes_example_turns_to_format():
    catalog = MagicMock(spec=Catalog)
    turn = _update_text_messages({"text": "Hello"})
    factory = _fake_format_factory()
    tool = _Tool([catalog], lambda _ctx: [turn], factory)
    llm_request_mock = MagicMock()

    await tool.process_llm_request(
        tool_context=MagicMock(spec=ToolContext), llm_request=llm_request_mock
    )

    factory.create_format.assert_called_once_with([catalog], examples=[turn])
    llm_request_mock.append_instructions.assert_called_once_with(
        ["format_prompt", _Tool.TOOL_USAGE_INSTRUCTION]
    )


@pytest.mark.asyncio
async def test_send_tool_process_llm_request_defaults_to_direct_json():
    tool = _Tool([BasicCatalog("0.9")], "examples")
    llm_request_mock = MagicMock()

    await tool.process_llm_request(
        tool_context=MagicMock(spec=ToolContext), llm_request=llm_request_mock
    )

    (instructions,), _ = llm_request_mock.append_instructions.call_args
    assert A2UI_SCHEMA_BLOCK_START in instructions[0]
    assert instructions[1:] == [_Tool.TOOL_USAGE_INSTRUCTION, "examples"]


@pytest.mark.asyncio
async def test_send_tool_process_llm_request_renders_express_examples():
    turn = _update_text_messages({"text": "Hello from example"})
    tool = _Tool([BasicCatalog("0.9")], [turn], ExpressFormatFactory())
    llm_request_mock = MagicMock()

    await tool.process_llm_request(
        tool_context=MagicMock(spec=ToolContext), llm_request=llm_request_mock
    )

    (instructions,), _ = llm_request_mock.append_instructions.call_args
    assert "A2UI Express" in instructions[0]
    assert 'Text("Hello from example")' in instructions[0]
    assert instructions[1:] == [_Tool.TOOL_USAGE_INSTRUCTION]


@pytest.mark.asyncio
async def test_send_tool_resolve_examples():
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
        [MagicMock(spec=Catalog)], "examples"
    )
    examples = await tool._resolve_a2ui_examples(MagicMock(spec=ReadonlyContext))
    assert examples == "examples"


@pytest.mark.asyncio
async def test_send_tool_resolve_example_turns():
    turn = _update_text_messages({"text": "Hello"})
    tool = _Tool([MagicMock(spec=Catalog)], (tuple(turn),))
    examples = await tool._resolve_a2ui_examples(MagicMock(spec=ReadonlyContext))
    assert examples == [turn]


@pytest.mark.asyncio
async def test_send_tool_resolve_examples_rejects_single_turn():
    turn = _update_text_messages({"text": "Hello"})
    tool = _Tool([MagicMock(spec=Catalog)], turn)
    with pytest.raises(TypeError, match="sequence of turns"):
        await tool._resolve_a2ui_examples(MagicMock(spec=ReadonlyContext))


@pytest.mark.asyncio
async def test_send_tool_run_async_valid():
    catalog_mock = MagicMock(spec=Catalog)
    compiled = [{"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}}]
    factory = _fake_format_factory(compiled)
    tool = _Tool([catalog_mock], "examples", factory)
    tool_context_mock = MagicMock(spec=ToolContext)
    tool_context_mock.state = {}
    tool_context_mock.actions = MagicMock(skip_summarization=False)
    args = {_Tool.A2UI_JSON_ARG_NAME: "a2ui block"}

    result = await tool.run_async(args=args, tool_context=tool_context_mock)

    factory.create_format.assert_called_once_with([catalog_mock], examples=None)
    parser = factory.create_format.return_value.create_parser.return_value
    parser.compile.assert_called_once_with("a2ui block")
    assert result == {_Tool.VALIDATED_A2UI_JSON_KEY: compiled}
    assert tool_context_mock.actions.skip_summarization


@pytest.mark.asyncio
async def test_send_tool_run_async_compiles_against_all_catalogs():
    first = MagicMock(spec=Catalog)
    second = MagicMock(spec=Catalog)
    factory = _fake_format_factory()
    tool = _Tool([first, second], "examples", factory)
    tool_context_mock = MagicMock(spec=ToolContext)
    tool_context_mock.actions = MagicMock(skip_summarization=False)

    await tool.run_async(
        args={_Tool.A2UI_JSON_ARG_NAME: "a2ui block"}, tool_context=tool_context_mock
    )

    factory.create_format.assert_called_once_with([first, second], examples=None)


@pytest.mark.asyncio
async def test_send_tool_run_async_missing_arg():
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
        [MagicMock(spec=Catalog)], "examples"
    )
    result = await tool.run_async(args={}, tool_context=MagicMock())
    assert "error" in result
    assert (
        SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME
        in result["error"]
    )


@pytest.mark.asyncio
async def test_send_tool_run_async_invalid_json():
    tool = _Tool([BasicCatalog("0.9")], "examples")
    args = {_Tool.A2UI_JSON_ARG_NAME: "{invalid"}
    result = await tool.run_async(args=args, tool_context=MagicMock())
    assert "error" in result
    assert "Failed to call A2UI tool" in result["error"]
    assert "not JSON" in result["error"]


@pytest.mark.asyncio
async def test_send_tool_run_async_reports_format_validation_error():
    factory = _fake_format_factory()
    parser = factory.create_format.return_value.create_parser.return_value
    parser.compile.side_effect = A2uiValidationError("'text' is a required property")
    tool = _Tool([MagicMock(spec=Catalog)], "examples", factory)
    result = await tool.run_async(
        args={_Tool.A2UI_JSON_ARG_NAME: "a2ui block"}, tool_context=MagicMock()
    )
    assert "error" in result
    assert "Failed to call A2UI tool" in result["error"]
    assert "'text' is a required property" in result["error"]


def _update_text_messages(text_props: dict) -> list:
    return to_message_models(_update_text_payload(text_props))


def _update_text_payload(text_props: dict) -> list[dict]:
    return [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "root", "component": "Text", **text_props}],
        },
    }]


@pytest.mark.asyncio
async def test_send_tool_run_async_accepts_valid_payload_for_real_catalog():
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
        [BasicCatalog("0.9")], "examples"
    )
    tool_context_mock = MagicMock(spec=ToolContext)
    tool_context_mock.state = {}
    tool_context_mock.actions = MagicMock(skip_summarization=False)
    payload = _update_text_payload({"text": "Hello"})
    args = {
        SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME: (
            json.dumps(payload)
        )
    }

    result = await tool.run_async(args=args, tool_context=tool_context_mock)

    assert result == {
        SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY: (
            payload
        )
    }


@pytest.mark.asyncio
async def test_send_tool_run_async_rejects_invalid_payload_for_real_catalog():
    tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool(
        [BasicCatalog("0.9")], "examples"
    )
    args = {
        SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME: (
            json.dumps(_update_text_payload({}))
        )
    }

    result = await tool.run_async(args=args, tool_context=MagicMock())

    assert "error" in result
    assert "Failed to call A2UI tool" in result["error"]
    assert "'text' is a required property" in result["error"]


@pytest.mark.asyncio
async def test_send_tool_run_async_accepts_wrapped_direct_json():
    payload = _update_text_payload({"text": "Hello"})
    tool = _Tool([BasicCatalog("0.9")], "examples")
    tool_context_mock = MagicMock(spec=ToolContext)
    tool_context_mock.actions = MagicMock(skip_summarization=False)
    content = f"Here you go:\n<a2ui-json>{json.dumps(payload)}</a2ui-json>"

    result = await tool.run_async(
        args={_Tool.A2UI_JSON_ARG_NAME: content}, tool_context=tool_context_mock
    )

    assert result == {_Tool.VALIDATED_A2UI_JSON_KEY: payload}


@pytest.mark.asyncio
@pytest.mark.parametrize("wrapped", [False, True], ids=["bare", "wrapped"])
async def test_send_tool_run_async_compiles_express(wrapped):
    tool = _Tool([BasicCatalog("0.9")], "", ExpressFormatFactory())
    tool_context_mock = MagicMock(spec=ToolContext)
    tool_context_mock.actions = MagicMock(skip_summarization=False)
    content = 'surface("s1")\nroot = Text("Hello")'
    if wrapped:
        content = f"<a2ui>\n{content}\n</a2ui>"

    result = await tool.run_async(
        args={_Tool.A2UI_JSON_ARG_NAME: content}, tool_context=tool_context_mock
    )

    payload = result[_Tool.VALIDATED_A2UI_JSON_KEY]
    assert payload[0]["createSurface"]["surfaceId"] == "s1"
    assert payload[1]["updateComponents"]["components"] == [
        {"id": "root", "component": "Text", "text": "Hello"}
    ]
    assert tool_context_mock.actions.skip_summarization


@pytest.mark.asyncio
async def test_send_tool_run_async_rejects_invalid_express():
    tool = _Tool([BasicCatalog("0.9")], "", ExpressFormatFactory())
    result = await tool.run_async(
        args={_Tool.A2UI_JSON_ARG_NAME: 'root = NoSuchComponent("Hello")'},
        tool_context=MagicMock(),
    )
    assert "error" in result
    assert "Failed to call A2UI tool" in result["error"]


# endregion
