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

"""Tests for the decision inference format, render tool, and synthesizer ergonomics."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from a2ui.core import Catalog
from a2ui.inference_formats import (
    DecisionFormat,
    DecisionFormatFactory,
    DecisionParser,
    DecisionPromptGenerator,
    DecisionRenderTool,
    DecisionSynthesizer,
    SynthesisConfig,
    SynthesisStage,
    TemplateRegistry,
)
from a2ui.inference_formats.decision import (
    CatalogDecisionGraph,
    DecisionBackendType,
    DecisionBlock,
    DecisionQuery,
    DecisionTask,
    DecisionWireFormat,
    DeterministicMockBackend,
    FallbackSource,
    JevHttpBackend,
    StepZeroLogprobBackend,
    SurfaceTemplate,
    coerce_decision_payload,
    create_decision_backend,
    decision_block_from_messages,
)
from a2ui.parser import A2uiCompilationError, A2uiPart, TextPart
from a2ui.parser.messages import to_message_dicts
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import validate_payload

CATALOG_ID = "https://example.com/catalogs/ops/v1/catalog.json"


def _make_catalog() -> Catalog:
    """A small v1.0 catalog with a leaf, an action leaf, and a container."""
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": CATALOG_ID,
        "protocolVersion": "1.0",
        "components": {
            "TelemetryBadge": {
                "type": "object",
                "description": "Read-only telemetry badge.",
                "properties": {
                    "component": {"const": "TelemetryBadge"},
                    "serviceName": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "latencyMs": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                },
                "required": ["component", "serviceName", "latencyMs"],
            },
            "ActionableControl": {
                "type": "object",
                "description": "Mutable control leaf with an action.",
                "properties": {
                    "component": {"const": "ActionableControl"},
                    "targetHost": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "onExecute": {"$ref": "common_types.json#/$defs/Action"},
                },
                "required": ["component", "targetHost", "onExecute"],
            },
            "AlertFrame": {
                "type": "object",
                "description": "Container wrapping a single child component.",
                "properties": {
                    "component": {"const": "AlertFrame"},
                    "innerWidget": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "innerWidget"],
            },
        },
        "functions": {},
    }
    return Catalog.from_json(schema)


def _confident_backend() -> DeterministicMockBackend:
    return DeterministicMockBackend(
        scripted={
            "template_select": {"badge_tpl": 0.95},
        }
    )


def _abstaining_backend() -> DeterministicMockBackend:
    return DeterministicMockBackend(scripted={"template_select": {"badge_tpl": 0.2}})


def _badge_template(surface_id: str = "default_surface") -> SurfaceTemplate:
    return SurfaceTemplate(
        template_id="badge_tpl",
        description="Pre-approved telemetry badge",
        surface_id=surface_id,
        catalog_id=CATALOG_ID,
        protocol_version="v1.0",
        components=(
            {
                "id": "root",
                "component": "TelemetryBadge",
                "serviceName": {"@path": "/serviceName"},
                "latencyMs": {"@path": "/latencyMs"},
            },
        ),
        required_pointers=("/serviceName", "/latencyMs"),
    )


PAYLOAD = {"serviceName": "checkout", "latencyMs": 42}
BLOCK = {"intent": "Show service telemetry", "payload": PAYLOAD, "surfaceId": "s1"}


# --------------------------------------------------------------------------
# Enums and payload coercion
# --------------------------------------------------------------------------


def test_wire_enums_format_as_their_values() -> None:
    assert DecisionTask.FAMILY == "family"
    assert f"{DecisionTask.FAMILY}:x" == "family:x"
    assert str(DecisionWireFormat.SYSTEMONE) == "systemone"
    assert DecisionBackendType.STEP_ZERO.value == "step0"
    # Scripted mock lookups built with f-strings keep matching enum tasks.
    backend = DeterministicMockBackend(scripted={"family:p": {"A": 1.0}})
    dist = asyncio.run(
        backend.predict(
            DecisionQuery(task=DecisionTask.FAMILY, prompt="p", candidates=("A", "B"))
        )
    )
    assert dist.probabilities["A"] == pytest.approx(1.0)


def test_coerce_decision_payload() -> None:
    assert coerce_decision_payload(PAYLOAD) is PAYLOAD
    assert coerce_decision_payload(json.dumps(PAYLOAD)) == PAYLOAD
    assert coerce_decision_payload("[1, 2]") == [1, 2]
    with pytest.raises(ValueError, match="not valid JSON"):
        coerce_decision_payload("{not json")
    with pytest.raises(TypeError, match="JSON string"):
        coerce_decision_payload('"just a string"')
    with pytest.raises(TypeError):
        coerce_decision_payload(42)  # type: ignore[arg-type]


def test_create_decision_backend_accepts_enum_and_rejects_unknown() -> None:
    assert isinstance(
        create_decision_backend(DecisionBackendType.MOCK), DeterministicMockBackend
    )
    backend = create_decision_backend(
        DecisionBackendType.SYSTEMONE, endpoint_url="http://h/v1/systemone"
    )
    assert isinstance(backend, JevHttpBackend)
    with pytest.raises(ValueError, match="Unknown decision backend type") as info:
        create_decision_backend("nope")
    assert "'jev'" in str(info.value)
    with pytest.raises(ValueError, match="requires an endpoint URL"):
        create_decision_backend("jev")


@pytest.mark.asyncio
async def test_wire_format_auto_detects_systemone() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"answers": {"q": {"answer": "A"}}})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        for wire in ("auto", DecisionWireFormat.AUTO):
            backend = JevHttpBackend(
                "http://h/v1/systemone", wire_format=wire, client=client
            )
            await backend.predict(
                DecisionQuery(task="t", prompt="p", candidates=("A",))
            )
    assert len(seen) == 2
    assert all("questions" in req for req in seen)


# --------------------------------------------------------------------------
# Backend lifecycle
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_http_backends_support_async_with_and_per_loop_clients() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"probabilities": {"A": 1.0}})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        async with JevHttpBackend("http://local/predict", client=client) as backend:
            dist = await backend.predict(
                DecisionQuery(task="t", prompt="p", candidates=("A",))
            )
            assert dist.probabilities == {"A": 1.0}
        async with StepZeroLogprobBackend("http://local/v1/completions", "m") as step:
            assert step._owned_client is None
    assert calls == 1

    # An owned client is created per loop and closed by aclose / __aexit__.
    owned = JevHttpBackend("http://local/predict")
    async with owned:
        first = owned._get_client()
        assert owned._get_client() is first
    assert owned._owned_client is None

    def on_other_loop() -> bool:
        async def body() -> bool:
            second = owned._get_client()
            await owned.aclose()
            return second is not first

        return asyncio.run(body())

    assert await asyncio.to_thread(on_other_loop)
    await first.aclose()


@pytest.mark.asyncio
async def test_mock_backend_supports_async_with() -> None:
    async with DeterministicMockBackend() as backend:
        dist = await backend.predict(
            DecisionQuery(task="t", prompt="p", candidates=("A", "B"))
        )
        assert set(dist.probabilities) == {"A", "B"}


# --------------------------------------------------------------------------
# Synthesizer ergonomics
# --------------------------------------------------------------------------


def test_synthesizer_constructor_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("A2UI_DECISION_BACKEND", "mock")
    catalog = _make_catalog()
    synth = DecisionSynthesizer([catalog])
    assert isinstance(synth.backend, DeterministicMockBackend)

    graph = CatalogDecisionGraph([catalog])
    from_graph = DecisionSynthesizer(graph, _confident_backend())
    assert from_graph.graph is graph

    via_env = DecisionSynthesizer.from_env(graph)
    assert via_env.graph is graph
    assert isinstance(via_env.backend, DeterministicMockBackend)


def test_synthesize_sync_without_and_within_running_loop() -> None:
    catalog = _make_catalog()
    registry = TemplateRegistry()
    registry.register(_badge_template())
    synth = DecisionSynthesizer([catalog], _confident_backend(), registry=registry)

    out = synth.synthesize_sync("Show telemetry", PAYLOAD, surface_id="s1")
    assert out.stage == SynthesisStage.TEMPLATE_SELECT
    validate_payload([catalog], out.messages)

    async def inside_loop() -> SynthesisStage:
        return synth.synthesize_sync("Show telemetry", PAYLOAD).stage

    assert asyncio.run(inside_loop()) == SynthesisStage.TEMPLATE_SELECT


@pytest.mark.asyncio
async def test_synthesize_accepts_json_string_and_array_payloads() -> None:
    catalog = _make_catalog()
    synth = DecisionSynthesizer([catalog], _confident_backend(), fallback_card=True)

    out = await synth.synthesize("Show telemetry", json.dumps(PAYLOAD))
    data = [d for d in to_message_dicts(out.messages) if "updateDataModel" in d]
    assert data[0]["updateDataModel"]["value"] == PAYLOAD

    arr = await synth.synthesize(
        "Show telemetry", [{"serviceName": "a", "latencyMs": 1}]
    )
    data = [d for d in to_message_dicts(arr.messages) if "updateDataModel" in d]
    assert data[0]["updateDataModel"]["value"] == {
        "items": [{"serviceName": "a", "latencyMs": 1}]
    }

    with pytest.raises(ValueError, match="not valid JSON"):
        await synth.synthesize("x", "{bad")
    with pytest.raises(TypeError, match="JSON string"):
        await synth.synthesize("x", '"scalar"')


@pytest.mark.asyncio
async def test_synthesize_explicit_template_id() -> None:
    catalog = _make_catalog()
    registry = TemplateRegistry()
    registry.register(_badge_template())
    synth = DecisionSynthesizer([catalog], _abstaining_backend(), registry=registry)

    out = await synth.synthesize(
        "anything", PAYLOAD, template_id="badge_tpl", surface_id="s9"
    )
    assert out.stage == SynthesisStage.TEMPLATE_SELECT
    assert out.selected_template_id == "badge_tpl"
    assert out.confidence == 1.0
    assert to_message_dicts(out.messages)[0]["createSurface"]["surfaceId"] == "s9"

    with pytest.raises(ValueError, match="Unknown template 'missing'"):
        await synth.synthesize("anything", PAYLOAD, template_id="missing")


@pytest.mark.asyncio
async def test_abstention_without_fallback_is_unchanged() -> None:
    catalog = _make_catalog()
    synth = DecisionSynthesizer([catalog], _abstaining_backend())
    out = await synth.synthesize("low confidence", PAYLOAD)
    assert out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert out.messages == []
    assert out.fallback_source is None


@pytest.mark.asyncio
async def test_abstention_fallback_dsl_compiles_and_adds_data_model() -> None:
    catalog = _make_catalog()
    synth = DecisionSynthesizer([catalog], _abstaining_backend())
    out = await synth.synthesize(
        "low confidence",
        PAYLOAD,
        surface_id="s1",
        fallback_dsl="root = TelemetryBadge($/serviceName, $/latencyMs)",
    )
    assert out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert out.fallback_source is FallbackSource.DSL
    assert out.fallback_source == "fallback_dsl"
    dicts = to_message_dicts(out.messages)
    assert dicts[0]["createSurface"]["surfaceId"] == "s1"
    assert any("updateDataModel" in d for d in dicts)
    validate_payload([catalog], out.messages)


@pytest.mark.asyncio
async def test_abstention_fallback_fn_sync_and_async() -> None:
    catalog = _make_catalog()
    template = _badge_template()
    seen: list[tuple[str, str]] = []

    def sync_fn(intent: str, payload: Any, surface_id: str) -> Any:
        seen.append((intent, surface_id))
        return template.render_messages(payload, surface_id=surface_id)

    async def async_fn(intent: str, payload: Any, surface_id: str) -> Any:
        return sync_fn(intent, payload, surface_id)

    def dict_fn(intent: str, payload: Any, surface_id: str) -> Any:
        # Wire-format dicts are accepted too; to_message_models validates them.
        return to_message_dicts(sync_fn(intent, payload, surface_id))

    for fn in (sync_fn, async_fn, dict_fn):
        synth = DecisionSynthesizer([catalog], _abstaining_backend(), fallback_fn=fn)
        out = await synth.synthesize("low", PAYLOAD, surface_id="s2")
        assert out.fallback_source is FallbackSource.CALLBACK
        assert out.messages
    assert seen == [("low", "s2")] * 3


def test_format_factory_shares_one_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    from a2ui.inference_formats.decision import BatchingDecisionBackend

    monkeypatch.setenv("A2UI_DECISION_BACKEND", "mock")
    catalog = _make_catalog()

    lazy = DecisionFormatFactory()
    assert lazy.backend is None
    first = lazy.create_format([catalog])
    second = lazy.create_format([catalog])
    assert first.synthesizer.backend is second.synthesizer.backend is lazy.backend
    assert isinstance(lazy.backend, BatchingDecisionBackend)
    assert isinstance(lazy.backend.inner, DeterministicMockBackend)
    # The catalog graph is still per format.
    assert first.synthesizer.graph is not second.synthesizer.graph

    explicit_backend = _confident_backend()
    explicit = DecisionFormatFactory(backend=explicit_backend)
    explicit_fmt = explicit.create_format([catalog])
    assert isinstance(explicit_fmt.synthesizer.backend, BatchingDecisionBackend)
    assert explicit_fmt.synthesizer.backend.inner is explicit_backend

    unbatched = DecisionFormatFactory(backend=explicit_backend, batch_backend=False)
    assert unbatched.create_format([catalog]).synthesizer.backend is explicit_backend


@pytest.mark.asyncio
async def test_abstention_fallback_card_is_deterministic_and_actionless() -> None:
    catalog = _make_catalog()
    synth = DecisionSynthesizer([catalog], _abstaining_backend(), fallback_card=True)
    first = await synth.synthesize("low confidence", PAYLOAD, surface_id="s3")
    second = await synth.synthesize("low confidence", PAYLOAD, surface_id="s3")
    assert first.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert first.fallback_source is FallbackSource.CARD
    assert to_message_dicts(first.messages) == to_message_dicts(second.messages)
    components = next(
        d["updateComponents"]["components"]
        for d in to_message_dicts(first.messages)
        if "updateComponents" in d
    )
    assert components[0]["component"] == "AlertFrame"
    assert all(c["component"] != "ActionableControl" for c in components)
    validate_payload([catalog], first.messages)


# --------------------------------------------------------------------------
# Templates with v1.0 envelopes
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_promote_synthesized_accepts_v10_single_envelope() -> None:
    catalog = _make_catalog()
    reg_in = TemplateRegistry()
    reg_in.register(_badge_template())
    synth = DecisionSynthesizer([catalog], _confident_backend(), registry=reg_in)
    out = await synth.synthesize("Show telemetry", PAYLOAD, surface_id="s1")
    dicts = to_message_dicts(out.messages)
    components = next(d for d in dicts if "updateComponents" in d)["updateComponents"][
        "components"
    ]
    single = [{
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": CATALOG_ID,
            "components": components,
        },
    }]
    from a2ui.parser.messages import to_message_models

    single_output = type(out)(
        stage=out.stage,
        messages=to_message_models(single),
        confidence=out.confidence,
        entropy=out.entropy,
    )
    registry = TemplateRegistry()
    template = registry.promote_synthesized("from_v10", "desc", single_output)
    assert template.surface_id == "s1"
    assert template.catalog_id == CATALOG_ID
    assert template.root_component() == "TelemetryBadge"
    validate_payload([catalog], template.render_messages(PAYLOAD))

    with pytest.raises(ValueError, match="must define components"):
        registry.promote_synthesized(
            "empty",
            "desc",
            type(out)(stage=out.stage, messages=[], confidence=0.0, entropy=0.0),
        )


# --------------------------------------------------------------------------
# Decision block, prompt generator, parser, and format
# --------------------------------------------------------------------------


def test_decision_block_round_trip_and_aliases() -> None:
    block = DecisionBlock.from_mapping({
        "intent": " Show it ",
        "data": json.dumps(PAYLOAD),
        "surface_id": "s1",
        "templateId": "badge_tpl",
        "fallback_dsl": "",
    })
    assert block.intent == "Show it"
    assert block.payload == PAYLOAD
    assert block.surface_id == "s1"
    assert block.template_id == "badge_tpl"
    assert block.fallback_dsl is None
    assert block.layout == ()
    assert block.to_json() == {
        "intent": "Show it",
        "payload": PAYLOAD,
        "surfaceId": "s1",
        "template": "badge_tpl",
    }
    with pytest.raises(ValueError, match="intent"):
        DecisionBlock.from_mapping({"payload": {}})
    with pytest.raises(TypeError, match="payload"):
        DecisionBlock.from_mapping({"intent": "x"})
    with pytest.raises(TypeError, match="surfaceId"):
        DecisionBlock.from_mapping({"intent": "x", "payload": {}, "surfaceId": 3})


def test_decision_block_layout_carries_raw_items_and_synthesizer_validates() -> None:
    from a2ui.inference_formats.decision.models import LayoutBrief, MAX_BRIEF_SECTIONS

    with_layout = DecisionBlock.from_mapping({
        "intent": "Show resort",
        "payload": PAYLOAD,
        "layout": ["picture:name,logoUrl", "collection:/photos", "facts:address"],
    })
    # The block carries the items verbatim; it does not know the grammar.
    assert with_layout.layout == (
        "picture:name,logoUrl",
        "collection:/photos",
        "facts:address",
    )
    assert with_layout.to_json()["layout"] == list(with_layout.layout)

    # A pre-parsed brief is accepted and serialized back to items.
    brief = LayoutBrief.parse(["picture:name"], roles=frozenset({"picture"}))
    assert DecisionBlock.from_mapping(
        {"intent": "x", "payload": PAYLOAD, "layout": brief}
    ).layout == ("picture:/name",)

    # Empty or blank layout arrays normalize to no items and are omitted on output.
    empty = DecisionBlock.from_mapping(
        {"intent": "Show resort", "payload": PAYLOAD, "layout": ["", "  "]}
    )
    assert empty.layout == ()
    assert "layout" not in empty.to_json()

    # Shape errors are the block's job: non-array or non-string items.
    with pytest.raises(TypeError, match="layout"):
        DecisionBlock.from_mapping(
            {"intent": "Show resort", "payload": PAYLOAD, "layout": "picture:name"}
        )
    with pytest.raises(TypeError, match="layout"):
        DecisionBlock.from_mapping(
            {"intent": "Show resort", "payload": PAYLOAD, "layout": [123]}
        )

    # Role and structure validation happens against the synthesizer's grammar.
    catalog = _make_catalog()
    synth = DecisionSynthesizer([catalog], _confident_backend())
    roles = list(synth.archetypes.brief_roles())
    too_many = [f"{roles[i]}:k{i}" for i in range(MAX_BRIEF_SECTIONS + 1)]
    with pytest.raises(ValueError, match=str(MAX_BRIEF_SECTIONS)):
        synth.synthesize_sync("Show resort", PAYLOAD, layout=too_many)
    for invalid_item in ("picture:name:sub", "sparkles:name", "name,logoUrl"):
        with pytest.raises(ValueError):
            synth.synthesize_sync("Show resort", PAYLOAD, layout=[invalid_item])


def test_custom_grammar_roles_flow_through_prompt_parser_and_synthesizer() -> None:
    """A grammar with an extra block id is honored end to end (no default-grammar leak)."""
    import copy

    from a2ui.inference_formats.decision.archetypes import ArchetypeGrammar, load_asset

    raw = copy.deepcopy(load_asset("archetypes.json"))
    gallery = copy.deepcopy(next(b for b in raw["blocks"] if b["id"] == "picture"))
    gallery["id"] = "gallery"
    raw["blocks"].append(gallery)
    custom = ArchetypeGrammar.from_json(raw)
    assert "gallery" in custom.brief_roles()

    catalog = _make_catalog()
    fmt = DecisionFormat(
        [catalog], backend=_confident_backend(), archetypes=custom, surface_id="s"
    )
    assert "`gallery`" in fmt.prompt_generator.generate_base_rules()
    assert "`gallery`" not in DecisionPromptGenerator([catalog]).generate_base_rules()

    block_json = json.dumps(
        {"intent": "Show", "payload": PAYLOAD, "layout": ["gallery:serviceName"]}
    )
    # The parser forwards the raw items; the custom grammar accepts the role.
    messages = fmt.parser.compile(block_json)
    assert messages


def test_prompt_generator_lists_components_and_templates() -> None:
    from a2ui.inference_formats.decision.archetypes import ArchetypeGrammar

    catalog = _make_catalog()
    registry = TemplateRegistry()
    registry.register(_badge_template())
    gen = DecisionPromptGenerator([catalog], registry=registry)
    prompt = gen.generate()
    assert "<a2ui>" in prompt and "intent" in prompt and "payload" in prompt
    assert "`layout`" in prompt
    for role in ArchetypeGrammar.default().brief_roles():
        assert f"`{role}`" in prompt
    assert "- TelemetryBadge" in prompt
    assert "`badge_tpl`: Pre-approved telemetry badge" in prompt
    assert gen.generate_catalog_instructions(include_schema=False) == ""
    assert gen.generate_examples() == ""


def test_processor_with_decision_format_factory() -> None:
    catalog = _make_catalog()
    processor = A2uiRequestProcessor(
        catalogs=[catalog],
        format_factory=DecisionFormatFactory(backend=_confident_backend()),
    )
    assert isinstance(processor.format, DecisionFormat)
    prompt = processor.prompt_snippet
    assert "Decision Block Output Contract" in prompt

    response = f"Here you go.\n<a2ui>\n{json.dumps(BLOCK)}\n</a2ui>\nDone."
    parts = processor.parse_response(response)
    assert isinstance(parts[0], TextPart)
    a2ui_parts = [p for p in parts if isinstance(p, A2uiPart)]
    assert len(a2ui_parts) == 1
    dicts = to_message_dicts(a2ui_parts[0].a2ui)
    assert dicts[0]["createSurface"]["surfaceId"] == "s1"
    validate_payload([catalog], a2ui_parts[0].a2ui)

    # Unwrapped compilation and lossy decompilation.
    parser = processor.format.create_parser()
    assert isinstance(parser, DecisionParser)
    messages = parser.compile(json.dumps(BLOCK))
    back = parser.decompile(messages)
    assert back.startswith("<a2ui>") and back.endswith("</a2ui>")
    recovered = json.loads(back[len("<a2ui>") : -len("</a2ui>")])
    assert recovered == {
        "intent": "Render s1",
        "payload": PAYLOAD,
        "surfaceId": "s1",
    }
    assert decision_block_from_messages(messages).surface_id == "s1"
    # Decompiled output can be parsed and compiled back without error (H3).
    round_trip_parts = processor.parse_response(back)
    assert any(isinstance(p, A2uiPart) for p in round_trip_parts)


def test_decision_parser_errors() -> None:
    catalog = _make_catalog()
    strict = DecisionFormat(
        [catalog], backend=_abstaining_backend(), fallback_card=False
    ).create_parser()
    with pytest.raises(A2uiCompilationError, match="abstained"):
        strict.compile(json.dumps(BLOCK))
    with pytest.raises(A2uiCompilationError, match="not valid JSON"):
        strict.compile("{nope")
    with pytest.raises(A2uiCompilationError, match="intent"):
        strict.compile(json.dumps({"payload": {}}))
    with pytest.raises(A2uiCompilationError, match="Unknown template"):
        strict.compile(json.dumps({**BLOCK, "template": "missing"}))

    # The format default renders a card instead of failing on abstention.
    lenient = DecisionFormat([catalog], backend=_abstaining_backend()).create_parser()
    assert lenient.compile(json.dumps(BLOCK))
    assert lenient.has_format_content("<a2ui>{}</a2ui>", complete=True)
    assert not lenient.has_format_content("plain text")

    # A list of blocks renders every surface, and omits duplicate createSurface
    # when surfaceId is omitted or reused (H4).
    two = lenient.compile(json.dumps([BLOCK, {**BLOCK, "surfaceId": "s2"}]))
    ids = {
        d["createSurface"]["surfaceId"]
        for d in to_message_dicts(two)
        if "createSurface" in d
    }
    assert ids == {"s1", "s2"}
    validate_payload([catalog], two)

    unnamed_pair = lenient.compile(
        json.dumps([
            {"intent": "First", "payload": PAYLOAD},
            {"intent": "Second", "payload": PAYLOAD},
        ])
    )
    unnamed_ids = [
        d["createSurface"]["surfaceId"]
        for d in to_message_dicts(unnamed_pair)
        if "createSurface" in d
    ]
    assert unnamed_ids == ["main_1", "main_2"]
    validate_payload([catalog], unnamed_pair)

    replaced = lenient.compile(
        json.dumps([
            {"intent": "First", "payload": PAYLOAD, "surfaceId": "s1"},
            {
                "intent": "Second",
                "payload": {"serviceName": "auth", "latencyMs": 9},
                "surfaceId": "s1",
            },
        ])
    )
    create_count = sum(1 for d in to_message_dicts(replaced) if "createSurface" in d)
    assert create_count == 1
    validate_payload([catalog], replaced)


@pytest.mark.asyncio
async def test_prompt_generator_validates_examples_and_factory_aclose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies H3 (example validation on generate), Q1 (factory aclose), M2 (protocol aclose), and H1 (synthesize_sync client cleanup)."""
    from a2ui.core import A2uiValidationError
    from a2ui.inference_formats.decision import DecisionBackend
    from a2ui.parser.messages import to_message_models

    assert hasattr(DecisionBackend, "aclose")
    assert hasattr(DecisionBackend, "__aenter__")
    assert hasattr(DecisionBackend, "__aexit__")

    catalog = _make_catalog()
    bad_example = to_message_models([
        {
            "version": "v1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": CATALOG_ID},
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "UnknownWidget"}],
            },
        },
    ])
    gen_bad = DecisionPromptGenerator([catalog], examples=[bad_example])
    with pytest.raises(A2uiValidationError):
        gen_bad.generate()

    valid_example = _badge_template("s1").render_messages(PAYLOAD)
    gen_ok = DecisionPromptGenerator([catalog], examples=[valid_example])
    prompt_text = gen_ok.generate()
    assert '"intent": "Render s1"' in prompt_text

    # DecisionFormatFactory supports async with and aclose() (Q1).
    monkeypatch.setenv("A2UI_DECISION_BACKEND", "mock")
    async with DecisionFormatFactory() as factory:
        fmt = factory.create_format([catalog])
        assert fmt.synthesizer.backend is factory.backend

    # H1: synthesize_sync closes temporary loop clients on JevHttpBackend.
    created_clients: list[httpx.AsyncClient] = []
    real_async_client = httpx.AsyncClient

    def tracking_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        transport = httpx.MockTransport(
            lambda req: httpx.Response(200, json={"probabilities": {"badge_tpl": 0.95}})
        )
        c = real_async_client(*args, transport=transport, **kwargs)
        created_clients.append(c)
        return c

    monkeypatch.setattr(httpx, "AsyncClient", tracking_client)
    http_backend = JevHttpBackend("http://local/predict")
    reg_http = TemplateRegistry()
    reg_http.register(_badge_template())
    synth = DecisionSynthesizer([catalog], http_backend, registry=reg_http)
    synth.synthesize_sync("Show telemetry", PAYLOAD)
    synth.synthesize_sync("Show telemetry", PAYLOAD)
    assert len(created_clients) == 2
    assert all(c.is_closed for c in created_clients)


def test_decision_format_shares_synthesizer_and_default_surface() -> None:
    catalog = _make_catalog()
    fmt = DecisionFormat([catalog], backend=_confident_backend(), surface_id="pane")
    assert fmt.create_parser().synthesizer is fmt.synthesizer
    assert fmt.catalogs == [catalog] and fmt.examples is None
    messages = fmt.parser.compile(json.dumps({"intent": "Show", "payload": PAYLOAD}))
    assert to_message_dicts(messages)[0]["createSurface"]["surfaceId"] == "pane"


# --------------------------------------------------------------------------
# Render tool
# --------------------------------------------------------------------------


def test_render_tool_schema_and_run_sync() -> None:
    catalog = _make_catalog()
    registry = TemplateRegistry()
    registry.register(_badge_template())
    tool = DecisionRenderTool.create(
        [catalog], backend=_confident_backend(), registry=registry
    )
    schema = tool.parameters_json_schema()
    assert schema["required"] == ["intent", "payload"]
    assert schema["properties"]["template"]["enum"] == ["badge_tpl"]
    assert {"type": "string"} in schema["properties"]["payload"]["anyOf"]
    assert "`items`" in schema["properties"]["payload"]["description"]
    assert tool.name == "render_a2ui_decision"

    out = tool.run_sync({"intent": "Show telemetry", "payload": json.dumps(PAYLOAD)})
    # The only registered template matches the payload, so Stage 1 wins.
    assert out.stage == SynthesisStage.TEMPLATE_SELECT
    assert out.selected_template_id == "badge_tpl"
    assert (
        to_message_dicts(out.messages)[0]["createSurface"]["surfaceId"]
        == SynthesisConfig().default_surface_id
    )

    templated = tool.run_sync(
        {"intent": "x", "payload": PAYLOAD, "template": "badge_tpl", "surfaceId": "t"}
    )
    assert templated.selected_template_id == "badge_tpl"
    assert to_message_dicts(templated.messages)[0]["createSurface"]["surfaceId"] == "t"


@pytest.mark.asyncio
async def test_render_tool_run_async_fallbacks() -> None:
    catalog = _make_catalog()
    tool = DecisionRenderTool.create(
        [catalog], backend=_abstaining_backend(), surface_id="main"
    )
    card = await tool.run_async({"intent": "low", "payload": PAYLOAD})
    assert card.fallback_source is FallbackSource.CARD
    assert to_message_dicts(card.messages)[0]["createSurface"]["surfaceId"] == "main"

    dsl = await tool.run_async({
        "intent": "low",
        "payload": PAYLOAD,
        "fallbackDsl": "root = TelemetryBadge($/serviceName, $/latencyMs)",
    })
    assert dsl.fallback_source is FallbackSource.DSL

    with pytest.raises(ValueError, match="intent"):
        await tool.run_async({"payload": PAYLOAD})

    # L1 + M2: schema pattern accepts `~` tokens and tool accepts pre-parsed LayoutBrief
    from a2ui.inference_formats.decision.models import LayoutBrief

    schema = tool.parameters_json_schema()
    layout_pattern = schema["properties"]["layout"]["items"]["pattern"]
    import re

    assert re.match(layout_pattern, "prose:/foo~1bar") is not None
    brief_res = await tool.run_async({
        "intent": "low",
        "payload": PAYLOAD,
        "layout": LayoutBrief.parse(["prose:/foo~1bar"], roles=frozenset({"prose"})),
    })
    assert brief_res.fallback_source is FallbackSource.CARD

    # DecisionBlock mutablePaths / mutable_paths parsing and tool schema
    assert "mutablePaths" in schema["properties"]
    mut_block = DecisionBlock.from_mapping({
        "intent": "Sign in",
        "payload": {"email": "alex@example.com", "password": ""},
        "mutablePaths": ["email", "/password"],
    })
    assert mut_block.mutable_paths == ("/email", "/password")
    assert mut_block.to_json()["mutablePaths"] == ["/email", "/password"]
    with pytest.raises(TypeError, match="mutablePaths"):
        DecisionBlock.from_mapping({
            "intent": "Sign in",
            "payload": {"email": "a"},
            "mutablePaths": "/email",
        })
