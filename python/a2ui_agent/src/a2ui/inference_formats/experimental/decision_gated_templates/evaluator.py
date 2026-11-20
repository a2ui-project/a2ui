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

"""Decision-model evaluator for gated A2UI v1.0 templates."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.experimental.decision import (
    DecisionAnswer,
    DecisionBackend,
    DecisionBackendError,
    DecisionBatch,
    DecisionQuestion,
    PointerSummary,
    QuestionKind,
    coerce_decision_payload,
    inspect_pointers,
    is_secret_pointer,
    lower_for_transport,
)
from a2ui.utils import RendererState
from a2ui.utils._experimental import experimental

from .models import (
    GatedTemplateResult,
    GatedTemplateSpec,
    GateDecisionRecord,
    GateSpec,
    VariantGroupSpec,
)
from .pruner import extract_gates_and_variants, prune_components

DEFAULT_MIN_CONFIDENCE = 0.65
DEFAULT_MAX_PAIRS = 400
_ARRAY_PAYLOAD_KEY = "items"


@dataclass(frozen=True)
class _PreparedTemplate:
    """Validated template spec with pre-extracted gates and variant groups."""

    spec: GatedTemplateSpec
    gates: tuple[GateSpec, ...]
    variants: tuple[VariantGroupSpec, ...]


def _escape_pointer_token(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def _is_excluded(path: str, exclude: Collection[str]) -> bool:
    return any(path == ex or path.startswith(f"{ex}/") for ex in exclude)


def _is_mutable(path: str, mutable_set: set[str]) -> bool:
    return any(path == mp or path.startswith(f"{mp}/") for mp in mutable_set)


def _redact_value(
    value: Any, prefix: str, exclude: Collection[str], mutable_set: set[str]
) -> Any:
    if isinstance(value, Mapping):
        cleaned: dict[str, Any] = {}
        for raw_key, child in value.items():
            key_str = str(raw_key)
            child_path = f"{prefix}/{_escape_pointer_token(key_str)}"
            if _is_excluded(child_path, exclude):
                continue
            if not _is_mutable(child_path, mutable_set):
                probe = PointerSummary(
                    path=child_path, value_type="string", cardinality=1, key=key_str
                )
                if is_secret_pointer(probe):
                    continue
            cleaned[key_str] = _redact_value(child, child_path, exclude, mutable_set)
        return cleaned
    if isinstance(value, list):
        return [
            _redact_value(item, f"{prefix}/{idx}", exclude, mutable_set)
            for idx, item in enumerate(value)
            if not _is_excluded(f"{prefix}/{idx}", exclude)
        ]
    return value


def _redact_data_model(
    data_model: Mapping[str, Any],
    *,
    exclude: Collection[str] = (),
    mutable_paths: Collection[str] = (),
) -> dict[str, Any]:
    """Copies `data_model`, removing excluded paths and non-mutable secret fields."""
    mutable_set = {str(p) for p in mutable_paths}
    return dict(_redact_value(data_model, "", exclude, mutable_set))


def _normalize_payload(payload: Any) -> dict[str, Any] | None:
    """Normalizes a mapping, sequence, or JSON string into a root data dict."""
    if isinstance(payload, str):
        try:
            payload = coerce_decision_payload(payload)
        except (TypeError, ValueError):
            return None
    if isinstance(payload, Mapping):
        return dict(payload)
    if isinstance(payload, Sequence) and not isinstance(
        payload, (str, bytes, bytearray)
    ):
        return {_ARRAY_PAYLOAD_KEY: list(payload)}
    return None


def _format_state_text(
    intent: str,
    pointers: Sequence[PointerSummary],
    data_model: Mapping[str, Any],
) -> str:
    """Formats explicit `DecisionBatch.state` text for gate and variant scoring."""
    lines = [f"Intent: {intent.strip()}", "Payload:"]
    for ptr in pointers:
        extra = f", keys={list(ptr.element_keys)}" if ptr.element_keys else ""
        lines.append(
            f"- {ptr.path} ({ptr.value_type}/{ptr.semantic_type.value},"
            f" label={ptr.label}{extra})"
        )
    # Include redacted scalar values so boolean gates can reason about payload content.
    redacted = _redact_data_model(data_model)
    if redacted:
        lines.append(f"Values: {redacted}")
    return "\n".join(lines)


def _build_template_questions(
    prepared: _PreparedTemplate, *, prefix_template_id: bool = False
) -> list[DecisionQuestion]:
    """Builds `QuestionKind.BOOLEAN` gate and `QuestionKind.CHOICE` variant questions."""
    prefix = f"{prepared.spec.id}:" if prefix_template_id else ""
    questions: list[DecisionQuestion] = []
    for gate in prepared.gates:
        questions.append(
            DecisionQuestion(
                id=f"gate:{prefix}{gate.component_id}",
                kind=QuestionKind.BOOLEAN,
                prompt=gate.condition,
            )
        )
    for group in prepared.variants:
        questions.append(
            DecisionQuestion(
                id=f"variant:{prefix}{group.group}",
                kind=QuestionKind.CHOICE,
                prompt=group.prompt,
                options=tuple(opt.name for opt in group.options),
                option_texts=tuple(
                    f"{opt.name}: {opt.description}" for opt in group.options
                ),
                allow_none=group.allow_none,
            )
        )
    return questions


@experimental
class GatedTemplateEvaluator:
    """Evaluates boolean region gates and named variants on A2UI v1.0 templates."""

    def __init__(
        self,
        backend: DecisionBackend,
        *,
        transport_catalogs: Sequence[CatalogApi],
        templates: Sequence[GatedTemplateSpec] = (),
        min_confidence: float = DEFAULT_MIN_CONFIDENCE,
        max_pairs: int = DEFAULT_MAX_PAIRS,
    ) -> None:
        if not transport_catalogs:
            raise ValueError("transport_catalogs must be non-empty.")
        if not (0.0 <= min_confidence <= 1.0):
            raise ValueError(
                f"min_confidence must be in [0.0, 1.0], got {min_confidence}."
            )
        if max_pairs < 1:
            raise ValueError(f"max_pairs must be >= 1, got {max_pairs}.")

        self._backend = backend
        self._transport_catalogs = tuple(transport_catalogs)
        self._min_confidence = min_confidence
        self._max_pairs = max_pairs
        self._templates: dict[str, _PreparedTemplate] = {}
        for spec in templates:
            if spec.id in self._templates:
                raise A2uiCatalogError(f"Duplicate gated template id '{spec.id}'.")
            gates, variants = extract_gates_and_variants(spec.components)
            self._templates[spec.id] = _PreparedTemplate(
                spec=spec, gates=gates, variants=variants
            )

    def template_ids(self) -> tuple[str, ...]:
        """Returns registered template IDs in registration order."""
        return tuple(self._templates.keys())

    async def evaluate(
        self,
        template_id: str,
        intent: str,
        payload: Any,
        *,
        surface_id: str = "gated_surface",
        exclude: Collection[str] = (),
        mutable_paths: Collection[str] = (),
        renderer_state: RendererState | None = None,
        timeout_seconds: float | None = None,
    ) -> GatedTemplateResult:
        """Evaluates all gates and variants on a named `template_id` in one batch."""
        prepared = self._templates.get(template_id)
        if prepared is None:
            raise A2uiCatalogError(f"Unknown gated template '{template_id}'.")

        data_model = _normalize_payload(payload)
        if data_model is None:
            return GatedTemplateResult(
                template_id=template_id,
                abstained=True,
                reason="empty or non-structured payload",
            )

        pointers = inspect_pointers(
            data_model, exclude=exclude, mutable_paths=mutable_paths
        )
        questions = _build_template_questions(prepared, prefix_template_id=False)
        answer_map: dict[str, DecisionAnswer] = {}
        calls = 0
        if questions:
            state_text = _format_state_text(intent, pointers, data_model)
            answers = await self._backend.answer(
                DecisionBatch(state=state_text, questions=tuple(questions)),
                timeout_seconds=timeout_seconds,
            )
            answer_map = {ans.question_id: ans for ans in answers}
            calls = 1

        return self._apply_answers(
            prepared,
            answer_map=answer_map,
            prefix_template_id=False,
            data_model=data_model,
            surface_id=surface_id,
            exclude=exclude,
            mutable_paths=mutable_paths,
            decision_calls=calls,
            renderer_state=renderer_state,
        )

    async def select_and_evaluate(
        self,
        intent: str,
        payload: Any,
        *,
        surface_id: str = "gated_surface",
        exclude: Collection[str] = (),
        mutable_paths: Collection[str] = (),
        renderer_state: RendererState | None = None,
        timeout_seconds: float | None = None,
    ) -> GatedTemplateResult:
        """Selects the best gated template and evaluates its gates and variants.

        Combines `select:template` with all candidate gate/variant questions in
        1 backend call when total `(question, candidate)` pairs <= `max_pairs`,
        or splits into 2 calls otherwise.
        """
        if not self._templates:
            return GatedTemplateResult(
                abstained=True, reason="no gated templates registered"
            )

        data_model = _normalize_payload(payload)
        if data_model is None:
            return GatedTemplateResult(
                abstained=True, reason="empty or non-structured payload"
            )

        pointers = inspect_pointers(
            data_model, exclude=exclude, mutable_paths=mutable_paths
        )
        pointer_paths = {p.path for p in pointers}
        eligible = [
            prep
            for prep in self._templates.values()
            if all(path in pointer_paths for path in prep.spec.required_paths)
        ]
        if not eligible:
            return GatedTemplateResult(
                abstained=True, reason="no eligible gated templates for payload"
            )

        select_q = DecisionQuestion(
            id="select:template",
            kind=QuestionKind.CHOICE,
            prompt="Select the best gated UI template for this payload, or none.",
            options=tuple(p.spec.id for p in eligible),
            option_texts=tuple(
                f"{p.spec.id}: {p.spec.description}" for p in eligible
            ),
            allow_none=True,
        )
        questions_by_tid = {
            p.spec.id: _build_template_questions(p, prefix_template_id=True)
            for p in eligible
        }
        all_gate_questions = [
            q for p in eligible for q in questions_by_tid[p.spec.id]
        ]
        total_pairs = len(select_q.candidates()) + sum(
            len(q.candidates()) for q in all_gate_questions
        )
        state_text = _format_state_text(intent, pointers, data_model)

        if total_pairs <= self._max_pairs:
            answers = await self._backend.answer(
                DecisionBatch(
                    state=state_text, questions=(select_q, *all_gate_questions)
                ),
                timeout_seconds=timeout_seconds,
            )
            answer_map = {ans.question_id: ans for ans in answers}
            calls = 1
        else:
            first_answers = await self._backend.answer(
                DecisionBatch(state=state_text, questions=(select_q,)),
                timeout_seconds=timeout_seconds,
            )
            answer_map = {ans.question_id: ans for ans in first_answers}
            calls = 1

        select_ans = answer_map.get("select:template")
        if select_ans is None:
            raise DecisionBackendError(
                "Decision backend omitted answer for 'select:template'.",
                backend_kind=self._backend.backend_kind,
                model_id=self._backend.model_id,
            )
        choice, prob = select_ans.top()
        if not choice or choice == "none":
            return GatedTemplateResult(
                abstained=True,
                reason="template selection chose none",
                decision_calls=calls,
            )
        if prob < self._min_confidence:
            return GatedTemplateResult(
                template_id=choice,
                abstained=True,
                reason=(
                    f"template confidence {prob:.3f} below min_confidence"
                    f" {self._min_confidence:.3f}"
                ),
                decision_calls=calls,
            )
        winner = self._templates.get(choice)
        if winner is None:
            return GatedTemplateResult(
                abstained=True,
                reason=f"unknown template choice '{choice}'",
                decision_calls=calls,
            )

        if total_pairs > self._max_pairs:
            winner_questions = questions_by_tid.get(winner.spec.id, [])
            if winner_questions:
                second_answers = await self._backend.answer(
                    DecisionBatch(state=state_text, questions=tuple(winner_questions)),
                    timeout_seconds=timeout_seconds,
                )
                for ans in second_answers:
                    answer_map[ans.question_id] = ans
                calls = 2

        return self._apply_answers(
            winner,
            answer_map=answer_map,
            prefix_template_id=True,
            data_model=data_model,
            surface_id=surface_id,
            exclude=exclude,
            mutable_paths=mutable_paths,
            decision_calls=calls,
            renderer_state=renderer_state,
        )

    def _apply_answers(
        self,
        prepared: _PreparedTemplate,
        *,
        answer_map: Mapping[str, DecisionAnswer],
        prefix_template_id: bool,
        data_model: Mapping[str, Any],
        surface_id: str,
        exclude: Collection[str],
        mutable_paths: Collection[str],
        decision_calls: int,
        renderer_state: RendererState | None,
    ) -> GatedTemplateResult:
        """Interprets gate/variant answers, prunes components, and lowers wire output."""
        prefix = f"{prepared.spec.id}:" if prefix_template_id else ""
        pruned_ids: set[str] = set()
        records: list[GateDecisionRecord] = []

        for gate in prepared.gates:
            qid = f"gate:{prefix}{gate.component_id}"
            ans = answer_map.get(qid)
            yes_prob = float(ans.yes) if ans is not None else 0.0
            keep = yes_prob >= gate.threshold
            if not keep:
                pruned_ids.add(gate.component_id)
            records.append(
                GateDecisionRecord(
                    kind="gate",
                    target=gate.component_id,
                    chosen="keep" if keep else "prune",
                    probability=yes_prob,
                    kept_component_ids=(gate.component_id,) if keep else (),
                    pruned_component_ids=() if keep else (gate.component_id,),
                )
            )

        for group in prepared.variants:
            qid = f"variant:{prefix}{group.group}"
            ans = answer_map.get(qid)
            chosen, prob = ans.top() if ans is not None else ("none", 0.0)
            below_conf = prob < group.min_confidence
            if not chosen or chosen == "none" or below_conf:
                if not group.allow_none:
                    return GatedTemplateResult(
                        template_id=prepared.spec.id,
                        decisions=tuple(records),
                        decision_calls=decision_calls,
                        abstained=True,
                        reason=(
                            f"variant group '{group.group}' fell below min_confidence"
                            f" ({prob:.3f} < {group.min_confidence:.3f})"
                            if below_conf
                            else f"variant group '{group.group}' had no selected option"
                        ),
                    )
                all_group_ids = tuple(opt.component_id for opt in group.options)
                pruned_ids.update(all_group_ids)
                records.append(
                    GateDecisionRecord(
                        kind="variant",
                        target=group.group,
                        chosen="none",
                        probability=prob,
                        kept_component_ids=(),
                        pruned_component_ids=all_group_ids,
                    )
                )
                continue

            kept_ids: list[str] = []
            dropped_ids: list[str] = []
            for opt in group.options:
                if opt.name == chosen:
                    kept_ids.append(opt.component_id)
                else:
                    dropped_ids.append(opt.component_id)
                    pruned_ids.add(opt.component_id)
            records.append(
                GateDecisionRecord(
                    kind="variant",
                    target=group.group,
                    chosen=chosen,
                    probability=prob,
                    kept_component_ids=tuple(kept_ids),
                    pruned_component_ids=tuple(dropped_ids),
                )
            )

        surviving, final_pruned = prune_components(prepared.spec.components, pruned_ids)
        if not surviving:
            return GatedTemplateResult(
                template_id=prepared.spec.id,
                pruned_component_ids=final_pruned,
                decisions=tuple(records),
                decision_calls=decision_calls,
                abstained=True,
                reason="root component lost a required child after pruning",
            )

        catalog_id = prepared.spec.catalog_id or self._transport_catalogs[0].catalog_id
        safe_data = _redact_data_model(
            data_model, exclude=exclude, mutable_paths=mutable_paths
        )
        raw_messages = list(
            to_message_models([
                {
                    "version": "1.0",
                    "createSurface": {
                        "surfaceId": surface_id,
                        "catalogId": catalog_id,
                    },
                },
                {
                    "version": "1.0",
                    "updateComponents": {
                        "surfaceId": surface_id,
                        "components": surviving,
                    },
                },
                {
                    "version": "1.0",
                    "updateDataModel": {
                        "surfaceId": surface_id,
                        "path": "/",
                        "value": safe_data,
                    },
                },
            ])
        )
        lowered = lower_for_transport(
            raw_messages,
            transport_catalogs=self._transport_catalogs,
            renderer_state=renderer_state,
        )
        kept_all = tuple(str(c["id"]) for c in surviving if isinstance(c.get("id"), str))
        return GatedTemplateResult(
            messages=lowered,
            template_id=prepared.spec.id,
            kept_component_ids=kept_all,
            pruned_component_ids=final_pruned,
            decisions=tuple(records),
            decision_calls=decision_calls,
            abstained=False,
            reason="",
        )
