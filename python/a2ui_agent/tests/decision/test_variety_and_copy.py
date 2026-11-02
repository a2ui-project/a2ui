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

"""Tests for variety mode sampling, authored copy placement, and remix."""

from __future__ import annotations

from typing import Any

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    DecisionSynthesizer,
    SynthesisConfig,
    SynthesisStage,
    VarietyMode,
)
import pytest

from .layout_fixtures import HOST, RESORT, ScriptedAnswers

HOST_SCRIPTED = {
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

HOST_DETAIL_SCRIPTED = {
    "family": ("inspect", 0.90),
    "stakes": 1.0,
    "urgency": 1.4,
    "archetype:inspect": ("detail", 0.85),
    "gate:picture": 0.10,
    "gate:banner": 0.80,
    "gate:headline": 0.90,
    "gate:prose": 0.85,
    "gate:facts": 0.80,
    "gate:media": 0.10,
    "gate:collection": 0.10,
    "gate:actions": 0.10,
    "anatomy:headline.deltas": 0.85,
    "salience:/cpu": 2.8,
    "salience:/status": 2.1,
    "salience:/uptimeHours": 1.2,
    "salience:/host": 0.4,
    "instance:banner.tone:/status": ("warning", 0.90),
    "instance:headline.news:/cpu": ("bad", 0.85),
    "instance:headline.state_tone:/status": ("warning", 0.80),
}

RESORT_SCRIPTED = {
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


def _extract_components(messages: Any) -> list[dict[str, Any]]:
    """Returns the `updateComponents.components` list from `messages`."""
    comps: list[dict[str, Any]] = []
    for msg in messages:
        d = msg if isinstance(msg, dict) else msg.model_dump(by_alias=True)
        if "updateComponents" in d:
            comps.extend(d["updateComponents"].get("components", []))
    return comps


@pytest.mark.asyncio
async def test_authored_title_replaces_intent_in_page_title() -> None:
    catalog = BasicCatalog("v1.0")
    sa = ScriptedAnswers(answers=HOST_SCRIPTED)
    synth = DecisionSynthesizer([catalog], sa.backend())

    # Without authored title, the title falls back to intent (or title pointer if any)
    out_default = await synth.synthesize(HOST.intent, HOST.payload)
    assert out_default.stage == SynthesisStage.ARCHETYPE
    assert out_default.layout_plan is not None

    # With authored title
    custom_title = "Production Cluster Health"
    out_custom = await synth.synthesize(HOST.intent, HOST.payload, title=custom_title)
    assert out_custom.stage == SynthesisStage.ARCHETYPE
    assert out_custom.layout_plan is not None
    assert out_custom.layout_plan.page.title.literal == custom_title

    comps = _extract_components(out_custom.messages)
    # Confirm title appears in page header component (with markdown heading prefix)
    assert any(
        c.get("component") in {"Text", "Heading", "Title"}
        and custom_title in str(c.get("text", ""))
        for c in comps
    )


@pytest.mark.asyncio
async def test_authored_summary_yields_prose_block_on_host_payload() -> None:
    catalog = BasicCatalog("v1.0")
    sa = ScriptedAnswers(answers=HOST_DETAIL_SCRIPTED)
    synth = DecisionSynthesizer([catalog], sa.backend())

    summary_text = "Host is running with normal CPU utilization."
    out = await synth.synthesize(
        "Inspect host details", HOST.payload, summary=summary_text
    )
    assert out.stage == SynthesisStage.ARCHETYPE
    assert out.layout_plan is not None
    assert "prose" in out.layout_plan.block_ids()
    block_map = {b.block_id: b for b in out.layout_plan.blocks}
    prose_block = block_map["prose"]
    assert prose_block.bindings.get("body") is not None
    assert prose_block.bindings.get("body").literal == summary_text

    # When payload has an 'about' field with text, the summary is ignored in favor of the pointer
    payload_with_about = dict(HOST.payload)
    payload_with_about["about"] = "Pre-existing telemetry description."
    answers_about = dict(HOST_DETAIL_SCRIPTED)
    answers_about["gate:banner"] = 0.10
    sa_about = ScriptedAnswers(answers=answers_about)
    synth_about = DecisionSynthesizer([catalog], sa_about.backend())
    out_about = await synth_about.synthesize(
        "Inspect host details", payload_with_about, summary=summary_text
    )
    assert out_about.stage == SynthesisStage.ARCHETYPE
    assert out_about.layout_plan is not None
    assert "prose" in out_about.layout_plan.block_ids()
    about_block_map = {b.block_id: b for b in out_about.layout_plan.blocks}
    prose_about = about_block_map["prose"]
    # Bound to pointer /about
    assert prose_about.bindings.get("body") is not None
    assert prose_about.bindings.get("body").pointer == "/about"
    assert prose_about.bindings.get("body").literal is None


@pytest.mark.asyncio
async def test_variety_sampling_near_top_seeds_and_deterministic_invariants() -> None:
    catalog = BasicCatalog("v1.0")
    # Set up near-top probabilities for collection.layout:
    # "cards": 0.46, "reel": 0.44 (within variety_margin=0.15 of top), "rows": 0.10 (outside margin)
    dist_answers = dict(RESORT_SCRIPTED)
    dist_answers["anatomy:collection.layout"] = {
        "cards": 0.46,
        "reel": 0.44,
        "rows": 0.10,
    }

    config = SynthesisConfig(variety=VarietyMode.NEAR_TOP, variety_margin=0.15)

    # Seed 1
    backend1 = ScriptedAnswers(answers=dist_answers).backend()
    synth1 = DecisionSynthesizer([catalog], backend1, config=config)
    out1 = await synth1.synthesize(RESORT.intent, RESORT.payload, variety_seed=42)

    # Re-run with the same seed 1 reproduces identical plan
    backend1_repeat = ScriptedAnswers(answers=dist_answers).backend()
    synth1_repeat = DecisionSynthesizer([catalog], backend1_repeat, config=config)
    out1_repeat = await synth1_repeat.synthesize(
        RESORT.intent, RESORT.payload, variety_seed=42
    )
    assert out1.layout_plan is not None
    assert out1_repeat.layout_plan is not None
    assert out1.layout_plan.archetype == out1_repeat.layout_plan.archetype
    assert out1.layout_plan.family == out1_repeat.layout_plan.family
    map1 = {b.block_id: b for b in out1.layout_plan.blocks}
    map1_repeat = {b.block_id: b for b in out1_repeat.layout_plan.blocks}
    assert (
        map1["collection"].variant_knobs["layout"]
        == map1_repeat["collection"].variant_knobs["layout"]
    )

    # Find a seed that selects the alternative near-top option
    layout1 = map1["collection"].variant_knobs["layout"]
    found_diff = False
    for alt_seed in range(1, 20):
        backend_alt = ScriptedAnswers(answers=dist_answers).backend()
        synth_alt = DecisionSynthesizer([catalog], backend_alt, config=config)
        out_alt = await synth_alt.synthesize(
            RESORT.intent, RESORT.payload, variety_seed=alt_seed
        )
        assert out_alt.layout_plan is not None
        assert out_alt.layout_plan.family == "inspect"
        assert out_alt.layout_plan.archetype == "detail"
        map_alt = {b.block_id: b for b in out_alt.layout_plan.blocks}
        alt_layout = map_alt["collection"].variant_knobs["layout"]
        # Option must only be one of the near-top options ("cards" or "reel"), never "rows"
        assert alt_layout in {"cards", "reel"}
        if alt_layout != layout1:
            found_diff = True
            break
    assert (
        found_diff
    ), "Expected at least one seed to pick the alternative near-top option"


@pytest.mark.asyncio
async def test_remix_zero_backend_calls_and_validation() -> None:
    catalog = BasicCatalog("v1.0")
    sa = ScriptedAnswers(answers=HOST_SCRIPTED)
    backend = sa.backend()
    synth = DecisionSynthesizer([catalog], backend)

    out = await synth.synthesize(HOST.intent, HOST.payload)
    assert out.stage == SynthesisStage.ARCHETYPE
    assert len(out.decision_answers) > 0
    initial_batch_count = len(backend.batches)

    # Remix re-uses existing answers without any backend calls
    remix_out = await synth.remix(
        HOST.intent, HOST.payload, out.decision_answers, seed=123
    )
    assert remix_out.stage == SynthesisStage.ARCHETYPE
    assert len(backend.batches) == initial_batch_count
    assert remix_out.decision_calls == 0
    assert remix_out.decision_latency_ms == 0.0
    assert remix_out.decision_answers == out.decision_answers

    # Synchronous remix works identically
    remix_sync_out = synth.remix_sync(
        HOST.intent, HOST.payload, out.decision_answers, seed=123
    )
    assert remix_sync_out.stage == SynthesisStage.ARCHETYPE
    assert len(backend.batches) == initial_batch_count
    assert remix_sync_out.decision_calls == 0

    # Mismatched answers raise ValueError
    with pytest.raises(
        ValueError, match="answers do not match this intent and payload"
    ):
        await synth.remix(HOST.intent, HOST.payload, out.decision_answers[:-1])

    with pytest.raises(
        ValueError, match="answers do not match this intent and payload"
    ):
        await synth.remix(HOST.intent, HOST.payload, ())


@pytest.mark.asyncio
async def test_argmax_reproduces_existing_plans_exactly() -> None:
    catalog = BasicCatalog("v1.0")
    sa = ScriptedAnswers(answers=HOST_SCRIPTED)
    synth = DecisionSynthesizer(
        [catalog], sa.backend(), config=SynthesisConfig(variety=VarietyMode.ARGMAX)
    )

    out = await synth.synthesize(HOST.intent, HOST.payload)
    assert out.stage == SynthesisStage.ARCHETYPE
    assert out.layout_plan is not None
    assert out.layout_plan.family == "monitor"
    assert out.layout_plan.archetype == "dashboard"
    assert list(out.layout_plan.block_ids()) == [
        "banner",
        "headline",
        "facts",
    ]
