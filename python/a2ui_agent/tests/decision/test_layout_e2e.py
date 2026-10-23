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

import asyncio
import copy
import json
import os
import statistics
import time
from typing import Any

from a2ui.core import A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    ArchetypeGrammar,
    BatchingDecisionBackend,
    BlockBindings,
    CatalogDecisionGraph,
    DecisionAnswer,
    DecisionBatch,
    DecisionDistribution,
    DecisionFormatFactory,
    DecisionQuery,
    DecisionRenderTool,
    DecisionSynthesizer,
    DeterministicMockBackend,
    FallbackSource,
    MergedPatternLibrary,
    PatternExpander,
    PatternLibrary,
    SlotBinding,
    SynthesisConfig,
    SynthesisStage,
    eligible_archetypes,
    inspect_payload_pointers,
)
from a2ui.parser import A2uiPart
from a2ui.parser.messages import to_message_dicts
from a2ui.processor import A2uiRequestProcessor, CatalogConfig
from a2ui.utils import validate_payload
import httpx
import pytest

from .layout_fixtures import (
    HOST,
    RESORT,
    ScriptedAnswers,
    ScriptedValue,
    SETTINGS,
    TRANSFER,
)

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

TRANSFER_BASE_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("act", 0.85),
    "stakes": 2.1,
    "urgency": 0.6,
    "gate:banner": 0.20,
    "gate:prose": 0.45,
    "gate:facts": 0.85,
    "gate:actions": 0.90,
    "instance:actions.primary:/actions": ("Send", 0.90),
    "instance:actions.destructive:0": 0.80,
    "instance:actions.destructive:1": 0.10,
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


def _extract_components(messages: Any) -> list[dict[str, Any]]:
    """Returns the `updateComponents.components` list from `messages`."""
    for d in to_message_dicts(messages):
        if "updateComponents" in d:
            return list(d["updateComponents"]["components"])
    return []


@pytest.mark.parametrize("version", ["v0.9", "v1.0"])
@pytest.mark.asyncio
async def test_resort_e2e_v09_and_v10_and_logo_page_mark(version: str) -> None:
    """Worked example 1 (`RESORT`): validates v0.9/v1.0 messages, logo page_mark, and $repeat."""
    catalog = BasicCatalog(version)
    sa = ScriptedAnswers(answers=RESORT_SCRIPTED)
    synth = DecisionSynthesizer([catalog], sa.backend())

    out = await synth.synthesize(RESORT.intent, RESORT.payload)
    assert out.stage == SynthesisStage.ARCHETYPE
    assert out.layout_plan is not None
    assert out.layout_plan.archetype == "detail"
    assert list(out.layout_plan.block_ids()) == [
        "picture",
        "headline",
        "prose",
        "collection",
    ]
    validate_payload([catalog], out.messages)

    components = _extract_components(out.messages)
    by_id = {c["id"]: c for c in components}
    assert "page_mark" in by_id
    assert by_id["page_mark"]["component"] == "Image"

    reel_comp = by_id["collection_reel"]
    assert reel_comp["children"] == {
        "path": "/photos",
        "componentId": "collection_item",
    }
    if version == "v0.9":
        assert by_id["page_mark"]["url"] == {"path": "/logoUrl"}
    else:
        assert by_id["page_mark"]["url"] == {"@path": "/logoUrl"}


@pytest.mark.parametrize("version", ["v0.9", "v1.0"])
@pytest.mark.asyncio
async def test_host_dashboard_e2e_v09_and_v10(version: str) -> None:
    """Worked example 2 (`HOST`): `monitor -> dashboard` validates on v0.9 and v1.0."""
    catalog = BasicCatalog(version)
    sa = ScriptedAnswers(answers=HOST_SCRIPTED)
    synth = DecisionSynthesizer([catalog], sa.backend())

    out = await synth.synthesize(HOST.intent, HOST.payload)
    assert out.stage == SynthesisStage.ARCHETYPE
    assert out.layout_plan is not None
    assert out.layout_plan.archetype == "dashboard"
    assert list(out.layout_plan.block_ids()) == ["banner", "headline", "facts"]
    validate_payload([catalog], out.messages)


@pytest.mark.parametrize("version", ["v0.9", "v1.0"])
@pytest.mark.asyncio
async def test_transfer_action_gate_blocks_080_commits_090_and_boundary_0875(
    version: str,
) -> None:
    """Worked example 3 (`TRANSFER`): abstains at 0.80, renders at 0.90, exact boundary 0.875."""
    catalog = BasicCatalog(version)

    # 0.80 < 0.875: abstains, and fallback_card never emits the refused Button.
    sa_low = ScriptedAnswers(
        answers={**TRANSFER_BASE_SCRIPTED, "archetype:act": ("confirm", 0.80)}
    )
    synth_low = DecisionSynthesizer([catalog], sa_low.backend(), fallback_card=True)
    out_low = await synth_low.synthesize(
        TRANSFER.intent, TRANSFER.payload, mutable_paths=TRANSFER.mutable_paths
    )
    assert out_low.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert out_low.fallback_source is FallbackSource.CARD
    assert any(r.outcome == "action_gate" for r in out_low.trace)
    card_comps = _extract_components(out_low.messages)
    assert all(c["component"] != "Button" for c in card_comps)

    # 0.90 >= 0.875: commits and renders `confirm` with `facts` and `actions`.
    sa_high = ScriptedAnswers(
        answers={**TRANSFER_BASE_SCRIPTED, "archetype:act": ("confirm", 0.90)}
    )
    synth_high = DecisionSynthesizer([catalog], sa_high.backend())
    out_high = await synth_high.synthesize(
        TRANSFER.intent, TRANSFER.payload, mutable_paths=TRANSFER.mutable_paths
    )
    assert out_high.stage == SynthesisStage.ARCHETYPE
    assert out_high.layout_plan is not None
    assert out_high.layout_plan.archetype == "confirm"
    assert list(out_high.layout_plan.block_ids()) == ["facts", "actions"]
    validate_payload([catalog], out_high.messages)
    high_comps = _extract_components(out_high.messages)
    assert any(c["component"] == "Button" for c in high_comps)

    # Exact gate boundary for stakes 2.1 (gate = 0.875): >= passes, < abstains.
    sa_exact = ScriptedAnswers(
        answers={**TRANSFER_BASE_SCRIPTED, "archetype:act": ("confirm", 0.875)}
    )
    out_exact = await DecisionSynthesizer([catalog], sa_exact.backend()).synthesize(
        TRANSFER.intent, TRANSFER.payload, mutable_paths=TRANSFER.mutable_paths
    )
    assert out_exact.stage == SynthesisStage.ARCHETYPE

    sa_below = ScriptedAnswers(
        answers={**TRANSFER_BASE_SCRIPTED, "archetype:act": ("confirm", 0.874)}
    )
    out_below = await DecisionSynthesizer([catalog], sa_below.backend()).synthesize(
        TRANSFER.intent, TRANSFER.payload, mutable_paths=TRANSFER.mutable_paths
    )
    assert out_below.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert out_below.messages == []


@pytest.mark.parametrize("version", ["v0.9", "v1.0"])
@pytest.mark.asyncio
async def test_settings_toggles_live_at_085_and_degraded_below_080(
    version: str,
) -> None:
    """Worked example 4 (`SETTINGS`): toggles live at 0.85, degraded to read-only below 0.80."""
    catalog = BasicCatalog(version)

    sa_live = ScriptedAnswers(
        answers={
            **SETTINGS_BASE_SCRIPTED,
            "archetype:input": ("settings", 0.85),
        }
    )
    out_live = await DecisionSynthesizer([catalog], sa_live.backend()).synthesize(
        SETTINGS.intent, SETTINGS.payload, mutable_paths=SETTINGS.mutable_paths
    )
    assert out_live.stage == SynthesisStage.ARCHETYPE
    validate_payload([catalog], out_live.messages)
    live_types = {c["component"] for c in _extract_components(out_live.messages)}
    assert "CheckBox" in live_types
    assert "Button" in live_types

    sa_deg = ScriptedAnswers(
        answers={
            **SETTINGS_BASE_SCRIPTED,
            "archetype:input": ("settings", 0.75),
        }
    )
    out_deg = await DecisionSynthesizer([catalog], sa_deg.backend()).synthesize(
        SETTINGS.intent, SETTINGS.payload, mutable_paths=SETTINGS.mutable_paths
    )
    assert out_deg.stage == SynthesisStage.ARCHETYPE
    validate_payload([catalog], out_deg.messages)
    deg_types = {c["component"] for c in _extract_components(out_deg.messages)}
    assert "CheckBox" not in deg_types
    assert "Button" not in deg_types


@pytest.mark.asyncio
async def test_use_archetypes_false_and_container_only_catalog_abstention() -> None:
    """`use_archetypes=False` reproduces flat output; container-only catalog abstains."""
    basic = BasicCatalog("v1.0")
    flat_synth = DecisionSynthesizer(
        [basic],
        DeterministicMockBackend(scripted={"root_component": {"Text": 0.92}}),
        config=SynthesisConfig(use_archetypes=False),
    )
    flat_out = await flat_synth.synthesize("Show resort name", {"name": "Casa Verde"})
    assert flat_out.stage == SynthesisStage.FAST_1PASS_LEAF
    assert flat_out.layout_plan is None
    assert flat_out.trace == ()
    validate_payload([basic], flat_out.messages)

    container_only_cat = Catalog.from_json({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/container_only/v1",
        "protocolVersion": "1.0",
        "components": {
            "OuterBox": {
                "type": "object",
                "properties": {
                    "component": {"const": "OuterBox"},
                    "childId": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "childId"],
            },
        },
    })
    container_synth = DecisionSynthesizer(
        [container_only_cat],
        DeterministicMockBackend(scripted={"root_component": {"OuterBox": 0.90}}),
        fallback_card=True,
    )
    container_out = await container_synth.synthesize(
        "Show outer box", {"title": "hello"}
    )
    assert container_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert container_out.messages == []
    assert (
        container_out.trace
        and container_out.trace[0].outcome == "no eligible archetype"
    )


def test_format_factory_through_request_processor_with_layout_brief() -> None:
    """`DecisionFormatFactory` through `A2uiRequestProcessor` compiles a block with `layout`."""
    catalog = BasicCatalog("v1.0")
    sa = ScriptedAnswers(answers=RESORT_SCRIPTED)
    factory = DecisionFormatFactory(backend=sa.backend())
    processor = A2uiRequestProcessor(
        catalogs=[catalog],
        format_factory=factory,
    )

    decision_json = json.dumps({
        "intent": RESORT.intent,
        "payload": RESORT.payload,
        "layout": ["headline:priceFrom,rating", "prose:about"],
    })
    raw_response = f"Here is the resort overview:\n<a2ui>{decision_json}</a2ui>"
    parts = processor.parse_response(raw_response)
    a2ui_parts = [p for p in parts if isinstance(p, A2uiPart)]
    assert len(a2ui_parts) == 1
    validate_payload([catalog], a2ui_parts[0].a2ui)


def test_render_tool_run_sync_with_layout_and_trace() -> None:
    """`DecisionRenderTool.run_sync` parses `layout` and returns `layoutPlan` and `trace`."""
    catalog = BasicCatalog("v1.0")
    sa = ScriptedAnswers(answers=RESORT_SCRIPTED)
    synth = DecisionSynthesizer([catalog], sa.backend())
    tool = DecisionRenderTool(synth, include_trace=True)

    schema = tool.parameters_json_schema()
    assert "layout" in schema["properties"]
    assert schema["properties"]["layout"]["maxItems"] == 6

    out = tool.run_sync({
        "intent": RESORT.intent,
        "payload": RESORT.payload,
        "layout": ["headline:priceFrom,rating", "prose:about"],
    })
    assert out.stage == SynthesisStage.ARCHETYPE
    result = tool.format_result(out)
    assert "archetype" in result["stage"].lower()
    assert result["layoutPlan"] == {
        "archetype": "detail",
        "blocks": ["picture", "headline", "prose", "collection"],
    }
    assert isinstance(result["trace"], list) and len(result["trace"]) > 0
    assert result["trace"][0]["questionId"] == "family"


@pytest.mark.asyncio
async def test_single_answer_call_per_surface_and_two_with_forced_reask() -> None:
    """Verifies a single `backend.answer` call normally and two calls when `needs_reask` fires."""
    catalog = BasicCatalog("v1.0")
    answer_calls = 0

    class CountingBackend(DeterministicMockBackend):

        async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
            nonlocal answer_calls
            answer_calls += 1
            return await super().answer(batch)

    sa_normal = ScriptedAnswers(answers=HOST_SCRIPTED)
    normal_backend = CountingBackend(scorer=sa_normal.scorer)
    synth_normal = DecisionSynthesizer([catalog], normal_backend)
    out_normal = await synth_normal.synthesize(HOST.intent, HOST.payload)
    assert out_normal.stage == SynthesisStage.ARCHETYPE
    assert answer_calls == 1

    # Forced re-ask: set `family` winning probability to 0.52 (< reask_below=0.55)
    # on the first call, and 0.92 on the second call.
    answer_calls = 0
    low_family_scripted = {
        **HOST_SCRIPTED,
        "family": ("monitor", 0.52),
    }
    sa_reask = ScriptedAnswers(answers=low_family_scripted)

    class ReaskBackend(DeterministicMockBackend):

        async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
            nonlocal answer_calls
            answer_calls += 1
            if batch.shared_context.get("reask"):
                sa_reask.answers = {**HOST_SCRIPTED, "family": ("monitor", 0.92)}
            return await super().answer(batch)

    reask_backend = ReaskBackend(scorer=sa_reask.scorer)
    synth_reask = DecisionSynthesizer(
        [catalog],
        reask_backend,
        config=SynthesisConfig(reask_below=0.55),
    )
    out_reask = await synth_reask.synthesize(HOST.intent, HOST.payload)
    assert out_reask.stage == SynthesisStage.ARCHETYPE
    assert answer_calls == 2


@pytest.mark.asyncio
async def test_edge_cases_empty_identifiers_60_pointers_and_bad_answers() -> None:
    """Covers empty/identifier-only payloads, 60-pointer cap, and malformed backend answers."""
    catalog = BasicCatalog("v1.0")
    grammar = ArchetypeGrammar.default()
    lib = PatternLibrary.for_catalogs([catalog])

    # 1. Empty payload: no eligible archetypes, abstains cleanly.
    sa = ScriptedAnswers(answers=HOST_SCRIPTED)
    synth = DecisionSynthesizer([catalog], sa.backend())
    empty_out = await synth.synthesize("Show empty", {})
    assert empty_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert empty_out.messages == []

    # Identifier-only payload: `headline` and `collection` shape-excluded.
    id_ptrs = inspect_payload_pointers({
        "id": "usr_12345",
        "uuid": "550e8400-e29b-41d4-a716-446655440000",
    })
    el_ids = {a.id for a in eligible_archetypes(grammar, lib, id_ptrs)}
    assert "dashboard" not in el_ids
    assert "feed" not in el_ids

    # 2. Payload with 60 pointers: salience questions capped by `max_pairs`.
    big_payload = {f"price_{i:02d}": float(i) for i in range(60)}
    big_ptrs = inspect_payload_pointers(big_payload)
    batch, state = synth.planner.build_batch(
        "Show 60 prices", big_ptrs, payload=big_payload
    )
    assert batch.pair_count() <= SynthesisConfig().max_pairs
    assert state.budget_exhausted is True

    # 3. Backend returning fewer answers or an unknown question id:
    # planner raises A2uiValidationError, synthesizer falls back to flat path and records in trace.
    class TruncatedAnswerBackend(DeterministicMockBackend):

        async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
            full = await super().answer(batch)
            return full[:-1]

    trunc_synth = DecisionSynthesizer(
        [catalog],
        TruncatedAnswerBackend(scripted={"root_component": {"Text": 0.92}}),
    )
    trunc_out = await trunc_synth.synthesize(HOST.intent, HOST.payload)
    assert trunc_out.stage in (
        SynthesisStage.FAST_1PASS_LEAF,
        SynthesisStage.CONTAINER_2PASS,
    )
    assert any(
        "Answer count mismatch" in r.outcome
        or "Missing answers" in r.outcome
        or "validation_error" in r.outcome
        for r in trunc_out.trace
    )

    class UnknownIdAnswerBackend(DeterministicMockBackend):

        async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
            full = list(await super().answer(batch))
            full[0] = DecisionAnswer(
                question_id="unknown_question_id",
                distribution=full[0].distribution,
            )
            return tuple(full)

    unk_synth = DecisionSynthesizer(
        [catalog],
        UnknownIdAnswerBackend(scripted={"root_component": {"Text": 0.92}}),
    )
    unk_out = await unk_synth.synthesize(HOST.intent, HOST.payload)
    assert any("unknown_question_id" in r.outcome for r in unk_out.trace)


@pytest.mark.asyncio
async def test_batching_backend_timeout_propagates_to_all_waiters() -> None:
    """`BatchingDecisionBackend` propagates backend timeout exceptions to every concurrent waiter."""

    class TimeoutBackend(DeterministicMockBackend):

        async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
            await asyncio.sleep(0.01)
            raise httpx.ReadTimeout("Decision backend timed out")

    batched = BatchingDecisionBackend(TimeoutBackend(), window_ms=5.0)
    q = DecisionQuery(
        task="family",
        prompt="Show host",
        candidates=("monitor", "inspect"),
    )

    with pytest.raises(httpx.ReadTimeout):
        await asyncio.gather(batched.predict(q), batched.predict(q))
    await batched.aclose()


@pytest.mark.asyncio
async def test_required_block_wins_multi_catalog_markdown_escape_and_brief_warning() -> (
    None
):
    """Covers required-block-wins trace, multi-catalog precedence, markdown escaping, and brief warnings."""
    catalog = BasicCatalog("v1.0")

    # 1. Required block gated `no` (`headline` at 0.20 on `dashboard`) + disallowed brief section (`compose:host`).
    scripted = {
        **HOST_SCRIPTED,
        "gate:headline": 0.20,
    }
    sa = ScriptedAnswers(answers=scripted)
    synth = DecisionSynthesizer([catalog], sa.backend())
    out = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        layout=["compose:host", "facts:uptimeHours,host"],
    )
    assert out.stage == SynthesisStage.ARCHETYPE
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

    # 2. Markdown heading in `$text` when slot value contains `#` or newlines: escaped.
    expander = PatternExpander(
        PatternLibrary.for_catalogs([catalog]),
        CatalogDecisionGraph([catalog]),
    )
    prose_comps = expander.expand_block(
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
    heading_comp = next(c for c in prose_comps if c["id"] == "prose_heading")
    assert "\n" not in heading_comp["text"]
    assert r"\#1" in heading_comp["text"]

    # 3. Multi-catalog surface: primary catalog wins on duplicate pattern name,
    # and expansion ids carry the catalog-qualified block prefix.
    secondary_cat = Catalog.from_json({
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
    basic_lib = PatternLibrary.for_catalogs([catalog]).libraries[0]
    sec_lib = PatternLibrary.from_json({
        "version": "1",
        "catalogIds": [secondary_cat.catalog_id],
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

    multi_synth = DecisionSynthesizer(
        [catalog, secondary_cat],
        ScriptedAnswers(answers=HOST_SCRIPTED).backend(),
        patterns=merged,
    )
    multi_out = await multi_synth.synthesize(HOST.intent, HOST.payload)
    assert multi_out.stage == SynthesisStage.ARCHETYPE
    validate_payload([catalog, secondary_cat], multi_out.messages)
    multi_comps = _extract_components(multi_out.messages)
    assert any(c["id"].startswith("basic_") for c in multi_comps)
    assert all("catalogId" in c for c in multi_comps)


@pytest.mark.skipif(
    not os.environ.get("A2UI_DECISION_BENCH"),
    reason=(
        "Set A2UI_DECISION_BENCH=1 to run the layout planning + expansion"
        " micro-benchmark."
    ),
)
@pytest.mark.asyncio
async def test_resort_planning_and_expansion_micro_benchmark() -> None:
    """Planning plus expansion for the resort fixture completes in under 10 ms median."""
    catalog = BasicCatalog("v1.0")
    sa = ScriptedAnswers(answers=RESORT_SCRIPTED)
    backend = sa.backend()
    synth = DecisionSynthesizer([catalog], backend)
    pointers = inspect_payload_pointers(RESORT.payload)
    elig = eligible_archetypes(synth.archetypes, synth.patterns, pointers)

    samples_ms: list[float] = []
    for _ in range(25):
        start = time.perf_counter()
        batch, state = synth.planner.build_batch(
            RESORT.intent, pointers, eligible=elig, payload=RESORT.payload
        )
        answers = await backend.answer(batch)
        outcome = synth.planner.read(state, answers)
        assert outcome.plan is not None
        components = synth._expand_plan(outcome.plan)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        assert len(components) > 0
        samples_ms.append(elapsed_ms)

    median_ms = statistics.median(samples_ms)
    assert median_ms < 10.0, f"Median latency {median_ms:.2f} ms exceeded 10 ms"
