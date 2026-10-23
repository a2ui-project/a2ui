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

"""Unit tests for the layout planner, grammar rules, and structural lint."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from a2ui.core import A2uiValidationError
from a2ui.inference_formats.decision import (
    SynthesisConfig,
    inspect_payload_pointers,
)
from a2ui.inference_formats.decision.archetypes import ArchetypeGrammar
from a2ui.inference_formats.decision.layout_lint import (
    LintFinding,
    lint_components,
)
from a2ui.inference_formats.decision.layout_planner import (
    LayoutPlanner,
    PlannerState,
    apply_actions_gate,
    apply_at_least,
    apply_catalog_eligibility,
    apply_fallback_must_end,
    apply_leading_all_or_none,
    apply_no_empty_container,
    apply_one_primary_action,
    apply_pictures_need_a_look,
    apply_pointer_once_per_region,
    apply_required_block_wins,
    apply_urgency_terse,
)
from a2ui.inference_formats.decision.models import (
    BlockBindings,
    DecisionAnswer,
    DecisionDistribution,
    LayoutBrief,
    LayoutPlan,
    PageBindings,
    PatternCapabilities,
    PlannedBlock,
    PlanOutcome,
    PlanReason,
    SlotBinding,
)
import pytest

from .layout_fixtures import (
    HOST,
    LayoutFixture,
    RESORT,
    ScriptedAnswers,
    ScriptedValue,
    SETTINGS,
    TRANSFER,
)


@dataclass(frozen=True)
class StubCapabilities:
    """Stub `PatternCapabilities` implementation for planner tests."""

    disabled: frozenset[tuple[str, str | None]] = field(default_factory=frozenset)

    def has_pattern(self, name: str, variant: str | None = None) -> bool:
        if (name, None) in self.disabled:
            return False
        return (name, variant) not in self.disabled


def _run_fixture(
    fixture: LayoutFixture,
    scripted: Mapping[str, ScriptedValue],
    *,
    config: SynthesisConfig | None = None,
    brief: LayoutBrief | None = None,
    capabilities: PatternCapabilities | None = None,
) -> tuple[
    LayoutPlanner,
    PlannerState,
    tuple[DecisionAnswer, ...],
    PlanOutcome,
    ScriptedAnswers,
]:
    """Builds a batch for `fixture`, answers via `ScriptedAnswers`, and reads."""
    grammar = ArchetypeGrammar.default()
    cfg = config or SynthesisConfig()
    planner = LayoutPlanner(grammar, cfg, capabilities=capabilities)
    pointers = inspect_payload_pointers(
        fixture.payload, mutable_paths=fixture.mutable_paths
    )
    batch, state = planner.build_batch(
        intent=fixture.intent,
        pointers=pointers,
        brief=brief,
        payload=fixture.payload,
    )
    sa = ScriptedAnswers(answers=scripted)
    answers = asyncio.run(sa.backend().answer(batch))
    outcome = planner.read(state, answers)
    return planner, state, answers, outcome, sa


def test_resort_detail_worked_example() -> None:
    """Worked example 1 (`RESORT`): `inspect -> detail` with gallery reel."""
    scripted: dict[str, ScriptedValue] = {
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
    _, state, _, outcome, sa = _run_fixture(RESORT, scripted)

    assert "gate:media" not in sa.asked
    assert state.batch.pair_count() <= SynthesisConfig().max_pairs

    assert outcome.reason == "planned"
    assert outcome.plan is not None
    plan = outcome.plan
    assert plan.family == "inspect"
    assert plan.archetype == "detail"
    assert plan.page.title.pointer == "/name"
    assert plan.page.mark.pointer == "/logoUrl"

    assert list(plan.block_ids()) == [
        "picture",
        "headline",
        "prose",
        "collection",
    ]
    by_id = {b.block_id: b for b in plan.blocks}

    pic = by_id["picture"]
    assert pic.bindings.get("picture") == SlotBinding(pointer="/photos/0/url")
    assert pic.variant_knobs.get("framing") == "banner"
    assert pic.variant_knobs.get("prominence") == "leading"

    headline = by_id["headline"]
    hl_items = headline.bindings.get("items")
    assert hl_items is not None
    assert [it["value"].pointer for it in hl_items.items] == [
        "/priceFrom",
        "/rating",
    ]

    prose = by_id["prose"]
    assert prose.bindings.get("body") == SlotBinding(pointer="/about")
    assert prose.variant_knobs.get("length") == "blurb"

    collection = by_id["collection"]
    assert collection.variant_knobs.get("layout") == "reel"
    col_items = collection.bindings.get("items")
    assert col_items is not None
    assert col_items.pointer == "/photos"
    assert col_items.fields["picture"] == SlotBinding(pointer="url")
    assert col_items.fields["headline"] == SlotBinding(pointer="caption")


def test_host_dashboard_worked_example() -> None:
    """Worked example 2 (`HOST`): `monitor -> dashboard` with banner, headline, facts."""
    scripted: dict[str, ScriptedValue] = {
        "family": ("monitor", 0.90),
        "stakes": 1.0,
        "urgency": 1.4,
        "archetype:monitor": ("dashboard", 0.85),
        "gate:banner": 0.80,
        "gate:headline": 0.90,
        "gate:facts": 0.80,
        "salience:/cpu": 2.8,
        "salience:/status": 2.1,
        "salience:/uptimeHours": 1.2,
        "salience:/host": 0.4,
        "instance:banner.tone:/status": ("warning", 0.90),
        "instance:headline.news:/cpu": ("bad", 0.85),
        "instance:headline.state_tone:/status": ("warning", 0.80),
    }
    _, _, _, outcome, sa = _run_fixture(HOST, scripted)

    assert "gate:chart" not in sa.asked
    assert "gate:collection" not in sa.asked
    assert "salience:/cpuDelta" not in sa.asked

    assert outcome.reason == "planned"
    assert outcome.plan is not None
    plan = outcome.plan
    assert plan.family == "monitor"
    assert plan.archetype == "dashboard"
    assert list(plan.block_ids()) == ["banner", "headline", "facts"]

    by_id = {b.block_id: b for b in plan.blocks}
    banner = by_id["banner"]
    assert banner.bindings.get("title") == SlotBinding(pointer="/status")
    assert banner.variant_knobs.get("tone") == "warning"

    headline = by_id["headline"]
    hl_items = headline.bindings.get("items")
    assert hl_items is not None
    assert [it["value"].pointer for it in hl_items.items] == ["/cpu"]
    assert hl_items.items[0]["delta"] == SlotBinding(pointer="/cpuDelta")
    assert headline.instances.get("/cpu", {}).get("news") == "bad"

    facts = by_id["facts"]
    rows = facts.bindings.get("rows")
    assert rows is not None
    assert [it["value"].pointer for it in rows.items] == [
        "/uptimeHours",
        "/host",
    ]


def test_transfer_confirm_action_gate_blocks_at_080_commits_at_090() -> None:
    """Worked example 3 (`TRANSFER`): action gate at 0.875 blocks 0.80, passes 0.90."""
    base_scripted: dict[str, ScriptedValue] = {
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

    _, _, _, blocked, _ = _run_fixture(
        TRANSFER, {**base_scripted, "archetype:act": ("confirm", 0.80)}
    )
    assert blocked.reason == "action_gate"
    assert blocked.plan is None

    _, _, _, committed, _ = _run_fixture(
        TRANSFER, {**base_scripted, "archetype:act": ("confirm", 0.90)}
    )
    assert committed.reason == "planned"
    assert committed.plan is not None
    plan = committed.plan
    assert plan.family == "act"
    assert plan.archetype == "confirm"
    assert plan.actions_allowed is True
    assert list(plan.block_ids()) == ["facts", "actions"]

    by_id = {b.block_id: b for b in plan.blocks}
    facts = by_id["facts"]
    rows = facts.bindings.get("rows")
    assert rows is not None
    assert [it["value"].pointer for it in rows.items] == [
        "/amount",
        "/recipient",
        "/fee",
        "/arrives",
    ]

    actions = by_id["actions"]
    buttons = actions.bindings.get("buttons")
    assert buttons is not None
    assert [it["label"].literal for it in buttons.items] == ["Cancel", "Send"]
    assert actions.instances["Send"]["primary"] == "false"
    assert actions.instances["Send"]["destructive"] == "true"
    assert actions.instances["Cancel"]["primary"] == "false"


def test_settings_worked_example_and_action_gate_degradation() -> None:
    """Worked example 4 (`SETTINGS`): `input -> settings` at 0.85 and below 0.80."""
    base_scripted: dict[str, ScriptedValue] = {
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

    _, _, _, outcome, _ = _run_fixture(
        SETTINGS, {**base_scripted, "archetype:input": ("settings", 0.85)}
    )
    assert outcome.reason == "planned"
    assert outcome.plan is not None
    groups_block = outcome.plan.blocks[0]
    assert groups_block.block_id == "groups"
    groups_slot = groups_block.bindings.get("groups")
    assert groups_slot is not None
    assert len(groups_slot.items) == 3
    assert groups_block.instances["/playback/autoDownload"]["row_kind"] == "switch"
    assert groups_block.instances["/account/signOut"]["row_kind"] == "danger"

    # Below 0.80 (at stakes 1.2, gate is 0.80): `actions_allowed` is False,
    # so `danger` and `switch` rows degrade to read-only `value` rows.
    _, _, _, degraded, _ = _run_fixture(
        SETTINGS, {**base_scripted, "archetype:input": ("settings", 0.75)}
    )
    assert degraded.reason == "planned"
    assert degraded.plan is not None
    deg_block = degraded.plan.blocks[0]
    assert deg_block.instances["/account/signOut"]["row_kind"] == "value"
    assert deg_block.instances["/playback/autoDownload"]["row_kind"] == "value"


def test_prior_archetypes_ordering() -> None:
    """`prior_archetypes` puts brief-pinned first, then satisfied block count."""
    grammar = ArchetypeGrammar.default()
    planner = LayoutPlanner(grammar, SynthesisConfig())
    pointers = inspect_payload_pointers(
        TRANSFER.payload, mutable_paths=TRANSFER.mutable_paths
    )
    eligible = grammar.archetypes

    unpinned = planner.prior_archetypes(eligible, pointers)
    assert len(unpinned) == len(eligible)

    all_roles = set(grammar.families()) | set(grammar.blocks)
    brief_family = LayoutBrief.parse(["input:amount"], roles=all_roles)
    family_pinned = planner.prior_archetypes(eligible, pointers, brief=brief_family)
    input_archs = {a.id for a in grammar.archetypes_in("input")}
    assert {a.id for a in family_pinned[: len(input_archs)]} == input_archs

    brief_block = LayoutBrief.parse(["groups:amount"], roles=all_roles)
    block_pinned = planner.prior_archetypes(eligible, pointers, brief=brief_block)
    assert block_pinned[0].id == "settings"


def test_capabilities_filter_anatomy_options() -> None:
    """Disabling `("collection", "grid")` removes `"grid"` from `collection.layout`."""
    caps = StubCapabilities(disabled=frozenset({("collection", "grid")}))
    planner = LayoutPlanner(
        ArchetypeGrammar.default(), SynthesisConfig(), capabilities=caps
    )
    pointers = inspect_payload_pointers(RESORT.payload)
    batch, _ = planner.build_batch(
        intent=RESORT.intent, pointers=pointers, payload=RESORT.payload
    )
    layout_q = next(q for q in batch.questions if q.id == "anatomy:collection.layout")
    assert "grid" not in layout_q.options
    assert "cards" in layout_q.options
    assert "rows" in layout_q.options


def test_required_block_wins_records_disagreement_trace() -> None:
    """A required `!` block with `gate:<block> < 0.50` is kept and traced."""
    scripted: dict[str, ScriptedValue] = {
        "family": ("monitor", 0.85),
        "stakes": 0.5,
        "urgency": 0.5,
        "archetype:monitor": ("dashboard", 0.85),
        "gate:headline": 0.20,
        "gate:banner": 0.10,
        "gate:facts": 0.80,
        "salience:/cpu": 2.8,
        "salience:/host": 2.0,
    }
    _, state, _, outcome, _ = _run_fixture(HOST, scripted)
    assert outcome.reason == "planned"
    assert outcome.plan is not None
    assert "headline" in outcome.plan.block_ids()
    assert any(
        r.question.id == "gate:headline" and "required_override" in r.outcome
        for r in state.trace
    )


def test_at_least_rule_tops_up_expected_blocks() -> None:
    """`apply_at_least` adds expected `+` blocks when gated blocks are too few."""
    scripted: dict[str, ScriptedValue] = {
        "family": ("inspect", 0.85),
        "stakes": 0.5,
        "urgency": 0.5,
        "archetype:inspect": ("detail", 0.85),
        "gate:picture": 0.10,
        "gate:banner": 0.10,
        "gate:headline": 0.20,
        "gate:prose": 0.30,
        "gate:facts": 0.25,
        "gate:collection": 0.10,
        "gate:actions": 0.10,
        "salience:/rating": 2.4,
        "salience:/priceFrom": 2.2,
    }
    _, _, _, outcome, _ = _run_fixture(RESORT, scripted)
    assert outcome.reason == "planned"
    assert outcome.plan is not None
    assert list(outcome.plan.block_ids()) == ["prose", "facts"]


def test_budget_exhaustion_falls_back_to_heuristics() -> None:
    """Exceeding `max_pairs` sets `budget_exhausted` and uses defaults for unasked."""
    cfg = SynthesisConfig(max_pairs=8)
    _, state, _, outcome, _ = _run_fixture(
        RESORT,
        {
            "family": ("inspect", 0.80),
            "stakes": 0.2,
            "urgency": 0.1,
            "archetype:inspect": ("detail", 0.85),
        },
        config=cfg,
    )
    assert state.budget_exhausted is True
    assert state.batch.pair_count() <= 8
    assert outcome.reason == "planned"
    assert outcome.plan is not None


def test_layout_brief_pins_and_warns_on_unused_block() -> None:
    """`LayoutBrief` skips pinned questions and logs a trace warning for extraneous blocks."""
    grammar = ArchetypeGrammar.default()
    brief = LayoutBrief.parse(
        ["monitor:cpu", "banner:status", "facts:host", "timeline:uptimeHours"],
        roles=set(grammar.families()) | set(grammar.blocks),
    )
    _, state, _, outcome, sa = _run_fixture(
        HOST,
        {
            "stakes": 0.5,
            "urgency": 0.5,
            "archetype:monitor": ("dashboard", 0.85),
            "gate:headline": 0.85,
            "salience:/cpu": 2.9,
            "salience:/status": 2.2,
            "salience:/host": 1.9,
        },
        brief=brief,
    )
    assert "family" not in sa.asked
    assert "gate:banner" not in sa.asked
    assert "gate:facts" not in sa.asked
    assert outcome.reason == "planned"
    assert any(
        r.question.id == "brief:timeline" and "warning" in r.outcome
        for r in state.trace
    )


def test_needs_reask_identifies_low_confidence_depended_questions() -> None:
    """`needs_reask` returns depended-on questions with winning prob < `reask_below`."""
    planner, state, _, outcome, _ = _run_fixture(
        HOST,
        {
            "family": ("monitor", 0.55),
            "stakes": 0.5,
            "urgency": 0.5,
            "archetype:monitor": ("dashboard", 0.62),
            "archetype:orient": ("feed", 0.45),
            "gate:banner": 0.78,
            "gate:headline": 0.85,
            "gate:facts": 0.82,
            "instance:banner.tone:/status": ("warning", 0.60),
            "salience:/cpu": 2.8,
            "salience:/status": 2.2,
            "salience:/host": 1.9,
        },
    )
    assert outcome.reason == "planned"
    assert outcome.plan is not None
    reask = planner.needs_reask(outcome.plan, state)
    reask_ids = [q.id for q in reask]
    assert "family" in reask_ids
    assert "archetype:monitor" in reask_ids
    assert "instance:banner.tone:/status" in reask_ids
    assert "archetype:orient" not in reask_ids


def test_answer_validation_rejects_missing_or_unknown_ids() -> None:
    """`read` raises `A2uiValidationError` on missing or unknown question ids."""
    grammar = ArchetypeGrammar.default()
    planner = LayoutPlanner(grammar, SynthesisConfig())
    pointers = inspect_payload_pointers(HOST.payload)
    batch, state = planner.build_batch(
        intent=HOST.intent, pointers=pointers, payload=HOST.payload
    )
    answers = asyncio.run(ScriptedAnswers().backend().answer(batch))

    with pytest.raises(A2uiValidationError, match="Missing answers"):
        planner.read(state, answers[:-1])

    extra = DecisionAnswer(
        question_id="unknown:question",
        distribution=DecisionDistribution(
            probabilities={"yes": 0.8, "no": 0.2}, calibrated=True
        ),
    )
    with pytest.raises(A2uiValidationError, match="Unknown question id"):
        planner.read(state, (*answers[:-1], extra))


def test_individual_rule_functions_transform_plans() -> None:
    """Direct unit tests for individual `apply_<rule>` functions."""
    grammar = ArchetypeGrammar.default()
    caps = StubCapabilities(disabled=frozenset({("collection", "grid")}))
    planner = LayoutPlanner(grammar, SynthesisConfig(), capabilities=caps)
    pointers = inspect_payload_pointers(RESORT.payload)
    batch, state = planner.build_batch(
        intent=RESORT.intent, pointers=pointers, payload=RESORT.payload
    )
    answers = asyncio.run(ScriptedAnswers().backend().answer(batch))
    planner.read(state, answers)

    plan = LayoutPlan(
        family="inspect",
        archetype="detail",
        stakes=0.5,
        urgency=2.5,
        blocks=(
            PlannedBlock(
                block_id="picture",
                pattern="picture",
                bindings=BlockBindings(
                    {"picture": SlotBinding(pointer="/photos/0/url")}
                ),
                variant_knobs={"framing": "banner", "prominence": "hero"},
            ),
            PlannedBlock(
                block_id="prose",
                pattern="prose",
                bindings=BlockBindings({"body": SlotBinding(pointer="/about")}),
                variant_knobs={"length": "blurb"},
            ),
            PlannedBlock(
                block_id="facts",
                pattern="facts",
                bindings=BlockBindings(),
            ),
        ),
        page=PageBindings(title=SlotBinding(pointer="/name")),
    )

    p1 = apply_required_block_wins(plan, state)
    p2 = apply_at_least(p1, state, grammar)
    p3 = apply_fallback_must_end(p2, state, grammar, caps)
    p4 = apply_catalog_eligibility(p3, state)
    p5 = apply_pointer_once_per_region(p4, state, planner)
    p6 = apply_pictures_need_a_look(p5, state)
    assert p6.page.mark == SlotBinding(pointer="/logoUrl")

    p7 = apply_leading_all_or_none(p6, state)
    p8 = apply_actions_gate(
        p7,
        state,
        grammar.threshold("actionGateFloor"),
        grammar.threshold("actionGateCap"),
    )
    p9 = apply_one_primary_action(p8, state)
    p10 = apply_urgency_terse(p9, state, caps)
    assert all(b.block_id != "prose" for b in p10.blocks)

    with_empty = replace(
        p10,
        blocks=(
            *p10.blocks,
            PlannedBlock(
                block_id="outcome",
                pattern="outcome",
                bindings=BlockBindings(),
            ),
        ),
    )
    p11 = apply_no_empty_container(with_empty, state, grammar)
    assert all(b.block_id != "outcome" for b in p11.blocks)


def test_lint_components_catches_all_six_structural_violations() -> None:
    """`lint_components` reports all six structural violations and honors `raise_on_error`."""
    bad_components: list[dict[str, Any]] = [
        {
            "id": "root",
            "component": "Column",
            "children": [
                "empty_col",
                "missing_id",
                "body_txt",
                "h1_txt",
                "btn1",
                "btn2",
                "reel1",
                "reel2",
                "dup1",
                "dup2",
            ],
        },
        {"id": "empty_col", "component": "Column", "children": []},
        {
            "id": "body_txt",
            "component": "Text",
            "text": {"path": "/a"},
            "variant": "body",
        },
        {
            "id": "h1_txt",
            "component": "Text",
            "text": "Heading",
            "variant": "h1",
        },
        {
            "id": "btn1",
            "component": "Button",
            "label": "Go",
            "variant": "primary",
        },
        {
            "id": "btn2",
            "component": "Button",
            "label": "Send",
            "variant": "primary",
        },
        {
            "id": "reel1",
            "component": "List",
            "children": ["body_txt"],
            "direction": "horizontal",
        },
        {
            "id": "reel2",
            "component": "List",
            "children": ["h1_txt"],
            "direction": "horizontal",
        },
        {"id": "dup1", "component": "Text", "text": {"path": "/shared"}},
        {"id": "dup2", "component": "Text", "text": {"@path": "/shared"}},
    ]

    findings: tuple[LintFinding, ...] = lint_components(bad_components)
    codes = {f.code for f in findings}
    assert codes == {
        "empty_container",
        "missing_component",
        "multiple_primary_buttons",
        "duplicate_pointer_binding",
        "heading_after_body",
        "multiple_reels",
    }

    with pytest.raises(A2uiValidationError, match="Layout component lint failed"):
        lint_components(bad_components, raise_on_error=True)

    valid_components: list[dict[str, Any]] = [
        {
            "id": "root",
            "component": "Column",
            "children": ["h1_txt", "body_txt", "btn1"],
        },
        {
            "id": "h1_txt",
            "component": "Text",
            "text": {"path": "/title"},
            "variant": "h1",
        },
        {
            "id": "body_txt",
            "component": "Text",
            "text": {"path": "/body"},
            "variant": "body",
        },
        {
            "id": "btn1",
            "component": "Button",
            "label": "OK",
            "variant": "primary",
        },
    ]
    assert lint_components(valid_components, raise_on_error=True) == ()


def test_threshold_boundary_cases_050_075_and_0875() -> None:
    """Tests exact boundary behavior at 0.50 (expected), 0.75 (optional), and 0.875 (action gate)."""
    # 1. Expected block (`prose+` on detail) at 0.49 vs 0.50, and optional block (`collection?`) at 0.74 vs 0.75.
    base_resort: dict[str, ScriptedValue] = {
        "family": ("inspect", 0.80),
        "stakes": 0.2,
        "urgency": 0.1,
        "archetype:inspect": ("detail", 0.85),
        "gate:picture": 0.90,
        "gate:headline": 0.80,
        "gate:facts": 0.10,
        "gate:banner": 0.10,
        "gate:actions": 0.10,
        "salience:/rating": 2.4,
        "salience:/priceFrom": 2.6,
    }
    _, _, _, below, _ = _run_fixture(
        RESORT,
        {**base_resort, "gate:prose": 0.49, "gate:collection": 0.74},
    )
    assert below.plan is not None
    assert "prose" not in below.plan.block_ids()
    assert "collection" not in below.plan.block_ids()

    _, _, _, exact, _ = _run_fixture(
        RESORT,
        {**base_resort, "gate:prose": 0.50, "gate:collection": 0.75},
    )
    assert exact.plan is not None
    assert "prose" in exact.plan.block_ids()
    assert "collection" in exact.plan.block_ids()

    # 2. Action gate at stakes 2.1 is 0.70 + 0.25 * 2.1 / 3 = 0.875.
    base_transfer: dict[str, ScriptedValue] = {
        "family": ("act", 0.85),
        "stakes": 2.1,
        "urgency": 0.6,
        "gate:facts": 0.85,
        "gate:actions": 0.90,
        "salience:/amount": 2.9,
        "salience:/recipient": 2.6,
    }
    _, _, _, gate_below, _ = _run_fixture(
        TRANSFER, {**base_transfer, "archetype:act": ("confirm", 0.874)}
    )
    assert gate_below.reason == "action_gate"

    _, _, _, gate_exact, _ = _run_fixture(
        TRANSFER, {**base_transfer, "archetype:act": ("confirm", 0.875)}
    )
    assert gate_exact.reason == "planned"
    assert gate_exact.plan is not None
    assert gate_exact.plan.actions_allowed is True


def test_leading_all_or_none_degrades_sparse_collection_pictures() -> None:
    """`apply_leading_all_or_none` sets `leading='none'` when over half of items lack pictures."""
    sparse_fixture = LayoutFixture(
        name="sparse_resort",
        intent="Show the resort overview",
        payload={
            "name": "Casa Verde",
            "rating": 4.6,
            "photos": [
                {"url": "https://example.com/1.jpg", "caption": "One"},
                {"url": "", "caption": "Two"},
                {"url": "", "caption": "Three"},
            ],
        },
    )
    _, _, _, outcome, _ = _run_fixture(
        sparse_fixture,
        {
            "family": ("inspect", 0.80),
            "stakes": 0.2,
            "urgency": 0.1,
            "archetype:inspect": ("detail", 0.85),
            "gate:headline": 0.80,
            "gate:collection": 0.85,
            "anatomy:collection.layout": ("rows", 0.80),
            "anatomy:collection.leading": ("thumbnail", 0.85),
            "salience:/rating": 2.5,
        },
    )
    assert outcome.reason == "planned"
    assert outcome.plan is not None
    col = next(b for b in outcome.plan.blocks if b.block_id == "collection")
    assert col.variant_knobs.get("leading") == "none"

    # M3: fallback entry `collection:grid` requires the specific `(collection, grid)` variant
    caps_no_grid = StubCapabilities(
        disabled=frozenset({("nonexistent_pic", None), ("collection", "grid")})
    )
    planner_no_grid = LayoutPlanner(
        ArchetypeGrammar.default(), SynthesisConfig(), capabilities=caps_no_grid
    )
    spec_with_grid_fb = replace(
        ArchetypeGrammar.default().block("picture"),
        pattern="nonexistent_pic",
        fallback=("nonexistent_pic", "collection:grid"),
    )
    from a2ui.inference_formats.decision.layout_planner import (
        _resolve_block_pattern,
    )

    assert _resolve_block_pattern(spec_with_grid_fb, caps_no_grid) is None

    # Q1: `steps` array binding unrolls `items` so `{$index1}` renders 1., 2., 3.
    steps_payload = {
        "title": "How to brew",
        "steps": [
            {"title": "Grind beans", "detail": "Medium-fine"},
            {"title": "Pour water", "detail": "93C"},
        ],
    }
    steps_ptrs = inspect_payload_pointers(steps_payload)
    steps_bindings = planner_no_grid.bind_slots(
        ArchetypeGrammar.default().block("steps"),
        steps_ptrs,
        set(),
        payload=steps_payload,
    )
    steps_slot = steps_bindings.get("items")
    assert steps_slot is not None
    assert len(steps_slot.items) == 2
    assert steps_slot.items[0]["title"].pointer == "/steps/0/title"
    assert steps_slot.items[1]["title"].pointer == "/steps/1/title"


def test_threshold_overrides_take_precedence_over_grammar_thresholds() -> None:
    """`SynthesisConfig.threshold_overrides` wins per key; other keys stay on the grammar."""
    grammar = ArchetypeGrammar.default()
    planner = LayoutPlanner(
        grammar, SynthesisConfig(threshold_overrides={"optional": 0.9})
    )
    assert planner.threshold("optional") == pytest.approx(0.9)
    assert planner.threshold("expected") == pytest.approx(grammar.threshold("expected"))
    assert planner.threshold("actionGateCap") == pytest.approx(
        grammar.threshold("actionGateCap")
    )
    with pytest.raises(KeyError):
        planner.threshold("not_a_threshold")

    # Raising `optional` to 0.9 drops the 0.85 collection gate that passed at 0.75.
    scripted: dict[str, ScriptedValue] = {
        "family": ("inspect", 0.80),
        "stakes": 0.2,
        "urgency": 0.1,
        "archetype:inspect": ("detail", 0.85),
        "gate:headline": 0.80,
        "gate:prose": 0.90,
        "gate:collection": 0.85,
        "salience:/rating": 2.4,
        "salience:/priceFrom": 2.6,
    }
    _, _, _, default_outcome, _ = _run_fixture(RESORT, scripted)
    assert default_outcome.plan is not None
    assert "collection" in default_outcome.plan.block_ids()
    _, _, _, strict_outcome, _ = _run_fixture(
        RESORT,
        scripted,
        config=SynthesisConfig(threshold_overrides={"optional": 0.9}),
    )
    assert strict_outcome.plan is not None
    assert "collection" not in strict_outcome.plan.block_ids()
    assert strict_outcome.reason is PlanReason.PLANNED
    assert strict_outcome.reason == "planned"
