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

"""Framework-agnostic `FieldExtractor` protocol and built-in extractors."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
import math
import time
from typing import Any, Protocol, runtime_checkable

from a2ui.utils._experimental import experimental

from .models import (
    ExtractedField,
    ExtractionResult,
    FieldExtractionError,
    FieldType,
    TypedFieldSpec,
)

StructuredJsonCaller = Callable[
    [str, dict[str, Any], float | None],
    Awaitable[Mapping[str, Any]],
]


@runtime_checkable
class FieldExtractor(Protocol):
    """Protocol for lifting flat typed field values out of plain prose."""

    @property
    def model_id(self) -> str:
        """Identifier of the underlying extraction model."""
        ...

    async def extract(
        self,
        text: str,
        fields: Sequence[TypedFieldSpec],
        *,
        timeout_seconds: float | None = None,
    ) -> ExtractionResult:
        """Extracts `fields` from `text`."""
        ...


def build_extraction_json_schema(fields: Sequence[TypedFieldSpec]) -> dict[str, Any]:
    """Builds a JSON Schema object describing per-field extraction outputs."""
    props: dict[str, Any] = {}
    for spec in fields:
        if spec.field_type is FieldType.NUMBER:
            val_schema: dict[str, Any] = {"type": "number", "nullable": True}
        elif spec.field_type is FieldType.BOOLEAN:
            val_schema = {"type": "boolean", "nullable": True}
        elif spec.field_type in (FieldType.LIST_TEXT, FieldType.LIST_DATE):
            val_schema = {
                "type": "array",
                "items": {"type": "string"},
                "nullable": True,
            }
        else:
            val_schema = {"type": "string", "nullable": True}

        props[spec.key] = {
            "type": "object",
            "properties": {
                "found": {"type": "boolean"},
                "value": val_schema,
                "source_span": {"type": "string", "nullable": True},
                "confidence": {"type": "number"},
                "p_null": {"type": "number"},
            },
            "required": ["found", "value", "source_span", "confidence", "p_null"],
        }

    return {
        "type": "object",
        "properties": {
            "fields": {
                "type": "object",
                "properties": props,
                "required": list(props.keys()),
            }
        },
        "required": ["fields"],
    }


def build_extraction_prompt(text: str, fields: Sequence[TypedFieldSpec]) -> str:
    """Formats a grounded extraction prompt for structured-JSON LLM callers."""
    lines = [
        "Extract ONLY values explicitly stated in the text below.",
        "Never guess or infer missing values.",
        (
            "If a field is not explicitly stated, set found=false, value=null,"
            " source_span=null, p_null=1.0, confidence=0.0."
        ),
        (
            "When found=true, copy the exact verbatim substring from the text"
            " into source_span."
        ),
        "",
        "Fields:",
    ]
    for spec in fields:
        req = "required" if spec.required else "optional"
        lines.append(
            f"- {spec.key} ({spec.field_type.value}, {req}): {spec.description}"
        )
    lines.extend(["", "Text:", text])
    return "\n".join(lines)


@experimental
class DeterministicMockExtractor:
    """Offline mock `FieldExtractor` returning scripted or default field values."""

    def __init__(
        self,
        scripted_fields: Mapping[str, ExtractedField | Any] | None = None,
        *,
        model_id: str = "mock-extractor",
    ) -> None:
        self._scripted = dict(scripted_fields or {})
        self._model_id = model_id

    @property
    def model_id(self) -> str:
        return self._model_id

    async def extract(
        self,
        text: str,
        fields: Sequence[TypedFieldSpec],
        *,
        timeout_seconds: float | None = None,
    ) -> ExtractionResult:
        del text, timeout_seconds
        out: dict[str, ExtractedField] = {}
        for spec in fields:
            raw = self._scripted.get(spec.path)
            if raw is None and spec.key in self._scripted:
                raw = self._scripted[spec.key]
            if isinstance(raw, ExtractedField):
                out[spec.path] = raw
            elif raw is not None:
                out[spec.path] = ExtractedField(
                    path=spec.path,
                    value=raw,
                    found=True,
                    confidence=0.95,
                    p_null=0.02,
                    source_span=str(raw),
                )
            else:
                out[spec.path] = ExtractedField(
                    path=spec.path,
                    value=None,
                    found=False,
                    confidence=0.0,
                    p_null=1.0,
                    source_span=None,
                )
        return ExtractionResult(
            fields=out,
            latency_ms=0.5,
            model_id=self._model_id,
        )


@experimental
class StructuredOutputExtractor:
    """Provider-agnostic `FieldExtractor` backed by an async JSON caller.

    Accepts any async callable `(prompt, response_schema, timeout_seconds) -> dict`
    so callers can plug in Gemini Flash, OpenAI, or local structured-output models
    without coupling `a2ui-agent-sdk` to a specific LLM client SDK.
    """

    def __init__(
        self,
        json_caller: StructuredJsonCaller,
        *,
        model_id: str = "structured-output",
    ) -> None:
        self._json_caller = json_caller
        self._model_id = model_id

    @property
    def model_id(self) -> str:
        return self._model_id

    async def extract(
        self,
        text: str,
        fields: Sequence[TypedFieldSpec],
        *,
        timeout_seconds: float | None = None,
    ) -> ExtractionResult:
        schema = build_extraction_json_schema(fields)
        prompt = build_extraction_prompt(text, fields)
        start = time.perf_counter()
        try:
            raw = await self._json_caller(prompt, schema, timeout_seconds)
        except Exception as exc:
            raise FieldExtractionError(
                f"StructuredOutputExtractor '{self._model_id}' failed: {exc}"
            ) from exc
        elapsed_ms = (time.perf_counter() - start) * 1000.0

        if not isinstance(raw, Mapping):
            raise FieldExtractionError(
                "StructuredOutputExtractor expected a JSON object response."
            )
        raw_fields = raw.get("fields", raw)
        if not isinstance(raw_fields, Mapping):
            raise FieldExtractionError(
                "StructuredOutputExtractor response 'fields' must be a JSON object."
            )

        extracted: dict[str, ExtractedField] = {}
        for spec in fields:
            entry = raw_fields.get(spec.key)
            if not isinstance(entry, Mapping):
                extracted[spec.path] = ExtractedField(
                    path=spec.path,
                    value=None,
                    found=False,
                    confidence=0.0,
                    p_null=1.0,
                    source_span=None,
                )
                continue
            found = bool(entry.get("found", entry.get("value") is not None))
            value = entry.get("value")
            span_raw = entry.get("source_span")
            span = str(span_raw) if isinstance(span_raw, str) else None
            conf_raw = entry.get("confidence", 1.0 if found else 0.0)
            p_null_raw = entry.get("p_null", 0.0 if found else 1.0)
            confidence = (
                float(conf_raw)
                if isinstance(conf_raw, (int, float))
                and not isinstance(conf_raw, bool)
                and math.isfinite(float(conf_raw))
                else (
                    0.0
                    if isinstance(conf_raw, (int, float))
                    else (1.0 if found else 0.0)
                )
            )
            p_null = (
                float(p_null_raw)
                if isinstance(p_null_raw, (int, float))
                and not isinstance(p_null_raw, bool)
                and math.isfinite(float(p_null_raw))
                else (
                    1.0
                    if isinstance(p_null_raw, (int, float))
                    else (0.0 if found else 1.0)
                )
            )
            extracted[spec.path] = ExtractedField(
                path=spec.path,
                value=value,
                found=found,
                confidence=confidence,
                p_null=p_null,
                truncated=bool(entry.get("truncated", False)),
                needs_review=bool(entry.get("needs_review", False)),
                source_span=span,
            )

        return ExtractionResult(
            fields=extracted,
            latency_ms=elapsed_ms,
            model_id=self._model_id,
        )
