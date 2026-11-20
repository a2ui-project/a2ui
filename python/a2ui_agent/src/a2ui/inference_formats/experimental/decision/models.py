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

import base64
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
import json
import math
from typing import Any, Literal, TypeAlias

from a2ui.core import A2uiError, A2uiValidationError


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


ComponentKey: TypeAlias = tuple[str, str]
MediaModality: TypeAlias = Literal["image", "audio", "video", "document"]
MediaResolution: TypeAlias = Literal["low", "medium", "high", "ultra_high"]

_ALLOWED_MEDIA_URI_SCHEMES = ("https://", "gs://")
_DEFAULT_MAX_INLINE_BYTES = 20_971_520


@dataclass(frozen=True)
class TextInputPart:
    """Plain text input part for multimodal decision batches."""

    text: str


@dataclass(frozen=True)
class MediaInputPart:
    """Multimodal input part (image, audio, video, or document) for a decision batch.

    Exactly one of `data_b64` or `uri` must be provided. Inline base64 payloads
    are bounded by `max_inline_bytes`, and URIs are restricted to `https://`
    and `gs://`.
    """

    modality: MediaModality
    mime_type: str
    data_b64: str | None = None
    uri: str | None = None
    resolution: MediaResolution | None = None
    max_inline_bytes: int = _DEFAULT_MAX_INLINE_BYTES

    def __post_init__(self) -> None:
        if not self.mime_type or not self.mime_type.strip():
            raise ValueError("MediaInputPart.mime_type must be non-empty.")
        if (self.data_b64 is None) == (self.uri is None):
            raise ValueError("MediaInputPart requires exactly one of data_b64 or uri.")
        if self.uri is not None:
            if not self.uri.startswith(_ALLOWED_MEDIA_URI_SCHEMES):
                raise ValueError(
                    "MediaInputPart.uri must use an https:// or gs:// scheme."
                )
        if self.data_b64 is not None:
            if self.max_inline_bytes <= 0:
                raise ValueError("MediaInputPart.max_inline_bytes must be positive.")
            try:
                decoded = base64.b64decode(self.data_b64, validate=True)
            except Exception as exc:
                raise ValueError(
                    "MediaInputPart.data_b64 must be valid base64."
                ) from exc
            if len(decoded) > self.max_inline_bytes:
                raise ValueError(
                    f"MediaInputPart inline payload ({len(decoded)} bytes) exceeds"
                    f" max_inline_bytes ({self.max_inline_bytes})."
                )


InputPart: TypeAlias = TextInputPart | MediaInputPart


class SlotKind(str, Enum):
    """Semantic classification of a component property slot in a catalog schema."""

    CHILD = "child"
    CHILD_LIST = "child_list"
    NAMED_CHILD_ARRAY = "named_child_array"
    DATA_VALUE = "data_value"
    LITERAL_PRIMITIVE = "literal_primitive"
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
    allowed_parents: tuple[str, ...] = ()
    allowed_children: tuple[str, ...] = ()

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
    def task(self) -> str:
        """The task prefix named by `id` (the segment before the first ``':'``)."""
        return self.id.split(":", 1)[0]

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
        state: Optional explicit caller-formatted state string for non-planner
            tracks. Mutually exclusive with a non-empty `shared_context`.
        input_parts: Optional ordered multimodal input parts for backends that
            support media inputs.
    """

    shared_context: dict[str, Any] = field(default_factory=dict)
    questions: tuple[DecisionQuestion, ...] = ()
    state: str | None = None
    input_parts: tuple[InputPart, ...] = ()

    def __post_init__(self) -> None:
        context_dict = dict(self.shared_context)
        if self.state is not None and context_dict:
            raise ValueError(
                "DecisionBatch.state and non-empty shared_context are mutually"
                " exclusive."
            )
        object.__setattr__(self, "shared_context", context_dict)
        object.__setattr__(self, "questions", tuple(self.questions))
        object.__setattr__(self, "input_parts", tuple(self.input_parts))
        seen: set[str] = set()
        for question in self.questions:
            if question.id in seen:
                raise ValueError(f"Duplicate question id {question.id!r} in batch.")
            seen.add(question.id)

    def pair_count(self) -> int:
        """Returns the number of (question, candidate) pairs in this batch."""
        return sum(len(q.candidates()) for q in self.questions)


@dataclass(frozen=True)
class ActionSpec:
    """One action button declared for a decision-bound surface.

    Attributes:
        id: Event name the agent receives when the action fires.
        label: Button text; presentational only.
        scope: JSON Pointer of the collection the action repeats over, for
            per-item actions.
        key: Item field used as the item's identity within `scope`.
        context: Event context, as names mapped to JSON Pointers.
    """

    id: str
    label: str
    scope: str | None = None
    key: str | None = None
    context: Mapping[str, str] = field(default_factory=dict, hash=False)

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not self.id.strip():
            raise A2uiValidationError("Action id must be a non-empty string.")
        if not isinstance(self.label, str) or not self.label.strip():
            raise A2uiValidationError(
                f"Action {self.id!r}: label must be a non-empty string."
            )
        object.__setattr__(self, "context", dict(self.context))


@dataclass(frozen=True)
class ExpressSurfaceSpec:
    """One registered Express template surface shared by cascade routing and binding.

    Attributes:
        id: Stable unique identifier used as the decision candidate label.
        description: Short natural-language description shown to the decision
            model so it can match user intent or tool output to this template.
        dsl: A2UI Express DSL source for this template.
        catalog_id: Optional target catalog identifier used to compile `dsl`.
        required_paths: RFC 6901 JSON Pointer paths required in the payload.
    """

    id: str
    description: str
    dsl: str
    catalog_id: str | None = None
    required_paths: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not self.id.strip():
            raise ValueError("ExpressSurfaceSpec.id must be a non-empty string.")
        if not isinstance(self.description, str) or not self.description.strip():
            raise ValueError(
                f"ExpressSurfaceSpec {self.id!r}: description must be a non-empty"
                " string."
            )
        if not isinstance(self.dsl, str) or not self.dsl.strip():
            raise ValueError(
                f"ExpressSurfaceSpec {self.id!r}: dsl must be a non-empty string."
            )
        if isinstance(self.required_paths, (str, bytes)):
            raise TypeError(
                "ExpressSurfaceSpec.required_paths must be a sequence of JSON Pointers,"
                " not a string."
            )
        object.__setattr__(self, "required_paths", tuple(self.required_paths))


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
