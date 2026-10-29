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
from typing import Any
from unittest.mock import MagicMock, patch

from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools.tool_context import ToolContext
from google.genai import types as genai_types
import pytest

from a2ui.adk import SendA2uiToClientToolset
from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_format import InferenceFormatFactory
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory, DirectJsonParser
from a2ui.inference_formats.express import ExpressFormatFactory
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState

_Tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool
_ARG = _Tool.A2UI_PAYLOAD_ARG_NAME
_RESULT = _Tool.VALIDATED_A2UI_JSON_KEY

_BASIC = BasicCatalog("0.9")
_CTX = MagicMock(spec=ReadonlyContext)


def _create(surface_id: str = "s1") -> dict[str, Any]:
    return {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": surface_id,
            "catalogId": _BASIC.catalog_id,
        },
    }


def _update(text_props: dict[str, Any], surface_id: str = "s1") -> dict[str, Any]:
    return {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": surface_id,
            "components": [{"id": "root", "component": "Text", **text_props}],
        },
    }


def _turns() -> list[list[Any]]:
    return [to_message_models([_create(), _update({"text": "Hello"})])]


def _processor(
    examples: Any = None,
    format_factory: InferenceFormatFactory | None = None,
    state: RendererState | None = None,
) -> A2uiRequestProcessor:
    return A2uiRequestProcessor(
        [_BASIC], examples=examples, format_factory=format_factory, state=state
    )


def _tool(**processor_kwargs: Any) -> Any:
    return _Tool(_processor(**processor_kwargs))


def _express(messages: list[dict[str, Any]]) -> str:
    """Writes messages in Express, as the LLM would write the tool's argument."""
    return _processor().parser.decompile(to_message_models(messages))


def _tool_context() -> MagicMock:
    tool_context = MagicMock(spec=ToolContext)
    tool_context.state = {}
    tool_context.actions = MagicMock(skip_summarization=False)
    return tool_context


def _llm_request(system_instruction: str | None = None) -> MagicMock:
    llm_request = MagicMock()
    llm_request.config.system_instruction = system_instruction
    return llm_request


def _appended(llm_request: MagicMock) -> list[str]:
    llm_request.append_instructions.assert_called_once()
    (instructions,), _ = llm_request.append_instructions.call_args
    return instructions


# region SendA2uiToClientToolset Tests
"""Tests for the SendA2uiToClientToolset class."""


@pytest.mark.asyncio
async def test_toolset_resolves_enabled_from_a_bool_or_a_provider():
    async def async_enabled(_ctx):
        return True

    enabled = MagicMock(return_value=True)
    processor = _processor()
    assert await SendA2uiToClientToolset(True, processor)._resolve_a2ui_enabled(_CTX)
    toolset = SendA2uiToClientToolset(enabled, processor)
    assert await toolset._resolve_a2ui_enabled(_CTX)
    enabled.assert_called_once_with(_CTX)
    toolset = SendA2uiToClientToolset(async_enabled, processor)
    assert await toolset._resolve_a2ui_enabled(_CTX)


@pytest.mark.asyncio
async def test_toolset_get_tools_enabled():
    tools = await SendA2uiToClientToolset(True, _processor()).get_tools(_CTX)
    assert len(tools) == 1
    assert isinstance(tools[0], _Tool)


@pytest.mark.asyncio
async def test_toolset_get_tools_disabled():
    assert await SendA2uiToClientToolset(False, _processor()).get_tools(_CTX) == []


@pytest.mark.asyncio
async def test_toolset_get_part_converter_uses_the_processor():
    pytest.importorskip("a2a")
    processor = _processor(format_factory=DirectJsonFormatFactory())
    toolset = SendA2uiToClientToolset(True, lambda _ctx: processor)

    with patch("a2ui.adk.A2uiPartConverter") as converter_cls:
        converter = await toolset.get_part_converter(_CTX)

    converter_cls.assert_called_once_with(processor)
    assert converter is converter_cls.return_value


# endregion

# region SendA2uiJsonToClientTool Tests
"""Tests for the _SendA2uiJsonToClientTool class."""


@pytest.mark.asyncio
async def test_send_tool_takes_a_processor():
    processor = _processor()
    tool = _Tool(processor)
    assert tool.name == _Tool.TOOL_NAME
    assert await tool._resolve_processor(_CTX) is processor


@pytest.mark.asyncio
async def test_send_tool_takes_a_sync_or_async_processor_provider():
    processor = _processor()

    async def provide(_ctx):
        return processor

    assert await _Tool(provide)._resolve_processor(_CTX) is processor
    assert await _Tool(lambda _ctx: processor)._resolve_processor(_CTX) is processor


@pytest.mark.asyncio
async def test_send_tool_calls_the_provider_per_context():
    provider = MagicMock(side_effect=lambda _ctx: _processor())
    tool = _Tool(provider)
    first = await tool._resolve_processor(_CTX)
    second = await tool._resolve_processor(_CTX)
    assert first is not second
    assert provider.call_count == 2


@pytest.mark.asyncio
async def test_send_tool_rejects_a_provider_returning_another_type():
    tool = _Tool(lambda _ctx: [_BASIC])
    with pytest.raises(TypeError, match="expects an A2uiRequestProcessor"):
        await tool._resolve_processor(_CTX)


def test_send_tool_get_declaration():
    declaration = _tool()._get_declaration()
    assert declaration is not None
    assert declaration.name == _Tool.TOOL_NAME
    assert _ARG in declaration.parameters.properties
    assert _ARG in declaration.parameters.required
    # The argument is described without naming a format.
    assert "JSON" not in declaration.parameters.properties[_ARG].description


# endregion

# region Prompt Tests
"""Tests for the prompt that process_llm_request adds."""


@pytest.mark.asyncio
async def test_process_llm_request_adds_the_processors_prompt():
    tool = _tool()
    generator = ExpressFormatFactory().create_format([_BASIC]).prompt_generator
    llm_request = _llm_request()

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    instructions = _appended(llm_request)
    text = "\n\n".join(instructions)
    assert generator.generate_base_rules() in text
    assert generator.generate_catalog_instructions(include_schema=True) in text
    assert tool._tool_instruction() in instructions


@pytest.mark.asyncio
async def test_process_llm_request_follows_the_processors_format():
    tool = _tool(format_factory=DirectJsonFormatFactory())
    generator = DirectJsonFormatFactory().create_format([_BASIC]).prompt_generator
    llm_request = _llm_request()

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    text = "\n\n".join(_appended(llm_request))
    assert generator.generate_base_rules() in text
    assert generator.generate_catalog_instructions(include_schema=True) in text


@pytest.mark.asyncio
async def test_process_llm_request_writes_example_turns_in_the_format():
    tool = _tool(examples=_turns())
    llm_request = _llm_request()

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    text = "\n\n".join(_appended(llm_request))
    # The Express prompt generator writes the turns, not a JSON decompiler.
    assert _express([_create(), _update({"text": "Hello"})]) in text
    assert "<a2ui-json>" not in text


@pytest.mark.asyncio
async def test_process_llm_request_skips_a_prompt_snippet_already_in_the_instruction():
    processor = _processor(examples=_turns())
    tool = _Tool(processor)
    llm_request = _llm_request(processor.prompt_snippet)

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    # Only the note on how to call the tool is new.
    assert _appended(llm_request) == [tool._tool_instruction()]


@pytest.mark.parametrize(
    "wrap",
    [
        lambda text: genai_types.Content(parts=[genai_types.Part(text=text)]),
        lambda text: genai_types.Part(text=text),
        lambda text: ["Role.", genai_types.Part(text=text)],
    ],
    ids=["content", "part", "list"],
)
@pytest.mark.asyncio
async def test_process_llm_request_reads_text_from_a_non_string_instruction(
    wrap,
):
    processor = _processor(examples=_turns())
    tool = _Tool(processor)
    llm_request = _llm_request()
    llm_request.config.system_instruction = wrap(processor.prompt_snippet)

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    assert _appended(llm_request) == [tool._tool_instruction()]


@pytest.mark.parametrize(
    "config",
    [
        None,
        MagicMock(system_instruction=None),
        # Parts that hold no text, or a text that is not a string.
        MagicMock(
            system_instruction=[
                None,
                genai_types.Part(),
                MagicMock(text=MagicMock()),
            ]
        ),
    ],
    ids=["no_config", "no_instruction", "no_text"],
)
@pytest.mark.asyncio
async def test_process_llm_request_adds_the_whole_prompt_without_instruction_text(
    config,
):
    tool = _tool()
    llm_request = MagicMock()
    llm_request.config = config

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    instructions = _appended(llm_request)
    assert tool._tool_instruction() in instructions
    assert len(instructions) > 1


@pytest.mark.asyncio
async def test_process_llm_request_skips_examples_already_in_the_instruction():
    processor = _processor(examples=_turns())
    generator = processor.format.prompt_generator
    llm_request = _llm_request(f"Role.\n\n{generator.generate_examples()}")

    await _Tool(processor).process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    text = "\n\n".join(_appended(llm_request))
    assert generator.generate_examples() not in text
    assert generator.generate_catalog_instructions(include_schema=True) in text


@pytest.mark.asyncio
async def test_process_llm_request_adds_nothing_when_everything_is_present():
    tool = _tool()
    first = _llm_request()
    await tool.process_llm_request(tool_context=_tool_context(), llm_request=first)
    llm_request = _llm_request("\n\n".join(_appended(first)))

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    llm_request.append_instructions.assert_not_called()


# endregion

# region run_async Tests
"""Tests for parsing and validating the tool's argument."""


@pytest.mark.asyncio
async def test_run_async_compiles_express_to_a2ui_json():
    tool = _tool()
    tool_context = _tool_context()
    payload = [_create(), _update({"text": "Hello"})]

    result = await tool.run_async(
        args={_ARG: _express(payload)}, tool_context=tool_context
    )

    assert result == {_RESULT: payload}
    assert tool_context.actions.skip_summarization


@pytest.mark.asyncio
async def test_run_async_accepts_a_block_left_in_its_tags():
    payload = [_create(), _update({"text": "Hello"})]

    result = await _tool().run_async(
        args={_ARG: f"<a2ui>\n{_express(payload)}\n</a2ui>"},
        tool_context=_tool_context(),
    )

    assert result == {_RESULT: payload}


@pytest.mark.asyncio
async def test_run_async_reads_direct_json_with_its_processor():
    tool = _tool(format_factory=DirectJsonFormatFactory())
    payload = [_create(), _update({"text": "Hello"})]

    result = await tool.run_async(
        args={_ARG: json.dumps(payload)}, tool_context=_tool_context()
    )

    assert result == {_RESULT: payload}


@pytest.mark.asyncio
async def test_run_async_validates_against_all_the_processors_catalogs():
    other = Catalog(catalog_id="other", protocol_version="0.9")
    processor = A2uiRequestProcessor(
        [_BASIC, other], format_factory=DirectJsonFormatFactory()
    )
    payload = [_update({"text": "Hello"})]

    with patch(
        "a2ui.adk.send_a2ui_to_client_toolset.validate_payload"
    ) as mock_validate:
        await _Tool(processor).run_async(
            args={_ARG: json.dumps(payload)}, tool_context=_tool_context()
        )

    mock_validate.assert_called_once_with([_BASIC, other], payload)


@pytest.mark.asyncio
async def test_run_async_without_state_accepts_an_update_to_an_earlier_surface():
    # Without a state, a surface the payload only updates may have been created
    # by an earlier call, as validate_payload assumes.
    payload = [_update({"text": "Hello"})]

    result = await _tool().run_async(
        args={_ARG: _express(payload)}, tool_context=_tool_context()
    )

    assert result == {_RESULT: payload}


@pytest.mark.asyncio
async def test_run_async_missing_arg():
    result = await _tool().run_async(args={}, tool_context=MagicMock())
    assert _Tool.TOOL_ERROR_KEY in result
    assert _ARG in result[_Tool.TOOL_ERROR_KEY]


@pytest.mark.asyncio
async def test_run_async_rejects_a_block_the_format_cannot_read():
    result = await _tool().run_async(
        args={_ARG: "root = Text("}, tool_context=_tool_context()
    )
    assert "Failed to call A2UI tool" in result[_Tool.TOOL_ERROR_KEY]


@pytest.mark.asyncio
async def test_run_async_rejects_invalid_direct_json():
    tool = _tool(format_factory=DirectJsonFormatFactory())
    result = await tool.run_async(args={_ARG: "{invalid"}, tool_context=MagicMock())
    assert "Failed to call A2UI tool" in result[_Tool.TOOL_ERROR_KEY]
    assert "not JSON" in result[_Tool.TOOL_ERROR_KEY]


@pytest.mark.asyncio
async def test_run_async_rejects_a_payload_the_catalog_rejects():
    tool = _tool(format_factory=DirectJsonFormatFactory())
    result = await tool.run_async(
        args={_ARG: json.dumps([_update({})])}, tool_context=MagicMock()
    )
    assert "Failed to call A2UI tool" in result[_Tool.TOOL_ERROR_KEY]
    assert "'text' is a required property" in result[_Tool.TOOL_ERROR_KEY]


@pytest.mark.parametrize(
    "factory",
    [ExpressFormatFactory(), DirectJsonFormatFactory()],
    ids=lambda f: type(f).__name__,
)
@pytest.mark.asyncio
async def test_run_async_validates_and_updates_the_bound_renderer_state(
    factory,
):
    state = RendererState([_BASIC])
    processor = _processor(format_factory=factory, state=state)
    tool = _Tool(processor)
    tool_context = _tool_context()

    def write(messages: list[dict[str, Any]]) -> str:
        if isinstance(processor.parser, DirectJsonParser):
            return json.dumps(messages)
        return processor.parser.decompile(to_message_models(messages))

    # Updating an unknown surface is rejected by the Canvas RendererState.
    bad = await tool.run_async(
        args={_ARG: write([_update({"text": "Hi"})])}, tool_context=tool_context
    )
    assert tool.TOOL_ERROR_KEY in bad
    assert state.get_surface("s1") is None

    # Creating the surface and root succeeds and updates the state.
    create_and_update = [_create(), _update({"text": "Created"})]
    ok = await tool.run_async(
        args={_ARG: write(create_and_update)}, tool_context=tool_context
    )
    assert ok == {_RESULT: create_and_update}

    # Turn 2: updating the existing surface in the state now succeeds.
    turn2 = [_update({"text": "Updated"})]
    result = await tool.run_async(args={_ARG: write(turn2)}, tool_context=tool_context)
    assert result == {_RESULT: turn2}


# endregion


@pytest.mark.parametrize(
    "factory, tags",
    [
        (ExpressFormatFactory(), ("<a2ui>", "</a2ui>")),
        (DirectJsonFormatFactory(), ("<a2ui-json>", "</a2ui-json>")),
    ],
    ids=["express", "direct_json"],
)
@pytest.mark.parametrize("bound_state", [False, True], ids=["stateless", "state"])
@pytest.mark.asyncio
async def test_run_async_accepts_a_block_whose_closing_tag_is_missing(
    factory, tags, bound_state
):
    processor = _processor(
        format_factory=factory,
        state=RendererState([_BASIC]) if bound_state else None,
    )
    payload = [_create(), _update({"text": "Hello"})]
    block = (
        json.dumps(payload)
        if isinstance(processor.parser, DirectJsonParser)
        else processor.parser.decompile(to_message_models(payload))
    )

    result = await _Tool(processor).run_async(
        args={_ARG: f"{tags[0]}\n{block}"}, tool_context=_tool_context()
    )

    assert result == {_RESULT: payload}


def test_toolset_warns_about_one_processor_with_a_bound_state(caplog):
    with caplog.at_level("WARNING"):
        SendA2uiToClientToolset(
            a2ui_enabled=True,
            a2ui_processor=_processor(state=RendererState([_BASIC])),
        )
    assert "every conversation shares that state" in caplog.text


def test_toolset_does_not_warn_about_a_provider_or_a_stateless_processor(
    caplog,
):
    with caplog.at_level("WARNING"):
        SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=_processor())
        SendA2uiToClientToolset(
            a2ui_enabled=True,
            a2ui_processor=lambda ctx: _processor(state=RendererState([_BASIC])),
        )
    assert caplog.text == ""


@pytest.mark.asyncio
async def test_run_async_logs_an_error_without_the_payload(caplog):
    tool = _tool(format_factory=DirectJsonFormatFactory())
    with caplog.at_level("INFO"):
        result = await tool.run_async(
            args={_ARG: json.dumps([_update({"hunter2": "x"})])},
            tool_context=MagicMock(),
        )
    # The LLM gets the details to fix its payload; the logs don't.
    assert "hunter2" in result[_Tool.TOOL_ERROR_KEY]
    assert "Failed to call A2UI tool" in caplog.text
    assert "hunter2" not in caplog.text
