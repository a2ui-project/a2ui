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

"""Tests for the decision format, its parser's surface lifecycle, and the render tool."""

from __future__ import annotations

import json
from typing import Any

import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    DecisionAnswer,
    DecisionBackendError,
    DecisionBatch,
    DecisionBlock,
    DecisionFormat,
    DecisionFormatFactory,
    DecisionParser,
    DecisionRenderTool,
    DeterministicMockBackend,
    FallbackSource,
    SurfaceOperation,
    SynthesisStage,
)
from a2ui.parser import A2uiCompilationError, A2uiPart, TextPart
from a2ui.parser.messages import to_message_dicts
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState, validate_payload

from .layout_fixtures import HOST, ScriptedValue, mock_backend

CATALOG = BasicCatalog("v1.0")

HOST_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("monitor", 0.90),
    "stakes": 1.0,
    "urgency": 1.4,
    "archetype:monitor": ("dashboard", 0.85),
    "gate:banner": 0.80,
    "gate:headline": 0.90,
    "gate:facts": 0.80,
}

BLOCK: dict[str, Any] = {
    "intent": HOST.intent,
    "payload": dict(HOST.payload),
    "surfaceId": "s1",
}


def _format(**scripted: ScriptedValue) -> DecisionFormat:
    return DecisionFormat(
        [CATALOG], backend=mock_backend(**(scripted or HOST_SCRIPTED))
    )


def _wrapped(*blocks: dict[str, Any]) -> str:
    body = json.dumps(list(blocks) if len(blocks) > 1 else blocks[0])
    return f"Here you go.\n<a2ui>\n{body}\n</a2ui>\nDone."


def _messages(parts: list[Any]) -> list[dict[str, Any]]:
    return [
        d
        for part in parts
        if isinstance(part, A2uiPart)
        for d in to_message_dicts(part.a2ui)
    ]


def _kinds(dicts: list[dict[str, Any]]) -> list[str]:
    return [next(k for k in d if k != "version") for d in dicts]


class _FailingBackend(DeterministicMockBackend):

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        raise DecisionBackendError(
            "request timed out after 30 s", backend_kind="jev", model_id="jev-1.14.0"
        )


# --- DecisionFormat and factory ---------------------------------------------------


def test_format_requires_backend_and_v10_catalogs() -> None:
    with pytest.raises(TypeError):
        DecisionFormat([CATALOG])  # type: ignore[call-arg]
    with pytest.raises(TypeError, match="requires a decision backend"):
        DecisionFormat([CATALOG], backend=None)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="v1.0 only"):
        DecisionFormat([BasicCatalog("v0.9")], backend=mock_backend())


def test_format_ignores_message_examples_and_keeps_block_examples() -> None:
    example = DecisionBlock(intent="Show the host", payload={"host": "prod-1"})
    created = _format().create_parser().compile(json.dumps(BLOCK))
    with pytest.warns(UserWarning, match="block_examples"):
        fmt = DecisionFormat(
            [CATALOG],
            [created],
            backend=mock_backend(),
            block_examples=[example],
        )
    assert fmt.block_examples == (example,)
    assert "Decision Block Output Contract" in fmt.prompt_generator.generate()


@pytest.mark.asyncio
async def test_factory_shares_one_backend_and_closes_it() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    example = DecisionBlock(intent="Show the host", payload={"host": "prod-1"})
    factory = DecisionFormatFactory(backend=backend, block_examples=[example])
    first = factory.create_format([CATALOG])
    second = factory.create_format([CATALOG])
    assert first.synthesizer.backend is second.synthesizer.backend is backend
    assert first.synthesizer.graph is not second.synthesizer.graph
    assert first.block_examples == (example,)
    with pytest.raises(TypeError, match="requires a decision backend"):
        DecisionFormatFactory(backend=None)  # type: ignore[arg-type]
    async with factory:
        pass


def test_processor_with_decision_format_factory() -> None:
    processor = A2uiRequestProcessor(
        catalogs=[CATALOG],
        format_factory=DecisionFormatFactory(backend=mock_backend(**HOST_SCRIPTED)),
    )
    assert isinstance(processor.format, DecisionFormat)
    assert "Decision Block Output Contract" in processor.prompt_snippet
    parts = processor.parse_response(_wrapped(BLOCK))
    assert isinstance(parts[0], TextPart)
    dicts = _messages(parts)
    assert dicts[0]["createSurface"]["surfaceId"] == "s1"
    validate_payload([CATALOG], [p for p in parts if isinstance(p, A2uiPart)][0].a2ui)


# --- Parser surface lifecycle ------------------------------------------------------


def test_parser_updates_an_existing_surface_in_place_and_replaces_on_request() -> None:
    parser = _format().create_parser()
    state = RendererState([CATALOG])

    first = _messages(parser.parse_response(_wrapped(BLOCK), state=state))
    assert _kinds(first) == ["createSurface", "updateComponents", "updateDataModel"]

    same_shape = _messages(parser.parse_response(_wrapped(BLOCK), state=state))
    assert _kinds(same_shape) == ["updateDataModel"]

    changed_shape = _messages(
        parser.parse_response(
            _wrapped({**BLOCK, "payload": {**HOST.payload, "about": "Primary host"}}),
            state=state,
        )
    )
    assert _kinds(changed_shape) == ["updateComponents", "updateDataModel"]

    replaced = _messages(
        parser.parse_response(_wrapped({**BLOCK, "replace": True}), state=state)
    )
    assert _kinds(replaced)[:2] == ["deleteSurface", "createSurface"]


def test_parser_without_state_creates_every_turn() -> None:
    parser = _format().create_parser()
    for _ in range(2):
        dicts = _messages(parser.parse_response(_wrapped(BLOCK)))
        assert _kinds(dicts)[0] == "createSurface"


def test_format_keeps_one_state_per_conversation() -> None:
    fmt = _format()
    assert fmt.state_for("c1") is fmt.state_for("c1")
    assert fmt.state_for("c1") is not fmt.state_for("c2")

    turn1 = _messages(
        fmt.create_parser(conversation_id="c1").parse_response(_wrapped(BLOCK))
    )
    turn2 = _messages(
        fmt.create_parser(conversation_id="c1").parse_response(_wrapped(BLOCK))
    )
    other = _messages(
        fmt.create_parser(conversation_id="c2").parse_response(_wrapped(BLOCK))
    )
    assert _kinds(turn1)[0] == "createSurface"
    assert _kinds(turn2) == ["updateDataModel"]
    assert _kinds(other)[0] == "createSurface"


def test_parser_compiles_several_blocks_with_default_ids() -> None:
    parser = _format().create_parser()
    dicts = to_message_dicts(
        parser.compile(
            json.dumps([
                {"intent": HOST.intent, "payload": HOST.payload},
                {"intent": HOST.intent, "payload": HOST.payload},
            ])
        )
    )
    created = [d["createSurface"]["surfaceId"] for d in dicts if "createSurface" in d]
    assert created == ["main_1", "main_2"]


def test_parser_errors() -> None:
    parser = _format(**{"family": {"none": 1.0}}).create_parser()
    with pytest.raises(A2uiCompilationError, match="not valid JSON"):
        parser.compile("{nope")
    with pytest.raises(A2uiCompilationError, match="intent"):
        parser.compile(json.dumps({"payload": {}}))
    with pytest.raises(A2uiCompilationError, match="abstained"):
        parser.compile(json.dumps({"intent": "Show nothing", "payload": {}}))
    assert parser.has_format_content("<a2ui>{}</a2ui>", complete=True)
    assert not parser.has_format_content("plain text")


def test_parser_renders_the_facts_fallback_on_abstention() -> None:
    parser = _format(**{"family": {"none": 1.0}}).create_parser()
    messages = parser.compile(json.dumps(BLOCK))
    assert _kinds(to_message_dicts(messages))[0] == "createSurface"
    validate_payload([CATALOG], messages)


def test_backend_errors_become_compilation_errors() -> None:
    parser = DecisionFormat([CATALOG], backend=_FailingBackend()).create_parser()
    with pytest.raises(A2uiCompilationError, match="'jev'.*timed out") as info:
        parser.compile(json.dumps({**BLOCK, "fallbackDsl": 'root = Text("unused")'}))
    assert isinstance(info.value.__cause__, DecisionBackendError)
    with pytest.raises(A2uiCompilationError, match="timed out"):
        parser.parse_response(_wrapped(BLOCK))


@pytest.mark.asyncio
async def test_synthesize_blocks_returns_outputs() -> None:
    parser = _format().create_parser()
    assert isinstance(parser, DecisionParser)
    outputs = await parser.synthesize_blocks(json.dumps(BLOCK))
    assert len(outputs) == 1
    assert outputs[0].stage is SynthesisStage.ARCHETYPE
    assert outputs[0].backend_kind == "mock"


# --- Render tool -------------------------------------------------------------------


def test_render_tool_schema_has_actions_exclude_and_replace() -> None:
    tool = DecisionRenderTool.create([CATALOG], backend=mock_backend(**HOST_SCRIPTED))
    schema = tool.parameters_json_schema()
    props = schema["properties"]
    assert "template" not in props
    assert {"actions", "exclude", "replace"} <= set(props)
    option_schema = props["actions"]["additionalProperties"]["anyOf"][1]
    assert option_schema["properties"]["style"]["enum"] == [
        "primary",
        "secondary",
        "destructive",
    ]
    assert schema["required"] == ["intent", "payload"]


def test_render_tool_requires_a_backend() -> None:
    with pytest.raises(TypeError):
        DecisionRenderTool.create([CATALOG])  # type: ignore[call-arg]


def test_render_tool_run_sync_and_replace() -> None:
    tool = DecisionRenderTool.create([CATALOG], backend=mock_backend(**HOST_SCRIPTED))
    out = tool.run_sync({"intent": HOST.intent, "payload": json.dumps(HOST.payload)})
    assert out.stage is SynthesisStage.ARCHETYPE
    assert out.operation is SurfaceOperation.CREATE
    result = tool.format_result(out, include_trace=True)
    assert result["layoutPlan"]["archetype"] == "dashboard"
    assert result["trace"]

    replaced = tool.run_sync({**BLOCK, "replace": True})
    assert replaced.operation is SurfaceOperation.REPLACE
    assert _kinds(to_message_dicts(replaced.messages))[:2] == [
        "deleteSurface",
        "createSurface",
    ]


@pytest.mark.asyncio
async def test_render_tool_run_async_fallbacks_and_backend_errors() -> None:
    tool = DecisionRenderTool.create(
        [CATALOG], backend=mock_backend(**{"family": {"none": 1.0}})
    )
    out = await tool.run_async(BLOCK)
    assert out.fallback_source is FallbackSource.FACTS
    dsl_out = await tool.run_async({**BLOCK, "fallbackDsl": 'root = Text("Fallback")'})
    assert dsl_out.fallback_source is FallbackSource.DSL

    failing = DecisionRenderTool.create([CATALOG], backend=_FailingBackend())
    with pytest.raises(DecisionBackendError):
        await failing.run_async(BLOCK)


@pytest.mark.asyncio
async def test_render_tool_region_update_does_not_overwrite_cached_full_plan() -> None:
    tool = DecisionRenderTool.create(
        [CATALOG], backend=mock_backend(**HOST_SCRIPTED), surface_id="ops"
    )
    first = await tool.run_async({"intent": HOST.intent, "payload": dict(HOST.payload)})
    assert first.cache_hit is False
    assert any(
        c.get("id") == "root"
        for d in to_message_dicts(first.messages)
        for c in d.get("updateComponents", {}).get("components", [])
    )

    region_out = await tool.run_async({
        "intent": HOST.intent,
        "payload": dict(HOST.payload),
        "region": "headline",
    })
    assert region_out.cache_hit is False

    # Hitting the full-surface tool cache and promoting still have `root`.
    second = await tool.run_async(
        {"intent": HOST.intent, "payload": {**HOST.payload, "cpu": 0.42}}
    )
    assert second.cache_hit is True
    assert any(
        c.get("id") == "root"
        for d in to_message_dicts(second.messages)
        for c in d.get("updateComponents", {}).get("components", [])
    )

    tpl = tool.promote("ops_full_tpl", "Full host template")
    assert any(c.get("id") == "root" for c in tpl.components)


def test_decision_format_conversation_states_lru_and_clear_conversation() -> None:
    with pytest.raises(ValueError, match="max_conversations"):
        DecisionFormat(
            [CATALOG],
            backend=mock_backend(**HOST_SCRIPTED),
            max_conversations=0,
        )
    fmt = DecisionFormat(
        [CATALOG],
        backend=mock_backend(**HOST_SCRIPTED),
        max_conversations=2,
    )
    s1 = fmt.state_for("c1")
    s2 = fmt.state_for("c2")
    assert fmt.state_for("c1") is s1
    # Touching `c1` makes `c2` the oldest when `c3` is created.
    s3 = fmt.state_for("c3")
    assert fmt.state_for("c1") is s1
    assert fmt.state_for("c3") is s3
    assert fmt.state_for("c2") is not s2

    fmt.clear_conversation("c1")
    assert fmt.state_for("c1") is not s1
