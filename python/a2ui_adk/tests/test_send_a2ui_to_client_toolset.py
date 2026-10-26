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
import pytest

from a2ui.adk import SendA2uiToClientToolset
from a2ui.core import A2uiCatalogError, A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory, DirectJsonParser
from a2ui.inference_formats.express import ExpressFormatFactory, ExpressParser
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState

_Tool = SendA2uiToClientToolset._SendA2uiJsonToClientTool
_ARG = _Tool.A2UI_PAYLOAD_ARG_NAME
_RESULT = _Tool.VALIDATED_A2UI_JSON_KEY

_BASIC = BasicCatalog("0.9")


def _create(surface_id: str = "s1") -> dict[str, Any]:
    return {
        "version": "v0.9",
        "createSurface": {"surfaceId": surface_id, "catalogId": _BASIC.catalog_id},
    }


def _update(text_props: dict[str, Any], surface_id: str = "s1") -> dict[str, Any]:
    return {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": surface_id,
            "components": [{"id": "root", "component": "Text", **text_props}],
        },
    }


def _express(messages: list[dict[str, Any]]) -> str:
    """Writes messages in Express, as the LLM would write the tool's argument."""
    processor = A2uiRequestProcessor([_BASIC], format_factory=ExpressFormatFactory())
    return processor.parser.decompile(to_message_models(messages))


def _tool_context() -> MagicMock:
    tool_context = MagicMock(spec=ToolContext)
    tool_context.state = {}
    tool_context.actions = MagicMock(skip_summarization=False)
    return tool_context


def _llm_request(system_instruction: str | None = None) -> MagicMock:
    llm_request = MagicMock()
    llm_request.config.system_instruction = system_instruction
    return llm_request


def _toolset(
    catalogs: Any = (_BASIC,), examples: Any = None, **kwargs: Any
) -> SendA2uiToClientToolset:
    return SendA2uiToClientToolset(
        a2ui_enabled=True, a2ui_catalogs=catalogs, a2ui_examples=examples, **kwargs
    )


def _tool(catalogs: Any = (_BASIC,), examples: Any = None, **kwargs: Any) -> Any:
    return _toolset(catalogs, examples, **kwargs)._ui_tool


def _turns() -> list[list[Any]]:
    return [to_message_models([_create(), _update({"text": "Hello"})])]


_OTHER = Catalog(catalog_id="other", protocol_version="0.9")
_CTX = MagicMock(spec=ReadonlyContext)


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
    assert await _toolset()._resolve_a2ui_enabled(_CTX)
    toolset = SendA2uiToClientToolset(a2ui_enabled=enabled, a2ui_catalogs=[_BASIC])
    assert await toolset._resolve_a2ui_enabled(_CTX)
    enabled.assert_called_once_with(_CTX)
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=async_enabled, a2ui_catalogs=[_BASIC]
    )
    assert await toolset._resolve_a2ui_enabled(_CTX)


@pytest.mark.asyncio
async def test_toolset_get_tools_enabled():
    tools = await _toolset().get_tools(_CTX)
    assert len(tools) == 1
    assert isinstance(tools[0], _Tool)


@pytest.mark.asyncio
async def test_toolset_get_tools_disabled():
    toolset = SendA2uiToClientToolset(a2ui_enabled=False, a2ui_catalogs=[_BASIC])
    assert await toolset.get_tools(_CTX) == []


@pytest.mark.asyncio
async def test_toolset_get_part_converter_uses_the_toolset_processor():
    pytest.importorskip("a2a")
    state = RendererState([_BASIC])
    toolset = _toolset(
        inference_format_factory=DirectJsonFormatFactory(), a2ui_state=state
    )

    with patch("a2ui.adk.A2uiPartConverter") as converter_cls:
        converter = await toolset.get_part_converter(_CTX)

    _, kwargs = converter_cls.call_args
    assert kwargs["processor"] is toolset._ui_tool._processor
    assert isinstance(kwargs["processor"].parser, DirectJsonParser)
    assert kwargs["state"] is state
    assert converter is converter_cls.return_value


# endregion

# region Processor Tests
"""Tests for the processor the toolset binds the catalogs and examples to."""


def test_fixed_catalogs_and_examples_build_one_processor_up_front():
    tool = _tool([_BASIC], _turns())
    assert isinstance(tool._processor, A2uiRequestProcessor)
    assert tool._processor.active_catalogs == [_BASIC]
    assert tool._processor.examples == _turns()


@pytest.mark.asyncio
async def test_fixed_processor_is_reused():
    tool = _tool()
    assert await tool._resolve_processor(_CTX) is tool._processor
    assert await tool._resolve_processor(_CTX) is tool._processor


def test_the_processor_defaults_to_express():
    assert isinstance(_tool()._processor.parser, ExpressParser)


def test_the_processor_uses_the_given_format():
    tool = _tool(inference_format_factory=DirectJsonFormatFactory())
    assert isinstance(tool._processor.parser, DirectJsonParser)


def test_catalogs_keep_their_order():
    tool = _tool((_BASIC, _OTHER), inference_format_factory=DirectJsonFormatFactory())
    assert tool._processor.active_catalogs == [_BASIC, _OTHER]


def test_catalogs_from_a_generator_are_read_once():
    tool = _tool((c for c in [_BASIC]))
    assert tool._processor.active_catalogs == [_BASIC]


@pytest.mark.asyncio
async def test_providers_build_a_processor_per_context():
    catalogs = MagicMock(return_value=[_BASIC])
    tool = _tool(catalogs, lambda _ctx: _turns())

    first = await tool._resolve_processor(_CTX)
    second = await tool._resolve_processor(_CTX)

    assert first is not second
    assert first.active_catalogs == [_BASIC]
    assert first.examples == _turns()
    catalogs.assert_called_with(_CTX)
    assert catalogs.call_count == 2


@pytest.mark.asyncio
async def test_async_providers_are_awaited():
    async def catalogs(_ctx):
        return [_BASIC]

    async def examples(_ctx):
        return _turns()

    processor = await _tool(catalogs, examples)._resolve_processor(_CTX)
    assert processor.active_catalogs == [_BASIC]
    assert processor.examples == _turns()


def test_empty_catalogs_are_rejected():
    with pytest.raises(A2uiCatalogError, match="at least one A2UI catalog"):
        _tool([])


@pytest.mark.asyncio
async def test_empty_catalogs_from_a_provider_are_rejected():
    tool = _tool(lambda _ctx: [])
    with pytest.raises(A2uiCatalogError, match="at least one A2UI catalog"):
        await tool._resolve_processor(_CTX)


@pytest.mark.parametrize(
    "not_a_sequence", [BasicCatalog("0.9"), "catalog"], ids=["catalog", "str"]
)
def test_a_single_catalog_is_rejected(not_a_sequence):
    with pytest.raises(TypeError, match="expects a sequence of A2UI catalogs"):
        _tool(not_a_sequence)


@pytest.mark.asyncio
async def test_a_provider_returning_a_single_catalog_is_rejected():
    tool = _tool(lambda _ctx: BasicCatalog("0.9"))
    with pytest.raises(TypeError, match="expects a sequence of A2UI catalogs"):
        await tool._resolve_processor(_CTX)


@pytest.mark.parametrize("no_examples", [None, "", []], ids=["none", "str", "list"])
def test_no_examples(no_examples):
    tool = _tool(examples=no_examples)
    assert tool._processor.examples is None
    assert tool._processor.format.prompt_generator.generate_examples() == ""


def test_examples_from_a_generator_are_read_once():
    turn = _turns()[0]
    assert _tool(examples=(t for t in [turn]))._processor.examples == [turn]


@pytest.mark.asyncio
async def test_examples_from_a_provider_may_be_any_iterable():
    turn = _turns()[0]
    tool = _tool(examples=lambda _ctx: (tuple(t) for t in [turn]))
    assert (await tool._resolve_processor(_CTX)).examples == [turn]


@pytest.mark.parametrize(
    "not_turns",
    [
        b"examples",
        to_message_models([_create()])[0],
        to_message_models([_create()]),
        _create(),
    ],
    ids=["bytes", "message", "one_turn", "mapping"],
)
def test_examples_that_are_not_turns_are_rejected(not_turns):
    with pytest.raises(TypeError, match="expects"):
        _tool(examples=not_turns)


@pytest.mark.asyncio
async def test_a_provider_returning_other_examples_is_rejected():
    tool = _tool(examples=lambda _ctx: 42)
    with pytest.raises(TypeError, match="expects examples"):
        await tool._resolve_processor(_CTX)


def test_an_invalid_fixed_example_fails_when_the_toolset_is_created():
    with pytest.raises(A2uiValidationError):
        _tool(examples=[to_message_models([_update({})])])


def test_markdown_examples_go_to_the_processor_prompt():
    tool = _tool(examples="### My examples")
    processor = tool._processor
    assert processor.examples is None
    assert processor.format.prompt_generator.generate_examples() == "### My examples"
    assert "### My examples" in processor.prompt_snippet
    # The format still reads payloads as before.
    assert isinstance(processor.parser, ExpressParser)


# endregion

# region SendA2uiJsonToClientTool Tests
"""Tests for the _SendA2uiJsonToClientTool class."""


@pytest.mark.asyncio
async def test_send_tool_takes_a_processor():
    processor = A2uiRequestProcessor([_BASIC])
    tool = _Tool(processor)
    assert tool.name == _Tool.TOOL_NAME
    assert await tool._resolve_processor(_CTX) is processor


@pytest.mark.asyncio
async def test_send_tool_takes_a_processor_provider():
    processor = A2uiRequestProcessor([_BASIC])

    async def provide(_ctx):
        return processor

    assert await _Tool(provide)._resolve_processor(_CTX) is processor
    assert await _Tool(lambda _ctx: processor)._resolve_processor(_CTX) is processor


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
async def test_process_llm_request_adds_the_express_prompt_by_default():
    tool = _tool([_BASIC], "string examples")
    generator = ExpressFormatFactory().create_format([_BASIC]).prompt_generator
    llm_request = _llm_request()

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    instructions = _appended(llm_request)
    text = "\n\n".join(instructions)
    assert generator.generate_base_rules() in text
    assert generator.generate_catalog_instructions(include_schema=True) in text
    # A string of examples is shown as the format's examples.
    assert "### Examples:\nstring examples" in instructions
    assert tool._tool_instruction() in instructions


@pytest.mark.asyncio
async def test_process_llm_request_follows_the_inference_format():
    tool = _tool([_BASIC], inference_format_factory=DirectJsonFormatFactory())
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
    turns = [to_message_models([_create(), _update({"text": "Hello"})])]
    tool = _tool([_BASIC], turns)
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
    turns = [to_message_models([_create(), _update({"text": "Hello"})])]
    processor = A2uiRequestProcessor([_BASIC], examples=turns)
    tool = _tool(processor.active_catalogs, processor.examples)
    assert tool._processor.prompt_snippet == processor.prompt_snippet
    llm_request = _llm_request(processor.prompt_snippet)

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    # Only the note on how to call the tool is new.
    assert _appended(llm_request) == [tool._tool_instruction()]


@pytest.mark.asyncio
async def test_process_llm_request_skips_examples_already_in_the_instruction():
    turns = [to_message_models([_create(), _update({"text": "Hello"})])]
    tool = _tool([_BASIC], turns)
    generator = ExpressFormatFactory().create_format([_BASIC], turns).prompt_generator
    llm_request = _llm_request(f"Role.\n\n{generator.generate_examples()}")

    await tool.process_llm_request(
        tool_context=_tool_context(), llm_request=llm_request
    )

    text = "\n\n".join(_appended(llm_request))
    assert generator.generate_examples() not in text
    assert generator.generate_catalog_instructions(include_schema=True) in text


@pytest.mark.asyncio
async def test_process_llm_request_adds_nothing_when_everything_is_present():
    tool = _tool([_BASIC])
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
    tool = _tool([_BASIC])
    tool_context = _tool_context()
    payload = [_create(), _update({"text": "Hello"})]

    result = await tool.run_async(
        args={_ARG: _express(payload)}, tool_context=tool_context
    )

    assert result == {_RESULT: payload}
    assert tool_context.actions.skip_summarization


@pytest.mark.asyncio
async def test_run_async_accepts_a_block_left_in_its_tags():
    tool = _tool([_BASIC])
    payload = [_create(), _update({"text": "Hello"})]

    result = await tool.run_async(
        args={_ARG: f"<a2ui>\n{_express(payload)}\n</a2ui>"},
        tool_context=_tool_context(),
    )

    assert result == {_RESULT: payload}


@pytest.mark.asyncio
async def test_run_async_reads_direct_json_with_its_factory():
    tool = _tool([_BASIC], inference_format_factory=DirectJsonFormatFactory())
    payload = [_create(), _update({"text": "Hello"})]

    result = await tool.run_async(
        args={_ARG: json.dumps(payload)}, tool_context=_tool_context()
    )

    assert result == {_RESULT: payload}


@pytest.mark.asyncio
async def test_run_async_validates_against_all_catalogs():
    tool = _tool([_BASIC], inference_format_factory=DirectJsonFormatFactory())
    payload = [_update({"text": "Hello"})]

    with patch(
        "a2ui.adk.send_a2ui_to_client_toolset.validate_payload"
    ) as mock_validate:
        await tool.run_async(
            args={_ARG: json.dumps(payload)}, tool_context=_tool_context()
        )

    mock_validate.assert_called_once_with([_BASIC], payload)


@pytest.mark.asyncio
async def test_run_async_without_state_accepts_an_update_to_an_earlier_surface():
    # Without a state, a surface the payload only updates may have been created
    # by an earlier call, as validate_payload assumes.
    tool = _tool([_BASIC])
    payload = [_update({"text": "Hello"})]

    result = await tool.run_async(
        args={_ARG: _express(payload)}, tool_context=_tool_context()
    )

    assert result == {_RESULT: payload}


@pytest.mark.asyncio
async def test_run_async_missing_arg():
    tool = _tool([_BASIC])
    result = await tool.run_async(args={}, tool_context=MagicMock())
    assert _Tool.TOOL_ERROR_KEY in result
    assert _ARG in result[_Tool.TOOL_ERROR_KEY]


@pytest.mark.asyncio
async def test_run_async_rejects_a_block_the_format_cannot_read():
    tool = _tool([_BASIC])
    result = await tool.run_async(
        args={_ARG: "root = Text("}, tool_context=_tool_context()
    )
    assert "Failed to call A2UI tool" in result[_Tool.TOOL_ERROR_KEY]


@pytest.mark.asyncio
async def test_run_async_rejects_invalid_direct_json():
    tool = _tool([_BASIC], inference_format_factory=DirectJsonFormatFactory())
    result = await tool.run_async(args={_ARG: "{invalid"}, tool_context=MagicMock())
    assert "Failed to call A2UI tool" in result[_Tool.TOOL_ERROR_KEY]
    assert "not JSON" in result[_Tool.TOOL_ERROR_KEY]


@pytest.mark.asyncio
async def test_run_async_rejects_a_payload_the_catalog_rejects():
    tool = _tool([_BASIC], inference_format_factory=DirectJsonFormatFactory())
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
async def test_run_async_validates_and_updates_renderer_state(factory):
    state = RendererState([_BASIC])
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=True,
        a2ui_catalogs=[_BASIC],
        inference_format_factory=factory,
        a2ui_state=state,
    )
    tool = toolset._ui_tool
    tool_context = _tool_context()

    def write(messages: list[dict[str, Any]]) -> str:
        if isinstance(factory, ExpressFormatFactory):
            return _express(messages)
        return json.dumps(messages)

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


@pytest.mark.asyncio
async def test_run_async_rejects_a_state_for_other_catalogs():
    other = RendererState([BasicCatalog("1.0")])
    tool = _tool([_BASIC], a2ui_state=other)
    result = await tool.run_async(
        args={_ARG: _express([_create(), _update({"text": "Hi"})])},
        tool_context=_tool_context(),
    )
    assert "active catalogs" in result[_Tool.TOOL_ERROR_KEY]


# endregion
