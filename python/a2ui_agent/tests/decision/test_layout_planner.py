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
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from a2ui.core import A2uiValidationError
from a2ui.inference_formats.decision import (
    SurfaceTemplate,
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
    MAX_ORPHAN_FACTS_ROWS,
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
    compute_fit_score,
)
from a2ui.inference_formats.decision.models import (
    ActionSpec,
    ActionStyle,
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


_TRANSFER_FIXTURE = LayoutFixture(
    name="transfer_clean",
    intent=TRANSFER.intent,
    payload={k: v for k, v in TRANSFER.payload.items() if k != "actions"},
)
_TRANSFER_ACTIONS: tuple[ActionSpec, ...] = (
    ActionSpec(id="send", label="Send"),
    ActionSpec(id="cancel", label="Cancel"),
)


def _run_fixture(
    fixture: LayoutFixture,
    scripted: Mapping[str, ScriptedValue],
    *,
    config: SynthesisConfig | None = None,
    brief: LayoutBrief | None = None,
    capabilities: PatternCapabilities | None = None,
    templates: Sequence[SurfaceTemplate] = (),
    actions: Sequence[ActionSpec] = (),
    labels: Mapping[str, str] | None = None,
    exclude: Sequence[str] = (),
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
        templates=templates,
        actions=actions,
        labels=labels,
        exclude=exclude,
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
        "instance:actions.primary:buttons": ("send", 0.90),
        "instance:actions.destructive:send": 0.80,
        "instance:actions.destructive:cancel": 0.10,
        "salience:/amount": 2.9,
        "salience:/recipient": 2.6,
        "salience:/fee": 1.9,
        "salience:/arrives": 1.7,
    }

    _, _, _, blocked, _ = _run_fixture(
        _TRANSFER_FIXTURE,
        {**base_scripted, "archetype:act": ("confirm", 0.80)},
        actions=_TRANSFER_ACTIONS,
    )
    assert blocked.reason == "action_gate"
    assert blocked.plan is None

    _, _, _, committed, _ = _run_fixture(
        _TRANSFER_FIXTURE,
        {**base_scripted, "archetype:act": ("confirm", 0.90)},
        actions=_TRANSFER_ACTIONS,
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
    assert [it["action"].literal for it in buttons.items] == ["cancel", "send"]
    assert actions.instances["send"]["primary"] == "false"
    assert actions.instances["send"]["destructive"] == "true"
    assert actions.instances["cancel"]["primary"] == "false"


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


def test_lint_components_catches_structural_and_plan_level_violations() -> None:
    """`lint_components` catches structural and plan-level violations with zero catalog names."""
    bad_plan = LayoutPlan(
        family="act",
        archetype="confirm",
        page=PageBindings(title=SlotBinding(literal="   ")),
        blocks=(
            PlannedBlock(
                block_id="collection_a",
                pattern="collection",
                variant_knobs={"layout": "reel"},
            ),
            PlannedBlock(
                block_id="collection_b",
                pattern="collection",
                variant_knobs={"layout": "reel"},
            ),
            PlannedBlock(
                block_id="actions",
                pattern="actions",
                bindings=BlockBindings(
                    slots={
                        "buttons": SlotBinding(
                            items=(
                                {
                                    "action": SlotBinding(literal="go"),
                                    "label": SlotBinding(literal="Go"),
                                },
                                {
                                    "action": SlotBinding(literal="send"),
                                    "label": SlotBinding(literal="Send"),
                                },
                            )
                        )
                    }
                ),
                instances={
                    "go": {"primary": "true"},
                    "send": {"primary": "true"},
                },
            ),
        ),
    )
    bad_components: list[dict[str, Any]] = [
        {
            "id": "root",
            "component": "CustomStack",
            "children": [
                "empty_box",
                "missing_id",
                "dup1",
                "dup2",
            ],
        },
        {"id": "empty_box", "component": "CustomBox", "children": []},
        {"id": "dup1", "component": "CustomLeaf", "value": {"@path": "/shared"}},
        {"id": "dup2", "component": "CustomLeaf", "value": {"@path": "/shared"}},
    ]

    findings: tuple[LintFinding, ...] = lint_components(bad_components, plan=bad_plan)
    codes = {f.code for f in findings}
    assert codes == {
        "empty_container",
        "missing_component",
        "multiple_primary_buttons",
        "duplicate_pointer_binding",
        "empty_authored_text",
        "multiple_reels",
    }

    with pytest.raises(A2uiValidationError, match="Layout component lint failed"):
        lint_components(bad_components, plan=bad_plan, raise_on_error=True)

    valid_components: list[dict[str, Any]] = [
        {
            "id": "root",
            "component": "CustomStack",
            "children": ["title_leaf", "body_leaf", "act_leaf"],
        },
        {
            "id": "title_leaf",
            "component": "CustomLeaf",
            "text": {"@path": "/title"},
        },
        {
            "id": "body_leaf",
            "component": "CustomLeaf",
            "text": {"@path": "/body"},
        },
        {
            "id": "act_leaf",
            "component": "CustomTrigger",
            "variant": "primary",
            "action": {"event": {"name": "ok"}},
        },
    ]
    assert lint_components(valid_components, raise_on_error=True) == ()

    # Explicit `child_slot_keys` from `CatalogDecisionGraph` flags custom slot names
    explicit_slot_findings = lint_components(
        [{
            "id": "root",
            "component": "CustomOverlay",
            "opener": "missing_opener",
            "pane": "",
        }],
        child_slot_keys=("opener", "pane"),
    )
    assert {f.code for f in explicit_slot_findings} == {
        "empty_container",
        "missing_component",
    }


def test_threshold_boundary_cases_050_075_and_0875() -> None:
    """Tests exact boundary behavior at 0.50 (expected), 0.75 (optional), and 0.875 (action gate)."""
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
        _TRANSFER_FIXTURE,
        {**base_transfer, "archetype:act": ("confirm", 0.874)},
        actions=_TRANSFER_ACTIONS,
    )
    assert gate_below.reason == "action_gate"

    _, _, _, gate_exact, _ = _run_fixture(
        _TRANSFER_FIXTURE,
        {**base_transfer, "archetype:act": ("confirm", 0.875)},
        actions=_TRANSFER_ACTIONS,
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


def test_grammar_thresholds_and_conservativeness_scaling() -> None:
    """`LayoutPlanner.threshold` reads grammar thresholds and `conservativeness` scales action gate."""
    grammar = ArchetypeGrammar.default()
    planner = LayoutPlanner(grammar, SynthesisConfig())
    assert planner.threshold("template") == pytest.approx(0.75)
    assert planner.threshold("templateMutable") == pytest.approx(0.85)
    assert planner.threshold("actionGateFloor") == pytest.approx(0.70)
    assert planner.threshold("actionGateCap") == pytest.approx(0.95)
    with pytest.raises(KeyError):
        planner.threshold("not_a_threshold")
    with pytest.raises(KeyError):
        planner.threshold("reask_below")

    base_transfer: dict[str, ScriptedValue] = {
        "family": ("act", 0.85),
        "stakes": 2.1,
        "urgency": 0.6,
        "gate:facts": 0.85,
        "gate:actions": 0.90,
        "salience:/amount": 2.9,
        "salience:/recipient": 2.6,
    }

    # conservativeness=0.0 -> gate drops to actionGateFloor (0.70), so 0.71 passes!
    _, _, _, permissive, _ = _run_fixture(
        _TRANSFER_FIXTURE,
        {**base_transfer, "archetype:act": ("confirm", 0.71)},
        config=SynthesisConfig(conservativeness=0.0),
        actions=_TRANSFER_ACTIONS,
    )
    assert permissive.reason is PlanReason.PLANNED
    assert permissive.plan is not None
    assert permissive.plan.actions_allowed is True

    # conservativeness=1.0 -> gate rises to actionGateCap (0.95), so 0.94 is blocked and 0.95 passes!
    _, _, _, strict_blocked, _ = _run_fixture(
        _TRANSFER_FIXTURE,
        {**base_transfer, "archetype:act": ("confirm", 0.94)},
        config=SynthesisConfig(conservativeness=1.0),
        actions=_TRANSFER_ACTIONS,
    )
    assert strict_blocked.reason is PlanReason.ACTION_GATE

    _, _, _, strict_passed, _ = _run_fixture(
        _TRANSFER_FIXTURE,
        {**base_transfer, "archetype:act": ("confirm", 0.95)},
        config=SynthesisConfig(conservativeness=1.0),
        actions=_TRANSFER_ACTIONS,
    )
    assert strict_passed.reason is PlanReason.PLANNED


def test_template_question_only_when_matching_and_respects_mutable_threshold() -> None:
    """`template` question appears iff templates match and reads against `template` / `templateMutable`."""
    resort_tpl = SurfaceTemplate(
        template_id="resort_card",
        description="Fixed resort overview card.",
        surface_id="resort",
        catalog_id=None,
        protocol_version="1.0",
        components=({"id": "root", "component": "Text", "text": "Resort"},),
        required_pointers=("/name", "/rating"),
    )
    unmatched_tpl = SurfaceTemplate(
        template_id="flight_card",
        description="Flight boarding pass.",
        surface_id="flight",
        catalog_id=None,
        protocol_version="1.0",
        components=({"id": "root", "component": "Text", "text": "Flight"},),
        required_pointers=("/flightNumber",),
    )

    # Non-matching template -> no `template` question in batch
    _, no_tpl_state, _, _, no_tpl_sa = _run_fixture(
        RESORT,
        {
            "family": ("inspect", 0.80),
            "archetype:inspect": ("detail", 0.85),
            "gate:headline": 0.85,
            "gate:prose": 0.85,
        },
        templates=(unmatched_tpl,),
    )
    assert "template" not in no_tpl_sa.asked
    assert [q.id for q in no_tpl_state.batch.questions][0] == "family"

    # Matching template -> `template` is FIRST question with `("resort_card", "compose")`
    _, match_state, _, win_outcome, _ = _run_fixture(
        RESORT,
        {"template": ("resort_card", 0.75)},
        templates=(resort_tpl, unmatched_tpl),
    )
    first_q = match_state.batch.questions[0]
    assert first_q.id == "template"
    assert first_q.options == ("resort_card", "compose")
    assert win_outcome.plan is not None
    assert win_outcome.plan.template_id == "resort_card"

    # Below 0.75 (`template` threshold) -> falls back to composing an archetype plan
    _, _, _, compose_outcome, _ = _run_fixture(
        RESORT,
        {
            "template": ("resort_card", 0.74),
            "family": ("inspect", 0.80),
            "archetype:inspect": ("detail", 0.85),
            "gate:headline": 0.85,
            "gate:prose": 0.85,
        },
        templates=(resort_tpl,),
    )
    assert compose_outcome.plan is not None
    assert compose_outcome.plan.template_id is None
    assert compose_outcome.plan.archetype == "detail"

    # Mutable payload uses `templateMutable` (0.85): 0.80 composes, 0.85 picks template!
    settings_tpl = SurfaceTemplate(
        template_id="settings_sheet",
        description="Podcast settings sheet.",
        surface_id="settings",
        catalog_id=None,
        protocol_version="1.0",
        components=({"id": "root", "component": "Text", "text": "Settings"},),
        required_pointers=("/playback/speed",),
    )
    _, _, _, mut_below, _ = _run_fixture(
        SETTINGS,
        {
            "template": ("settings_sheet", 0.80),
            "family": ("input", 0.85),
            "archetype:input": ("settings", 0.85),
            "gate:groups": 0.90,
        },
        templates=(settings_tpl,),
    )
    assert mut_below.plan is not None
    assert mut_below.plan.template_id is None

    # Two-stage batch short-circuits Stage 2 when template clears `templateMutable` (0.85)
    planner = LayoutPlanner()
    s_ptrs = inspect_payload_pointers(
        SETTINGS.payload, mutable_paths=SETTINGS.mutable_paths
    )
    s1_batch, s_state = planner.build_stage1_batch(
        SETTINGS.intent,
        s_ptrs,
        payload=SETTINGS.payload,
        templates=(settings_tpl,),
    )
    s1_ans = asyncio.run(
        ScriptedAnswers({"template": ("settings_sheet", 0.86)})
        .backend()
        .answer(s1_batch)
    )
    s2_batch = planner.build_stage2_batch(s_state, s1_ans)
    assert s2_batch.questions == ()
    mut_win = planner.read(s_state, s1_ans)
    assert mut_win.plan is not None
    assert mut_win.plan.template_id == "settings_sheet"


def test_action_style_and_scoped_collection_item_actions() -> None:
    """`ActionSpec.style` pins primary/destructive flags and `scope` attaches item buttons."""
    # 1. Explicit PRIMARY and DESTRUCTIVE styles skip redundant instance questions
    styled_actions = (
        ActionSpec(id="delete_acct", label="Delete", style=ActionStyle.DESTRUCTIVE),
        ActionSpec(id="keep_acct", label="Keep", style=ActionStyle.PRIMARY),
    )
    _, _, _, styled_out, styled_sa = _run_fixture(
        _TRANSFER_FIXTURE,
        {
            "family": ("act", 0.90),
            "stakes": 1.0,
            "urgency": 0.2,
            "archetype:act": ("confirm", 0.90),
            "gate:facts": 0.85,
            "gate:actions": 0.90,
        },
        actions=styled_actions,
    )
    assert "instance:actions.primary:buttons" not in styled_sa.asked
    assert "instance:actions.destructive:delete_acct" not in styled_sa.asked
    assert "instance:actions.destructive:keep_acct" in styled_sa.asked
    assert styled_out.plan is not None
    act_block = next(b for b in styled_out.plan.blocks if b.block_id == "actions")
    assert act_block.instances["keep_acct"]["primary"] == "true"
    assert act_block.instances["delete_acct"]["destructive"] == "true"

    # 2. Scoped item action attaches to `collection` and sets `trailing='button'`
    scoped = (ActionSpec(id="view_photo", label="Open photo", scope="/photos"),)
    _, _, _, col_out, col_sa = _run_fixture(
        RESORT,
        {
            "family": ("inspect", 0.85),
            "stakes": 0.2,
            "urgency": 0.1,
            "archetype:inspect": ("detail", 0.85),
            "gate:headline": 0.80,
            "gate:collection": 0.90,
        },
        actions=scoped,
    )
    assert "anatomy:collection.trailing" not in col_sa.asked
    assert col_out.plan is not None
    col_block = next(b for b in col_out.plan.blocks if b.block_id == "collection")
    assert col_block.variant_knobs.get("trailing") == "button"
    assert col_block.variant_knobs.get("trailing.label") == "Open photo"
    items_slot = col_block.bindings.get("items")
    assert items_slot is not None
    assert items_slot.fields["action"].literal == "view_photo"


def test_decision_suite_gap_fixes_orphan_recovery_3_field_items_redirect_and_primitive_arrays() -> (
    None
):
    """Covers the four completeness gaps surfaced by `decision_v1_0`."""
    # Gap A: Unclaimed single top-level scalar pointer (`/author`) is recovered into `facts`
    # even when `gate:facts < 0.75`.
    article_fixture = LayoutFixture(
        name="article_summary",
        intent="Show the article summary",
        payload={
            "title": "Why Declarative UIs Work",
            "author": "Ada Lovelace",
            "body": (
                "Declarative user interfaces separate state from structure so that"
                " agents can emit data payloads while deterministic layout rules"
                " handle presentation and accessibility."
            ),
        },
    )
    _, _, _, article_outcome, _ = _run_fixture(
        article_fixture,
        {
            "family": ("inspect", 0.85),
            "archetype:inspect": ("detail", 0.85),
            "gate:prose": 0.90,
            "gate:facts": 0.40,
        },
    )
    assert article_outcome.plan is not None
    assert "facts" in article_outcome.plan.block_ids()
    facts_block = next(b for b in article_outcome.plan.blocks if b.block_id == "facts")
    rows_slot = facts_block.bindings.get("rows")
    assert rows_slot is not None
    fact_ptrs = [it["value"].pointer for it in rows_slot.items]
    assert "/author" in fact_ptrs

    # Gap B: 3-field collection items (`name`, `elevation`, `openRuns` and `title`, `snippet`, `url`)
    # bind `headline`, `supporting`, and `meta`.
    search_fixture = LayoutFixture(
        name="search_results",
        intent="Show search results",
        payload={
            "results": [
                {
                    "title": "A2UI Protocol Specification",
                    "snippet": "Streaming declarative user interfaces for AI agents.",
                    "url": "https://a2ui.dev/spec",
                },
                {
                    "title": "Decision Model Layout Grammar",
                    "snippet": "Archetype and block selection via zero-shot scoring.",
                    "url": "https://a2ui.dev/decision",
                },
            ]
        },
    )
    _, _, _, search_outcome, _ = _run_fixture(
        search_fixture,
        {
            "family": ("browse", 0.90),
            "archetype:browse": ("feed", 0.90),
            "gate:collection": 0.90,
        },
    )
    assert search_outcome.plan is not None
    col_block = next(
        b for b in search_outcome.plan.blocks if b.block_id == "collection"
    )
    items_slot = col_block.bindings.get("items")
    assert items_slot is not None
    assert items_slot.fields["headline"].pointer == "title"
    assert items_slot.fields["supporting"].pointer == "snippet"
    assert items_slot.fields["meta"].pointer == "url"

    # Gap C: Flat scalar step payload (`recipeName`, `currentStep`, `totalSteps`, `instruction`)
    # redirects `follow` to an eligible family (`inspect -> detail`) and binds all pointers.
    recipe_fixture = LayoutFixture(
        name="sourdough_step",
        intent="Walk me through making sourdough bread step by step",
        payload={
            "recipeName": "Country Sourdough",
            "currentStep": 1,
            "totalSteps": 5,
            "instruction": "Mix 50g starter with 50g warm water and 50g bread flour.",
        },
    )
    _, _, _, recipe_outcome, _ = _run_fixture(
        recipe_fixture,
        {
            "family": {"follow": 0.80, "inspect": 0.15, "act": 0.05},
            "archetype:inspect": ("none", 0.60),
            "gate:prose": 0.85,
            "gate:facts": 0.85,
        },
    )
    assert recipe_outcome.reason == "planned"
    assert recipe_outcome.plan is not None
    assert recipe_outcome.plan.family == "inspect"
    all_bound_ptrs = set(recipe_outcome.plan.page.title.pointers())
    for b in recipe_outcome.plan.blocks:
        all_bound_ptrs.update(b.bindings.pointers())
    assert {
        "/recipeName",
        "/currentStep",
        "/totalSteps",
        "/instruction",
    } <= all_bound_ptrs

    # Gap D: On a catalog without `chart`, `chart?` in `dashboard` is skipped as a redundant
    # optional fallback (since `headline` is already in `dashboard.blocks`), and primitive
    # string arrays (`regions: ["us-east", "us-west", "eu-central"]`) unroll into `collection`.
    cluster_fixture = LayoutFixture(
        name="cluster_status",
        intent="Show cluster status across regions",
        payload={
            "clusterName": "prod-us-1",
            "overallHealth": "healthy",
            "activeNodes": 42,
            "regions": ["us-east", "us-west", "eu-central"],
        },
    )
    caps_no_chart = StubCapabilities(disabled=frozenset({("chart", None)}))
    _, _, _, cluster_outcome, cluster_sa = _run_fixture(
        cluster_fixture,
        {
            "family": ("monitor", 0.90),
            "archetype:monitor": ("dashboard", 0.90),
            "gate:banner": 0.85,
            "gate:headline": 0.90,
            "gate:collection": 0.85,
        },
        capabilities=caps_no_chart,
    )
    assert "gate:chart" not in cluster_sa.asked
    assert cluster_outcome.plan is not None
    assert "chart" not in cluster_outcome.plan.block_ids()
    assert "collection" in cluster_outcome.plan.block_ids()
    reg_col = next(b for b in cluster_outcome.plan.blocks if b.block_id == "collection")
    reg_items = reg_col.bindings.get("items")
    assert reg_items is not None
    assert len(reg_items.items) == 3
    assert [it["headline"].pointer for it in reg_items.items] == [
        "/regions/0",
        "/regions/1",
        "/regions/2",
    ]


def test_two_stage_batching_reduces_pairs_and_matches_single_stage() -> None:
    """`build_stage1_batch` + `build_stage2_batch` asks fewer pairs while producing the same plan."""
    scripted: dict[str, ScriptedValue] = {
        "family": ("monitor", 0.90),
        "stakes": 0.4,
        "urgency": 1.6,
        "archetype:monitor": ("dashboard", 0.88),
        "gate:banner": 0.85,
        "gate:headline": 0.90,
        "gate:facts": 0.80,
        "gate:collection": 0.20,
        "gate:actions": 0.20,
    }
    _, single_state, _, single_outcome, _ = _run_fixture(HOST, scripted)
    assert single_outcome.plan is not None

    grammar = ArchetypeGrammar.default()
    planner = LayoutPlanner(grammar)
    pointers = inspect_payload_pointers(HOST.payload, mutable_paths=HOST.mutable_paths)
    sa = ScriptedAnswers(answers=scripted)
    backend = sa.backend()
    stage1_batch, state = planner.build_stage1_batch(
        HOST.intent, pointers, payload=HOST.payload
    )
    stage1_answers = asyncio.run(backend.answer(stage1_batch))
    stage2_batch = planner.build_stage2_batch(state, stage1_answers)
    stage2_answers = asyncio.run(backend.answer(stage2_batch))
    two_stage_outcome = planner.read(state, (*stage1_answers, *stage2_answers))

    assert two_stage_outcome.plan is not None
    assert two_stage_outcome.plan.family == single_outcome.plan.family
    assert two_stage_outcome.plan.archetype == single_outcome.plan.archetype
    assert two_stage_outcome.plan.block_ids() == single_outcome.plan.block_ids()
    assert state.batch.pair_count() < single_state.batch.pair_count()


def test_family_none_wins_no_fit_and_falls_back_below_threshold() -> None:
    """`family == 'none'` at `>= thresholds.noFit` returns `NO_FIT`; below `noFit` checks next family."""
    planner = LayoutPlanner()
    assert planner.threshold("noFit") == pytest.approx(0.50)

    _, state_exact, _, exact_no_fit, sa = _run_fixture(HOST, {"family": ("none", 0.50)})
    fam_q = next(q for q in state_exact.batch.questions if q.id == "family")
    assert fam_q.candidates().count("none") == 1
    assert "archetype:none" not in sa.asked
    assert exact_no_fit.reason is PlanReason.NO_FIT
    assert exact_no_fit.plan is None
    assert exact_no_fit.fit_score is not None
    assert 0.0 <= exact_no_fit.fit_score <= 1.0
    assert any(
        r.question.id == "family" and r.outcome == "no_fit" for r in state_exact.trace
    )
    assert any(r.question.id == "fit_score" for r in state_exact.trace)

    # Below `noFit` (0.49 < 0.50), runner-up `monitor` >= 0.40 wins cleanly
    _, _, _, runner_up, _ = _run_fixture(
        HOST,
        {
            "family": {"none": 0.49, "monitor": 0.41, "browse": 0.10},
            "archetype:monitor": ("dashboard", 0.85),
            "gate:headline": 0.90,
            "gate:facts": 0.80,
        },
    )
    assert runner_up.reason is PlanReason.PLANNED
    assert runner_up.plan is not None
    assert runner_up.plan.family == "monitor"

    # Below `noFit` AND runner-up below `family` threshold (0.40) -> `NO_FAMILY`
    _, _, _, abstained, _ = _run_fixture(
        HOST,
        {"family": {"none": 0.49, "monitor": 0.30, "browse": 0.21}},
    )
    assert abstained.reason is PlanReason.NO_FAMILY
    assert abstained.plan is None

    # Two-stage batch short-circuits Stage 2 on `family == 'none'` >= `noFit`
    ptrs = inspect_payload_pointers(HOST.payload, mutable_paths=HOST.mutable_paths)
    s1_batch, s_state = planner.build_stage1_batch(
        HOST.intent, ptrs, payload=HOST.payload
    )
    s1_ans = asyncio.run(
        ScriptedAnswers({"family": ("none", 0.85)}).backend().answer(s1_batch)
    )
    s2_batch = planner.build_stage2_batch(s_state, s1_ans)
    assert s2_batch.questions == ()
    s_outcome = planner.read(s_state, s1_ans)
    assert s_outcome.reason is PlanReason.NO_FIT


def test_fit_score_monotonicity_across_all_four_inputs_and_trace() -> None:
    """`fit_score` is monotonic in archetype prob, entropy, orphan share, and weak required slots."""
    assert compute_fit_score(0.90, 0.20, 0.10, 0.10) > compute_fit_score(
        0.60, 0.20, 0.10, 0.10
    )
    assert compute_fit_score(0.85, 0.10, 0.10, 0.10) > compute_fit_score(
        0.85, 0.80, 0.10, 0.10
    )
    assert compute_fit_score(0.85, 0.20, 0.00, 0.10) > compute_fit_score(
        0.85, 0.20, 0.50, 0.10
    )
    assert compute_fit_score(0.85, 0.20, 0.10, 0.00) > compute_fit_score(
        0.85, 0.20, 0.10, 0.50
    )
    assert 0.0 <= compute_fit_score(1.5, -0.5, 2.0, 2.0) <= 1.0

    # 1 & 2. End-to-end: higher archetype prob and lower Shannon entropy increase `fit_score`
    base_resort: dict[str, ScriptedValue] = {
        "family": ("inspect", 0.85),
        "gate:picture": 0.90,
        "gate:headline": 0.85,
        "gate:prose": 0.90,
        "gate:collection": 0.85,
        "salience:/rating": 2.5,
        "salience:/priceFrom": 2.6,
    }
    _, high_p_state, _, high_p_out, _ = _run_fixture(
        RESORT,
        {
            **base_resort,
            "archetype:inspect": {"detail": 0.90, "profile": 0.10, "none": 0.0},
        },
    )
    _, low_h_state, _, low_h_out, _ = _run_fixture(
        RESORT,
        {
            **base_resort,
            "archetype:inspect": {"detail": 0.60, "profile": 0.40, "none": 0.0},
        },
    )
    _, high_h_state, _, high_h_out, _ = _run_fixture(
        RESORT,
        {
            **base_resort,
            "archetype:inspect": {
                "detail": 0.60,
                "profile": 0.20,
                "none": 0.20,
            },
        },
    )
    assert high_p_out.fit_score is not None
    assert low_h_out.fit_score is not None
    assert high_h_out.fit_score is not None
    assert high_p_out.plan is not None
    assert high_p_out.fit_score == pytest.approx(high_p_out.plan.fit_score)
    assert high_p_out.fit_score > low_h_out.fit_score > high_h_out.fit_score
    for st in (high_p_state, low_h_state, high_h_state):
        assert any(r.question.id == "fit_score" for r in st.trace)

    # 3. End-to-end: orphan-recovered pointers lower `fit_score`
    clean_article = LayoutFixture(
        name="clean_article",
        intent="Show article",
        payload={
            "title": "Declarative UI",
            "heroUrl": "https://example.com/hero.jpg",
            "body": "Long prose body text here.",
        },
    )
    orphan_article = LayoutFixture(
        name="orphan_article",
        intent="Show article",
        payload={
            "title": "Declarative UI",
            "heroUrl": "https://example.com/hero.jpg",
            "body": "Long prose body text here.",
            "author": "Ada Lovelace",
            "edition": "Third",
        },
    )
    article_scripted: dict[str, ScriptedValue] = {
        "family": ("inspect", 0.85),
        "archetype:inspect": ("detail", 0.85),
        "gate:picture": 0.90,
        "gate:prose": 0.90,
        "gate:facts": 0.20,
    }
    _, _, _, no_orphan_out, _ = _run_fixture(clean_article, article_scripted)
    _, _, _, with_orphan_out, _ = _run_fixture(orphan_article, article_scripted)
    assert no_orphan_out.fit_score is not None
    assert with_orphan_out.fit_score is not None
    assert no_orphan_out.fit_score > with_orphan_out.fit_score

    # 4. End-to-end: required slot instance confidence below `thresholds.instance` lowers `fit_score`
    base_host: dict[str, ScriptedValue] = {
        "family": ("monitor", 0.90),
        "archetype:monitor": ("dashboard", 0.85),
        "gate:banner": 0.10,
        "gate:headline": 0.90,
        "gate:facts": 0.80,
        "salience:/cpu": 2.8,
        "salience:/status": 0.5,
        "salience:/uptimeHours": 1.2,
        "salience:/host": 0.4,
    }
    _, _, _, strong_inst, _ = _run_fixture(
        HOST, {**base_host, "instance:headline.news:/cpu": ("bad", 0.90)}
    )
    _, _, _, weak_inst, _ = _run_fixture(
        HOST,
        {
            **base_host,
            "instance:headline.news:/cpu": {
                "bad": 0.40,
                "good": 0.35,
                "neutral": 0.25,
            },
        },
    )
    assert strong_inst.fit_score is not None
    assert weak_inst.fit_score is not None
    assert strong_inst.fit_score > weak_inst.fit_score


def test_no_orphaned_pointers_caps_at_eight_rows_and_omits_excluded_pointers() -> None:
    """`no-orphaned-pointers` adds at most 8 `facts` rows and never recovers `exclude`d pointers."""
    wide_payload: dict[str, Any] = {
        "title": "Quarterly Audit",
        "heroUrl": "https://example.com/audit.jpg",
        "body": (
            "Detailed narrative summary of quarterly operational performance and"
            " reliability metrics across production clusters."
        ),
        **{f"metric_{idx:02d}": f"v{idx}" for idx in range(12)},
        "internalNote": "do-not-render",
        "debugEvents": [{"title": "trace-1", "detail": "internal"}],
    }
    wide_fixture = LayoutFixture(
        name="wide_audit",
        intent="Show quarterly audit summary",
        payload=wide_payload,
    )
    _, _, _, outcome, sa = _run_fixture(
        wide_fixture,
        {
            "family": ("inspect", 0.85),
            "archetype:inspect": ("detail", 0.85),
            "gate:picture": 0.90,
            "gate:prose": 0.90,
            "gate:facts": 0.10,
            "gate:collection": 0.10,
            "salience:/metric_11": 2.9,
            "salience:/metric_10": 2.8,
        },
        exclude=("/internalNote", "debugEvents"),
    )
    assert "salience:/internalNote" not in sa.asked
    assert outcome.plan is not None
    assert "collection" not in outcome.plan.block_ids()
    facts_block = next(b for b in outcome.plan.blocks if b.block_id == "facts")
    rows_slot = facts_block.bindings.get("rows")
    assert rows_slot is not None
    assert len(rows_slot.items) == MAX_ORPHAN_FACTS_ROWS == 8
    bound_ptrs = [it["value"].pointer for it in rows_slot.items]
    assert "/internalNote" not in bound_ptrs
    assert bound_ptrs[:2] == ["/metric_11", "/metric_10"]


def test_agent_labels_override_humanized_keys_in_blocks_orphans_and_prompts() -> None:
    """Agent `labels` replace humanized keys in `headline`, `facts`, `groups`, `form`, and prompts."""
    host_labels = {
        "/cpu": "Processor Load",
        "uptimeHours": "Uptime (Hours)",
        "/status": "Service Health",
    }
    _, host_state, _, host_out, _ = _run_fixture(
        HOST,
        {
            "family": ("monitor", 0.90),
            "archetype:monitor": ("dashboard", 0.85),
            "gate:banner": 0.85,
            "gate:headline": 0.90,
            "gate:facts": 0.10,
            "salience:/cpu": 2.9,
            "salience:/status": 1.0,
            "salience:/uptimeHours": 1.2,
            "instance:banner.tone:/status": ("warning", 0.85),
            "instance:headline.news:/cpu": ("bad", 0.85),
        },
        labels=host_labels,
    )
    host_prompts = {q.id: q.prompt for q in host_state.batch.questions}
    assert "Processor Load" in host_prompts["salience:/cpu"]
    assert "Processor Load" in host_prompts["instance:headline.news:/cpu"]
    assert "Service Health" in host_prompts["instance:banner.tone:/status"]
    assert host_out.plan is not None
    by_id = {b.block_id: b for b in host_out.plan.blocks}
    hl_items = by_id["headline"].bindings.get("items")
    assert hl_items is not None
    assert hl_items.items[0]["label"].literal == "Processor Load"
    # `gate:facts = 0.10` forces `/uptimeHours` through `no-orphaned-pointers`
    facts_rows = by_id["facts"].bindings.get("rows")
    assert facts_rows is not None
    row_labels = {it["value"].pointer: it["label"].literal for it in facts_rows.items}
    assert row_labels["/uptimeHours"] == "Uptime (Hours)"

    # `groups` headings and rows + prompts
    _, settings_state, _, settings_out, _ = _run_fixture(
        SETTINGS,
        {
            "family": ("input", 0.85),
            "archetype:input": ("settings", 0.90),
            "gate:groups": 0.90,
            "instance:groups.row_kind:/playback/autoDownload": ("switch", 0.90),
        },
        labels={
            "/playback": "Audio & Speed",
            "/playback/autoDownload": "Auto-fetch Episodes",
        },
    )
    settings_prompts = {q.id: q.prompt for q in settings_state.batch.questions}
    assert (
        "Auto-fetch Episodes"
        in settings_prompts["instance:groups.row_kind:/playback/autoDownload"]
    )
    assert settings_out.plan is not None
    groups_slot = settings_out.plan.blocks[0].bindings.get("groups")
    assert groups_slot is not None
    playback_grp = next(
        g for g in groups_slot.items if g["heading"].literal == "Audio & Speed"
    )
    auto_row = next(
        r
        for r in playback_grp["rows"].items
        if r["value"].pointer == "/playback/autoDownload"
    )
    assert auto_row["label"].literal == "Auto-fetch Episodes"

    # `form` field labels
    form_fixture = LayoutFixture(
        name="signup_form",
        intent="Collect contact email",
        payload={"workEmail": ""},
        mutable_paths=frozenset({"/workEmail"}),
    )
    _, _, _, form_out, _ = _run_fixture(
        form_fixture,
        {
            "family": ("input", 0.90),
            "archetype:input": ("form", 0.90),
            "gate:form": 0.90,
        },
        labels={"/workEmail": "Corporate Email Address"},
    )
    assert form_out.plan is not None
    fields_slot = form_out.plan.blocks[0].bindings.get("fields")
    assert fields_slot is not None
    assert fields_slot.items[0]["label"].literal == "Corporate Email Address"


def test_build_block_batch_and_read_block_replan_single_region() -> None:
    """`build_block_batch` asks only `block_id`'s questions and `read_block` updates that block."""
    planner, full_state, _, outcome, _ = _run_fixture(
        HOST,
        {
            "family": ("monitor", 0.90),
            "stakes": 1.0,
            "urgency": 1.2,
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
        },
    )
    assert outcome.plan is not None
    plan = outcome.plan

    updated_payload = {
        **HOST.payload,
        "cpu": 0.34,
        "cpuDelta": -0.18,
        "memoryPct": 0.88,
    }
    updated_ptrs = inspect_payload_pointers(updated_payload)
    reg_batch, reg_state = planner.build_block_batch(
        plan,
        "headline",
        updated_ptrs,
        intent=HOST.intent,
        labels={"/memoryPct": "RAM Usage", "/cpu": "CPU Load"},
        payload=updated_payload,
    )
    assert reg_batch.shared_context["region"] == "headline"
    asked_ids = [q.id for q in reg_batch.questions]
    assert asked_ids
    for q_id in asked_ids:
        assert q_id.startswith(("anatomy:headline.", "salience:", "instance:headline."))
    assert not any(
        q_id in {"family", "stakes", "urgency"}
        or q_id.startswith(("archetype:", "gate:", "instance:banner."))
        for q_id in asked_ids
    )

    reg_sa = ScriptedAnswers({
        "salience:/memoryPct": 2.9,
        "salience:/cpu": 2.5,
        "anatomy:headline.deltas": 0.90,
        "anatomy:headline.gauge": 0.85,
        "instance:headline.news:/memoryPct": ("bad", 0.90),
        "instance:headline.news:/cpu": ("good", 0.85),
    })
    reg_answers = asyncio.run(reg_sa.backend().answer(reg_batch))
    updated_block = planner.read_block(reg_state, reg_answers)
    assert updated_block.block_id == "headline"
    hl_items = updated_block.bindings.get("items")
    assert hl_items is not None
    assert [it["value"].pointer for it in hl_items.items] == [
        "/memoryPct",
        "/cpu",
    ]
    assert [it["label"].literal for it in hl_items.items] == [
        "RAM Usage",
        "CPU Load",
    ]
    assert updated_block.variant_knobs["deltas"] == "yes"
    assert updated_block.instances["/cpu"]["news"] == "good"

    # Region update on `actions` recovers bound `ActionSpec`s from the cached plan
    _, _, _, transfer_out, _ = _run_fixture(
        _TRANSFER_FIXTURE,
        {
            "family": ("act", 0.90),
            "stakes": 2.1,
            "urgency": 0.5,
            "archetype:act": ("confirm", 0.90),
            "gate:facts": 0.85,
            "gate:actions": 0.90,
            "instance:actions.primary:buttons": ("send", 0.90),
            "instance:actions.destructive:send": 0.85,
        },
        actions=_TRANSFER_ACTIONS,
    )
    assert transfer_out.plan is not None
    act_batch, act_state = planner.build_block_batch(
        transfer_out.plan,
        "actions",
        inspect_payload_pointers(_TRANSFER_FIXTURE.payload),
        intent=_TRANSFER_FIXTURE.intent,
    )
    act_ans = asyncio.run(
        ScriptedAnswers({
            "instance:actions.primary:buttons": ("send", 0.95),
            "instance:actions.destructive:send": 0.10,
        })
        .backend()
        .answer(act_batch)
    )
    updated_act = planner.read_block(act_state, act_ans)
    assert updated_act.block_id == "actions"
    assert updated_act.instances["send"]["primary"] == "true"

    # Absent block and non-region state raise `A2uiValidationError`
    with pytest.raises(A2uiValidationError, match="not present"):
        planner.build_block_batch(plan, "timeline", updated_ptrs)
    with pytest.raises(A2uiValidationError, match="build_block_batch"):
        planner.read_block(full_state, ())


def test_terminal_fallback_capabilities_ineligible_pinned_family_and_urgency_at_least() -> (
    None
):
    """Covers terminal fallback capability checks, ineligible pinned families, and `urgency-terse`."""
    from a2ui.inference_formats.decision.layout_planner import (
        _resolve_block_pattern,
    )

    grammar = ArchetypeGrammar.default()
    # H3: terminal fallback entries (`facts`, `prose`) still check `capabilities.has_pattern`.
    caps_no_terminals = StubCapabilities(
        disabled=frozenset({
            ("headline", None),
            ("facts", None),
            ("banner", None),
            ("prose", None),
        })
    )
    assert _resolve_block_pattern(grammar.block("headline"), caps_no_terminals) is None
    assert _resolve_block_pattern(grammar.block("banner"), caps_no_terminals) is None

    # M3: brief pinning an ineligible family (`input` on a read-only payload) falls back to `family`.
    brief_input = LayoutBrief.parse(["input:host,cpu"], roles=grammar.brief_roles())
    _, _, _, pinned_out, pinned_sa = _run_fixture(
        HOST,
        {
            "family": ("monitor", 0.90),
            "archetype:monitor": ("dashboard", 0.88),
            "gate:banner": 0.85,
            "gate:headline": 0.90,
            "gate:facts": 0.85,
        },
        brief=brief_input,
    )
    assert "family" in pinned_sa.asked
    assert pinned_out.reason == "planned"
    assert pinned_out.plan is not None
    assert pinned_out.plan.family == "monitor"

    # Q1: `apply_urgency_terse` preserves `prose` when dropping it would violate `archetype.at_least`.
    planner = LayoutPlanner(grammar, SynthesisConfig())
    ptrs = inspect_payload_pointers(RESORT.payload)
    batch, state = planner.build_batch(
        intent=RESORT.intent, pointers=ptrs, payload=RESORT.payload
    )
    ans = asyncio.run(ScriptedAnswers().backend().answer(batch))
    planner.read(state, ans)
    state.selected_archetype = grammar.archetype("detail")
    two_block_plan = LayoutPlan(
        family="inspect",
        archetype="detail",
        stakes=0.5,
        urgency=2.5,
        blocks=(
            PlannedBlock(
                block_id="prose",
                pattern="prose",
                bindings=BlockBindings({"body": SlotBinding(pointer="/about")}),
            ),
            PlannedBlock(
                block_id="facts",
                pattern="facts",
                bindings=BlockBindings(),
            ),
        ),
    )
    kept = apply_urgency_terse(two_block_plan, state)
    assert [b.block_id for b in kept.blocks] == ["prose", "facts"]
