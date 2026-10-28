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

"""Unit tests for the batched question types and the predict-to-answer adapter."""

from __future__ import annotations

import pytest

from a2ui.core import A2uiValidationError
from a2ui.inference_formats.decision import (
    DecisionBackend,
    DecisionDistribution,
    DecisionQuery,
    DecisionTask,
    DeterministicMockBackend,
    JevHttpBackend,
    LocalCrossEncoderBackend,
    StepZeroLogprobBackend,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
)
from a2ui.inference_formats.decision.backends import answer_from_distribution
from a2ui.inference_formats.decision.bindings import (
    is_v10,
    make_data_binding,
    make_function_call,
)
from a2ui.inference_formats.decision.models import (
    MAX_BRIEF_SECTIONS,
    BlockBindings,
    BriefSection,
    DecisionAnswer,
    DecisionBatch,
    DecisionQuestion,
    DecisionRecord,
    LayoutBrief,
    LayoutPlan,
    PatternCapabilities,
    PlanOutcome,
    PlannedBlock,
    QuestionKind,
    SemanticType,
    SlotBinding,
)
from a2ui.inference_formats.decision.payload_inspector import (
    PointerSummary,
    inspect_payload_pointers,
    split_pointer,
)

from .layout_fixtures import FIXTURES, HOST, RESORT, ScriptedAnswers

_LEVELS = ("none", "small", "medium", "large")


def _choice(
    question_id: str = "family", *, allow_none: bool = True
) -> DecisionQuestion:
    return DecisionQuestion(
        id=question_id,
        kind=QuestionKind.CHOICE,
        prompt="What is the person here to do?",
        options=("browse", "inspect"),
        option_texts=("Look through things.", "Understand one thing."),
        allow_none=allow_none,
    )


def _boolean(question_id: str = "gate:collection") -> DecisionQuestion:
    return DecisionQuestion(
        id=question_id,
        kind=QuestionKind.BOOLEAN,
        prompt="Are there several similar items the person would scan?",
        context={
            "yes": "Results, products, records.",
            "no": "This is about one thing.",
        },
    )


def _score(question_id: str = "stakes") -> DecisionQuestion:
    return DecisionQuestion(
        id=question_id,
        kind=QuestionKind.SCORE,
        prompt="If this goes wrong, how bad is it?",
        options=_LEVELS,
    )


# --- DecisionQuestion / DecisionAnswer / DecisionBatch -------------------------


def test_question_candidates_and_task_prefix() -> None:
    assert _choice().candidates() == ("browse", "inspect", "none")
    assert _choice(allow_none=False).candidates() == ("browse", "inspect")
    assert _boolean().candidates() == ("yes", "no")
    assert _score().candidates() == _LEVELS
    assert _choice("family").task is DecisionTask.FAMILY
    assert _choice("archetype:browse").task is DecisionTask.ARCHETYPE
    assert _boolean("gate:collection").task is DecisionTask.BLOCK_GATE
    assert _choice("anatomy:collection.layout").task is DecisionTask.ANATOMY
    assert _score("salience:/cpu").task is DecisionTask.SALIENCE
    assert _choice("instance:banner.tone:/status").task is DecisionTask.INSTANCE
    assert _score("stakes").task is DecisionTask.STAKES
    assert _score("urgency").task is DecisionTask.URGENCY
    assert _choice("custom:thing").task == "custom"


def test_question_validation() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        DecisionQuestion(id="", kind=QuestionKind.BOOLEAN, prompt="?")
    with pytest.raises(ValueError, match="take no options"):
        DecisionQuestion(id="b", kind=QuestionKind.BOOLEAN, prompt="?", options=("x",))
    with pytest.raises(ValueError, match="need options"):
        DecisionQuestion(id="c", kind=QuestionKind.CHOICE, prompt="?")
    with pytest.raises(ValueError, match="at least two levels"):
        DecisionQuestion(id="s", kind=QuestionKind.SCORE, prompt="?", options=("one",))
    with pytest.raises(ValueError, match="option_texts"):
        DecisionQuestion(
            id="c", kind="choice", prompt="?", options=("a", "b"), option_texts=("A",)
        )
    coerced = DecisionQuestion(id="c", kind="choice", prompt="?", options=["a"])
    assert coerced.kind is QuestionKind.CHOICE
    assert coerced.options == ("a",)
    assert f"{coerced.kind}" == "choice"


def test_answer_yes_top_and_expected() -> None:
    boolean = DecisionAnswer(
        question_id="g", distribution=DecisionDistribution({"yes": 0.8, "no": 0.2})
    )
    assert boolean.yes == pytest.approx(0.8)
    assert boolean.top() == ("yes", pytest.approx(0.8))
    choice = DecisionAnswer(
        question_id="c", distribution=DecisionDistribution({"a": 0.3, "b": 0.7})
    )
    assert choice.yes == 0.0
    assert choice.top() == ("b", pytest.approx(0.7))
    assert choice.expected is None
    score = DecisionAnswer(
        question_id="s",
        distribution=DecisionDistribution({"none": 0.5, "small": 0.5}),
        expected=0.5,
    )
    assert score.expected == 0.5


def test_batch_rejects_duplicate_ids_and_counts_pairs() -> None:
    batch = DecisionBatch(
        shared_context={"intent": "x"}, questions=[_choice(), _boolean(), _score()]
    )
    assert batch.pair_count() == 3 + 2 + 4
    with pytest.raises(ValueError, match="Duplicate question id"):
        DecisionBatch(shared_context={}, questions=(_choice(), _choice()))


def test_decision_record_defaults() -> None:
    record = DecisionRecord(question=_boolean())
    assert record.answer is None
    assert record.threshold is None
    assert record.outcome == ""


# --- _AnswerViaPredict on DeterministicMockBackend ------------------------------


@pytest.mark.asyncio
async def test_mock_backend_answers_scripted_batch_for_all_kinds() -> None:
    backend = DeterministicMockBackend(
        scripted={
            "family:What is the person here to do?": {
                "browse": 0.2,
                "inspect": 0.7,
                "none": 0.1,
            },
            "block_gate:Are there several similar items the person would scan?": {
                "yes": 0.9,
                "no": 0.1,
            },
            "stakes:If this goes wrong, how bad is it?": {
                "none": 0.1,
                "small": 0.2,
                "medium": 0.3,
                "large": 0.4,
            },
        }
    )
    batch = DecisionBatch(
        shared_context={}, questions=(_choice(), _boolean(), _score())
    )
    answers = await backend.answer(batch)
    assert [a.question_id for a in answers] == ["family", "gate:collection", "stakes"]
    family, gate, stakes = answers
    assert family.top() == ("inspect", pytest.approx(0.7))
    assert set(family.distribution.probabilities) == {"browse", "inspect", "none"}
    assert gate.yes == pytest.approx(0.9)
    assert gate.distribution.probabilities == {
        "yes": pytest.approx(0.9),
        "no": pytest.approx(0.1),
    }
    assert stakes.expected == pytest.approx(0.1 * 0 + 0.2 * 1 + 0.3 * 2 + 0.4 * 3)
    assert stakes.top() == ("large", pytest.approx(0.4))


@pytest.mark.asyncio
async def test_mock_backend_heuristic_answers_every_kind() -> None:
    backend = DeterministicMockBackend()
    batch = DecisionBatch(
        shared_context={"intent": "Browse the feed"},
        questions=(_choice(), _boolean(), _score()),
    )
    answers = await backend.answer(batch)
    family, gate, stakes = answers
    assert sum(family.distribution.probabilities.values()) == pytest.approx(1.0)
    assert family.top()[0] in ("browse", "inspect", "none")
    assert 0.0 <= gate.yes <= 1.0
    assert gate.distribution.probabilities["no"] == pytest.approx(1.0 - gate.yes)
    assert stakes.expected is not None
    assert 0.0 <= stakes.expected <= 3.0


@pytest.mark.asyncio
async def test_allow_none_adds_and_removes_the_none_option() -> None:
    seen: list[DecisionQuery] = []

    def scorer(query: DecisionQuery) -> DecisionDistribution:
        seen.append(query)
        n = len(query.candidates)
        return DecisionDistribution({c: 1.0 / n for c in query.candidates})

    backend = DeterministicMockBackend(scorer=scorer)
    with_none, without = await backend.answer(
        DecisionBatch(
            shared_context={"intent": "x"},
            questions=(_choice("a"), _choice("b", allow_none=False)),
        )
    )
    assert seen[0].candidates == ("browse", "inspect", "none")
    assert seen[1].candidates == ("browse", "inspect")
    assert "none" in with_none.distribution.probabilities
    assert "none" not in without.distribution.probabilities


@pytest.mark.asyncio
async def test_predict_query_carries_question_context() -> None:
    seen: list[DecisionQuery] = []

    def scorer(query: DecisionQuery) -> DecisionDistribution:
        seen.append(query)
        return DecisionDistribution({c: 1.0 for c in query.candidates[:1]})

    backend = DeterministicMockBackend(scorer=scorer)
    await backend.answer(
        DecisionBatch(
            shared_context={"intent": "Show it", "pointers": ["/a"]},
            questions=(_choice(), _boolean()),
        )
    )
    choice_query, boolean_query = seen
    assert choice_query.task is DecisionTask.FAMILY
    assert choice_query.prompt == "What is the person here to do?"
    assert choice_query.context["intent"] == "Show it"
    assert choice_query.context["question_id"] == "family"
    assert choice_query.context["question_kind"] == "choice"
    assert choice_query.context["candidate_descriptions"] == {
        "browse": "Look through things.",
        "inspect": "Understand one thing.",
    }
    assert boolean_query.task is DecisionTask.BLOCK_GATE
    assert boolean_query.context["candidate_descriptions"] == {
        "yes": "Results, products, records.",
        "no": "This is about one thing.",
    }


def test_answer_from_distribution_handles_empty_mass() -> None:
    gate = answer_from_distribution(_boolean(), DecisionDistribution({}))
    assert gate.yes == 0.0
    assert gate.distribution.probabilities["no"] == 1.0
    score = answer_from_distribution(_score(), DecisionDistribution({}))
    assert score.expected is None
    unnormalized = answer_from_distribution(
        _score(), DecisionDistribution({"none": 1.0, "large": 1.0})
    )
    assert unnormalized.expected == pytest.approx(1.5)
    assert unnormalized.distribution.probabilities["none"] == pytest.approx(0.5)


def test_all_backends_expose_answer_and_satisfy_protocol() -> None:
    backends = (
        JevHttpBackend("http://localhost:8080/predict"),
        StepZeroLogprobBackend("http://localhost:8000/v1/completions", "m"),
        DeterministicMockBackend(),
        LocalCrossEncoderBackend(),
    )
    for backend in backends:
        assert isinstance(backend, DecisionBackend)
        assert callable(backend.answer)


# --- ScriptedAnswers fixture helper ----------------------------------------------


@pytest.mark.asyncio
async def test_scripted_answers_helper_scripts_by_question_id() -> None:
    scripted = ScriptedAnswers({
        "family": "inspect",
        "gate:collection": 0.85,
        "stakes": 2.2,
        "anatomy:collection.layout": ("reel", 0.7),
    })
    layout = DecisionQuestion(
        id="anatomy:collection.layout",
        kind=QuestionKind.CHOICE,
        prompt="How should these items be laid out?",
        options=("rows", "cards", "reel"),
    )
    answers = await scripted.backend().answer(
        DecisionBatch(
            shared_context={},
            questions=(_choice(), _boolean(), _score(), layout, _choice("archetype:x")),
        )
    )
    family, gate, stakes, reel, unscripted = answers
    assert family.top() == ("inspect", pytest.approx(0.9))
    assert gate.yes == pytest.approx(0.85)
    assert stakes.expected == pytest.approx(2.2)
    assert reel.top() == ("reel", pytest.approx(0.7))
    assert unscripted.top()[1] == pytest.approx(1.0 / 3)
    assert scripted.asked == [
        "family",
        "gate:collection",
        "stakes",
        "anatomy:collection.layout",
        "archetype:x",
    ]


def test_layout_fixtures_are_the_worked_examples() -> None:
    assert set(FIXTURES) == {"resort", "host", "transfer", "settings"}
    assert RESORT.payload["photos"][0]["caption"] == "Pool at dusk"
    assert 15 <= len(str(RESORT.payload["about"]).split()) < 60
    assert HOST.mutable_paths == ()
    assert FIXTURES["transfer"].mutable_paths == ("/actions",)
    assert FIXTURES["settings"].mutable_paths == (
        "/playback",
        "/notifications",
        "/account",
    )


# --- SynthesisConfig / SynthesisOutput / SynthesisStage ---------------------------


def test_synthesis_config_defaults_for_archetypes() -> None:
    config = SynthesisConfig()
    assert config.max_pairs == 400
    assert config.threshold_overrides == {}
    assert config.use_archetypes is True
    tuned = SynthesisConfig(
        threshold_overrides={"actionGateFloor": 0.8, "actionGateCap": 0.8}
    )
    assert tuned.threshold_overrides["actionGateFloor"] == pytest.approx(0.8)
    SynthesisConfig(threshold_overrides={"expected": 0.6, "optional": 0.6})


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"max_pairs": 0}, "max_pairs"),
        ({"threshold_overrides": {"actionGateFloor": -0.1}}, "actionGateFloor"),
        ({"threshold_overrides": {"actionGateCap": 1.1}}, "actionGateCap"),
        (
            {"threshold_overrides": {"actionGateFloor": 0.9, "actionGateCap": 0.8}},
            "actionGateFloor must be <=",
        ),
        ({"threshold_overrides": {"expected": 1.5}}, "expected"),
        ({"threshold_overrides": {"optional": -1.0}}, "optional"),
        (
            {"threshold_overrides": {"expected": 0.8, "optional": 0.7}},
            "expected must be <=",
        ),
        ({"threshold_overrides": {"reask_below": 2.0}}, "reask_below"),
    ],
)
def test_synthesis_config_rejects_bad_archetype_fields(
    kwargs: dict[str, float], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        SynthesisConfig(**kwargs)


def test_synthesis_output_new_fields_default() -> None:
    output = SynthesisOutput(
        stage=SynthesisStage.ARCHETYPE, messages=[], confidence=0.9, entropy=0.1
    )
    assert output.layout_plan is None
    assert output.trace == ()
    assert SynthesisStage.ARCHETYPE.value == "archetype"
    plan = LayoutPlan(archetype="detail", family="inspect", blocks=())
    traced = SynthesisOutput(
        stage=SynthesisStage.ARCHETYPE,
        messages=[],
        confidence=0.9,
        entropy=0.1,
        layout_plan=plan,
        trace=[DecisionRecord(question=_boolean())],
    )
    assert traced.layout_plan is plan
    assert isinstance(traced.trace, tuple)


# --- Plan types ---------------------------------------------------------------------


def test_slot_and_block_bindings() -> None:
    assert not SlotBinding().bound
    assert SlotBinding(pointer="/a").bound
    assert SlotBinding(literal="Send").bound
    items = SlotBinding(
        items=[
            {"label": SlotBinding(literal="CPU"), "value": SlotBinding(pointer="/cpu")},
            {"value": SlotBinding(pointer="/status")},
        ]
    )
    assert items.bound
    assert items.pointers() == ("/cpu", "/status")
    bindings = BlockBindings({
        "items": items,
        "title": SlotBinding(pointer="/name"),
        "empty": SlotBinding(),
    })
    assert bindings.is_bound("items")
    assert bindings.is_bound("title")
    assert not bindings.is_bound("empty")
    assert bindings.get("missing") is None
    assert bindings.pointers() == ("/cpu", "/status", "/name")


def test_layout_plan_and_outcome() -> None:
    block = PlannedBlock(
        block_id="headline",
        pattern="headline",
        variant_knobs={"deltas": "yes"},
        instances={"/cpu": {"news": "bad"}},
        probability=0.8,
    )
    plan = LayoutPlan(
        archetype="dashboard",
        family="monitor",
        blocks=[block],
        stakes=1.0,
        urgency=1.4,
        confidence=0.9,
        actions_allowed=True,
    )
    assert plan.block_ids() == ("headline",)
    assert plan.blocks[0].variant_knobs == {"deltas": "yes"}
    assert PlanOutcome(plan=plan, reason="planned").plan is plan
    assert PlanOutcome(plan=None, reason="action_gate").plan is None
    with pytest.raises(ValueError):
        PlanOutcome(plan=None, reason="planned")
    with pytest.raises(ValueError):
        PlanOutcome(plan=plan, reason="no_family")


def test_pattern_capabilities_protocol_is_structural() -> None:
    class Stub:

        def has_pattern(self, name: str, variant: str | None = None) -> bool:
            return name == "collection" and variant != "grid"

    stub = Stub()
    assert isinstance(stub, PatternCapabilities)
    assert stub.has_pattern("collection")
    assert not stub.has_pattern("collection", "grid")


# --- LayoutBrief ----------------------------------------------------------------------


_ROLES = ("inspect", "picture", "collection", "headline", "facts", "actions", "banner")


def test_layout_brief_parses_bare_keys_and_pointers() -> None:
    brief = LayoutBrief.parse(
        ["picture:name,logoUrl", "collection:/photos", " headline:rating,priceFrom "],
        roles=_ROLES,
    )
    assert brief.roles() == ("picture", "collection", "headline")
    assert brief.sections[0] == BriefSection("picture", ("/name", "/logoUrl"))
    assert brief.sections[1].pointers == ("/photos",)
    assert brief.sections[2].pointers == ("/rating", "/priceFrom")
    assert brief.section("collection") is not None
    assert brief.section("facts") is None
    assert brief.to_items() == [
        "picture:/name,/logoUrl",
        "collection:/photos",
        "headline:/rating,/priceFrom",
    ]
    assert LayoutBrief.parse(brief.to_items(), roles=_ROLES) == brief
    assert LayoutBrief.parse([], roles=_ROLES).sections == ()


@pytest.mark.parametrize(
    ("items", "message"),
    [
        (["hero:name"], "role 'hero'"),
        (["picture"], "not of the form"),
        (["picture:"], "not of the form"),
        (["picture:a:b"], "not of the form"),
        (["picture:name,,logoUrl"], "empty key"),
        (["picture:name", "picture:logoUrl"], "repeats role"),
        ([f"facts:k{i}" for i in range(MAX_BRIEF_SECTIONS + 1)], "at most 6"),
    ],
)
def test_layout_brief_rejects_malformed_items(items: list[str], message: str) -> None:
    with pytest.raises(A2uiValidationError, match=message):
        LayoutBrief.parse(items, roles=_ROLES)


# --- bindings.py --------------------------------------------------------------------


def test_wire_helpers() -> None:
    assert is_v10("1.0") and is_v10("v1.0") and is_v10("1") and is_v10("v1.2")
    assert not is_v10("0.9") and not is_v10("v0.9.1")
    assert make_data_binding("/a", is_v10=True) == {"@path": "/a"}
    assert make_data_binding("/a", is_v10=False) == {"path": "/a"}
    assert make_function_call("formatString", {"value": "x"}, is_v10=True) == {
        "@call": "formatString",
        "args": {"value": "x"},
    }
    assert make_function_call("required", {}, is_v10=False) == {
        "call": "required",
        "args": {},
    }


# --- PointerSummary additions ---------------------------------------------------------


def test_split_pointer() -> None:
    assert split_pointer("/a/b") == ("/a", "b")
    assert split_pointer("/name") == ("", "name")
    assert split_pointer("name") == ("", "name")
    assert split_pointer("/a/b~1c~0d") == ("/a", "b/c~d")
    assert split_pointer("") == ("", "")


def test_pointer_summary_defaults_key_and_parent() -> None:
    summary = PointerSummary(path="/photos/0/url", value_type="string", cardinality=1)
    assert summary.key == "url"
    assert summary.parent == "/photos/0"
    assert summary.semantic_type == "string"
    assert summary.hints == {}
    assert summary.label == ""
    assert summary.element_semantic_types == {}
    assert summary.sample_pointers == ()
    explicit = PointerSummary(
        path="/x",
        value_type="number",
        cardinality=1,
        semantic_type=SemanticType.CURRENCY,
        hints={"currency": "USD"},
        key="custom",
        label="Price",
        parent="/root",
        sample_pointers=["/x/0"],
    )
    assert explicit.key == "custom"
    assert explicit.parent == "/root"
    assert explicit.semantic_type == "currency"
    assert explicit.sample_pointers == ("/x/0",)
    relative = PointerSummary(path="caption", value_type="string", cardinality=1)
    assert (relative.parent, relative.key) == ("", "caption")


def test_inspector_populates_key_and_parent() -> None:
    pointers = {p.path: p for p in inspect_payload_pointers(dict(RESORT.payload))}
    assert pointers["/name"].key == "name"
    assert pointers["/name"].parent == ""
    assert pointers["/photos"].key == "photos"
    assert pointers["/photos"].element_keys == ("url", "caption")
    nested = {
        p.path: p
        for p in inspect_payload_pointers(
            dict(FIXTURES["settings"].payload),
            mutable_paths=FIXTURES["settings"].mutable_paths,
        )
    }
    assert nested["/playback/speed"].parent == "/playback"
    assert nested["/playback/speed"].key == "speed"
    assert nested["/playback/speed"].mutable_hint
