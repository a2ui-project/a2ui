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

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
import json
import math
from typing import Any

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage


class _WireEnum(str, Enum):
    """String enum whose `str()` and `format()` yield the wire value.

    Since Python 3.11, `format()` on a plain `(str, Enum)` member returns
    `ClassName.MEMBER`, which would break f-string keys such as
    ``f"{query.task}:{query.prompt}"`` that existing backends build.
    """

    def __str__(self) -> str:
        return str.__str__(self)

    def __format__(self, format_spec: str) -> str:
        return str.__format__(str(self), format_spec)


class DecisionTask(_WireEnum):
    """Kind of choice a `DecisionQuery` asks a decision backend to make.

    Members compare equal to their string values, so backends and tests that
    match on the literal strings keep working.
    """

    TEMPLATE_SELECT = "template_select"
    ROOT_COMPONENT = "root_component"
    CHILD_COMPONENT = "child_component"


class DecisionWireFormat(_WireEnum):
    """Request and response format spoken by a remote decision endpoint."""

    JEV = "jev"
    SYSTEMONE = "systemone"


class DecisionBackendType(_WireEnum):
    """Backend selector accepted by `create_decision_backend`."""

    MOCK = "mock"
    LOCAL = "local"
    ONNX = "onnx"
    JEV = "jev"
    SYSTEMONE = "systemone"
    STEP_ZERO = "step0"


def coerce_decision_payload(
    payload: Mapping[str, Any] | Sequence[Any] | str,
    *,
    parse_json_strings: bool = True,
) -> Mapping[str, Any] | Sequence[Any]:
    """Normalizes a synthesis payload into a JSON object or array.

    LLM tool calls often pass the payload as a JSON-encoded string rather
    than a parsed object. This helper decodes such strings so callers do not
    have to.

    Args:
        payload: A mapping, a non-string sequence, or (when
            `parse_json_strings` is True) a JSON-encoded string of either.
        parse_json_strings: Whether a `str` payload is decoded as JSON. When
            False, a string payload is rejected.

    Returns:
        The payload as a `Mapping` or a non-string `Sequence`.

    Raises:
        TypeError: If the payload (after decoding) is neither a mapping nor a
            non-string sequence, or if it is a string and
            `parse_json_strings` is False.
        ValueError: If a string payload is not valid JSON.
    """
    if isinstance(payload, str):
        if not parse_json_strings:
            raise TypeError(
                "Payload must be a JSON object (Mapping) or array (Sequence);"
                " got a string and parse_json_strings is False."
            )
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Payload string is not valid JSON: {exc.msg}") from exc
        return coerce_decision_payload(decoded, parse_json_strings=False)
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
    FAST_1PASS_LEAF = "fast_1pass_leaf"
    CONTAINER_2PASS = "container_2pass"
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

    task: str
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
    entropy_switch_margin: float = 0.20
    max_tree_depth: int = 3
    max_children_per_container: int = 8
    default_surface_id: str = "default_surface"

    def __post_init__(self) -> None:
        _validate_unit_interval(
            "template_confidence_threshold", self.template_confidence_threshold
        )
        _validate_unit_interval(
            "mutable_confidence_threshold", self.mutable_confidence_threshold
        )
        _validate_unit_interval("abstain_threshold", self.abstain_threshold)
        _validate_unit_interval("entropy_switch_margin", self.entropy_switch_margin)
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


@dataclass(frozen=True)
class SynthesisOutput:
    """Result produced by a single decision-model synthesis pass."""

    stage: SynthesisStage
    messages: list[AgentToRendererMessage]
    confidence: float
    entropy: float
    selected_template_id: str | None = None
    component_tree_spec: dict[str, Any] | None = None
    fallback_source: str | None = None
    """Which fallback produced `messages` after the model abstained.

    One of ``"fallback_dsl"``, ``"fallback_fn"``, or ``"fallback_card"``;
    None when the model did not abstain or no fallback applied.
    """

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
