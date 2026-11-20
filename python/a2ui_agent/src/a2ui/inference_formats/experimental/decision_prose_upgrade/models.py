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

"""Data models for decision-model prose-to-surface upgrade."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum
import re
from typing import Any

from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats.experimental.decision import ExpressSurfaceSpec

_FLAT_POINTER_RE = re.compile(r"^/[^/]+$")


class _WireEnum(str, Enum):
    """String enum whose `str()` and `format()` emit the wire value on Python 3.10+."""

    def __str__(self) -> str:
        return str(self.value)

    def __format__(self, format_spec: str) -> str:
        return format(str(self.value), format_spec)

    def __hash__(self) -> int:
        return hash(str(self.value))


class FieldType(_WireEnum):
    """Flat field types supported by `FieldExtractor` and `ProseSurfaceUpgrader`."""

    TEXT = "text"
    NUMBER = "number"
    DATE = "date"
    TIME = "time"
    DATETIME = "datetime"
    DURATION = "duration"
    BOOLEAN = "boolean"
    LIST_TEXT = "list_text"
    LIST_DATE = "list_date"


@dataclass(frozen=True)
class TypedFieldSpec:
    """Typed flat field extracted from prose into a template's data model.

    `path` must be a single-segment RFC 6901 JSON Pointer (for example,
    `"/orderId"` or `"/uptimeHours"`). Nested object paths are rejected in v1.
    """

    path: str
    field_type: FieldType
    description: str
    required: bool = True

    def __post_init__(self) -> None:
        if not _FLAT_POINTER_RE.match(self.path):
            raise ValueError(
                "TypedFieldSpec.path must be a single-segment JSON Pointer"
                f" (e.g. '/field'), got {self.path!r}."
            )
        if not self.description.strip():
            raise ValueError(
                f"TypedFieldSpec '{self.path}' requires a non-empty description."
            )

    @property
    def key(self) -> str:
        """Returns the RFC 6901 unescaped top-level data model key."""
        return self.path[1:].replace("~1", "/").replace("~0", "~")


@dataclass(frozen=True)
class ProseTemplateSpec:
    """Pairs an `ExpressSurfaceSpec` with its flat typed extraction schema."""

    id: str
    description: str
    surface: ExpressSurfaceSpec
    fields: tuple[TypedFieldSpec, ...]

    def __post_init__(self) -> None:
        if not self.id.strip():
            raise ValueError("ProseTemplateSpec.id must be non-empty.")
        if not self.fields:
            raise ValueError(
                f"ProseTemplateSpec '{self.id}' must declare at least one TypedFieldSpec."
            )
        seen: set[str] = set()
        for f in self.fields:
            if f.path in seen:
                raise ValueError(
                    f"Duplicate field path '{f.path}' in ProseTemplateSpec '{self.id}'."
                )
            seen.add(f.path)


@dataclass(frozen=True)
class ExtractedField:
    """One extracted field value with optional confidence and grounding metadata."""

    path: str
    value: Any = None
    found: bool = True
    confidence: float = 1.0
    p_null: float = 0.0
    truncated: bool = False
    needs_review: bool = False
    source_span: str | None = None


@dataclass(frozen=True)
class ExtractionResult:
    """Output of a `FieldExtractor.extract(...)` call."""

    fields: Mapping[str, ExtractedField] = field(default_factory=dict)
    latency_ms: float = 0.0
    model_id: str = ""


@dataclass(frozen=True)
class ExtractionThresholds:
    """Guardrail thresholds that prevent ungrounded or uncertain values from rendering."""

    min_field_confidence: float = 0.7
    max_p_null: float = 0.5
    reject_truncated: bool = True
    reject_needs_review: bool = True
    require_grounded_span: bool = False

    def __post_init__(self) -> None:
        if not (0.0 <= self.min_field_confidence <= 1.0):
            raise ValueError(
                "min_field_confidence must be in [0.0, 1.0],"
                f" got {self.min_field_confidence}."
            )
        if not (0.0 <= self.max_p_null <= 1.0):
            raise ValueError(
                f"max_p_null must be in [0.0, 1.0], got {self.max_p_null}."
            )


class FieldExtractionError(RuntimeError):
    """Raised when a `FieldExtractor` fails or returns malformed output."""


@dataclass(frozen=True)
class ProseUpgradeResult:
    """Outcome of upgrading a plain prose response into a companion A2UI surface."""

    messages: list[AgentToRendererMessage] = field(default_factory=list)
    template_id: str | None = None
    extracted_data: Mapping[str, Any] = field(default_factory=dict)
    abstained: bool = False
    reason: str = ""
    gate_probability: float = 0.0
    template_confidence: float = 0.0
    decision_calls: int = 0
    extraction_latency_ms: float = 0.0
