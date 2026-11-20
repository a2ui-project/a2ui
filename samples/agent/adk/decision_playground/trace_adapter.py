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

"""Serializes Wave 1 decision runs into `schemaVersion: 1` inspector traces."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import json
from typing import Any

from a2ui.inference_formats.experimental.decision import (
    DecisionAnswer,
    DecisionQuestion,
    QuestionKind,
)
from modes import RenderMode, RenderOutcome
from recording_backend import RecordedBatchCall, flatten_recorded_calls


def _wire_format_for_backend(backend_kind: str) -> str:
    """Maps a `DecisionBackend.backend_kind` to `DecisionInputStage.wireFormat`."""
    mapping = {
        "gemini": "gemini_decisions",
        "systemone": "systemone",
        "jev": "jev",
        "step0": "step0",
    }
    return mapping.get(backend_kind, "in_process")


def _serialize_question(question: DecisionQuestion) -> dict[str, Any]:
    """Serializes one `DecisionQuestion` for Stage 2."""
    is_bool = question.kind is QuestionKind.BOOLEAN
    opt_map = dict(zip(question.options, question.option_texts, strict=False))
    return {
        "id": question.id,
        "kind": "boolean" if is_bool else "categorical",
        "prompt": question.prompt,
        "options": [
            {"value": opt, "description": opt_map.get(opt, "")}
            for opt in question.candidates()
            if not is_bool
        ],
        "trueDescription": str(question.context.get("yes", "")),
        "falseDescription": str(question.context.get("no", "")),
        "pruned": False,
    }


def _serialize_answer_record(
    question: DecisionQuestion, answer: DecisionAnswer
) -> dict[str, Any]:
    """Serializes one `(question, answer)` pair for Stage 3 probability bars."""
    is_bool = question.kind is QuestionKind.BOOLEAN
    winner, winner_prob = answer.top()
    passed = (winner == "yes" and winner_prob >= 0.5) if is_bool else True
    ranked = sorted(
        answer.distribution.probabilities.items(),
        key=lambda item: item[1],
        reverse=True,
    )
    return {
        "questionId": question.id,
        "kind": "boolean" if is_bool else "categorical",
        "winner": winner,
        "winnerProb": round(winner_prob, 4),
        "threshold": 0.5 if is_bool else None,
        "outcome": ("pass" if passed else "fail") if is_bool else "selected",
        "pruned": False,
        "probabilities": [
            {"option": opt, "prob": round(prob, 4)} for opt, prob in ranked
        ],
    }


def _build_decision_stages(
    outcome: RenderOutcome,
    calls: Sequence[RecordedBatchCall],
    *,
    backend_kind: str,
    model_id: str,
    endpoint_url: str | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, float | None, int | None]:
    """Builds Stage 2 (`decisionInput`) and Stage 3 (`decisionOutput`) dicts."""
    if not calls:
        return None, None, None, None
    questions, answers, total_ms, state_text = flatten_recorded_calls(calls)
    answer_by_id = {ans.question_id: ans for ans in answers}
    records = [
        _serialize_answer_record(q, answer_by_id[q.id])
        for q in questions
        if q.id in answer_by_id
    ]
    decision_input = {
        "backendKind": backend_kind,
        "modelId": model_id,
        "endpointUrl": endpoint_url,
        "wireFormat": _wire_format_for_backend(backend_kind),
        "decisionCalls": len(calls),
        "cacheHit": False,
        "shapeSignature": None,
        "contextJson": state_text,
        "questionCount": len(questions),
        "questions": [_serialize_question(q) for q in questions],
        "wireRequest": None,
    }
    decision_output = {
        "stage": outcome.stage,
        "confidence": round(outcome.confidence, 4),
        "fitScore": None,
        "selectedTemplateId": outcome.selected_template_id,
        "fallbackSource": outcome.fallback_source,
        "fallbackReason": outcome.fallback_reason,
        "operation": outcome.operation,
        "records": records,
        "layoutPlan": None,
        "rawAnswers": [
            {
                "id": ans.question_id,
                "kind": (
                    "boolean"
                    if ans.question_id
                    in {q.id for q in questions if q.kind is QuestionKind.BOOLEAN}
                    else "categorical"
                ),
                "probabilities": dict(ans.distribution.probabilities),
            }
            for ans in answers
        ],
    }
    return decision_input, decision_output, round(total_ms, 2), len(calls)


def _message_kinds(messages: Sequence[Mapping[str, Any]]) -> list[str]:
    """Extracts top-level A2UI message operation names from wire dicts."""
    kinds: list[str] = []
    for msg in messages:
        for key in msg:
            if key != "version":
                kinds.append(key)
    return kinds


def build_candidate_trace(
    outcome: RenderOutcome,
    calls: Sequence[RecordedBatchCall],
    *,
    backend_kind: str,
    model_id: str,
    endpoint_url: str | None = None,
) -> dict[str, Any]:
    """Builds one `CandidateTrace` entry matching `types/inspector.ts`."""
    decision_input, decision_output, decision_ms, decision_calls = (
        _build_decision_stages(
            outcome,
            calls,
            backend_kind=backend_kind,
            model_id=model_id,
            endpoint_url=endpoint_url,
        )
    )
    msg_list = [dict(m) for m in outcome.messages]
    return {
        "mode": outcome.mode.value,
        "surfaceId": outcome.surface_id,
        "ok": outcome.ok,
        "error": outcome.error,
        "metrics": {
            "backend": backend_kind if calls else "llm",
            "modelId": model_id if calls else None,
            "llmCalls": outcome.llm_calls,
            "totalLatencyMs": round(outcome.total_latency_ms, 2),
            "decisionLatencyMs": decision_ms,
            "decisionCalls": decision_calls,
            "promptTokens": outcome.prompt_tokens,
            "outputTokens": outcome.output_tokens,
            "cacheHit": False,
        },
        "decisionInput": decision_input,
        "decisionOutput": decision_output,
        "llmStage2": None,
        "wireOutput": {
            "surfaceId": outcome.surface_id,
            "operation": outcome.operation,
            "messageCount": len(msg_list),
            "messageKinds": _message_kinds(msg_list),
            "messages": msg_list,
            "decompiledExpress": outcome.decompiled_express,
        },
    }


def build_turn_trace(
    *,
    turn: int,
    query: str,
    active_mode: RenderMode,
    compare: bool,
    stage1_source: str,
    tool_name: str | None,
    payload: Any,
    candidates: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Builds a top-level `schemaVersion: 1` `PlaygroundTurnTrace` payload."""
    raw_text = (
        json.dumps(payload, indent=2, default=str) if payload is not None else query
    )
    return {
        "schemaVersion": 1,
        "turn": turn,
        "query": query,
        "compare": compare,
        "activeMode": active_mode.value,
        "stage1": {
            "source": stage1_source,
            "model": None,
            "llmCalls": 0,
            "latencyMs": 0.0,
            "promptTokens": 0,
            "outputTokens": 0,
            "rawText": raw_text,
            "toolName": tool_name,
            "toolArgs": None,
            "block": {
                "intent": query,
                "payload": payload,
                "surfaceId": "main",
                "title": None,
                "summary": None,
                "layout": None,
                "region": None,
                "operation": None,
                "mutablePaths": [],
                "actions": [],
            },
            "error": None,
        },
        "candidates": [dict(c) for c in candidates],
    }
