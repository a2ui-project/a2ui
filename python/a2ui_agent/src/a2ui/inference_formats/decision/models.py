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

from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
import hashlib
import json
import math
import re
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from a2ui.core import A2uiError, A2uiValidationError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage

if TYPE_CHECKING:
    from .payload_inspector import PointerSummary


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
    """Kind of choice a `DecisionQuestion` asks, named by its id prefix.

    Members compare equal to their string values, so backends and tests that
    match on the literal strings keep working.
    """

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
    fall through to the flat path. `NO_FIT` means the model chose the job
    family `none` at or above `thresholds.noFit`: no archetype suits the
    request, so the synthesizer runs its fallback chain.
    """

    PLANNED = "planned"
    NO_FAMILY = "no_family"
    NO_ARCHETYPE = "no_archetype"
    REQUIRED_BLOCK_MISSING = "required_block_missing"
    ACTION_GATE = "action_gate"
    NO_FIT = "no_fit"


class DecisionWireFormat(_WireEnum):
    """Request and response format spoken by a remote decision endpoint.

    `AUTO` picks Gemini Decisions when the endpoint path ends in
    `/v1beta/decisions`, SystemOne when it ends in `/v1/systemone`, and Jev
    otherwise.
    """

    AUTO = "auto"
    JEV = "jev"
    SYSTEMONE = "systemone"
    GEMINI_DECISIONS = "gemini_decisions"


class FallbackSource(_WireEnum):
    """Which link of the fallback chain produced a `SynthesisOutput`.

    The chain runs in order: the block's `fallbackDsl`, then the host
    callback, then a single `facts` pattern rendering of the payload.
    """

    DSL = "fallback_dsl"
    CALLBACK = "fallback_fn"
    FACTS = "fallback_facts"


class ActionStyle(_WireEnum):
    """Presentational emphasis of an action button."""

    PRIMARY = "primary"
    SECONDARY = "secondary"
    DESTRUCTIVE = "destructive"


class SurfaceOperation(_WireEnum):
    """How synthesized messages change the client's surface.

    `CREATE` sends `createSurface` for a surface the client does not have.
    `UPDATE_ROOT` replaces the root of an existing surface in place with
    `updateComponents` and `updateDataModel`. `REPLACE` sends `deleteSurface`
    and then creates the surface again.
    """

    CREATE = "create"
    UPDATE_ROOT = "update_root"
    REPLACE = "replace"


class DecisionBackendType(_WireEnum):
    """Backend selector accepted by `create_decision_backend`."""

    MOCK = "mock"
    JEV = "jev"
    GEMINI = "gemini"
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
    """Metadata describing a single bindable or structural slot on a component.

    Attributes:
        name: Property name on the component schema.
        kind: Structural or data-binding category of the slot.
        required: Whether the component schema requires this property.
        value_type: Coarse value type for `DATA_VALUE` slots, when applicable.
        enum_values: Allowed string values for `STATIC_ENUM` slots.
        child_id_key: Object key holding the child component ID for
            `NAMED_CHILD_ARRAY` slots.
        label_key: Object key holding the tab or item label for
            `NAMED_CHILD_ARRAY` slots.
        description: Human-readable property description from the catalog.
    """

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
    """Catalog-derived structural specification for a single A2UI component.

    Attributes:
        name: Component type name in the catalog.
        catalog_id: Identifier of the catalog defining this component.
        description: Human-readable component summary from the catalog schema.
        slots: Bindable and structural property slots on the component.
        supports_checks: Whether the component supports validation `checks`.
        is_container: Whether the component has child component slots.
        is_multi_view_switcher: Whether the component has a
            `NAMED_CHILD_ARRAY` slot.
        has_action_slot: Whether the component has an `ACTION` slot.
    """

    name: str
    catalog_id: str
    description: str
    slots: tuple[ComponentSlot, ...]
    supports_checks: bool = False
    is_container: bool = False
    is_multi_view_switcher: bool = False
    has_action_slot: bool = False

    def get_slot(self, name: str) -> ComponentSlot | None:
        """Returns the `ComponentSlot` matching `name` (ignoring index brackets).

        Args:
            name: Slot name, optionally suffixed with an array index such as
                ``"tabs[0]"``.

        Returns:
            The matching `ComponentSlot`, or None if absent.
        """
        base_name = name.split("[", 1)[0]
        for slot in self.slots:
            if slot.name == base_name or slot.name == name:
                return slot
        return None


@dataclass(frozen=True, eq=True)
class DecisionDistribution:
    """Probability distribution returned by a decision-model backend.

    Attributes:
        probabilities: Candidate option IDs mapped to their probabilities.
        calibrated: Whether the probabilities are temperature-calibrated.
        top_logit_margin: Logit margin between the top two candidates, when
            known.
    """

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
        positive = [p for p in self.probabilities.values() if p > 0.0]
        total = sum(positive)
        if total <= 0.0:
            return 0.0
        probs = [p / total for p in positive]
        entropy = -sum(p * math.log(p) for p in probs)
        if entropy <= 0.0:
            return 0.0
        return min(1.0, entropy / math.log(k))


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
        if not isinstance(self.id, str) or not self.id:
            raise ValueError("DecisionQuestion.id must be a non-empty string.")
        object.__setattr__(self, "kind", QuestionKind(self.kind))
        object.__setattr__(self, "options", tuple(self.options))
        object.__setattr__(self, "option_texts", tuple(self.option_texts))
        object.__setattr__(self, "context", dict(self.context))
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
    """All speculative questions for one surface, answered in one call.

    Attributes:
        shared_context: Context dictionary shared by all questions in the batch.
        questions: Ordered tuple of questions to answer.
    """

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
        """Returns the number of (question, candidate) pairs in this batch."""
        return sum(len(q.candidates()) for q in self.questions)


@dataclass(frozen=True)
class DecisionRecord:
    """One entry in a synthesis trace: a question, its answer, and the outcome.

    Attributes:
        question: The decision question asked by the planner.
        answer: The backend's answer, if the question was evaluated.
        threshold: Confidence threshold applied to `answer`, if any.
        outcome: Planner outcome summary for this question.
    """

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

    Attributes:
        pointer: Absolute or relative RFC 6901 JSON Pointer bound to the slot.
        literal: Static literal value bound to the slot.
        fields: Per-element field bindings for array-backed repeated slots.
        items: Per-item field mappings for scalar-assembled repeated slots.
        semantic_type: Semantic type of the bound pointer, when known; informs
            `$byType` dispatch.
    """

    pointer: str | None = None
    literal: Any = None
    fields: Mapping[str, SlotBinding] = field(default_factory=dict, hash=False)
    items: tuple[Mapping[str, SlotBinding], ...] = ()
    semantic_type: SemanticType | None = field(default=None, compare=False)

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
    """Slot bindings for one planned block, keyed by slot name.

    Attributes:
        slots: Mapping from slot name to its resolved `SlotBinding`.
    """

    slots: Mapping[str, SlotBinding] = field(default_factory=dict, hash=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "slots", dict(self.slots))

    def get(self, slot: str) -> SlotBinding | None:
        """Returns the binding for `slot`, or None when `slot` is unbound."""
        binding = self.slots.get(slot)
        return binding if binding is not None and binding.bound else None

    def is_bound(self, slot: str) -> bool:
        """Returns whether `slot` resolved to a pointer, literal, or elements."""
        return self.get(slot) is not None

    def pointers(self) -> tuple[str, ...]:
        """Returns every absolute pointer claimed by this block, in slot order."""
        found: list[str] = []
        for binding in self.slots.values():
            found.extend(binding.pointers())
        return tuple(found)


@dataclass(frozen=True)
class PageBindings:
    """Bindings for the page pattern's own slots and frame knobs.

    Attributes:
        title: Binding for the page title slot.
        subtitle: Binding for the page subtitle slot.
        mark: Binding for the page mark or badge slot.
        dialog: Whether the page frame renders as a modal dialog.
        sticky_actions: Whether the page frame pins actions to a sticky footer.
    """

    title: SlotBinding = field(default_factory=SlotBinding)
    subtitle: SlotBinding = field(default_factory=SlotBinding)
    mark: SlotBinding = field(default_factory=SlotBinding)
    dialog: bool = False
    sticky_actions: bool = False


@dataclass(frozen=True)
class PlannedBlock:
    """A block the planner decided to render, with its knobs and bindings.

    Attributes:
        block_id: Identifier of the block within the archetype.
        pattern: Pattern name used to expand the block.
        variant_knobs: Chosen anatomy variant knob options keyed by knob name.
        bindings: Resolved slot bindings for the block.
        instances: Per-element instance answers mapping element key to a map of
            question name to chosen option.
        probability: Gate confidence probability for the block.
    """

    block_id: str
    pattern: str
    variant_knobs: Mapping[str, str] = field(default_factory=dict, hash=False)
    bindings: BlockBindings = field(default_factory=BlockBindings)
    instances: Mapping[str, Mapping[str, str]] = field(default_factory=dict, hash=False)
    probability: float = 1.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "variant_knobs", dict(self.variant_knobs))
        object.__setattr__(
            self, "instances", {k: dict(v) for k, v in self.instances.items()}
        )


@dataclass(frozen=True)
class LayoutPlan:
    """The planner's validated choice of archetype, blocks, and bindings.

    Attributes:
        archetype: Winning archetype name.
        family: Winning job family name.
        blocks: Planned blocks in render order.
        page: Page-level slot bindings and frame knobs.
        stakes: Expected stakes level index from the stakes question.
        urgency: Expected urgency level index from the urgency question.
        confidence: Overall plan confidence score.
        actions_allowed: Whether the action confidence gate permitted actions.
        template_id: Registered template chosen by the template question, if
            any.
        fit_score: Archetype fit score in ``[0.0, 1.0]``, when scored.
    """

    archetype: str
    family: str
    blocks: tuple[PlannedBlock, ...]
    page: PageBindings = field(default_factory=PageBindings)
    stakes: float = 0.0
    urgency: float = 0.0
    confidence: float = 0.0
    actions_allowed: bool = False
    template_id: str | None = None
    fit_score: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "blocks", tuple(self.blocks))
        if self.fit_score is not None:
            _validate_unit_interval("fit_score", self.fit_score)

    def block_ids(self) -> tuple[str, ...]:
        """Returns the IDs of the planned blocks in render order."""
        return tuple(block.block_id for block in self.blocks)


@dataclass(frozen=True)
class PlanOutcome:
    """Result of reading a batch of answers into a `LayoutPlan`.

    Attributes:
        plan: Validated `LayoutPlan` when `reason` is `PlanReason.PLANNED`, or
            None otherwise.
        reason: Outcome code explaining why planning succeeded or abstained.
        fit_score: Planner fit score in ``[0.0, 1.0]``, preserved even on
            `NO_FIT` outcomes without a plan.
    """

    plan: LayoutPlan | None
    reason: PlanReason
    fit_score: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "reason", PlanReason(self.reason))
        if (self.reason is PlanReason.PLANNED) != (self.plan is not None):
            raise ValueError(
                "PlanOutcome.plan must be set exactly when reason is 'planned'."
            )
        if self.fit_score is not None:
            _validate_unit_interval("fit_score", self.fit_score)


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


_ACTION_OPTION_KEYS = frozenset({"label", "scope", "key", "context", "style"})


def _action_pointer(action_id: str, name: str, value: Any) -> str:
    """Validates one JSON Pointer used in an action's options."""
    if not isinstance(value, str) or not value.startswith("/"):
        raise A2uiValidationError(
            f"Action {action_id!r}: {name} must be a JSON Pointer starting with"
            f" '/', got {value!r}."
        )
    return value


def _action_context(action_id: str, raw: Any) -> dict[str, str]:
    """Validates an action's ``context`` map of names to JSON Pointers."""
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise A2uiValidationError(
            f"Action {action_id!r}: context must be an object, got {raw!r}."
        )
    return {
        str(name): _action_pointer(action_id, f"context[{name!r}]", pointer)
        for name, pointer in raw.items()
    }


def _action_style(action_id: str, raw: Any) -> ActionStyle | None:
    """Parses an action's optional ``style`` into an `ActionStyle`."""
    if raw is None:
        return None
    try:
        return ActionStyle(raw)
    except ValueError:
        choices = ", ".join(repr(s.value) for s in ActionStyle)
        raise A2uiValidationError(
            f"Action {action_id!r}: style must be one of {choices}, got {raw!r}."
        ) from None


@dataclass(frozen=True)
class ActionSpec:
    """One action the model declared in the decision block's ``actions`` map.

    Attributes:
        id: Event name the agent receives when the action fires.
        label: Button text; presentational only.
        scope: JSON Pointer of the collection the action repeats over, for
            per-item actions.
        key: Item field used as the item's identity within `scope`. When
            None, the expander uses ``id`` if the items have one.
        context: Event context, as names mapped to JSON Pointers.
        style: Optional presentational emphasis.
    """

    id: str
    label: str
    scope: str | None = None
    key: str | None = None
    context: Mapping[str, str] = field(default_factory=dict, hash=False)
    style: ActionStyle | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not self.id.strip():
            raise A2uiValidationError("Action id must be a non-empty string.")
        if not isinstance(self.label, str) or not self.label.strip():
            raise A2uiValidationError(
                f"Action {self.id!r}: label must be a non-empty string."
            )
        object.__setattr__(self, "context", dict(self.context))

    @classmethod
    def from_block_value(
        cls, action_id: str, value: str | Mapping[str, Any]
    ) -> ActionSpec:
        """Builds an `ActionSpec` from one entry of the block's ``actions`` map.

        Args:
            action_id: The map key, used as the event name.
            value: Either the label string, or an options object with
                ``label`` (required) and optional ``scope``, ``key``,
                ``context``, and ``style``.

        Raises:
            A2uiValidationError: If the id or label is empty, the value is
                neither a string nor an object, an option key is unknown, or
                an option value is malformed.
        """
        if isinstance(value, str):
            return cls(id=action_id, label=value)
        if not isinstance(value, Mapping):
            raise A2uiValidationError(
                f"Action {action_id!r}: value must be a label string or an"
                f" options object, got {type(value).__name__}."
            )
        unknown = sorted(set(value) - _ACTION_OPTION_KEYS)
        if unknown:
            raise A2uiValidationError(
                f"Action {action_id!r}: unknown option keys {unknown}; allowed"
                f" keys are {sorted(_ACTION_OPTION_KEYS)}."
            )
        scope = value.get("scope")
        key = value.get("key")
        return cls(
            id=action_id,
            label=value.get("label", ""),
            scope=None if scope is None else _action_pointer(action_id, "scope", scope),
            key=None if key is None else str(key),
            context=_action_context(action_id, value.get("context")),
            style=_action_style(action_id, value.get("style")),
        )


class DecisionBackendError(A2uiError):
    """A decision backend failed to answer: a timeout, transport, or HTTP error.

    The format surfaces it as a compilation error; no fallback runs for it.

    Attributes:
        backend_kind: `DecisionBackend.backend_kind` of the failing backend.
        model_id: `DecisionBackend.model_id` of the failing backend.
        cause: The underlying exception, when there is one.
    """

    def __init__(
        self,
        message: str,
        *,
        backend_kind: str,
        model_id: str,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.backend_kind = backend_kind
        self.model_id = model_id
        self.cause = cause


def _validate_unit_interval(name: str, value: float) -> None:
    """Validates that a threshold or dial parameter lies in [0.0, 1.0]."""
    if not (0.0 <= value <= 1.0):
        raise ValueError(f"{name} must be in [0.0, 1.0], got {value}.")


@dataclass(frozen=True)
class SynthesisConfig:
    """Host-level settings for decision-model UI synthesis.

    Confidence thresholds live in the archetype grammar, not here.

    Attributes:
        default_surface_id: Surface ID used when the decision block does not
            name one.
        max_pairs: Budget of (question, candidate) pairs for one batch; past it
            the planner drops optional question groups and uses heuristics.
        conservativeness: Action gate scale between the grammar's
            `actionGateFloor` (0.0) and `actionGateCap` (1.0).
    """

    default_surface_id: str = "default_surface"
    max_pairs: int = 400
    conservativeness: float = 0.5

    def __post_init__(self) -> None:
        if not self.default_surface_id or not self.default_surface_id.strip():
            raise ValueError("default_surface_id must be a non-empty string.")
        if self.max_pairs < 1:
            raise ValueError(f"max_pairs must be >= 1, got {self.max_pairs}.")
        _validate_unit_interval("conservativeness", self.conservativeness)


def validate_threshold_relations(thresholds: Mapping[str, float], owner: str) -> None:
    """Checks ordering constraints between grammar threshold keys that are present.

    Args:
        thresholds: Threshold name-to-value mapping from a grammar definition.
        owner: Label identifying the grammar or archetype in error messages.

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
class PlanCacheKey:
    """Identifies a cached layout plan.

    Two requests share a key only when they target the same surface with the
    same catalog and grammar, and their payload shape and planning inputs
    hash to the same `shape_signature` (see `plan_shape_signature`).

    Attributes:
        surface_id: Target A2UI surface identifier.
        catalog_id: Catalog identifier for the surface.
        grammar_version: Version string of the archetype grammar.
        shape_signature: Hex SHA-256 digest from `plan_shape_signature`.
    """

    surface_id: str
    catalog_id: str
    grammar_version: str
    shape_signature: str


def _pointer_shape(pointer: PointerSummary) -> dict[str, Any]:
    """Returns the data-independent shape fields of one `PointerSummary`."""
    return {
        "path": pointer.path,
        "valueType": pointer.value_type,
        "semanticType": str(pointer.semantic_type),
        "elementKeys": sorted(pointer.element_keys),
        "elementTypes": {
            key: str(value)
            for key, value in sorted(pointer.element_semantic_types.items())
        },
        "mutable": pointer.mutable_hint,
    }


def _action_shape(action: ActionSpec) -> dict[str, Any]:
    """Returns the canonical dictionary representation of one `ActionSpec`."""
    return {
        "id": action.id,
        "label": action.label,
        "scope": action.scope,
        "key": action.key,
        "context": dict(sorted(action.context.items())),
        "style": None if action.style is None else action.style.value,
    }


def plan_shape_signature(
    pointers: Iterable[PointerSummary],
    *,
    intent: str,
    actions: Sequence[ActionSpec] = (),
    exclude: Collection[str] = (),
    mutable_paths: Collection[str] = (),
    labels: Mapping[str, str] | None = None,
    layout: Sequence[str] = (),
    title: str | None = None,
    summary: str | None = None,
    template_ids: Collection[str] = (),
    conservativeness: float = 0.5,
    model_id: str = "",
) -> str:
    """Hashes a payload's shape and every planning input into a cache signature.

    The shape keeps each pointer's path, coarse and semantic types, element
    keys and types, and mutability. It leaves out array lengths, sample
    values, and detector hints, so a payload whose values change but whose
    structure does not keeps its signature and reuses the cached plan. Any
    change to a planning input (the intent, an action or one of its options,
    the excluded or mutable pointers, labels, layout brief, authored copy,
    registered templates, conservativeness, or the backend model) changes the
    signature and forces a re-plan.

    Args:
        pointers: The payload's pointer summaries.
        intent: The block's intent text.
        actions: The block's actions, in render order.
        exclude: Pointers the surface must not show.
        mutable_paths: Pointers the user may edit.
        labels: Display labels keyed by pointer.
        layout: Raw ``role:key,key`` brief items, in order.
        title: Authored surface title.
        summary: Authored surface summary.
        template_ids: Ids of the registered templates offered to the planner.
        conservativeness: `SynthesisConfig.conservativeness`.
        model_id: `DecisionBackend.model_id` of the backend that plans.

    Returns:
        The hex SHA-256 digest of the canonical JSON of the inputs.
    """
    canonical = {
        "shape": sorted(
            (_pointer_shape(p) for p in pointers), key=lambda shape: shape["path"]
        ),
        "intent": intent,
        "actions": [_action_shape(action) for action in actions],
        "exclude": sorted(exclude),
        "mutablePaths": sorted(mutable_paths),
        "labels": dict(sorted((labels or {}).items())),
        "layout": list(layout),
        "title": title,
        "summary": summary,
        "templates": sorted(template_ids),
        "conservativeness": conservativeness,
        "modelId": model_id,
    }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class SynthesisOutput:
    """Result produced by a single decision-model synthesis pass.

    Attributes:
        stage: Synthesis stage that produced `messages`.
        messages: Synthesized A2UI wire messages.
        confidence: Overall confidence score of the chosen template or plan.
        entropy: Normalized Shannon entropy of the primary decision.
        selected_template_id: Registered template ID when `stage` is
            `TEMPLATE_SELECT`.
        fallback_source: Fallback link that produced `messages` after the model
            abstained, or None when no fallback ran.
        fallback_reason: Free-text reason the fallback chain ran.
        backend_kind: `DecisionBackend.backend_kind` of the answering backend.
        model_id: `DecisionBackend.model_id` of the answering backend.
        operation: How `messages` modify the client surface.
        layout_plan: Archetype layout plan when `stage` is `ARCHETYPE`.
        trace: Evaluated questions with their answers and threshold outcomes.
        decision_latency_ms: Wall-clock milliseconds spent waiting on the
            decision backend.
        decision_calls: Number of backend `answer` calls made during synthesis.
        decision_answers: Raw backend answers in question order.
        cache_hit: Whether a cached plan produced `messages` without a backend
            call.
    """

    stage: SynthesisStage
    messages: list[AgentToRendererMessage]
    confidence: float
    entropy: float
    selected_template_id: str | None = None
    fallback_source: FallbackSource | None = None
    fallback_reason: str | None = None
    backend_kind: str = ""
    model_id: str = ""
    operation: SurfaceOperation = SurfaceOperation.CREATE
    layout_plan: LayoutPlan | None = None
    trace: tuple[DecisionRecord, ...] = ()
    decision_latency_ms: float = 0.0
    decision_calls: int = 0
    decision_answers: tuple[DecisionAnswer, ...] = ()
    cache_hit: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "trace", tuple(self.trace))
        object.__setattr__(self, "decision_answers", tuple(self.decision_answers))

    def to_express(
        self,
        catalogs: Sequence[CatalogApi],
        *,
        use_keyword_args: bool = False,
    ) -> str:
        """Decompiles synthesized A2UI messages into A2UI Express DSL syntax.

        Args:
            catalogs: Catalogs defining the components present in `messages`.
            use_keyword_args: Whether to emit keyword arguments for all
                component properties.

        Returns:
            The decompiled A2UI Express string, or ``""`` when `messages` is
            empty.
        """
        if not self.messages:
            return ""
        from a2ui.inference_formats.express import ExpressDecompiler

        return ExpressDecompiler(catalogs).decompile(
            self.messages, use_keyword_args=use_keyword_args
        )
