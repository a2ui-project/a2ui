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

"""End-to-end tests for archetype layout planning, expansion, and integration."""

from __future__ import annotations

import concurrent.futures
import json
import os
import statistics
import time
from typing import Any

import pytest

from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    ActionSpec,
    ArchetypeGrammar,
    BlockBindings,
    CatalogDecisionGraph,
    DecisionAnswer,
    DecisionBatch,
    DecisionFormatFactory,
    DecisionRenderTool,
    DecisionSynthesizer,
    DeterministicMockBackend,
    FallbackSource,
    MergedPatternLibrary,
    PatternExpander,
    PatternLibrary,
    SlotBinding,
    SurfaceTemplate,
    SynthesisConfig,
    SynthesisStage,
    TemplateRegistry,
    eligible_archetypes,
    inspect_payload_pointers,
)
from a2ui.parser import A2uiCompilationError, A2uiPart
from a2ui.parser.messages import to_message_dicts
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import validate_payload

from .layout_fixtures import (
    HOST,
    RESORT,
    SETTINGS,
    TRANSFER,
    ScriptedValue,
    mock_backend,
)

CATALOG = BasicCatalog("v1.0")

RESORT_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("inspect", 0.80),
    "stakes": 0.2,
    "urgency": 0.1,
    "archetype:inspect": ("detail", 0.85),
    "gate:picture": 0.90,
    "gate:banner": 0.10,
    "gate:headline": 0.80,
    "gate:prose": 0.90,
    "gate:facts": 0.40,
    "gate:collection": 0.85,
    "gate:actions": 0.30,
    "gate:media": 0.10,
    "anatomy:picture.framing": ("banner", 0.80),
    "anatomy:picture.prominence": 2.2,
    "anatomy:collection.layout": ("reel", 0.70),
    "anatomy:collection.leading": ("thumbnail", 0.80),
    "anatomy:collection.trailing": ("none", 0.80),
    "salience:/rating": 2.4,
    "salience:/priceFrom": 2.6,
}

HOST_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("monitor", 0.90),
    "stakes": 1.0,
    "urgency": 1.4,
    "archetype:monitor": ("dashboard", 0.85),
    "gate:banner": 0.80,
    "gate:headline": 0.90,
    "gate:facts": 0.80,
    "anatomy:headline.deltas": 0.85,
    "salience:/cpu": 2.8,
    "salience:/status": 2.1,
    "salience:/uptimeHours": 1.2,
    "salience:/host": 0.4,
    "instance:banner.tone:/status": ("warning", 0.90),
    "instance:headline.news:/cpu": ("bad", 0.85),
    "instance:headline.state_tone:/status": ("warning", 0.80),
}

TRANSFER_ACTIONS = (
    ActionSpec(id="send", label="Send"),
    ActionSpec(id="cancel", label="Cancel"),
)
TRANSFER_PAYLOAD = {k: v for k, v in TRANSFER.payload.items() if k != "actions"}
TRANSFER_BASE_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("act", 0.85),
    "stakes": 2.1,
    "urgency": 0.6,
    "gate:banner": 0.20,
    "gate:prose": 0.45,
    "gate:facts": 0.85,
    "gate:actions": 0.90,
    "instance:actions.primary:buttons": ("send", 0.90),
    "instance:actions.destructive:send": 0.80,
    "instance:actions.destructive:cancel": 0.10,
    "salience:/amount": 2.9,
    "salience:/recipient": 2.6,
    "salience:/fee": 1.9,
    "salience:/arrives": 1.7,
}

SETTINGS_BASE_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("input", 0.80),
    "stakes": 1.2,
    "urgency": 0.2,
    "gate:groups": 0.90,
    "gate:actions": 0.20,
    "instance:groups.row_kind:/playback/skipForward": ("value", 0.90),
    "instance:groups.row_kind:/playback/autoDownload": ("switch", 0.95),
    "instance:groups.row_kind:/playback/speed": ("value", 0.70),
    "instance:groups.row_kind:/notifications/newEpisodes": ("switch", 0.90),
    "instance:groups.row_kind:/notifications/digest": ("switch", 0.90),
    "instance:groups.row_kind:/account/signOut": ("danger", 0.90),
}


def _components(messages: Any) -> list[dict[str, Any]]:
    for d in to_message_dicts(messages):
        if "updateComponents" in d:
            return list(d["updateComponents"]["components"])
    return []


@pytest.mark.asyncio
async def test_resort_detail_with_logo_page_mark_and_photo_reel() -> None:
    """Worked example 1 (`RESORT`)."""
    synth = DecisionSynthesizer([CATALOG], mock_backend(**RESORT_SCRIPTED))
    out = await synth.synthesize(RESORT.intent, RESORT.payload)
    assert out.stage is SynthesisStage.ARCHETYPE
    assert out.layout_plan is not None
    assert out.layout_plan.archetype == "detail"
    assert list(out.layout_plan.block_ids()) == [
        "picture",
        "headline",
        "prose",
        "collection",
    ]
    validate_payload([CATALOG], out.messages)
    by_id = {c["id"]: c for c in _components(out.messages)}
    assert by_id["page_mark"]["component"] == "Image"
    assert by_id["page_mark"]["url"] == {"@path": "/logoUrl"}
    repeats = [
        c["children"]
        for c in by_id.values()
        if isinstance(c.get("children"), dict)
        and c["children"].get("path") == "/photos"
    ]
    assert len(repeats) == 1
    assert repeats[0]["componentId"].startswith("collection_")


@pytest.mark.asyncio
async def test_host_dashboard() -> None:
    """Worked example 2 (`HOST`)."""
    synth = DecisionSynthesizer([CATALOG], mock_backend(**HOST_SCRIPTED))
    out = await synth.synthesize(HOST.intent, HOST.payload)
    assert out.stage is SynthesisStage.ARCHETYPE
    assert out.layout_plan is not None
    assert out.layout_plan.archetype == "dashboard"
    assert list(out.layout_plan.block_ids()) == ["banner", "headline", "facts"]
    validate_payload([CATALOG], out.messages)


def _transfer(probability: float) -> DecisionSynthesizer:
    scripted = {**TRANSFER_BASE_SCRIPTED, "archetype:act": ("confirm", probability)}
    return DecisionSynthesizer([CATALOG], mock_backend(**scripted))


async def _run_transfer(synth: DecisionSynthesizer) -> Any:
    return await synth.synthesize(
        TRANSFER.intent,
        TRANSFER_PAYLOAD,
        actions=TRANSFER_ACTIONS,
        mutable_paths=TRANSFER.mutable_paths,
    )


@pytest.mark.asyncio
async def test_transfer_action_gate_commits_above_and_falls_back_below() -> None:
    """Worked example 3 (`TRANSFER`): the action gate refuses buttons below it."""
    low = await _run_transfer(_transfer(0.50))
    assert low.stage is SynthesisStage.ABSTAIN_FALLBACK
    assert low.fallback_source is FallbackSource.FACTS
    assert low.fallback_reason == "action_gate"
    assert all(c["component"] != "Button" for c in _components(low.messages))

    high = await _run_transfer(_transfer(0.95))
    assert high.stage is SynthesisStage.ARCHETYPE
    assert high.layout_plan is not None
    assert high.layout_plan.archetype == "confirm"
    assert "actions" in high.layout_plan.block_ids()
    validate_payload([CATALOG], high.messages)
    events = [
        c["action"]["event"]["name"]
        for c in _components(high.messages)
        if c["component"] == "Button"
    ]
    assert sorted(events) == ["cancel", "send"]


@pytest.mark.asyncio
async def test_action_gate_scales_with_conservativeness() -> None:
    scripted = {**TRANSFER_BASE_SCRIPTED, "archetype:act": ("confirm", 0.80)}

    async def stage(conservativeness: float) -> SynthesisStage:
        synth = DecisionSynthesizer(
            [CATALOG],
            mock_backend(**scripted),
            config=SynthesisConfig(conservativeness=conservativeness),
        )
        return (await _run_transfer(synth)).stage

    assert await stage(0.0) is SynthesisStage.ARCHETYPE
    assert await stage(1.0) is SynthesisStage.ABSTAIN_FALLBACK


@pytest.mark.asyncio
async def test_settings_toggles_live_and_degraded() -> None:
    """Worked example 4 (`SETTINGS`): live controls at 0.85, read-only below."""

    async def component_types(probability: float) -> set[str]:
        scripted = {
            **SETTINGS_BASE_SCRIPTED,
            "archetype:input": ("settings", probability),
        }
        out = await DecisionSynthesizer([CATALOG], mock_backend(**scripted)).synthesize(
            SETTINGS.intent, SETTINGS.payload, mutable_paths=SETTINGS.mutable_paths
        )
        assert out.stage is SynthesisStage.ARCHETYPE
        validate_payload([CATALOG], out.messages)
        return {c["component"] for c in _components(out.messages)}

    assert "CheckBox" in await component_types(0.85)
    assert "CheckBox" not in await component_types(0.75)


@pytest.mark.asyncio
async def test_template_question_picks_a_registered_template_end_to_end() -> None:
    """The real planner's template question routes to the registry."""
    registry = TemplateRegistry()
    registry.register(
        SurfaceTemplate(
            template_id="host_card",
            description="Approved host card",
            surface_id="default_surface",
            catalog_id=CATALOG.catalog_id,
            protocol_version="1.0",
            components=(
                {"id": "root", "component": "Text", "text": {"@path": "/host"}},
            ),
            required_pointers=("/host",),
        )
    )
    backend = mock_backend(**{**HOST_SCRIPTED, "template": ("host_card", 0.95)})
    synth = DecisionSynthesizer([CATALOG], backend, registry=registry)
    out = await synth.synthesize(HOST.intent, HOST.payload)
    assert out.stage is SynthesisStage.TEMPLATE_SELECT
    assert out.selected_template_id == "host_card"
    assert out.decision_calls == 1
    assert _components(out.messages) == [
        {"id": "root", "component": "Text", "text": {"@path": "/host"}}
    ]
    validate_payload([CATALOG], out.messages)

    composed = await DecisionSynthesizer(
        [CATALOG],
        mock_backend(**{**HOST_SCRIPTED, "template": ("compose", 0.95)}),
        registry=registry,
    ).synthesize(HOST.intent, HOST.payload)
    assert composed.stage is SynthesisStage.ARCHETYPE


def test_format_factory_through_request_processor_with_layout_brief() -> None:
    processor = A2uiRequestProcessor(
        catalogs=[CATALOG],
        format_factory=DecisionFormatFactory(backend=mock_backend(**RESORT_SCRIPTED)),
    )
    decision_json = json.dumps({
        "intent": RESORT.intent,
        "payload": RESORT.payload,
        "layout": ["headline:priceFrom,rating", "prose:about"],
    })
    parts = processor.parse_response(f"Resort:\n<a2ui>{decision_json}</a2ui>")
    a2ui_parts = [p for p in parts if isinstance(p, A2uiPart)]
    assert len(a2ui_parts) == 1
    validate_payload([CATALOG], a2ui_parts[0].a2ui)


def test_render_tool_run_sync_with_layout_and_trace() -> None:
    synth = DecisionSynthesizer([CATALOG], mock_backend(**RESORT_SCRIPTED))
    tool = DecisionRenderTool(synth, include_trace=True)
    assert tool.parameters_json_schema()["properties"]["layout"]["maxItems"] == 6
    out = tool.run_sync({
        "intent": RESORT.intent,
        "payload": RESORT.payload,
        "layout": ["headline:priceFrom,rating", "prose:about"],
    })
    result = tool.format_result(out)
    assert result["stage"] == "archetype"
    assert result["layoutPlan"] == {
        "archetype": "detail",
        "blocks": ["picture", "headline", "prose", "collection"],
    }
    assert result["trace"][0]["questionId"] == "family"


@pytest.mark.asyncio
async def test_one_answer_call_per_surface() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    out = await DecisionSynthesizer([CATALOG], backend).synthesize(
        HOST.intent, HOST.payload
    )
    assert out.stage is SynthesisStage.ARCHETYPE
    assert len(backend.batches) == out.decision_calls == 1


@pytest.mark.asyncio
async def test_edge_cases_empty_identifiers_60_pointers_and_bad_answers() -> None:
    synth = DecisionSynthesizer([CATALOG], mock_backend(**HOST_SCRIPTED))
    with pytest.raises(A2uiCompilationError, match="no eligible archetype"):
        await synth.synthesize("Show empty", {})

    grammar = ArchetypeGrammar.default()
    lib = MergedPatternLibrary.for_catalogs([CATALOG])
    id_ptrs = inspect_payload_pointers({
        "id": "usr_12345",
        "uuid": "550e8400-e29b-41d4-a716-446655440000",
    })
    el_ids = {a.id for a in eligible_archetypes(grammar, lib, id_ptrs)}
    assert "dashboard" not in el_ids and "feed" not in el_ids

    big_payload = {f"price_{i:02d}": float(i) for i in range(60)}
    batch, state = synth.planner.build_batch(
        "Show 60 prices", inspect_payload_pointers(big_payload), payload=big_payload
    )
    assert batch.pair_count() <= SynthesisConfig().max_pairs
    assert state.budget_exhausted is True

    class TruncatedAnswerBackend(DeterministicMockBackend):

        async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
            return (await super().answer(batch))[:-1]

    trunc = await DecisionSynthesizer(
        [CATALOG], TruncatedAnswerBackend(scripted_answers=HOST_SCRIPTED)
    ).synthesize(HOST.intent, HOST.payload)
    assert trunc.stage is SynthesisStage.ABSTAIN_FALLBACK
    assert trunc.fallback_source is FallbackSource.FACTS
    assert trunc.fallback_reason and "A2uiValidationError" in trunc.fallback_reason


@pytest.mark.asyncio
async def test_secret_keys_stay_out_of_the_facts_fallback() -> None:
    secret_payload = {
        "title": "Service Account",
        "status": "Active",
        "api_key": "sk-live-secret-12345",
        "ssn": "000-00-0000",
    }
    out = await DecisionSynthesizer(
        [CATALOG], mock_backend(**{"family": {"none": 1.0}})
    ).synthesize("Show account status", secret_payload)
    assert out.fallback_source is FallbackSource.FACTS
    dump = json.dumps(_components(out.messages))
    assert "/api_key" not in dump and "/ssn" not in dump


@pytest.mark.asyncio
async def test_required_block_wins_markdown_escape_and_multi_catalog() -> None:
    out = await DecisionSynthesizer(
        [CATALOG], mock_backend(**{**HOST_SCRIPTED, "gate:headline": 0.20})
    ).synthesize(
        HOST.intent, HOST.payload, layout=["compose:host", "facts:uptimeHours,host"]
    )
    assert out.stage is SynthesisStage.ARCHETYPE
    assert out.layout_plan is not None
    assert "headline" in out.layout_plan.block_ids()
    assert any(
        r.question.id == "gate:headline" and "required_override" in r.outcome
        for r in out.trace
    )
    assert any(
        r.question.id == "brief:compose" and "ignored_brief_block" in r.outcome
        for r in out.trace
    )

    expander = PatternExpander(
        MergedPatternLibrary.for_catalogs([CATALOG]), CatalogDecisionGraph([CATALOG])
    )
    prose = expander.expand_block(
        "prose",
        "prose",
        BlockBindings(
            slots={
                "heading": SlotBinding(literal="Section #1\nSubheading"),
                "body": SlotBinding(literal="Body text"),
            }
        ),
        knobs={"length": "blurb"},
    )
    heading = next(c for c in prose.components if "Section" in str(c.get("text", "")))
    assert "\n" not in heading["text"] and r"\#1" in heading["text"]

    secondary = Catalog.from_json({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/domain_sec/v1/catalog.json",
        "protocolVersion": "1.0",
        "components": {
            "DomainBanner": {
                "type": "object",
                "properties": {
                    "component": {"const": "DomainBanner"},
                    "title": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component", "title"],
            },
        },
    })
    basic_lib = MergedPatternLibrary.for_catalogs([CATALOG]).libraries[0]
    sec_lib = PatternLibrary.from_json({
        "grammarVersion": basic_lib.grammar_version,
        "catalogId": secondary.catalog_id,
        "patterns": {
            "banner": {
                "slots": ["title"],
                "root": "sec_banner",
                "components": [{
                    "id": "sec_banner",
                    "component": "DomainBanner",
                    "title": {"$slot": "title"},
                }],
            },
        },
    })
    merged = MergedPatternLibrary([basic_lib, sec_lib])
    assert merged.owner_catalog_id("banner") == basic_lib.catalog_id
    multi_out = await DecisionSynthesizer(
        [CATALOG, secondary], mock_backend(**HOST_SCRIPTED), patterns=merged
    ).synthesize(HOST.intent, HOST.payload)
    assert multi_out.stage is SynthesisStage.ARCHETYPE
    validate_payload([CATALOG, secondary], multi_out.messages)
    multi_comps = _components(multi_out.messages)
    assert any(c["id"].startswith("basic_") for c in multi_comps)
    assert all("@catalogId" in c for c in multi_comps)


def test_factory_compiles_from_several_threads() -> None:
    factory = DecisionFormatFactory(backend=mock_backend(**HOST_SCRIPTED))

    def compile_in_thread(idx: int) -> int:
        parser = factory.create_format([CATALOG]).create_parser()
        raw = json.dumps({
            "intent": HOST.intent,
            "payload": {**HOST.payload, "host": f"prod-{idx}"},
        })
        return len(parser.compile(f"<a2ui>{raw}</a2ui>"))

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        counts = list(pool.map(compile_in_thread, range(6)))
    assert all(c >= 2 for c in counts)


@pytest.mark.skipif(
    not os.environ.get("A2UI_DECISION_BENCH"),
    reason="Set A2UI_DECISION_BENCH=1 to run the planning and expansion benchmark.",
)
@pytest.mark.asyncio
async def test_resort_planning_and_expansion_micro_benchmark() -> None:
    backend = mock_backend(**RESORT_SCRIPTED)
    synth = DecisionSynthesizer([CATALOG], backend)
    pointers = inspect_payload_pointers(RESORT.payload)
    elig = eligible_archetypes(synth.archetypes, synth.patterns, pointers)
    samples_ms: list[float] = []
    for _ in range(25):
        start = time.perf_counter()
        batch, state = synth.planner.build_batch(
            RESORT.intent, pointers, eligible=elig, payload=RESORT.payload
        )
        outcome = synth.planner.read(state, await backend.answer(batch))
        assert outcome.plan is not None
        assert synth._expand_plan(outcome.plan).components
        samples_ms.append((time.perf_counter() - start) * 1000.0)
    assert statistics.median(samples_ms) < 10.0
