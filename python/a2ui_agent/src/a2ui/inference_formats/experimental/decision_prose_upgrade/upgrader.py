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

"""Decision-gated prose-to-surface upgrader for A2UI v1.0."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
import math
from typing import Any, Literal

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.experimental.decision import (
    DecisionBackend,
    DecisionBackendError,
    DecisionBatch,
    DecisionQuestion,
    PointerSummary,
    QuestionKind,
    is_secret_pointer,
    lower_for_transport,
)
from a2ui.inference_formats.express import ExpressCompiler
from a2ui.utils import RendererState
from a2ui.utils._experimental import experimental

from .extractors import FieldExtractor
from .models import (
    ExtractedField,
    ExtractionThresholds,
    FieldExtractionError,
    FieldType,
    ProseTemplateSpec,
    ProseUpgradeResult,
    TypedFieldSpec,
)

DEFAULT_GATE_THRESHOLD = 0.5
DEFAULT_MIN_TEMPLATE_CONFIDENCE = 0.65


def _is_grounded_in_prose(prose: str, span: str | None) -> bool:
    """Returns whether `span` appears verbatim (case-insensitive) in `prose`."""
    if not span or not span.strip():
        return False
    return span.strip().lower() in prose.lower()


def _matches_field_type(field_type: FieldType, value: Any) -> bool:
    """Validates that `value` matches the declared flat `FieldType`."""
    if value is None:
        return False
    if field_type is FieldType.NUMBER:
        return (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
        )
    if field_type is FieldType.BOOLEAN:
        return isinstance(value, bool)
    if field_type in (FieldType.LIST_TEXT, FieldType.LIST_DATE):
        return isinstance(value, list) and all(isinstance(item, str) for item in value)
    return isinstance(value, str) and bool(value.strip())


def _field_failure_reason(
    spec: TypedFieldSpec,
    extracted: ExtractedField | None,
    prose: str,
    thresholds: ExtractionThresholds,
) -> str | None:
    """Returns a failure reason if `extracted` fails any guard, or None if valid."""
    if extracted is None or not extracted.found or extracted.value is None:
        return f"missing field '{spec.path}'"
    if thresholds.reject_truncated and extracted.truncated:
        return f"field '{spec.path}' was truncated"
    if thresholds.reject_needs_review and extracted.needs_review:
        return f"field '{spec.path}' flagged needs_review"
    if not math.isfinite(extracted.p_null) or extracted.p_null >= thresholds.max_p_null:
        return (
            f"field '{spec.path}' p_null {extracted.p_null:.3f}"
            f" >= {thresholds.max_p_null:.3f}"
        )
    if (
        not math.isfinite(extracted.confidence)
        or extracted.confidence < thresholds.min_field_confidence
    ):
        return (
            f"field '{spec.path}' confidence {extracted.confidence:.3f}"
            f" < {thresholds.min_field_confidence:.3f}"
        )
    if thresholds.require_grounded_span and not _is_grounded_in_prose(
        prose, extracted.source_span
    ):
        return f"field '{spec.path}' source_span is not grounded in prose"
    if not _matches_field_type(spec.field_type, extracted.value):
        return f"field '{spec.path}' value type mismatch for '{spec.field_type.value}'"
    return None


def _is_excluded(path: str, exclude: Collection[str]) -> bool:
    return any(path == ex or path.startswith(f"{ex}/") for ex in exclude)


def _infer_pointer_type_and_cardinality(
    value: Any,
) -> tuple[Literal["string", "number", "boolean", "array", "object"], int]:
    """Returns `(value_type, cardinality)` matching `PointerSummary` conventions."""
    if isinstance(value, bool):
        return "boolean", 1
    if isinstance(value, (int, float)):
        return "number", 1
    if isinstance(value, list):
        return "array", len(value)
    return "string", 1


def _redact_flat_data(
    data: Mapping[str, Any],
    *,
    exclude: Collection[str] = (),
) -> dict[str, Any]:
    """Removes excluded paths and secret keys from a flat extracted data dict."""
    cleaned: dict[str, Any] = {}
    for key, value in data.items():
        escaped = key.replace("~", "~0").replace("/", "~1")
        path = f"/{escaped}"
        if _is_excluded(path, exclude):
            continue
        value_type, cardinality = _infer_pointer_type_and_cardinality(value)
        probe = PointerSummary(
            path=path, value_type=value_type, cardinality=cardinality, key=key
        )
        if is_secret_pointer(probe):
            continue
        cleaned[key] = value
    return cleaned


def _created_surface_id(
    messages: Sequence[AgentToRendererMessage], fallback: str
) -> str:
    """Returns the `surfaceId` of the first `createSurface` message, or `fallback`."""
    for msg in messages:
        dumped = msg.model_dump(by_alias=True, exclude_none=True)
        create_op = dumped.get("createSurface")
        if isinstance(create_op, Mapping) and isinstance(
            create_op.get("surfaceId"), str
        ):
            return str(create_op["surfaceId"])
    return fallback


@experimental
class ProseSurfaceUpgrader:
    """Upgrades plain LLM prose into a validated companion A2UI v1.0 surface.

    Runs one decision batch (`gate:has_structured_content` + `select:template`)
    followed by a typed `FieldExtractor` pass. Abstains cleanly (returning prose
    only) whenever the gate fails, no template matches, or any required field
    fails confidence, null-probability, truncation, review, or grounding guards.
    """

    def __init__(
        self,
        decision_backend: DecisionBackend,
        extractor: FieldExtractor,
        *,
        transport_catalogs: Sequence[CatalogApi],
        templates: Sequence[ProseTemplateSpec],
        gate_threshold: float = DEFAULT_GATE_THRESHOLD,
        min_template_confidence: float = DEFAULT_MIN_TEMPLATE_CONFIDENCE,
        extraction_thresholds: ExtractionThresholds | None = None,
        abstain_on_extractor_error: bool = False,
    ) -> None:
        if not transport_catalogs:
            raise ValueError("transport_catalogs must be non-empty.")
        if not templates:
            raise ValueError("templates must be non-empty.")
        if not (0.0 <= gate_threshold <= 1.0):
            raise ValueError(
                f"gate_threshold must be in [0.0, 1.0], got {gate_threshold}."
            )
        if not (0.0 <= min_template_confidence <= 1.0):
            raise ValueError(
                "min_template_confidence must be in [0.0, 1.0],"
                f" got {min_template_confidence}."
            )

        self._backend = decision_backend
        self._extractor = extractor
        self._transport_catalogs = tuple(transport_catalogs)
        self._gate_threshold = gate_threshold
        self._min_template_confidence = min_template_confidence
        self._thresholds = (
            extraction_thresholds
            if extraction_thresholds is not None
            else ExtractionThresholds()
        )
        self._abstain_on_extractor_error = abstain_on_extractor_error
        self._templates: dict[str, ProseTemplateSpec] = {}
        for tmpl in templates:
            if tmpl.id in self._templates:
                raise A2uiCatalogError(f"Duplicate ProseTemplateSpec id '{tmpl.id}'.")
            self._templates[tmpl.id] = tmpl

    def template_ids(self) -> tuple[str, ...]:
        """Returns registered prose template IDs in registration order."""
        return tuple(self._templates.keys())

    async def upgrade(
        self,
        prose: str,
        *,
        user_query: str = "",
        surface_id: str = "prose_surface",
        exclude: Collection[str] = (),
        renderer_state: RendererState | None = None,
        timeout_seconds: float | None = None,
    ) -> ProseUpgradeResult:
        """Evaluates `prose` and emits a validated A2UI v1.0 surface or abstains."""
        cleaned_prose = prose.strip()
        if not cleaned_prose:
            return ProseUpgradeResult(abstained=True, reason="empty prose input")

        state_text = (
            f"User Query: {user_query.strip()}\nResponse:\n{cleaned_prose}"
            if user_query.strip()
            else cleaned_prose
        )
        templates_list = tuple(self._templates.values())
        gate_q = DecisionQuestion(
            id="gate:has_structured_content",
            kind=QuestionKind.BOOLEAN,
            prompt=(
                "Does this response contain specific, concrete structured record"
                " values rather than general advice, definitions, or conversation?"
            ),
        )
        select_q = DecisionQuestion(
            id="select:template",
            kind=QuestionKind.CHOICE,
            prompt=(
                "Select the matching UI template for the concrete record in this"
                " response, or none."
            ),
            options=tuple(t.id for t in templates_list),
            option_texts=tuple(f"{t.id}: {t.description}" for t in templates_list),
            allow_none=True,
        )

        answers = await self._backend.answer(
            DecisionBatch(state=state_text, questions=(gate_q, select_q)),
            timeout_seconds=timeout_seconds,
        )
        answer_map = {ans.question_id: ans for ans in answers}
        gate_ans = answer_map.get("gate:has_structured_content")
        select_ans = answer_map.get("select:template")
        if gate_ans is None or select_ans is None:
            raise DecisionBackendError(
                "Decision backend omitted 'gate:has_structured_content' or"
                " 'select:template'.",
                backend_kind=self._backend.backend_kind,
                model_id=self._backend.model_id,
            )

        gate_prob = float(gate_ans.yes)
        choice, tmpl_prob = select_ans.top()

        if gate_prob < self._gate_threshold:
            return ProseUpgradeResult(
                abstained=True,
                reason=(
                    f"structured-content gate {gate_prob:.3f} below"
                    f" gate_threshold {self._gate_threshold:.3f}"
                ),
                gate_probability=gate_prob,
                template_confidence=tmpl_prob,
                decision_calls=1,
            )
        if not choice or choice == "none":
            return ProseUpgradeResult(
                abstained=True,
                reason="template selection chose none",
                gate_probability=gate_prob,
                template_confidence=tmpl_prob,
                decision_calls=1,
            )
        if tmpl_prob < self._min_template_confidence:
            return ProseUpgradeResult(
                template_id=choice,
                abstained=True,
                reason=(
                    f"template confidence {tmpl_prob:.3f} below"
                    f" min_template_confidence {self._min_template_confidence:.3f}"
                ),
                gate_probability=gate_prob,
                template_confidence=tmpl_prob,
                decision_calls=1,
            )
        template = self._templates.get(choice)
        if template is None:
            return ProseUpgradeResult(
                abstained=True,
                reason=f"unknown template choice '{choice}'",
                gate_probability=gate_prob,
                template_confidence=tmpl_prob,
                decision_calls=1,
            )

        try:
            extraction = await self._extractor.extract(
                cleaned_prose,
                template.fields,
                timeout_seconds=timeout_seconds,
            )
        except (FieldExtractionError, TimeoutError) as exc:
            if self._abstain_on_extractor_error:
                return ProseUpgradeResult(
                    template_id=template.id,
                    abstained=True,
                    reason=f"extractor failed: {exc}",
                    gate_probability=gate_prob,
                    template_confidence=tmpl_prob,
                    decision_calls=1,
                )
            if isinstance(exc, FieldExtractionError):
                raise
            raise FieldExtractionError(f"Field extractor failed: {exc}") from exc

        extracted_data: dict[str, Any] = {}
        for spec in template.fields:
            ef = extraction.fields.get(spec.path)
            failure = _field_failure_reason(spec, ef, cleaned_prose, self._thresholds)
            if failure is not None:
                if spec.required:
                    return ProseUpgradeResult(
                        template_id=template.id,
                        abstained=True,
                        reason=failure,
                        gate_probability=gate_prob,
                        template_confidence=tmpl_prob,
                        decision_calls=1,
                        extraction_latency_ms=extraction.latency_ms,
                    )
                continue
            assert ef is not None
            extracted_data[spec.key] = ef.value

        safe_data = _redact_flat_data(extracted_data, exclude=exclude)
        safe_paths = {f"/{k.replace('~', '~0').replace('/', '~1')}" for k in safe_data}
        missing_required = [
            path
            for path in (
                *(s.path for s in template.fields if s.required),
                *template.surface.required_paths,
            )
            if path not in safe_paths
        ]
        if missing_required:
            return ProseUpgradeResult(
                template_id=template.id,
                abstained=True,
                reason=f"required field redacted or missing: '{missing_required[0]}'",
                gate_probability=gate_prob,
                template_confidence=tmpl_prob,
                decision_calls=1,
                extraction_latency_ms=extraction.latency_ms,
            )
        compiled = self._compile_and_lower(
            template,
            safe_data,
            surface_id=surface_id,
            renderer_state=renderer_state,
        )
        return ProseUpgradeResult(
            messages=compiled,
            template_id=template.id,
            extracted_data=safe_data,
            abstained=False,
            reason="",
            gate_probability=gate_prob,
            template_confidence=tmpl_prob,
            decision_calls=1,
            extraction_latency_ms=extraction.latency_ms,
        )

    def _compile_and_lower(
        self,
        template: ProseTemplateSpec,
        data_model: Mapping[str, Any],
        *,
        surface_id: str,
        renderer_state: RendererState | None,
    ) -> list[AgentToRendererMessage]:
        catalogs: Sequence[CatalogApi] = self._transport_catalogs
        if template.surface.catalog_id is not None:
            matching = [
                c
                for c in self._transport_catalogs
                if c.catalog_id == template.surface.catalog_id
            ]
            if not matching:
                raise A2uiCatalogError(
                    f"Unknown catalog_id {template.surface.catalog_id!r}."
                )
            catalogs = matching
        compiler = ExpressCompiler(catalogs)
        compiled = list(compiler.compile(template.surface.dsl, surface_id=surface_id))
        effective_sid = _created_surface_id(compiled, surface_id)
        data_msg = to_message_models([{
            "version": "1.0",
            "updateDataModel": {
                "surfaceId": effective_sid,
                "path": "/",
                "value": dict(data_model),
            },
        }])
        compiled.extend(data_msg)
        return lower_for_transport(
            compiled,
            transport_catalogs=self._transport_catalogs,
            renderer_state=renderer_state,
        )
