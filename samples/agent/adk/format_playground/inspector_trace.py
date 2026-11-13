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

"""Builds structured per-turn playground traces for `<playground-inspector>`.

Reconstructs the speculative `DecisionBatch` and `PlanCacheKey` from the active
`DecisionSynthesizer`, formats the backend wire request, and packages all four
pipeline stages into an `application/x-a2ui-playground-trace+json` A2A `DataPart`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
import json
from typing import Any, Literal
import urllib.parse

from a2a.types import DataPart, Part

from a2ui.core import A2uiError
from a2ui.inference_formats.decision import (
    AuthoredCopy,
    DecisionAnswer,
    DecisionBackend,
    DecisionBatch,
    DecisionBlock,
    DecisionQuestion,
    DecisionRecord,
    DecisionSynthesizer,
    LayoutBrief,
    LayoutPlan,
    PlanCacheKey,
    PlannedBlock,
    PointerSummary,
    QuestionKind,
    SynthesisOutput,
    coerce_decision_payload,
    eligible_archetypes,
    inspect_payload_pointers,
)
from modes import LlmTurn, RenderMode, RenderResult, TurnMetrics
from renderers import stage2_user_text

PLAYGROUND_TRACE_MIME_TYPE = "application/x-a2ui-playground-trace+json"
"""MIME type carried in `DataPart.metadata['mimeType']` for playground traces."""

Stage1Source = Literal["llm", "direct_tool", "tool_call", "pasted_json"]


def sanitize_endpoint_url(url: str | None) -> str | None:
    """Strips credentials, query parameters, and fragments from `url`.

    Args:
        url: Raw endpoint URL string, or `None`.

    Returns:
        The sanitized `scheme://hostname[:port]/path` string, or `None` if
        `url` is empty or invalid.
    """
    if not isinstance(url, str) or not url.strip():
        return None
    parts = urllib.parse.urlsplit(url.strip())
    if not parts.scheme or not parts.hostname:
        return None
    try:
        port = parts.port
    except ValueError:
        return None
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    netloc = f"{host}:{port}" if port is not None else host
    return urllib.parse.urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def resolve_wire_format(
    backend: DecisionBackend,
) -> Literal["gemini_decisions", "systemone", "jev", "in_process"]:
    """Derives the inspector wire format identifier from `backend`.

    Args:
        backend: Active `DecisionBackend` instance.

    Returns:
        One of `"gemini_decisions"`, `"systemone"`, `"jev"`, or `"in_process"`.
    """
    endpoint_url = getattr(backend, "endpoint_url", None)
    if isinstance(endpoint_url, str) and endpoint_url.strip():
        path = urllib.parse.urlsplit(endpoint_url.strip()).path.rstrip("/")
        if path.endswith("/v1beta/decisions"):
            return "gemini_decisions"
        if path.endswith("/v1/systemone"):
            return "systemone"
    kind = getattr(backend, "backend_kind", "")
    if kind == "gemini":
        return "gemini_decisions"
    if kind == "systemone":
        return "systemone"
    if kind == "jev":
        return "jev"
    return "in_process"


def _pointers_summary(
    context: Mapping[str, Any], label: str, *, max_pointers: int = 12
) -> str | None:
    """Formats the available payload pointers clause when present in `context`.

    Args:
        context: Shared decision context dictionary.
        label: Prefix label for the pointers list.
        max_pointers: Maximum number of pointer paths to include.

    Returns:
        A formatted pointer list string, or `None` if `context` has no pointers.
    """
    pointers = context.get("pointers")
    if not isinstance(pointers, (list, tuple)) or not pointers:
        return None
    pts = list(pointers[:max_pointers]) if max_pointers > 0 else list(pointers)
    return f"{label}: {', '.join(str(p) for p in pts)}"


def _build_systemone_state(shared_context: Mapping[str, Any]) -> str:
    """Formats `shared_context` into a `/v1/systemone` or `/v1beta/decisions` context string.

    Args:
        shared_context: Shared context dictionary from a `DecisionBatch`.

    Returns:
        A non-empty state/input string summarizing intent and payload fields.
    """
    intent = shared_context.get("intent")
    intent_part = f"User intent: {intent}" if intent else None
    ptr_part = _pointers_summary(shared_context, "Payload data fields")
    parts = [p for p in (intent_part, ptr_part) if p]
    if not parts and shared_context:
        parts = [f"{k}: {v}" for k, v in shared_context.items()]
    return ". ".join(parts) if parts else "(no context)"


def _serialize_choice_criteria(question: DecisionQuestion) -> dict[str, str]:
    """Builds the candidate-to-description map for a categorical choice question.

    Args:
        question: Categorical `DecisionQuestion`.

    Returns:
        A dictionary mapping each candidate option to its description string.
    """
    desc_map: dict[str, str] = {}
    if question.option_texts:
        desc_map.update(
            (opt, str(txt))
            for opt, txt in zip(question.options, question.option_texts)
            if txt
        )
    cand_descs = question.context.get("candidate_descriptions")
    if isinstance(cand_descs, Mapping):
        desc_map.update((str(k), str(v)) for k, v in cand_descs.items() if v)
    return {
        c: (
            desc_map.get(c)
            or ("None of the above" if c == "none" else f"Candidate option: {c}")
        )
        for c in question.candidates()
    }


def _serialize_score_criteria(question: DecisionQuestion) -> list[str]:
    """Serializes level criteria for a score question.

    Args:
        question: Score `DecisionQuestion`.

    Returns:
        A list of formatted level criteria strings.
    """
    if question.option_texts and len(question.option_texts) == len(question.options):
        return [
            f"{lvl}: {txt}" if txt else str(lvl)
            for lvl, txt in zip(question.options, question.option_texts)
        ]
    return [str(lvl) for lvl in question.options]


def _serialize_systemone_question(
    question: DecisionQuestion, *, gemini_decisions: bool
) -> dict[str, Any]:
    """Serializes one `DecisionQuestion` for `/v1/systemone` or `/v1beta/decisions`.

    Args:
        question: Planner `DecisionQuestion` to serialize.
        gemini_decisions: Whether to use `/v1beta/decisions` boolean criteria
            keys (`true_description` and `false_description`).

    Returns:
        A wire-format question specification dictionary.
    """
    if question.kind is QuestionKind.BOOLEAN:
        spec: dict[str, Any] = {
            "type": "noul",
            "instructions": question.prompt,
        }
        true_key = "true_description" if gemini_decisions else "true"
        false_key = "false_description" if gemini_decisions else "false"
        criteria = {
            target: str(question.context[src])
            for src, target in (("yes", true_key), ("no", false_key))
            if question.context.get(src)
        }
        if criteria:
            spec["criteria"] = criteria
        return spec
    if question.kind is QuestionKind.SCORE:
        return {
            "type": "score",
            "instructions": question.prompt,
            "criteria": _serialize_score_criteria(question),
        }
    return {
        "type": "choice",
        "instructions": question.prompt,
        "criteria": _serialize_choice_criteria(question),
    }


def _serialize_native_question(question: DecisionQuestion) -> dict[str, Any]:
    """Serializes one `DecisionQuestion` into a native Jev batch request item.

    Args:
        question: Planner `DecisionQuestion` to serialize.

    Returns:
        A dictionary matching the native Jev question schema.
    """
    entry: dict[str, Any] = {
        "id": question.id,
        "kind": question.kind.value,
        "task": str(getattr(question.task, "value", question.task)),
        "prompt": question.prompt,
        "candidates": list(question.candidates()),
    }
    if question.options:
        entry["options"] = list(question.options)
    if question.option_texts:
        entry["option_texts"] = list(question.option_texts)
    if question.context:
        entry["context"] = dict(question.context)
    if question.kind is QuestionKind.CHOICE:
        entry["allow_none"] = question.allow_none
    return entry


def _format_systemone_wire_request(
    backend: DecisionBackend,
    batch: DecisionBatch,
    *,
    gemini_decisions: bool,
) -> dict[str, Any] | None:
    """Formats a `/v1beta/decisions` or `/v1/systemone` batch request dictionary.

    Args:
        backend: Active `DecisionBackend`.
        batch: Reconstructed `DecisionBatch`.
        gemini_decisions: Whether to format for `/v1beta/decisions` (`input`
            and `q_<index>` keys) rather than `/v1/systemone`.

    Returns:
        The wire request dictionary, or `None` if no questions remain after
        filtering single-option choice questions.
    """
    wire_questions: dict[str, dict[str, Any]] = {}
    for idx, q in enumerate(batch.questions):
        if q.kind is QuestionKind.CHOICE and len(q.candidates()) < 2:
            continue
        wire_id = f"q_{idx}" if gemini_decisions else q.id
        wire_questions[wire_id] = _serialize_systemone_question(
            q, gemini_decisions=gemini_decisions
        )
    if not wire_questions:
        return None
    context_key = "input" if gemini_decisions else "state"
    return {
        "model": getattr(backend, "model_id", "default"),
        context_key: _build_systemone_state(batch.shared_context),
        "questions": wire_questions,
    }


def format_wire_request(
    backend: DecisionBackend,
    batch: DecisionBatch,
    wire_format: str,
) -> dict[str, Any] | None:
    """Formats the JSON request body sent to `backend` for `batch`.

    Args:
        backend: Active `DecisionBackend`.
        batch: Reconstructed `DecisionBatch`.
        wire_format: Wire format identifier (`"gemini_decisions"`,
            `"systemone"`, `"jev"`, or `"in_process"`).

    Returns:
        The JSON-serializable wire request dictionary, or `None` when `batch`
        has no questions or `wire_format` is unrecognized.
    """
    if not batch.questions:
        return None
    if wire_format in ("gemini_decisions", "systemone"):
        return _format_systemone_wire_request(
            backend, batch, gemini_decisions=(wire_format == "gemini_decisions")
        )
    if wire_format in ("jev", "in_process"):
        return {
            "shared_context": dict(batch.shared_context),
            "questions": [_serialize_native_question(q) for q in batch.questions],
        }
    return None


def create_trace_part(trace: Mapping[str, Any]) -> Part:
    """Wraps a `PlaygroundTurnTrace` dictionary in an A2A `DataPart`.

    Args:
        trace: Serialized `PlaygroundTurnTrace` mapping.

    Returns:
        An A2A `Part` tagged with `PLAYGROUND_TRACE_MIME_TYPE`.
    """
    return Part(
        root=DataPart(
            data=dict(trace),
            metadata={"mimeType": PLAYGROUND_TRACE_MIME_TYPE},
        )
    )


def _normalize_payload_data(payload: Any) -> Mapping[str, Any]:
    """Normalizes a block payload into a surface data-model mapping.

    Args:
        payload: Raw payload object or sequence from a `DecisionBlock`.

    Returns:
        A mapping suitable for pointer inspection and layout planning.
    """
    coerced = coerce_decision_payload(payload)
    if isinstance(coerced, Mapping):
        return coerced
    return {"items": list(coerced)}


def _inspect_filtered_pointers(
    data: Mapping[str, Any],
    block: DecisionBlock,
) -> tuple[PointerSummary, ...]:
    """Inspects payload pointers, drops `block.exclude`, and applies `block.labels`.

    Args:
        data: Normalized payload mapping.
        block: Source `DecisionBlock` carrying `mutable_paths`, `exclude`, and
            `labels`.

    Returns:
        A tuple of filtered and relabeled `PointerSummary` entries.
    """
    raw = inspect_payload_pointers(data, mutable_paths=block.mutable_paths or ())
    if block.exclude:
        filtered = tuple(
            p
            for p in raw
            if not any(
                p.path == ex or p.path.startswith(f"{ex}/") for ex in block.exclude
            )
        )
    else:
        filtered = tuple(raw)
    labels = dict(block.labels) if block.labels else {}
    if not labels:
        return filtered
    return tuple(
        replace(p, label=labels[p.path]) if p.path in labels else p for p in filtered
    )


def _parse_optional_brief(
    block: DecisionBlock, synthesizer: DecisionSynthesizer
) -> LayoutBrief | None:
    """Parses `block.layout` against `synthesizer.archetypes`.

    Args:
        block: Source `DecisionBlock`.
        synthesizer: Active `DecisionSynthesizer` providing valid brief roles.

    Returns:
        A non-empty `LayoutBrief`, or `None` if `block.layout` is unset or
        invalid.
    """
    if not block.layout:
        return None
    try:
        parsed = LayoutBrief.parse(
            block.layout, roles=synthesizer.archetypes.brief_roles()
        )
    except (A2uiError, ValueError):
        return None
    return parsed if parsed.sections else None


def _reconstruct_batch_and_key(
    synthesizer: DecisionSynthesizer,
    block: DecisionBlock,
    surface_id: str,
    output: SynthesisOutput | None,
) -> tuple[DecisionBatch, PlanCacheKey, tuple[PointerSummary, ...]]:
    """Reconstructs `(batch, cache_key, pointers)` for a decision or tool render.

    Args:
        synthesizer: Active `DecisionSynthesizer`.
        block: Source `DecisionBlock`.
        surface_id: Target A2UI surface identifier.
        output: Completed `SynthesisOutput`, if available.

    Returns:
        A `(batch, cache_key, pointers)` tuple.
    """
    data = _normalize_payload_data(block.payload)
    pointers = _inspect_filtered_pointers(data, block)
    brief = _parse_optional_brief(block, synthesizer)
    copy = (
        AuthoredCopy(title=block.title, summary=block.summary)
        if (block.title is not None or block.summary is not None)
        else None
    )
    labels = dict(block.labels) if block.labels else {}
    cache_key = synthesizer.make_cache_key(
        surface_id,
        block.intent,
        pointers,
        actions=block.actions,
        exclude=block.exclude,
        mutable_paths=block.mutable_paths,
        labels=labels,
        layout=brief,
        title=copy.title if copy is not None else None,
        summary=copy.summary if copy is not None else None,
    )
    batch = _build_planner_batch(
        synthesizer, block, data, pointers, brief, copy, labels, output
    )
    return batch, cache_key, pointers


def _build_planner_batch(
    synthesizer: DecisionSynthesizer,
    block: DecisionBlock,
    data: Mapping[str, Any],
    pointers: tuple[PointerSummary, ...],
    brief: LayoutBrief | None,
    copy: AuthoredCopy | None,
    labels: dict[str, str],
    output: SynthesisOutput | None,
) -> DecisionBatch:
    """Builds the speculative, region, or two-stage `DecisionBatch` for `block`.

    Args:
        synthesizer: Active `DecisionSynthesizer`.
        block: Source `DecisionBlock`.
        data: Normalized payload mapping.
        pointers: Filtered payload pointer summaries.
        brief: Optional parsed `LayoutBrief`.
        copy: Optional `AuthoredCopy` overrides.
        labels: Pointer label overrides.
        output: Completed `SynthesisOutput`, if available.

    Returns:
        The reconstructed `DecisionBatch` matching `DecisionSynthesizer._plan_layout`.
    """
    planner = synthesizer.planner
    if (
        block.region is not None
        and output is not None
        and output.layout_plan is not None
        and block.region in output.layout_plan.block_ids()
    ):
        batch, _ = planner.build_block_batch(
            output.layout_plan,
            block.region,
            pointers,
            intent=block.intent,
            labels=labels or None,
            payload=data,
            actions=block.actions,
            exclude=block.exclude,
        )
        return batch
    eligible = eligible_archetypes(
        synthesizer.archetypes, synthesizer.patterns, pointers
    )
    if not eligible:
        return DecisionBatch(
            shared_context={
                "intent": block.intent,
                "pointers": [p.path for p in pointers],
            },
            questions=(),
        )
    templates = synthesizer.registry.matching_templates([p.path for p in pointers])
    if synthesizer.backend.capabilities.two_stage:
        s1_batch, state = planner.build_stage1_batch(
            block.intent,
            pointers,
            brief=brief,
            payload=data,
            copy=copy,
            templates=templates,
            actions=block.actions,
            labels=labels or None,
            exclude=block.exclude,
        )
        answers = output.decision_answers if output is not None else ()
        s1_len = len(s1_batch.questions)
        if s1_len > 0 and len(answers) >= s1_len:
            planner.build_stage2_batch(state, answers[:s1_len])
            return state.batch
        return s1_batch
    batch, _ = planner.build_batch(
        block.intent,
        pointers,
        brief=brief,
        payload=data,
        copy=copy,
        templates=templates,
        actions=block.actions,
        labels=labels or None,
        exclude=block.exclude,
    )
    return batch


def _question_kind_label(
    question: DecisionQuestion,
) -> Literal["boolean", "categorical"]:
    """Maps `QuestionKind` to the inspector's `'boolean' | 'categorical'` union.

    Args:
        question: Planner `DecisionQuestion`.

    Returns:
        `"boolean"` for boolean questions, otherwise `"categorical"`.
    """
    return "boolean" if question.kind is QuestionKind.BOOLEAN else "categorical"


def _question_options_list(question: DecisionQuestion) -> list[dict[str, str]]:
    """Builds `{value, description}` option descriptors for categorical questions.

    Args:
        question: Planner `DecisionQuestion`.

    Returns:
        A list of `{value, description}` dictionaries, or an empty list for
        boolean questions.
    """
    if question.kind is QuestionKind.BOOLEAN:
        return []
    desc_map = dict(zip(question.options, question.option_texts))
    return [
        {
            "value": cand,
            "description": desc_map.get(
                cand, "None of the above" if cand == "none" else ""
            ),
        }
        for cand in question.candidates()
    ]


def _serialize_input_question(
    question: DecisionQuestion,
    index: int,
    *,
    pruned: bool,
    wire_format: str,
) -> dict[str, Any]:
    """Serializes one `DecisionQuestion` for `DecisionInputStage.questions`.

    Args:
        question: Planner `DecisionQuestion`.
        index: Zero-based question index in the batch.
        pruned: Whether the planner pruned this speculative question.
        wire_format: Resolved backend wire format identifier.

    Returns:
        A dictionary representing one `DecisionInputStage` question row.
    """
    wire_id = f"q_{index}" if wire_format == "gemini_decisions" else question.id
    return {
        "id": question.id,
        "wireId": wire_id,
        "kind": _question_kind_label(question),
        "rawKind": question.kind.value,
        "prompt": question.prompt,
        "candidates": list(question.candidates()),
        "options": _question_options_list(question),
        "trueDescription": str(question.context.get("yes", "")),
        "falseDescription": str(question.context.get("no", "")),
        "pruned": pruned,
    }


def _backend_temperature(backend: DecisionBackend) -> float | None:
    """Extracts the calibration temperature from `backend` when present.

    Args:
        backend: Active `DecisionBackend`.

    Returns:
        The float calibration temperature, or `None` if uncalibrated.
    """
    calibration = getattr(backend, "calibration", None)
    if calibration is not None and hasattr(calibration, "temperature"):
        return float(calibration.temperature)
    return None


def _non_synthetic_trace_map(
    output: SynthesisOutput | None,
) -> dict[str, DecisionRecord]:
    """Builds `{question.id: record}` for non-synthetic trace rows (`answer is not None`).

    Args:
        output: Completed `SynthesisOutput`, or `None`.

    Returns:
        A dictionary mapping evaluated question identifiers to their
        `DecisionRecord` instances.
    """
    if output is None:
        return {}
    return {r.question.id: r for r in output.trace if r.answer is not None}


def _build_decision_input_stage(
    synthesizer: DecisionSynthesizer,
    batch: DecisionBatch,
    cache_key: PlanCacheKey,
    pointers: Sequence[PointerSummary],
    output: SynthesisOutput | None,
    metrics: TurnMetrics,
) -> dict[str, Any]:
    """Builds Stage 2 (`DecisionInputStage`) for a decision or tool candidate.

    Args:
        synthesizer: Active `DecisionSynthesizer`.
        batch: Reconstructed `DecisionBatch`.
        cache_key: Computed `PlanCacheKey` for the render.
        pointers: Filtered payload pointer summaries.
        output: Completed `SynthesisOutput`, or `None`.
        metrics: Candidate `TurnMetrics`.

    Returns:
        A serialized `DecisionInputStage` dictionary.
    """
    backend = synthesizer.backend
    wire_format = resolve_wire_format(backend)
    trace_by_id = _non_synthetic_trace_map(output)
    has_trace = bool(trace_by_id) or (
        output is not None and output.layout_plan is not None
    )
    questions = [
        _serialize_input_question(
            q,
            idx,
            pruned=bool(has_trace and q.id not in trace_by_id),
            wire_format=wire_format,
        )
        for idx, q in enumerate(batch.questions)
    ]
    backend_kind = (
        output.backend_kind
        if (output and output.backend_kind)
        else backend.backend_kind
    )
    model_id = output.model_id if (output and output.model_id) else backend.model_id
    decision_calls = (
        int(output.decision_calls)
        if output is not None
        else int(metrics.decision_calls or 0)
    )
    cache_hit = (
        bool(output.cache_hit) if output is not None else bool(metrics.cache_hit)
    )
    return {
        "backendKind": backend_kind,
        "modelId": model_id,
        "endpointUrl": sanitize_endpoint_url(getattr(backend, "endpoint_url", None)),
        "wireFormat": wire_format,
        "temperature": _backend_temperature(backend),
        "decisionCalls": decision_calls,
        "cacheHit": cache_hit,
        "shapeSignature": cache_key.shape_signature,
        "contextJson": json.dumps(batch.shared_context, indent=2, ensure_ascii=False),
        "questionCount": len(batch.questions),
        "pointers": [
            {
                "path": p.path,
                "valueType": p.value_type,
                "semanticType": str(p.semantic_type),
                "mutable": p.mutable_hint,
                "label": p.label,
            }
            for p in pointers
        ],
        "questions": questions,
        "wireRequest": format_wire_request(backend, batch, wire_format),
    }


def _answer_winner_and_probs(
    question: DecisionQuestion,
    answer: DecisionAnswer | None,
) -> tuple[str, float, list[dict[str, Any]], dict[str, float]]:
    """Extracts `(winner, winner_prob, prob_entries, prob_map)` from `answer`.

    Args:
        question: Planner `DecisionQuestion`.
        answer: Backend `DecisionAnswer`, or `None`.

    Returns:
        A `(winner, winner_prob, prob_entries, prob_map)` tuple.
    """
    if answer is None:
        return "", 0.0, [], {}
    probs_map = {str(k): float(v) for k, v in answer.distribution.probabilities.items()}
    if question.kind is QuestionKind.BOOLEAN:
        p_yes = float(answer.yes)
        p_no = float(probs_map.get("no", max(0.0, 1.0 - p_yes)))
        winner = "yes" if p_yes >= p_no else "no"
        winner_prob = p_yes if p_yes >= p_no else p_no
        entries = [
            {"option": "yes", "prob": p_yes},
            {"option": "no", "prob": p_no},
        ]
        return winner, winner_prob, entries, {"yes": p_yes, "no": p_no}
    winner, winner_prob = answer.top()
    ranked = sorted(probs_map.items(), key=lambda kv: -kv[1])
    entries = [{"option": opt, "prob": prob} for opt, prob in ranked]
    return winner, float(winner_prob), entries, probs_map


def _serialize_output_record(
    question: DecisionQuestion,
    record: DecisionRecord | None,
    answer: DecisionAnswer | None,
    *,
    pruned: bool,
) -> dict[str, Any]:
    """Serializes one joined question/answer/trace row for `DecisionOutputStage.records`.

    Args:
        question: Planner `DecisionQuestion`.
        record: Evaluated `DecisionRecord` from `output.trace`, or `None` if
            pruned.
        answer: Raw `DecisionAnswer` from the backend, or `None`.
        pruned: Whether the planner pruned this speculative question.

    Returns:
        A serialized record dictionary for `DecisionOutputStage.records`.
    """
    winner, winner_prob, prob_entries, prob_map = _answer_winner_and_probs(
        question, answer
    )
    threshold = (
        float(record.threshold)
        if record is not None and record.threshold is not None
        else None
    )
    outcome = (
        record.outcome
        if record is not None and record.outcome
        else ("pruned" if pruned else "")
    )
    return {
        "id": question.id,
        "questionId": question.id,
        "kind": _question_kind_label(question),
        "rawKind": question.kind.value,
        "prompt": question.prompt,
        "winner": winner,
        "winnerProb": winner_prob,
        "probability": winner_prob,
        "expected": (
            float(answer.expected)
            if answer is not None and answer.expected is not None
            else None
        ),
        "threshold": threshold,
        "outcome": outcome,
        "pruned": pruned,
        "probabilities": prob_entries,
        "probabilityMap": prob_map,
    }


def _extract_fit_score(output: SynthesisOutput) -> float | None:
    """Returns `layout_plan.fit_score` or parses the synthetic `fit_score` trace record.

    Args:
        output: Completed `SynthesisOutput`.

    Returns:
        The float fit score, or `None` if no fit score was computed.
    """
    if output.layout_plan is not None and output.layout_plan.fit_score is not None:
        return float(output.layout_plan.fit_score)
    for rec in output.trace:
        if rec.question.id == "fit_score" and rec.outcome:
            token = rec.outcome.split(" ", 1)[0]
            try:
                return float(token)
            except ValueError:
                return None
    return None


def _extract_surface_components(
    messages: Sequence[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    """Collects component dictionaries from `createSurface` or `updateComponents`.

    Args:
        messages: Emitted A2UI protocol message dictionaries.

    Returns:
        A flat list of component dictionaries.
    """
    found: list[Mapping[str, Any]] = []
    for msg in messages:
        for key in ("createSurface", "updateComponents"):
            body = msg.get(key)
            if isinstance(body, Mapping) and isinstance(body.get("components"), list):
                found.extend(c for c in body["components"] if isinstance(c, Mapping))
    return found


def _component_type_name(comp: Mapping[str, Any]) -> str:
    """Extracts the component type name from a v1.0 or v0.9 component dictionary.

    Args:
        comp: Serialized A2UI component dictionary.

    Returns:
        The component type name string, or `""` if absent.
    """
    raw = comp.get("component")
    if isinstance(raw, str):
        return raw
    if isinstance(raw, Mapping) and raw:
        return str(next(iter(raw.keys())))
    return ""


def _serialize_planned_block(
    planned: PlannedBlock,
    components: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Serializes one `PlannedBlock` for `DecisionOutputStage.layoutPlan.blocks`.

    Args:
        planned: `PlannedBlock` from `LayoutPlan.blocks`.
        components: Emitted A2UI component dictionaries for the surface.

    Returns:
        A serialized block dictionary for the inspector block tree.
    """
    prefix = f"{planned.block_id}_"
    matching = [
        c
        for c in components
        if isinstance(c.get("id"), str)
        and (c["id"] == planned.block_id or str(c["id"]).startswith(prefix))
    ]
    comp_name = (
        _component_type_name(matching[0]) if matching else ""
    ) or planned.pattern
    child_ids = [str(c["id"]) for c in matching[1:] if isinstance(c.get("id"), str)]
    pointers = list(planned.bindings.pointers())
    slots = {
        slot_name: list(binding.pointers())
        for slot_name, binding in planned.bindings.slots.items()
        if binding.bound
    }
    knob_summary = ", ".join(f"{k}={v}" for k, v in planned.variant_knobs.items())
    return {
        "blockId": planned.block_id,
        "pattern": planned.pattern,
        "component": comp_name,
        "pointer": ", ".join(pointers),
        "label": knob_summary or planned.block_id,
        "role": planned.block_id,
        "children": child_ids,
        "probability": float(planned.probability),
        "variantKnobs": dict(planned.variant_knobs),
        "slots": slots,
    }


def _serialize_layout_plan(
    plan: LayoutPlan,
    surface_id: str,
    fit_score: float | None,
    messages: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Serializes `LayoutPlan` for `DecisionOutputStage.layoutPlan`.

    Args:
        plan: Winning `LayoutPlan`.
        surface_id: Target A2UI surface identifier.
        fit_score: Resolved fit score fallback.
        messages: Emitted A2UI message dictionaries.

    Returns:
        A serialized layout plan dictionary.
    """
    components = _extract_surface_components(messages)
    root_comp = next((c for c in components if c.get("id") == "root"), None)
    root_container = (
        _component_type_name(root_comp) if root_comp is not None else ""
    ) or "Column"
    title = str(plan.page.title.literal or plan.page.title.pointer or "")
    summary = str(plan.page.subtitle.literal or plan.page.subtitle.pointer or "")
    effective_fit = float(
        plan.fit_score if plan.fit_score is not None else (fit_score or 0.0)
    )
    return {
        "surfaceId": surface_id,
        "family": plan.family,
        "archetype": plan.archetype,
        "rootContainer": root_container,
        "title": title,
        "summary": summary,
        "confidence": float(plan.confidence),
        "fitScore": effective_fit,
        "stakes": float(plan.stakes),
        "urgency": float(plan.urgency),
        "actionsAllowed": bool(plan.actions_allowed),
        "blocks": [_serialize_planned_block(b, components) for b in plan.blocks],
    }


def _serialize_raw_answer(
    answer: DecisionAnswer,
    question: DecisionQuestion | None,
) -> dict[str, Any]:
    """Serializes one `DecisionAnswer` for `DecisionOutputStage.rawAnswers`.

    Args:
        answer: Backend `DecisionAnswer`.
        question: Matching `DecisionQuestion`, if found in the batch.

    Returns:
        A dictionary containing the raw probability distribution for `answer`.
    """
    probs = {str(k): float(v) for k, v in answer.distribution.probabilities.items()}
    is_bool = (
        question.kind is QuestionKind.BOOLEAN
        if question is not None
        else ("yes" in probs and set(probs.keys()) <= {"yes", "no"})
    )
    if is_bool:
        p_yes = float(answer.yes)
        p_no = float(probs.get("no", max(0.0, 1.0 - p_yes)))
        return {
            "id": answer.question_id,
            "kind": "boolean",
            "yes": p_yes,
            "no": p_no,
            "probabilities": probs,
        }
    return {
        "id": answer.question_id,
        "kind": "categorical",
        "probabilities": probs,
    }


def _resolve_record_answer(
    question_id: str,
    trace_by_id: Mapping[str, DecisionRecord],
    answers_by_id: Mapping[str, DecisionAnswer],
) -> DecisionAnswer | None:
    """Returns the non-null `DecisionAnswer` from `trace_by_id` or `answers_by_id`.

    Args:
        question_id: Question identifier to look up.
        trace_by_id: Map of evaluated `DecisionRecord` entries by question id.
        answers_by_id: Map of raw backend `DecisionAnswer` entries by question id.

    Returns:
        The resolved `DecisionAnswer`, or `None` if unavailable.
    """
    rec = trace_by_id.get(question_id)
    if rec is not None and rec.answer is not None:
        return rec.answer
    return answers_by_id.get(question_id)


def _output_questions(
    output: SynthesisOutput,
    batch: DecisionBatch | None,
) -> tuple[DecisionQuestion, ...]:
    """Returns `batch.questions` when present, falling back to `output.trace` questions.

    Args:
        output: Completed `SynthesisOutput`.
        batch: Reconstructed `DecisionBatch`, or `None`.

    Returns:
        A tuple of `DecisionQuestion` instances in batch order.
    """
    if batch is not None and batch.questions:
        return batch.questions
    return tuple(r.question for r in output.trace if r.answer is not None)


def _build_decision_output_stage(
    output: SynthesisOutput,
    batch: DecisionBatch | None,
    surface_id: str,
    messages: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Builds Stage 3 (`DecisionOutputStage`) for a decision or tool candidate.

    Args:
        output: Completed `SynthesisOutput`.
        batch: Reconstructed `DecisionBatch`, or `None`.
        surface_id: Target A2UI surface identifier.
        messages: Emitted A2UI message dictionaries.

    Returns:
        A serialized `DecisionOutputStage` dictionary.
    """
    trace_by_id = _non_synthetic_trace_map(output)
    answers_by_id = {a.question_id: a for a in output.decision_answers}
    questions = _output_questions(output, batch)
    has_trace = bool(trace_by_id) or output.layout_plan is not None
    records = [
        _serialize_output_record(
            q,
            trace_by_id.get(q.id),
            _resolve_record_answer(q.id, trace_by_id, answers_by_id),
            pruned=bool(has_trace and q.id not in trace_by_id),
        )
        for q in questions
    ]
    questions_by_id = {q.id: q for q in questions}
    raw_answers = [
        _serialize_raw_answer(ans, questions_by_id.get(ans.question_id))
        for ans in output.decision_answers
    ]
    fit_score = _extract_fit_score(output)
    plan_dict = (
        _serialize_layout_plan(output.layout_plan, surface_id, fit_score, messages)
        if output.layout_plan is not None
        else None
    )
    fallback_src = (
        str(output.fallback_source) if output.fallback_source is not None else None
    )
    return {
        "stage": output.stage.value,
        "confidence": float(output.confidence),
        "fitScore": fit_score,
        "selectedTemplateId": output.selected_template_id,
        "fallbackSource": fallback_src,
        "fallbackReason": output.fallback_reason,
        "operation": str(output.operation),
        "records": records,
        "layoutPlan": plan_dict,
        "plan": plan_dict,
        "rawAnswers": raw_answers,
        "wireAnswers": {a["id"]: a for a in raw_answers},
    }


def _build_llm_stage2_trace(
    mode: RenderMode,
    block: DecisionBlock | None,
    surface_id: str,
    result: RenderResult,
) -> dict[str, Any] | None:
    """Builds `LlmStage2Trace` for `express` and `direct` candidates.

    Args:
        mode: Candidate `RenderMode`.
        block: Source `DecisionBlock`, or `None`.
        surface_id: Target A2UI surface identifier.
        result: Completed `RenderResult`.

    Returns:
        A serialized `LlmStage2Trace` dictionary, or `None` for non-LLM stage-2
        modes.
    """
    if mode not in (RenderMode.EXPRESS, RenderMode.DIRECT):
        return None
    attempts = (
        int(result.metrics.llm_calls)
        if result.metrics is not None and result.metrics.llm_calls > 0
        else 1
    )
    retries = max(0, attempts - 1)
    return {
        "promptPreview": (
            stage2_user_text(block, surface_id) if block is not None else ""
        ),
        "rawReply": result.raw_stage2_text,
        "rawText": result.raw_stage2_text or "",
        "retries": retries,
        "attempts": attempts,
        "validationRetry": retries > 0,
    }


def _message_kinds(messages: Sequence[Mapping[str, Any]]) -> list[str]:
    """Extracts the ordered A2UI envelope keys (excluding `'version'`) from `messages`.

    Args:
        messages: Sequence of A2UI protocol message dictionaries.

    Returns:
        A list of message envelope key names (such as `"createSurface"`).
    """
    kinds: list[str] = []
    for msg in messages:
        for key in msg.keys():
            if key != "version":
                kinds.append(str(key))
    return kinds


def _build_wire_output_stage(
    surface_id: str,
    result: RenderResult,
    metrics: TurnMetrics,
) -> dict[str, Any]:
    """Builds Stage 4 (`WireJsonStage`) for a candidate.

    Args:
        surface_id: Target A2UI surface identifier.
        result: Completed `RenderResult`.
        metrics: Candidate `TurnMetrics`.

    Returns:
        A serialized `WireJsonStage` dictionary.
    """
    output: SynthesisOutput | None = result.output
    operation = str(
        metrics.operation or (output.operation if output is not None else "create")
    )
    messages = [dict(m) for m in result.messages]
    return {
        "surfaceId": surface_id,
        "operation": operation,
        "messageCount": len(messages),
        "messageKinds": _message_kinds(messages),
        "messages": messages,
        "decompiledExpress": result.decompiled_express,
    }


def _build_candidate_trace(
    mode: RenderMode,
    surface_id: str,
    result: RenderResult,
    metrics: TurnMetrics,
    block: DecisionBlock | None,
    synthesizer: DecisionSynthesizer | None,
) -> dict[str, Any]:
    """Builds one `CandidateTrace` entry.

    Args:
        mode: Candidate `RenderMode`.
        surface_id: Target A2UI surface identifier.
        result: Completed `RenderResult`.
        metrics: Combined `TurnMetrics` for the candidate.
        block: Source `DecisionBlock`, or `None`.
        synthesizer: Active `DecisionSynthesizer`, or `None`.

    Returns:
        A serialized `CandidateTrace` dictionary.
    """
    output: SynthesisOutput | None = result.output
    is_decision = mode in (RenderMode.DECISION, RenderMode.TOOL)
    decision_input: dict[str, Any] | None = None
    decision_output: dict[str, Any] | None = None
    batch: DecisionBatch | None = None

    if is_decision and synthesizer is not None and block is not None:
        batch, cache_key, pointers = _reconstruct_batch_and_key(
            synthesizer, block, surface_id, output
        )
        decision_input = _build_decision_input_stage(
            synthesizer, batch, cache_key, pointers, output, metrics
        )
    if is_decision and output is not None:
        decision_output = _build_decision_output_stage(
            output, batch, surface_id, result.messages
        )

    return {
        "mode": mode.value,
        "surfaceId": surface_id,
        "ok": result.ok,
        "error": result.error,
        "metrics": {
            "backend": metrics.backend,
            "modelId": metrics.model_id,
            "llmCalls": int(metrics.llm_calls),
            "totalLatencyMs": round(float(metrics.latency_ms), 2),
            "decisionLatencyMs": (
                round(float(metrics.decision_latency_ms), 2)
                if metrics.decision_latency_ms is not None
                else None
            ),
            "decisionCalls": (
                int(metrics.decision_calls)
                if metrics.decision_calls is not None
                else None
            ),
            "promptTokens": int(metrics.prompt_tokens),
            "outputTokens": int(metrics.output_tokens),
            "cacheHit": bool(metrics.cache_hit),
        },
        "decisionInput": decision_input,
        "decisionOutput": decision_output,
        "llmStage2": _build_llm_stage2_trace(mode, block, surface_id, result),
        "wireOutput": _build_wire_output_stage(surface_id, result, metrics),
    }


def _serialize_stage1_block(block: DecisionBlock | None) -> dict[str, Any] | None:
    """Serializes `DecisionBlock` into the `BlockInputStage.block` shape.

    Args:
        block: Extracted or constructed `DecisionBlock`, or `None`.

    Returns:
        A serialized block dictionary, or `None` when `block` is `None`.
    """
    if block is None:
        return None
    return {
        "intent": block.intent,
        "payload": block.payload,
        "surfaceId": block.surface_id,
        "title": block.title,
        "summary": block.summary,
        "layout": ", ".join(block.layout) if block.layout else None,
        "region": block.region,
        "operation": "replace" if block.replace else None,
        "mutablePaths": list(block.mutable_paths),
        "actions": [
            {
                "name": action.id,
                "label": action.label,
                "context": list(action.context.keys()),
            }
            for action in block.actions
        ],
    }


def build_turn_trace(
    *,
    turn: int,
    query: str,
    compare: bool,
    active_mode: RenderMode,
    stage1_source: Stage1Source,
    model_name: str | None,
    stage1_turn: LlmTurn | None,
    tool_name: str | None,
    tool_args: Mapping[str, Any] | None,
    block: DecisionBlock | None,
    stage1_error: str | None,
    candidates: Sequence[tuple[RenderMode, str, RenderResult, TurnMetrics]],
    synthesizer: DecisionSynthesizer | None,
) -> dict[str, Any]:
    """Builds a Version 1 `PlaygroundTurnTrace` dictionary.

    Args:
        turn: 1-based turn counter.
        query: User query or slash command for the turn.
        compare: Whether the turn rendered all three comparison modes.
        active_mode: Active `RenderMode` for the turn.
        stage1_source: How the `DecisionBlock` was produced.
        model_name: Stage-1 language model name, or `None`.
        stage1_turn: Stage-1 `LlmTurn`, or `None` for direct tool calls.
        tool_name: Invoked tool name in `tool` mode, or `None`.
        tool_args: Invoked tool arguments in `tool` mode, or `None`.
        block: Extracted or constructed `DecisionBlock`, or `None`.
        stage1_error: Stage-1 error string, or `None`.
        candidates: Sequence of `(mode, surface_id, result, metrics)` tuples.
        synthesizer: Active `DecisionSynthesizer`, or `None`.

    Returns:
        A JSON-serializable `PlaygroundTurnTrace` dictionary.
    """
    stage1: dict[str, Any] = {
        "source": stage1_source,
        "model": None if stage1_source == "direct_tool" else model_name,
        "llmCalls": 1 if stage1_turn is not None else 0,
        "latencyMs": (
            round(float(stage1_turn.latency_ms), 2) if stage1_turn is not None else 0.0
        ),
        "promptTokens": (
            int(stage1_turn.prompt_tokens) if stage1_turn is not None else 0
        ),
        "outputTokens": (
            int(stage1_turn.output_tokens) if stage1_turn is not None else 0
        ),
        "rawText": stage1_turn.text if stage1_turn is not None else None,
        "toolName": tool_name,
        "toolArgs": dict(tool_args) if tool_args is not None else None,
        "block": _serialize_stage1_block(block),
        "error": stage1_error,
    }
    return {
        "schemaVersion": 1,
        "turn": int(turn),
        "query": query,
        "compare": bool(compare),
        "activeMode": active_mode.value,
        "stage1": stage1,
        "candidates": [
            _build_candidate_trace(
                mode, surface_id, result, metrics, block, synthesizer
            )
            for mode, surface_id, result, metrics in candidates
        ],
    }
