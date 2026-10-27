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

"""Data models and configuration types for local decision-model A2UI synthesis."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
import json
import math
import re
from typing import Any, Literal, Protocol, runtime_checkable

from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage


class _WireEnum(str, Enum):
    """String enum whose `str()`, `format()`, and `hash()` follow the wire value.

    Since Python 3.11, `format()` on a plain `(str, Enum)` member returns
    `ClassName.MEMBER`, which would break f-string keys such as
    ``f"{query.task}:{query.prompt}"`` that existing backends build. Hashing
    by the string value lets members stand in for their wire strings in sets
    and dict keys (``SemanticType.IMAGE_URL in {"image_url"}``).
    """

    def __str__(self) -> str:
        return str.__str__(self)

    def __format__(self, format_spec: str) -> str:
        return str.__format__(str(self), format_spec)

    def __hash__(self) -> int:
        return str.__hash__(self)


class DecisionTask(_WireEnum):
    """Kind of choice a `DecisionQuery` asks a decision backend to make.

    Members compare equal to their string values, so backends and tests that
    match on the literal strings keep working.
    """

    TEMPLATE_SELECT = "template_select"
    FAMILY = "family"
    ARCHETYPE = "archetype"
    BLOCK_GATE = "block_gate"
    ANATOMY = "anatomy"
    SALIENCE = "salience"
    INSTANCE = "instance"
    STAKES = "stakes"
    URGENCY = "urgency"


class QuestionKind(_WireEnum):
    """Answer shape of a `DecisionQuestion`.

    `CHOICE` yields a distribution over named options, `BOOLEAN` a calibrated
    yes probability, and `SCORE` an expected value over ordered levels.
    """

    CHOICE = "choice"
    BOOLEAN = "boolean"
    SCORE = "score"


class VarietyMode(_WireEnum):
    """How the layout planner samples choices from question distributions.

    `ARGMAX` picks the highest-probability option deterministically.
    `NEAR_TOP` samples among options within `variety_margin` of the top.
    """

    ARGMAX = "argmax"
    NEAR_TOP = "near_top"


class SemanticType(_WireEnum):
    """Semantic classification of a payload pointer's value.

    The archetype grammar's slots name these types in their `from` lists.
    Detection lives in the payload inspector; this enum is the shared
    vocabulary. Members in `DEFERRED_SEMANTIC_TYPES` are part of the
    vocabulary but no detector produces them yet.
    """

    # Text
    STRING = "string"
    LONG_TEXT = "long_text"
    MARKDOWN = "markdown"
    CODE = "code"
    NAME = "name"
    TITLE = "title"
    IDENTIFIER = "identifier"
    # Contact and links
    EMAIL = "email"
    PHONE = "phone"
    URL = "url"
    IMAGE_URL = "image_url"
    VIDEO_URL = "video_url"
    AUDIO_URL = "audio_url"
    DOCUMENT_URL = "document_url"
    # Time
    DATE = "date"
    TIME = "time"
    DATETIME = "datetime"
    DURATION = "duration"
    RELATIVE_TIME = "relative_time"
    DATE_RANGE = "date_range"
    # Quantity
    NUMBER = "number"
    INTEGER = "integer"
    COUNT = "count"
    CURRENCY = "currency"
    PERCENT = "percent"
    RATIO = "ratio"
    QUANTITY = "quantity"
    RATING = "rating"
    BOUNDED = "bounded"
    # State
    ENUM = "enum"
    STATUS = "status"
    BOOLEAN = "boolean"
    COLOR = "color"
    # Structure
    ARRAY = "array"
    OBJECT = "object"
    EMPTY = "empty"
    # Place (deferred: no detector yet)
    ADDRESS = "address"
    LOCATION = "location"
    PLACE_NAME = "place_name"
    COUNTRY = "country"
    REGION = "region"
    TIMEZONE = "timezone"
    LANGUAGE = "language"
    LOCALE = "locale"
    DISTANCE = "distance"
    # Composite objects (deferred: no detector yet)
    MEDIA_OBJECT = "media_object"
    MONEY_OBJECT = "money_object"


DEFERRED_SEMANTIC_TYPES: frozenset[SemanticType] = frozenset({
    SemanticType.ADDRESS,
    SemanticType.LOCATION,
    SemanticType.PLACE_NAME,
    SemanticType.COUNTRY,
    SemanticType.REGION,
    SemanticType.TIMEZONE,
    SemanticType.LANGUAGE,
    SemanticType.LOCALE,
    SemanticType.DISTANCE,
    SemanticType.MEDIA_OBJECT,
    SemanticType.MONEY_OBJECT,
})
"""Semantic types the grammar may reference that no detector produces yet.

The Place family and the composite object types are deferred; slots that
accept only these types never bind until a detector lands.
"""


class Requirement(_WireEnum):
    """How strongly an archetype wants a block, encoded by its mark.

    ``name!`` is `REQUIRED`, ``name`` is `EXPECTED`, ``name?`` is `OPTIONAL`.
    """

    REQUIRED = "required"
    EXPECTED = "expected"
    OPTIONAL = "optional"


class PlanReason(_WireEnum):
    """Why `LayoutPlanner.read` did or did not produce a plan.

    `ACTION_GATE` means the archetype would have rendered but its actions were
    refused by the confidence gate: the synthesizer must abstain rather than
    fall through to the flat path.
    """

    PLANNED = "planned"
    NO_FAMILY = "no_family"
    NO_ARCHETYPE = "no_archetype"
    REQUIRED_BLOCK_MISSING = "required_block_missing"
    ACTION_GATE = "action_gate"


class DecisionWireFormat(_WireEnum):
    """Request and response format spoken by a remote decision endpoint.

    `AUTO` picks SystemOne when the endpoint path ends in `/v1/systemone`
    and Jev otherwise.
    """

    AUTO = "auto"
    JEV = "jev"
    SYSTEMONE = "systemone"


class FallbackSource(_WireEnum):
    """Which fallback produced a `SynthesisOutput` after the model abstained."""

    DSL = "fallback_dsl"
    CALLBACK = "fallback_fn"
    CARD = "fallback_card"


class DecisionBackendType(_WireEnum):
    """Backend selector accepted by `create_decision_backend`."""

    MOCK = "mock"
    JEV = "jev"
    SYSTEMONE = "systemone"
    STEP_ZERO = "step0"


def coerce_decision_payload(
    payload: Mapping[str, Any] | Sequence[Any] | str,
) -> Mapping[str, Any] | Sequence[Any]:
    """Normalizes a synthesis payload into a JSON object or array.

    LLM tool calls often pass the payload as a JSON-encoded string rather
    than a parsed object. This helper decodes such strings so callers do not
    have to.

    Args:
        payload: A mapping, a non-string sequence, or a JSON-encoded string
            of either.

    Returns:
        The payload as a `Mapping` or a non-string `Sequence`.

    Raises:
        TypeError: If the payload (after decoding) is neither a mapping nor a
            non-string sequence.
        ValueError: If a string payload is not valid JSON.
    """
    if isinstance(payload, str):
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Payload string is not valid JSON: {exc.msg}") from exc
        if isinstance(decoded, str):
            raise TypeError(
                "Payload must be a JSON object (Mapping) or array (Sequence), got"
                " a JSON string."
            )
        return coerce_decision_payload(decoded)
    if isinstance(payload, Mapping):
        return payload
    if isinstance(payload, Sequence) and not isinstance(payload, (bytes, bytearray)):
        return payload
    raise TypeError(
        "Payload must be a JSON object (Mapping) or array (Sequence), got"
        f" {type(payload).__name__}."
    )


class SynthesisStage(str, Enum):
    """Execution stage reached during decision-model UI synthesis."""

    TEMPLATE_SELECT = "template_select"
    ARCHETYPE = "archetype"
    ABSTAIN_FALLBACK = "abstain_fallback"


class SlotKind(str, Enum):
    """Semantic classification of a component property slot in a catalog schema."""

    CHILD = "child"
    CHILD_LIST = "child_list"
    NAMED_CHILD_ARRAY = "named_child_array"
    DATA_VALUE = "data_value"
    STATIC_ENUM = "static_enum"
    ACTION = "action"


@dataclass(frozen=True)
class ComponentSlot:
    """Metadata describing a single bindable or structural slot on a component."""

    name: str
    kind: SlotKind
    required: bool
    value_type: str | None = None
    enum_values: tuple[str, ...] = ()
    child_id_key: str | None = None
    label_key: str | None = None
    description: str = ""


@dataclass(frozen=True)
class ComponentNodeSpec:
    """Catalog-derived structural specification for a single A2UI component."""

    name: str
    catalog_id: str
    description: str
    slots: tuple[ComponentSlot, ...]
    supports_checks: bool = False
    is_container: bool = False
    is_multi_view_switcher: bool = False
    has_action_slot: bool = False

    def get_slot(self, name: str) -> ComponentSlot | None:
        """Returns the ComponentSlot matching name (ignoring index brackets like [0])."""
        base_name = name.split("[", 1)[0]
        for slot in self.slots:
            if slot.name == base_name or slot.name == name:
                return slot
        return None


@dataclass(frozen=True, eq=True)
class DecisionQuery:
    """Query payload sent to a local decision-model backend."""

    task: DecisionTask | str
    prompt: str
    candidates: tuple[str, ...]
    context: dict[str, Any] = field(default_factory=dict, hash=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "candidates", tuple(self.candidates))
        object.__setattr__(self, "context", dict(self.context))


@dataclass(frozen=True, eq=True)
class DecisionDistribution:
    """Probability distribution returned by a decision-model backend."""

    probabilities: dict[str, float] = field(hash=False)
    calibrated: bool = True
    top_logit_margin: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "probabilities",
            {str(k): float(v) for k, v in self.probabilities.items()},
        )

    def top_choice(self) -> tuple[str, float]:
        """Returns the highest-probability candidate and its score, or ('', 0.0)."""
        if not self.probabilities:
            return ("", 0.0)
        return max(self.probabilities.items(), key=lambda item: item[1])

    def normalized_entropy(self) -> float:
        """Computes normalized Shannon entropy in [0.0, 1.0] over candidates."""
        k = len(self.probabilities)
        if k <= 1:
            return 0.0
        entropy = -sum(p * math.log(p) for p in self.probabilities.values() if p > 0.0)
        if entropy <= 0.0:
            return 0.0
        return entropy / math.log(k)


@dataclass(frozen=True)
class DecisionQuestion:
    """One question in a `DecisionBatch`.

    Attributes:
        id: Stable identifier such as ``"gate:collection"``,
            ``"anatomy:collection.layout"``, or ``"salience:/cpu"``. The prefix
            before the first colon names the `DecisionTask`.
        kind: The answer shape.
        prompt: The question text with ``{placeholders}`` already filled.
        options: `CHOICE`: option ids; `BOOLEAN`: empty; `SCORE`: level
            labels in order.
        option_texts: Optional descriptions parallel to `options`.
        context: Extra context a backend may show the model.
        allow_none: `CHOICE` only; adds an implicit ``"none"`` option.
    """

    id: str
    kind: QuestionKind
    prompt: str
    options: tuple[str, ...] = ()
    option_texts: tuple[str, ...] = ()
    context: dict[str, Any] = field(default_factory=dict, hash=False)
    allow_none: bool = True

    def __post_init__(self) -> None:
        object.__setattr__(self, "kind", QuestionKind(self.kind))
        object.__setattr__(self, "options", tuple(self.options))
        object.__setattr__(self, "option_texts", tuple(self.option_texts))
        object.__setattr__(self, "context", dict(self.context))
        if not self.id:
            raise ValueError("DecisionQuestion.id must be a non-empty string.")
        if self.option_texts and len(self.option_texts) != len(self.options):
            raise ValueError(
                f"Question {self.id!r}: option_texts must be empty or match"
                " options in length."
            )
        if self.kind is QuestionKind.BOOLEAN and self.options:
            raise ValueError(
                f"Question {self.id!r}: boolean questions take no options."
            )
        if self.kind is QuestionKind.CHOICE and not self.options:
            raise ValueError(f"Question {self.id!r}: choice questions need options.")
        if self.kind is QuestionKind.SCORE and len(self.options) < 2:
            raise ValueError(
                f"Question {self.id!r}: score questions need at least two levels."
            )

    @property
    def task(self) -> DecisionTask | str:
        """The `DecisionTask` named by the id prefix, or the raw prefix."""
        prefix = self.id.split(":", 1)[0]
        aliases = {"gate": DecisionTask.BLOCK_GATE}
        if prefix in aliases:
            return aliases[prefix]
        try:
            return DecisionTask(prefix)
        except ValueError:
            return prefix

    def candidates(self) -> tuple[str, ...]:
        """The labels a backend scores: options, ``yes``/``no``, or levels."""
        if self.kind is QuestionKind.BOOLEAN:
            return ("yes", "no")
        if self.kind is QuestionKind.CHOICE and self.allow_none:
            return self.options + ("none",)
        return self.options


@dataclass(frozen=True)
class DecisionAnswer:
    """A backend's answer to one `DecisionQuestion`.

    Attributes:
        question_id: The id of the question answered.
        distribution: `CHOICE` and `SCORE`: over the options; `BOOLEAN`:
            ``{"yes": p, "no": 1 - p}``.
        expected: `SCORE` only: ``sum(p_i * i)`` over level indices.
    """

    question_id: str
    distribution: DecisionDistribution
    expected: float | None = None

    @property
    def yes(self) -> float:
        """The yes probability of a `BOOLEAN` answer (0.0 when absent)."""
        return self.distribution.probabilities.get("yes", 0.0)

    def top(self) -> tuple[str, float]:
        """The highest-probability option and its probability."""
        return self.distribution.top_choice()


@dataclass(frozen=True)
class DecisionBatch:
    """All speculative questions for one surface, answered in one call."""

    shared_context: dict[str, Any]
    questions: tuple[DecisionQuestion, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "shared_context", dict(self.shared_context))
        object.__setattr__(self, "questions", tuple(self.questions))
        seen: set[str] = set()
        for question in self.questions:
            if question.id in seen:
                raise ValueError(f"Duplicate question id {question.id!r} in batch.")
            seen.add(question.id)

    def pair_count(self) -> int:
        """Number of (question, candidate) pairs a cross-encoder would score."""
        return sum(len(q.candidates()) for q in self.questions)


@dataclass(frozen=True)
class DecisionRecord:
    """One entry in a synthesis trace: a question, its answer, and the outcome."""

    question: DecisionQuestion
    answer: DecisionAnswer | None = None
    threshold: float | None = None
    outcome: str = ""


@dataclass(frozen=True)
class SlotBinding:
    """What a grammar slot resolved to.

    A scalar slot binds a `pointer` or a `literal`. A repeated slot backed by
    an array binds the array `pointer` plus per-element `fields` (relative
    keys). A repeated slot assembled from scalar pointers (headline tiles,
    fact rows, action buttons) lists one field mapping per element in
    `items`.
    """

    pointer: str | None = None
    literal: Any = None
    fields: Mapping[str, SlotBinding] = field(default_factory=dict, hash=False)
    items: tuple[Mapping[str, SlotBinding], ...] = ()
    semantic_type: SemanticType | None = field(default=None, compare=False)
    """The bound pointer's semantic type, when known; informs `$byType` dispatch."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "fields", dict(self.fields))
        object.__setattr__(self, "items", tuple(dict(item) for item in self.items))
        if self.semantic_type is not None:
            object.__setattr__(self, "semantic_type", SemanticType(self.semantic_type))

    @property
    def bound(self) -> bool:
        """Whether the slot resolved to anything at all."""
        return (
            self.pointer is not None
            or self.literal is not None
            or bool(self.fields)
            or bool(self.items)
        )

    def pointers(self) -> tuple[str, ...]:
        """Every absolute pointer this binding claims, including nested ones."""
        found: list[str] = []
        if self.pointer is not None:
            found.append(self.pointer)
        for item in self.items:
            for sub in item.values():
                found.extend(sub.pointers())
        return tuple(found)


@dataclass(frozen=True)
class BlockBindings:
    """Slot bindings for one planned block, keyed by slot name."""

    slots: Mapping[str, SlotBinding] = field(default_factory=dict, hash=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "slots", dict(self.slots))

    def get(self, slot: str) -> SlotBinding | None:
        """The binding for `slot`, or None when the slot was not bound."""
        binding = self.slots.get(slot)
        return binding if binding is not None and binding.bound else None

    def is_bound(self, slot: str) -> bool:
        """Whether `slot` resolved to a pointer, literal, or elements."""
        return self.get(slot) is not None

    def pointers(self) -> tuple[str, ...]:
        """Every absolute pointer claimed by this block, in slot order."""
        found: list[str] = []
        for binding in self.slots.values():
            found.extend(binding.pointers())
        return tuple(found)


@dataclass(frozen=True)
class PageBindings:
    """Bindings for the page pattern's own slots and frame knobs."""

    title: SlotBinding = field(default_factory=SlotBinding)
    subtitle: SlotBinding = field(default_factory=SlotBinding)
    mark: SlotBinding = field(default_factory=SlotBinding)
    dialog: bool = False
    sticky_actions: bool = False


@dataclass(frozen=True)
class PlannedBlock:
    """A block the planner decided to render, with its knobs and bindings."""

    block_id: str
    pattern: str
    variant_knobs: Mapping[str, str] = field(default_factory=dict, hash=False)
    bindings: BlockBindings = field(default_factory=BlockBindings)
    instances: Mapping[str, Mapping[str, str]] = field(default_factory=dict, hash=False)
    """Per-element instance answers: element key to (question name to option)."""
    probability: float = 1.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "variant_knobs", dict(self.variant_knobs))
        object.__setattr__(
            self, "instances", {k: dict(v) for k, v in self.instances.items()}
        )


@dataclass(frozen=True)
class LayoutPlan:
    """The planner's validated choice of archetype, blocks, and bindings."""

    archetype: str
    family: str
    blocks: tuple[PlannedBlock, ...]
    page: PageBindings = field(default_factory=PageBindings)
    stakes: float = 0.0
    urgency: float = 0.0
    confidence: float = 0.0
    actions_allowed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "blocks", tuple(self.blocks))

    def block_ids(self) -> tuple[str, ...]:
        """The ids of the planned blocks in render order."""
        return tuple(block.block_id for block in self.blocks)


@dataclass(frozen=True)
class PlanOutcome:
    """Result of reading a batch of answers into a `LayoutPlan`."""

    plan: LayoutPlan | None
    reason: PlanReason

    def __post_init__(self) -> None:
        object.__setattr__(self, "reason", PlanReason(self.reason))
        if (self.reason is PlanReason.PLANNED) != (self.plan is not None):
            raise ValueError(
                "PlanOutcome.plan must be set exactly when reason is 'planned'."
            )


@runtime_checkable
class PatternCapabilities(Protocol):
    """What the planner may ask about a catalog without loading its patterns."""

    def has_pattern(self, name: str, variant: str | None = None) -> bool:
        """Whether the catalog draws `name` (and, when given, that `variant`)."""
        ...


MAX_BRIEF_SECTIONS = 6
"""Most sections a `LayoutBrief` may carry."""

BRIEF_ITEM_PATTERN = r"^[a-z_]+:[A-Za-z0-9_/,.~-]+$"
"""Regular expression one ``role:key,key`` brief item must match.

Shared with the tool JSON Schema so the model-facing contract and the parser
agree.
"""

_BRIEF_ITEM_RE = re.compile(r"^([a-z_]+):([A-Za-z0-9_/,.~-]+)$")


def _brief_pointer(raw: str, item: str) -> str:
    """Normalizes one brief key into an absolute JSON Pointer."""
    key = raw.strip()
    if not key:
        raise A2uiValidationError(f"Layout brief item {item!r} has an empty key.")
    return key if key.startswith("/") else f"/{key}"


@dataclass(frozen=True)
class BriefSection:
    """One ``role:pointers`` section of a `LayoutBrief`."""

    role: str
    pointers: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "pointers", tuple(self.pointers))


@dataclass(frozen=True)
class LayoutBrief:
    """An author's hint about which payload pointers belong to which layout role.

    Written as ``"hero:name,logoUrl"`` items: a role from the grammar's
    vocabulary, a colon, and comma-separated payload keys or pointers.
    """

    sections: tuple[BriefSection, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "sections", tuple(self.sections))

    @classmethod
    def parse(cls, items: Sequence[str], *, roles: Collection[str]) -> LayoutBrief:
        """Parses brief items, validating roles against `roles`.

        Bare keys become absolute pointers (``name`` to ``/name``). At most
        `MAX_BRIEF_SECTIONS` sections are allowed, each role at most once,
        and no nesting (a second colon in an item).

        Raises:
            A2uiValidationError: On an unknown role, a malformed item, a
                repeated role, or too many sections.
        """
        if len(items) > MAX_BRIEF_SECTIONS:
            raise A2uiValidationError(
                f"Layout brief has {len(items)} sections; at most"
                f" {MAX_BRIEF_SECTIONS} are allowed."
            )
        sections: list[BriefSection] = []
        seen: set[str] = set()
        for item in items:
            match = _BRIEF_ITEM_RE.match(item.strip())
            if match is None:
                raise A2uiValidationError(
                    f"Layout brief item {item!r} is not of the form 'role:key,key'."
                )
            role, keys = match.group(1), match.group(2)
            if role not in roles:
                raise A2uiValidationError(
                    f"Layout brief role {role!r} is not one of {sorted(roles)}."
                )
            if role in seen:
                raise A2uiValidationError(f"Layout brief repeats role {role!r}.")
            seen.add(role)
            pointers = tuple(_brief_pointer(k, item) for k in keys.split(","))
            sections.append(BriefSection(role=role, pointers=pointers))
        return cls(sections=tuple(sections))

    def roles(self) -> tuple[str, ...]:
        """The roles named by the brief, in order."""
        return tuple(section.role for section in self.sections)

    def section(self, role: str) -> BriefSection | None:
        """The section for `role`, or None."""
        for section in self.sections:
            if section.role == role:
                return section
        return None

    def to_items(self) -> list[str]:
        """Serializes back to ``role:/a,/b`` items."""
        return [f"{s.role}:{','.join(s.pointers)}" for s in self.sections]


@dataclass(frozen=True)
class AuthoredCopy:
    """Optional authored copy supplied by the model in the decision block.

    Attributes:
        title: Optional title string for the surface.
        summary: Optional one-line summary string for the surface.
    """

    title: str | None = None
    summary: str | None = None

    def __post_init__(self) -> None:
        title = self.title.strip() if self.title else None
        summary = self.summary.strip() if self.summary else None
        object.__setattr__(self, "title", title or None)
        object.__setattr__(self, "summary", summary or None)

    @property
    def has_content(self) -> bool:
        """Whether any copy string is present."""
        return bool(self.title or self.summary)


def _validate_unit_interval(name: str, value: float) -> None:
    """Validates that a threshold or margin parameter lies in [0.0, 1.0]."""
    if not (0.0 <= value <= 1.0):
        raise ValueError(f"{name} must be in [0.0, 1.0], got {value}.")


@dataclass(frozen=True)
class SynthesisConfig:
    """Thresholds and structural limits governing decision-model UI synthesis."""

    template_confidence_threshold: float = 0.75
    mutable_confidence_threshold: float = 0.85
    abstain_threshold: float = 0.40
    uncalibrated_min_logit_margin: float = 1.50
    max_tree_depth: int = 3
    max_children_per_container: int = 8
    default_surface_id: str = "default_surface"
    max_pairs: int = 400
    """Budget of (question, candidate) pairs for one batch.

    Past it the planner stops adding optional question groups and falls back
    to heuristics for them.
    """
    threshold_overrides: Mapping[str, float] = field(default_factory=dict, hash=False)
    """Per-key overrides of `ArchetypeGrammar.thresholds`.

    Keys are the grammar's own names (``family``, ``archetype``, ``expected``,
    ``optional``, ``instance``, ``reask_below``, ``actionGateFloor``,
    ``actionGateCap``). The grammar is the single source of truth for the
    defaults; set a key here to tune one without editing the grammar file.
    """
    variety: VarietyMode = VarietyMode.ARGMAX
    """How choices are sampled from question distributions (ARGMAX or NEAR_TOP)."""
    variety_margin: float = 0.15
    """In NEAR_TOP mode, options within this margin of top probability are sampled."""
    two_stage_batching: bool | None = None
    """Splits planning into Stage 1 (family/archetype) and Stage 2 (winning archetype blocks).

    When None (default), enabled automatically for step-0 backends
    (`StepZeroLogprobBackend`) and disabled for single-round-trip remote/mock
    backends (`JevHttpBackend`, `DeterministicMockBackend`).
    """

    def __post_init__(self) -> None:
        _validate_unit_interval(
            "template_confidence_threshold", self.template_confidence_threshold
        )
        _validate_unit_interval(
            "mutable_confidence_threshold", self.mutable_confidence_threshold
        )
        _validate_unit_interval("abstain_threshold", self.abstain_threshold)
        if not (0.0 < self.variety_margin <= 1.0):
            raise ValueError(
                f"variety_margin must be in (0.0, 1.0], got {self.variety_margin}."
            )
        if self.mutable_confidence_threshold < self.template_confidence_threshold:
            raise ValueError(
                "mutable_confidence_threshold must be >= template_confidence_threshold."
            )
        if self.template_confidence_threshold < self.abstain_threshold:
            raise ValueError(
                "template_confidence_threshold must be >= abstain_threshold."
            )
        if self.uncalibrated_min_logit_margin < 0.0:
            raise ValueError("uncalibrated_min_logit_margin must be non-negative.")
        if self.max_tree_depth < 1:
            raise ValueError("max_tree_depth must be >= 1.")
        if self.max_children_per_container < 1:
            raise ValueError("max_children_per_container must be >= 1.")
        if not self.default_surface_id or not self.default_surface_id.strip():
            raise ValueError("default_surface_id must be a non-empty string.")
        self._validate_archetype_fields()

    def _validate_archetype_fields(self) -> None:
        """Validates the archetype planner budget and threshold overrides."""
        if self.max_pairs < 1:
            raise ValueError("max_pairs must be >= 1.")
        overrides = {str(k): float(v) for k, v in self.threshold_overrides.items()}
        object.__setattr__(self, "threshold_overrides", overrides)
        for name, value in overrides.items():
            _validate_unit_interval(f"threshold_overrides[{name!r}]", value)
        validate_threshold_relations(overrides, "threshold_overrides")


def validate_threshold_relations(thresholds: Mapping[str, float], owner: str) -> None:
    """Checks ordering constraints between grammar threshold keys that are present.

    Raises:
        ValueError: If ``actionGateFloor > actionGateCap`` or
            ``expected > optional`` when both keys of a pair are present.
    """
    floor, cap = thresholds.get("actionGateFloor"), thresholds.get("actionGateCap")
    if floor is not None and cap is not None and floor > cap:
        raise ValueError(f"{owner}: actionGateFloor must be <= actionGateCap.")
    expected, optional = thresholds.get("expected"), thresholds.get("optional")
    if expected is not None and optional is not None and expected > optional:
        raise ValueError(f"{owner}: expected must be <= optional.")


@dataclass(frozen=True)
class SynthesisOutput:
    """Result produced by a single decision-model synthesis pass."""

    stage: SynthesisStage
    messages: list[AgentToRendererMessage]
    confidence: float
    entropy: float
    selected_template_id: str | None = None
    component_tree_spec: dict[str, Any] | None = None
    fallback_source: FallbackSource | None = None
    """Which fallback produced `messages` after the model abstained.

    None when the model did not abstain or no fallback applied.
    """
    layout_plan: LayoutPlan | None = None
    """The archetype plan behind `messages` when `stage` is `ARCHETYPE`."""
    trace: tuple[DecisionRecord, ...] = ()
    """Every question asked, with its answer and threshold outcome."""
    decision_latency_ms: float = 0.0
    """Wall-clock milliseconds spent waiting on the decision model backend."""
    decision_calls: int = 0
    """Number of backend `predict` or `answer` calls made during synthesis."""
    decision_answers: tuple[DecisionAnswer, ...] = ()
    """The batch answers that produced the layout plan, in question order."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "trace", tuple(self.trace))
        object.__setattr__(self, "decision_answers", tuple(self.decision_answers))

    def to_express(
        self,
        catalogs: Sequence[CatalogApi],
        *,
        use_keyword_args: bool = False,
    ) -> str:
        """Decompiles synthesized A2UI messages into A2UI Express DSL syntax."""
        if not self.messages:
            return ""
        from a2ui.inference_formats.express import ExpressDecompiler

        return ExpressDecompiler(catalogs).decompile(
            self.messages, use_keyword_args=use_keyword_args
        )


@dataclass(frozen=True)
class CalibrationPoint:
    """Coverage, precision, and fallback metrics at a single confidence threshold."""

    threshold: float
    coverage: float
    precision: float
    fallback_rate: float


@dataclass(frozen=True)
class CalibrationResult:
    """Recommended confidence thresholds and Pareto frontier from calibration."""

    recommended_template_threshold: float
    recommended_mutable_threshold: float
    recommended_abstain_threshold: float
    achieved_precision: float
    achieved_coverage: float
    pareto_points: tuple[CalibrationPoint, ...]
