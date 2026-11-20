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

"""Recording proxy and offline mock heuristics for the decision playground."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
import time
from typing import Any

from a2ui.inference_formats.experimental.decision import (
    BackendCapabilities,
    DecisionAnswer,
    DecisionBackend,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuestion,
    DeterministicMockBackend,
    QuestionKind,
    answer_from_distribution,
)

_FACTUAL_TEXT_ONLY_CUES = ("capital of", "what is 2", "who wrote", "define ")
_VAGUE_COMPLAINT_CUES = ("broken", "bad", "sucks", "doesn't work", "fix it")


@dataclass(frozen=True)
class RecordedBatchCall:
    """One captured `DecisionBackend.answer(...)` exchange."""

    batch: DecisionBatch
    answers: tuple[DecisionAnswer, ...]
    latency_ms: float


class RecordingDecisionBackend:
    """Proxy implementing `DecisionBackend` that captures batches and answers."""

    def __init__(self, inner: DecisionBackend) -> None:
        self._inner = inner
        self.calls: list[RecordedBatchCall] = []

    @property
    def backend_kind(self) -> str:
        return self._inner.backend_kind

    @property
    def model_id(self) -> str:
        return self._inner.model_id

    @property
    def capabilities(self) -> BackendCapabilities:
        return self._inner.capabilities

    @property
    def endpoint_url(self) -> str | None:
        return getattr(self._inner, "endpoint_url", None)

    async def answer(
        self,
        batch: DecisionBatch,
        *,
        timeout_seconds: float | None = None,
    ) -> tuple[DecisionAnswer, ...]:
        start = time.perf_counter()
        answers = await self._inner.answer(batch, timeout_seconds=timeout_seconds)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        server_ms = getattr(self._inner, "last_call_latency_ms", None)
        latency_ms = (
            float(server_ms) if isinstance(server_ms, (int, float)) else elapsed_ms
        )
        self.calls.append(
            RecordedBatchCall(batch=batch, answers=answers, latency_ms=latency_ms)
        )
        return answers

    async def aclose(self) -> None:
        await self._inner.aclose()

    async def aclose_current_loop(self) -> None:
        await self._inner.aclose_current_loop()

    async def __aenter__(self) -> DecisionBackend:
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        del exc_type, exc, tb
        await self.aclose()


def _is_vague_complaint(state_low: str) -> bool:
    return len(state_low.strip()) < 16 or any(
        cue in state_low for cue in _VAGUE_COMPLAINT_CUES
    )


def _score_boolean_offline(state_low: str, question: DecisionQuestion) -> float:
    """Offline boolean heuristic so `mock` mode exercises pass and fail paths."""
    if question.id == "gate:needs_ui":
        return (
            0.15 if any(cue in state_low for cue in _FACTUAL_TEXT_ONLY_CUES) else 0.88
        )
    if question.id.startswith("prune:"):
        comp_name = question.id.rsplit(":", 1)[-1].lower()
        if comp_name in ("text", "card", "column", "row", "button"):
            return 0.80
        return 0.85 if comp_name in state_low else 0.10
    if question.id.startswith("predicate:"):
        return 0.18 if _is_vague_complaint(state_low) else 0.86
    return 0.65


def _best_keyword_candidate(
    state_low: str, candidates: Sequence[str]
) -> tuple[str, int]:
    """Returns `(best_candidate, hit_count)` for offline keyword matching."""
    best = candidates[0]
    best_hits = -1
    for cand in candidates:
        if cand == "none":
            continue
        tokens = [
            tok
            for tok in cand.replace("express:", "").replace("_", " ").split()
            if len(tok) > 2
        ]
        hits = sum(1 for tok in tokens if tok.lower() in state_low)
        if hits > best_hits:
            best_hits = hits
            best = cand
    return best, best_hits


def _score_choice_offline(
    state_low: str, question: DecisionQuestion
) -> dict[str, float]:
    """Offline choice heuristic matching template/target keywords."""
    candidates = question.candidates()
    if not candidates:
        return {}
    best, best_hits = _best_keyword_candidate(state_low, candidates)
    if question.id == "route:tier":
        chosen = "template" if best_hits > 0 else "pruned_express"
        if chosen not in candidates:
            chosen = candidates[0]
    elif best_hits <= 0 and "none" in candidates:
        chosen = "none"
    else:
        chosen = best
    others = [c for c in candidates if c != chosen]
    rest = (0.12 / len(others)) if others else 0.0
    return {c: 0.88 if c == chosen else rest for c in candidates}


class PlaygroundMockBackend:
    """Offline `DecisionBackend` wrapper with realistic pass/fail heuristics."""

    def __init__(self) -> None:
        self._inner = DeterministicMockBackend(model_id="playground-mock")

    @property
    def backend_kind(self) -> str:
        return "mock"

    @property
    def model_id(self) -> str:
        return "playground-mock"

    @property
    def capabilities(self) -> BackendCapabilities:
        return self._inner.capabilities

    async def answer(
        self,
        batch: DecisionBatch,
        *,
        timeout_seconds: float | None = None,
    ) -> tuple[DecisionAnswer, ...]:
        del timeout_seconds
        state_low = (batch.state or "").lower()
        results: list[DecisionAnswer] = []
        for question in batch.questions:
            if question.kind is QuestionKind.BOOLEAN:
                yes_p = _score_boolean_offline(state_low, question)
                probs = {"yes": yes_p, "no": round(1.0 - yes_p, 6)}
            else:
                probs = _score_choice_offline(state_low, question)
            dist = DecisionDistribution(
                probabilities=probs,
                calibrated=True,
                top_logit_margin=2.0,
            )
            results.append(answer_from_distribution(question, dist))
        return tuple(results)

    async def aclose(self) -> None:
        await self._inner.aclose()

    async def aclose_current_loop(self) -> None:
        await self._inner.aclose_current_loop()

    async def __aenter__(self) -> DecisionBackend:
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        del exc_type, exc, tb
        await self.aclose()


def flatten_recorded_calls(
    calls: Sequence[RecordedBatchCall],
) -> tuple[list[DecisionQuestion], list[DecisionAnswer], float, str]:
    """Flattens recorded batch calls into combined questions, answers, latency, and state."""
    questions: list[DecisionQuestion] = []
    answers: list[DecisionAnswer] = []
    total_ms = 0.0
    last_state = ""
    for call in calls:
        questions.extend(call.batch.questions)
        answers.extend(call.answers)
        total_ms += call.latency_ms
        if call.batch.state:
            last_state = call.batch.state
    return questions, answers, total_ms, last_state
