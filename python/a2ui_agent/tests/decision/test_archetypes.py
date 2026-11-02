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

"""Unit tests for the archetype grammar loader, model, and lint."""

from __future__ import annotations

import copy
from typing import Any

import pytest

from a2ui.inference_formats.decision.archetypes import (
    ArchetypeGrammar,
    BlockRef,
    GrammarError,
    MeasureSpec,
    ShapeFilter,
    lint_grammar,
    load_asset,
)
from a2ui.inference_formats.decision.models import QuestionKind

_EXPECTED_ARCHETYPES = (
    "feed",
    "compare",
    "dashboard",
    "detail",
    "result",
    "confirm",
    "checkout",
    "form",
    "settings",
    "guide",
    "article",
    "timeline",
    "location",
    "chat",
)
_EXPECTED_BLOCKS = (
    "banner",
    "picture",
    "filters",
    "headline",
    "media",
    "chart",
    "facts",
    "prose",
    "collection",
    "comparison",
    "steps",
    "form",
    "groups",
    "actions",
    "timeline",
    "map",
    "conversation",
    "compose",
    "outcome",
)


def _raw_grammar() -> dict[str, Any]:
    """A deep copy of the bundled grammar JSON, safe to mutate."""
    return copy.deepcopy(load_asset("archetypes.json"))


def _minimal_grammar() -> dict[str, Any]:
    """The smallest grammar that passes schema validation and lint."""
    return {
        "version": "1",
        "thresholds": {
            "family": 0.4,
            "archetype": 0.4,
            "expected": 0.5,
            "optional": 0.75,
            "instance": 0.5,
            "reask_below": 0.75,
            "actionGateFloor": 0.7,
            "actionGateCap": 0.95,
        },
        "job": {
            "family": {
                "kind": "choice",
                "question": "What is the person here to do?",
                "options": {"inspect": "Understand one thing."},
            },
            "stakes": {
                "kind": "score",
                "question": "Stakes?",
                "levels": ["none", "high"],
            },
            "urgency": {
                "kind": "score",
                "question": "Urgency?",
                "levels": ["no", "now"],
            },
        },
        "archetypes": [{
            "id": "detail",
            "family": "inspect",
            "criteria": "One thing in depth.",
            "blocks": ["prose!", "facts?"],
        }],
        "blocks": [
            {
                "id": "prose",
                "pattern": "prose",
                "gate": {
                    "kind": "boolean",
                    "question": "Is there something to read about {body}?",
                    "yes": "Yes.",
                    "no": "No.",
                },
                "slots": {"body": {"from": ["long_text", "string"], "required": True}},
                "fallback": ["prose"],
            },
            {
                "id": "facts",
                "pattern": "facts",
                "slots": {
                    "rows": {
                        "repeat": True,
                        "from": ["string"],
                        "fields": {
                            "label": {"from": ["key"]},
                            "value": {"from": ["any"], "required": True},
                        },
                    }
                },
                "anatomy": {
                    "density": {
                        "kind": "choice",
                        "question": "How dense?",
                        "options": {"tight": "Tight rows.", "loose": "Loose rows."},
                        "requires": {"tight": ["value"], "loose": ["actions_allowed"]},
                    }
                },
                "fallback": ["facts", "collection:rows", "prose"],
            },
        ],
    }


def test_default_grammar_round_trips_the_bundled_asset() -> None:
    grammar = ArchetypeGrammar.default()
    assert grammar.version == "1"
    assert tuple(a.id for a in grammar.archetypes) == _EXPECTED_ARCHETYPES
    assert tuple(grammar.blocks) == _EXPECTED_BLOCKS
    assert grammar.families() == (
        "browse",
        "monitor",
        "inspect",
        "act",
        "input",
        "follow",
    )
    assert len({a.family for a in grammar.archetypes}) == 6
    assert grammar.thresholds["actionGateFloor"] == pytest.approx(0.70)
    assert grammar.thresholds["actionGateCap"] == pytest.approx(0.95)
    assert grammar.threshold("reask_below") == pytest.approx(0.75)
    assert len(grammar.rules) == 11
    assert len(grammar.lint) == 5


def test_default_grammar_is_cached() -> None:
    assert ArchetypeGrammar.default() is ArchetypeGrammar.default()
    fresh = ArchetypeGrammar.from_json(load_asset("archetypes.json"))
    assert fresh is not ArchetypeGrammar.default()
    assert fresh == ArchetypeGrammar.default()


def test_block_marks_are_parsed_into_requirements() -> None:
    detail = ArchetypeGrammar.default().archetype("detail")
    assert detail.block_ids() == (
        "picture",
        "banner",
        "headline",
        "prose",
        "facts",
        "media",
        "collection",
        "actions",
    )
    assert detail.requirement_of("picture") == "optional"
    assert detail.requirement_of("prose") == "expected"
    assert detail.requirement_of("missing") is None
    assert detail.at_least == 2
    feed = ArchetypeGrammar.default().archetype("feed")
    assert feed.required_block_ids() == ("collection",)
    assert BlockRef.parse("x!").mark == "x!"
    assert BlockRef.parse("x?").mark == "x?"
    assert BlockRef.parse("x").mark == "x"


def test_archetype_shape_and_frame_are_parsed() -> None:
    grammar = ArchetypeGrammar.default()
    assert grammar.archetype("compare").shape == ShapeFilter(array_length=(2, 5))
    assert grammar.archetype("feed").shape.is_empty
    assert grammar.archetype("confirm").frame == {"dialog": True}
    chat = grammar.archetype("chat").shape
    assert chat.pointers == ("array",)
    assert "author" in chat.element_keys
    filters = grammar.block("filters").shape
    assert filters.array_length == (8, None)
    assert filters.mutable is True


def test_block_questions_slots_and_fallbacks_are_parsed() -> None:
    grammar = ArchetypeGrammar.default()
    collection = grammar.block("collection")
    assert collection.gate is not None
    assert collection.gate.kind is QuestionKind.BOOLEAN
    assert collection.gate.yes.startswith("Results")
    layout = collection.anatomy["layout"]
    assert layout.kind is QuestionKind.CHOICE
    assert tuple(layout.options) == ("rows", "cards", "grid", "reel")
    assert layout.requires["grid"] == ("picture", "pattern:collection:grid")
    assert collection.instance["badge_tone"].applies_when == {"badge": "bound"}
    assert collection.instance["badge_tone"].placeholders() == ("badge",)
    items = collection.slots["items"]
    assert items.repeat and items.required
    assert items.fields["headline"].prefer == ("name", "title", "label")
    assert items.fields["meta"].max == 2
    assert collection.fallback == ("collection",)
    assert dict(collection.questions())["anatomy.layout"] is layout

    headline = grammar.block("headline")
    assert headline.salience is not None
    assert headline.salience.per_pointer
    assert headline.salience.select == {"min": 1, "max": 6, "aboveLevel": 1.5}
    assert headline.salience.option_ids() == headline.salience.levels
    assert headline.anatomy["gauge"].applies_when == {"value": "bounded"}

    picture = grammar.block("picture")
    assert picture.slots["picture"].avoid_keys == (
        "logo",
        "icon",
        "avatar",
        "thumbnail",
    )
    assert picture.slots["width"].sibling == ("width", "w")
    assert "keyHint" in picture.anatomy["framing"].derived_when

    comparison = grammar.block("comparison")
    assert comparison.instance["headline_attribute"].options_from == "attributes"
    assert grammar.block("compose").slots["sendLabel"].default == "Send"
    assert grammar.block("conversation").anatomy["self"].options_from == (
        "messages.author.distinct"
    )


def test_prose_length_measure_levels() -> None:
    length = ArchetypeGrammar.default().block("prose").measures["length"]
    assert length.derived_from == "body.hints.wordCount"
    assert length.level_for(0) == "line"
    assert length.level_for(14) == "line"
    assert length.level_for(15) == "blurb"
    assert length.level_for(199) == "summary"
    assert length.level_for(200) == "article"
    assert length.level_for(5000) == "article"
    bounded = MeasureSpec(name="m", derived_from="x", levels={"a": (0, 1)})
    assert bounded.level_for(2) is None


def test_job_questions_and_brief_roles() -> None:
    grammar = ArchetypeGrammar.default()
    assert grammar.job["family"].kind is QuestionKind.CHOICE
    assert grammar.job["stakes"].kind is QuestionKind.SCORE
    assert len(grammar.job["stakes"].levels) == 4
    assert len(grammar.job["urgency"].levels) == 3
    roles = grammar.brief_roles()
    assert roles[:6] == grammar.families()
    assert set(roles[6:]) == set(_EXPECTED_BLOCKS)
    assert grammar.archetypes_in("act") == tuple(
        grammar.archetype(i) for i in ("result", "confirm", "checkout")
    )
    with pytest.raises(KeyError):
        grammar.archetype("nope")
    with pytest.raises(KeyError):
        grammar.threshold("nope")


def test_minimal_grammar_loads() -> None:
    grammar = ArchetypeGrammar.from_json(_minimal_grammar())
    assert grammar.archetype("detail").requirement_of("prose") == "required"
    assert grammar.block("facts").slot_names() == ("rows", "label", "value")
    assert grammar.rules == ()


def test_schema_violation_raises_grammar_error() -> None:
    raw = _minimal_grammar()
    raw["thresholds"]["family"] = 1.5
    with pytest.raises(GrammarError, match="schema validation") as info:
        ArchetypeGrammar.from_json(raw)
    assert "/thresholds/family" in str(info.value)

    raw = _minimal_grammar()
    raw["blocks"][0]["gate"]["kind"] = "ternary"
    with pytest.raises(GrammarError, match="schema validation"):
        ArchetypeGrammar.from_json(raw)

    raw = _minimal_grammar()
    raw["archetypes"][0]["blocks"] = ["Prose!"]
    with pytest.raises(GrammarError, match="schema validation"):
        ArchetypeGrammar.from_json(raw)


def test_lint_archetype_needs_required_or_expected_block() -> None:
    raw = _minimal_grammar()
    raw["archetypes"][0]["blocks"] = ["prose?", "facts?"]
    with pytest.raises(GrammarError, match="no required or expected block"):
        ArchetypeGrammar.from_json(raw)


def test_lint_block_ids_must_exist() -> None:
    raw = _minimal_grammar()
    raw["archetypes"][0]["blocks"].append("ghost")
    with pytest.raises(GrammarError, match="unknown block 'ghost'"):
        ArchetypeGrammar.from_json(raw)


@pytest.mark.parametrize("entry", ["sparkles", "sparkle-dust", "unknown:rows"])
def test_lint_fallback_entries(entry: str) -> None:
    raw = _minimal_grammar()
    raw["blocks"][1]["fallback"] = [entry]
    with pytest.raises(GrammarError, match="fallback entry"):
        ArchetypeGrammar.from_json(raw)


@pytest.mark.parametrize("entry", ["collection:", "collection:Cards", "a:b:c"])
def test_schema_rejects_malformed_fallback_entries(entry: str) -> None:
    raw = _minimal_grammar()
    raw["blocks"][1]["fallback"] = [entry]
    with pytest.raises(GrammarError, match="schema validation"):
        ArchetypeGrammar.from_json(raw)


def test_lint_block_pattern_must_be_abstract_pattern() -> None:
    raw = _minimal_grammar()
    raw["blocks"][1]["pattern"] = "sparkles"
    with pytest.raises(GrammarError, match="not an abstract pattern"):
        ArchetypeGrammar.from_json(raw)


def test_lint_placeholders_must_name_slots() -> None:
    raw = _minimal_grammar()
    raw["blocks"][0]["gate"]["question"] = "Is {headline} readable?"
    with pytest.raises(GrammarError, match="refers to 'headline'"):
        ArchetypeGrammar.from_json(raw)


def test_lint_applies_when_must_name_slots() -> None:
    raw = _minimal_grammar()
    raw["blocks"][1]["anatomy"]["density"]["appliesWhen"] = {"badge": "bound"}
    with pytest.raises(GrammarError, match="refers to 'badge'"):
        ArchetypeGrammar.from_json(raw)


@pytest.mark.parametrize(
    "entry", ["nope", "pattern:sparkles.grid", "density:huge", "pattern:collection"]
)
def test_lint_requires_entries(entry: str) -> None:
    raw = _minimal_grammar()
    raw["blocks"][1]["anatomy"]["density"]["requires"] = {"tight": [entry]}
    with pytest.raises(GrammarError, match=f"requires {entry!r}"):
        ArchetypeGrammar.from_json(raw)


@pytest.mark.parametrize(
    "entry",
    [
        "value",
        "rows",
        "actions_allowed",
        "pattern:collection:grid",
        "loose",
        "density:loose",
    ],
)
def test_lint_requires_accepts_valid_entries(entry: str) -> None:
    raw = _minimal_grammar()
    raw["blocks"][1]["anatomy"]["density"]["requires"] = {"tight": [entry]}
    ArchetypeGrammar.from_json(raw)


def test_lint_options_from_must_start_at_slot() -> None:
    raw = _minimal_grammar()
    raw["blocks"][1]["anatomy"]["density"] = {
        "kind": "choice",
        "question": "Which?",
        "optionsFrom": "columns.name",
    }
    with pytest.raises(GrammarError, match="optionsFrom 'columns.name'"):
        ArchetypeGrammar.from_json(raw)
    raw["blocks"][1]["anatomy"]["density"]["optionsFrom"] = "rows.label"
    ArchetypeGrammar.from_json(raw)


def test_lint_rejects_duplicate_ids() -> None:
    raw = _minimal_grammar()
    raw["blocks"].append(copy.deepcopy(raw["blocks"][0]))
    with pytest.raises(GrammarError, match="Duplicate block id 'prose'"):
        ArchetypeGrammar.from_json(raw)
    raw = _minimal_grammar()
    raw["archetypes"].append(copy.deepcopy(raw["archetypes"][0]))
    with pytest.raises(GrammarError, match="Duplicate archetype id 'detail'"):
        ArchetypeGrammar.from_json(raw)


def test_lint_reports_every_finding_at_once() -> None:
    raw = _minimal_grammar()
    raw["archetypes"][0]["blocks"] = ["ghost?", "prose?"]
    raw["blocks"][1]["fallback"] = ["sparkles"]
    with pytest.raises(GrammarError) as info:
        ArchetypeGrammar.from_json(raw)
    message = str(info.value)
    assert "no required or expected block" in message
    assert "unknown block 'ghost'" in message
    assert "fallback entry 'sparkles'" in message


def test_lint_grammar_on_bundled_grammar_is_clean() -> None:
    grammar = ArchetypeGrammar.default()
    assert lint_grammar(grammar.archetypes, tuple(grammar.blocks.values())) == []


def test_bundled_grammar_mutation_is_caught_by_lint() -> None:
    raw = _raw_grammar()
    raw["archetypes"][0]["blocks"] = ["banner?", "filters?"]
    with pytest.raises(GrammarError, match="Archetype 'feed'"):
        ArchetypeGrammar.from_json(raw)


def test_lint_rejects_unknown_archetype_family() -> None:
    raw = _minimal_grammar()
    raw["archetypes"][0]["family"] = "orient"
    with pytest.raises(
        GrammarError, match="Archetype 'detail' references unknown family 'orient'"
    ):
        ArchetypeGrammar.from_json(raw)


def test_grammar_threshold_relations_are_linted() -> None:
    raw = _minimal_grammar()
    raw["thresholds"]["actionGateFloor"] = 0.96
    with pytest.raises(GrammarError, match="actionGateFloor must be <= actionGateCap"):
        ArchetypeGrammar.from_json(raw)
    raw = _minimal_grammar()
    raw["thresholds"]["expected"] = 0.8
    with pytest.raises(GrammarError, match="expected must be <= optional"):
        ArchetypeGrammar.from_json(raw)


def test_requirement_and_block_marks_are_enums_that_compare_to_wire_strings() -> None:
    from a2ui.inference_formats.decision.models import Requirement

    ref = BlockRef.parse("prose!")
    assert ref.requirement is Requirement.REQUIRED
    assert ref.requirement == "required"
    assert ref.mark == "prose!"
    assert {ref.requirement} == {"required"}


def test_lint_rejects_retired_fallback_keywords() -> None:
    raw = _minimal_grammar()
    raw["blocks"][1]["fallback"] = ["facts", "repeat-in-parent"]
    with pytest.raises(GrammarError, match="fallback entry 'repeat-in-parent'"):
        ArchetypeGrammar.from_json(raw)


def test_parse_slots_and_questions_handle_none() -> None:
    from a2ui.inference_formats.decision.archetypes import SlotSpec

    slot = SlotSpec.from_json("items", {"from": ["array_of_objects"], "fields": None})
    assert slot.fields == {}
