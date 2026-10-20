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

"""Inference backends for local decision-model A2UI synthesis."""

from __future__ import annotations

from collections.abc import Callable, Mapping
import math
import re
from typing import Any, Protocol, cast, runtime_checkable

import httpx

from .models import DecisionDistribution, DecisionQuery

_CAMEL_BOUNDARY_RE = re.compile(r"([a-z0-9])([A-Z])")
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _safe_nonneg_float(value: Any) -> float:
    """Converts `value` to a non-negative float, returning 0.0 on conversion error."""
    try:
        return max(0.0, float(value))
    except (ValueError, TypeError):
        return 0.0


def _normalize_probabilities(
    raw_probs: Mapping[str, Any],
    candidates: tuple[str, ...],
) -> dict[str, float]:
    """Filters candidate probabilities and normalizes weights when sum > 1.0."""
    if not candidates:
        return {}
    filtered = {c: _safe_nonneg_float(raw_probs.get(c, 0.0)) for c in candidates}
    total = sum(filtered.values())
    if total <= 0.0:
        return {c: 0.0 for c in candidates}
    raw_total = sum(_safe_nonneg_float(v) for v in raw_probs.values())
    if total <= 1.0 and raw_total <= 1.0 + 1e-6:
        return filtered
    return {c: val / total for c, val in filtered.items()}


def _format_step_zero_prompt(query: DecisionQuery) -> str:
    """Formats a structured DecisionQuery into a step-0 completion prompt."""
    candidates_str = ", ".join(query.candidates)
    lines = [
        f"Task: {query.task}",
        f"Candidates: [{candidates_str}]",
    ]
    if query.context:
        lines.append(f"Context: {query.context}")
    lines.append(f"Intent: {query.prompt}")
    lines.append("Selection:")
    return "\n".join(lines)


async def _post_json(
    endpoint_url: str,
    payload: Mapping[str, Any],
    *,
    client: httpx.AsyncClient,
    timeout_seconds: float,
) -> dict[str, Any]:
    """Sends an HTTP POST with JSON payload and returns the decoded JSON object."""
    response = await client.post(endpoint_url, json=payload, timeout=timeout_seconds)
    response.raise_for_status()
    return cast(dict[str, Any], response.json())


def _extract_top_logprobs(data: Mapping[str, Any]) -> dict[str, float]:
    """Extracts token-to-logprob mappings from an OpenAI-compatible response."""
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return {}
    logprobs_obj = choices[0].get("logprobs")
    if not isinstance(logprobs_obj, Mapping):
        return {}
    top_list = logprobs_obj.get("top_logprobs")
    if not isinstance(top_list, list) or not top_list:
        return {}
    first_step = top_list[0]
    if not isinstance(first_step, Mapping):
        return {}

    result: dict[str, float] = {}
    for token, logprob in first_step.items():
        lp = float(logprob)
        token_str = str(token)
        result[token_str] = lp
        stripped = token_str.strip()
        if stripped and (stripped not in result or lp > result[stripped]):
            result[stripped] = lp
    return result


def _tokenize(text: str) -> set[str]:
    """Splits camelCase, PascalCase, and punctuation into lowercase tokens."""
    expanded = _CAMEL_BOUNDARY_RE.sub(r"\1 \2", text)
    return set(_TOKEN_RE.findall(expanded.lower()))


def _extract_context_tokens(context: Mapping[str, Any]) -> set[str]:
    """Extracts searchable lowercase tokens from a query context dictionary."""
    tokens: set[str] = set()
    for key, value in context.items():
        tokens.update(_tokenize(str(key)))
        if isinstance(value, str):
            tokens.update(_tokenize(value))
        elif isinstance(value, (list, tuple, set)):
            for item in value:
                tokens.update(_tokenize(str(item)))
        elif isinstance(value, Mapping):
            for sub_k, sub_v in value.items():
                tokens.update(_tokenize(str(sub_k)))
                tokens.update(_tokenize(str(sub_v)))
    return tokens


def _score_candidate(
    candidate: str,
    prompt_lower: str,
    prompt_tokens: set[str],
    context_tokens: set[str],
) -> float:
    """Computes a deterministic relevance score for a candidate."""
    cand_lower = candidate.lower()
    cand_tokens = _tokenize(candidate)
    score = 0.0
    if cand_lower and cand_lower in prompt_lower:
        score += 4.0
    for tok in cand_tokens:
        if tok in prompt_tokens:
            score += 2.0
        elif len(tok) >= 4 and any(
            pt.startswith(tok) or tok.startswith(pt)
            for pt in prompt_tokens
            if len(pt) >= 4
        ):
            score += 1.5
        if tok in context_tokens:
            score += 1.0
    return score


@runtime_checkable
class DecisionBackend(Protocol):
    """Protocol for local decision-model inference backends."""

    async def predict(self, query: DecisionQuery) -> DecisionDistribution:
        """Predicts a probability distribution over query candidates."""
        ...


class JevHttpBackend:
    """HTTP backend for Joint Embedding / Classifier (JEV) decision endpoints."""

    def __init__(
        self,
        endpoint_url: str,
        *,
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 2.0,
    ) -> None:
        self._endpoint_url = endpoint_url
        self._client = client
        self._owned_client: httpx.AsyncClient | None = None
        self._timeout_seconds = timeout_seconds

    def _get_client(self) -> httpx.AsyncClient:
        """Returns the caller-supplied client or lazily creates a reusable one."""
        if self._client is not None:
            return self._client
        if self._owned_client is None:
            self._owned_client = httpx.AsyncClient(timeout=self._timeout_seconds)
        return self._owned_client

    async def aclose(self) -> None:
        """Closes the internally owned `httpx.AsyncClient` if one was created."""
        if self._owned_client is not None:
            await self._owned_client.aclose()
            self._owned_client = None

    async def predict(self, query: DecisionQuery) -> DecisionDistribution:
        """Queries the JEV HTTP endpoint and normalizes candidate probabilities."""
        payload: dict[str, Any] = {
            "task": query.task,
            "prompt": query.prompt,
            "candidates": list(query.candidates),
            "context": query.context,
        }
        data = await _post_json(
            self._endpoint_url,
            payload,
            client=self._get_client(),
            timeout_seconds=self._timeout_seconds,
        )
        raw_probs = data.get("probabilities")
        probs_map = raw_probs if isinstance(raw_probs, Mapping) else {}
        probabilities = _normalize_probabilities(probs_map, query.candidates)
        calibrated = bool(data.get("calibrated", False))
        raw_margin = data.get("top_logit_margin")
        top_logit_margin = float(raw_margin) if raw_margin is not None else None
        return DecisionDistribution(
            probabilities=probabilities,
            calibrated=calibrated,
            top_logit_margin=top_logit_margin,
        )


class StepZeroLogprobBackend:
    """OpenAI-compatible step-0 top-logprob decision backend."""

    def __init__(
        self,
        endpoint_url: str,
        model: str,
        *,
        temperature: float = 1.0,
        max_logprobs: int = 20,
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 2.0,
    ) -> None:
        if temperature <= 0.0:
            raise ValueError(f"temperature must be positive, got {temperature}")
        if not (1 <= max_logprobs <= 20):
            raise ValueError(f"max_logprobs must be in [1, 20], got {max_logprobs}")
        self._endpoint_url = endpoint_url
        self._model = model
        self._temperature = float(temperature)
        self._max_logprobs = int(max_logprobs)
        self._client = client
        self._owned_client: httpx.AsyncClient | None = None
        self._timeout_seconds = timeout_seconds

    def _get_client(self) -> httpx.AsyncClient:
        """Returns the caller-supplied client or lazily creates a reusable one."""
        if self._client is not None:
            return self._client
        if self._owned_client is None:
            self._owned_client = httpx.AsyncClient(timeout=self._timeout_seconds)
        return self._owned_client

    async def aclose(self) -> None:
        """Closes the internally owned `httpx.AsyncClient` if one was created."""
        if self._owned_client is not None:
            await self._owned_client.aclose()
            self._owned_client = None

    async def predict(self, query: DecisionQuery) -> DecisionDistribution:
        """Queries step-0 logprobs and applies temperature-scaled softmax."""
        calibrated = self._temperature != 1.0
        if not query.candidates:
            return DecisionDistribution(
                probabilities={},
                calibrated=calibrated,
                top_logit_margin=0.0,
            )
        payload: dict[str, Any] = {
            "model": self._model,
            "prompt": _format_step_zero_prompt(query),
            "max_tokens": 1,
            "temperature": 0.0,
            "logprobs": min(max(len(query.candidates), 5), self._max_logprobs),
        }
        data = await _post_json(
            self._endpoint_url,
            payload,
            client=self._get_client(),
            timeout_seconds=self._timeout_seconds,
        )
        top_logprobs = _extract_top_logprobs(data)
        matched = {c: top_logprobs[c] for c in query.candidates if c in top_logprobs}
        for c in query.candidates:
            if c not in matched and c.strip() in top_logprobs:
                matched[c] = top_logprobs[c.strip()]

        default_floor = (min(matched.values()) - 10.0) if matched else -20.0
        logits = {c: matched.get(c, default_floor) for c in query.candidates}
        z_sorted = sorted(logits.values(), reverse=True)
        top_logit_margin = (
            z_sorted[0] - z_sorted[1] if len(z_sorted) >= 2 else float("inf")
        )
        z_max = z_sorted[0]
        exp_scores = {
            c: math.exp((z - z_max) / self._temperature) for c, z in logits.items()
        }
        total = sum(exp_scores.values())
        probabilities = {c: val / total for c, val in exp_scores.items()}
        return DecisionDistribution(
            probabilities=probabilities,
            calibrated=calibrated,
            top_logit_margin=top_logit_margin,
        )


class DeterministicMockBackend:
    """Deterministic offline decision backend for tests and local evaluation."""

    def __init__(
        self,
        scripted: Mapping[str, Mapping[str, float]] | None = None,
        *,
        scorer: Callable[[DecisionQuery], DecisionDistribution] | None = None,
        calibrated: bool = True,
        default_logit_margin: float = 2.5,
    ) -> None:
        self._scripted: dict[str, dict[str, float]] = (
            {k: dict(v) for k, v in scripted.items()} if scripted else {}
        )
        self._scorer = scorer
        self._calibrated = calibrated
        self._default_logit_margin = float(default_logit_margin)

    async def predict(self, query: DecisionQuery) -> DecisionDistribution:
        """Returns a scripted, custom-scored, or heuristic distribution."""
        if self._scorer is not None:
            return self._scorer(query)

        if not query.candidates:
            return DecisionDistribution(
                probabilities={},
                calibrated=self._calibrated,
                top_logit_margin=0.0,
            )

        scripted_entry = self._scripted.get(f"{query.task}:{query.prompt}")
        if scripted_entry is None:
            scripted_entry = self._scripted.get(query.task)
        if scripted_entry is not None:
            probabilities = _normalize_probabilities(scripted_entry, query.candidates)
            return DecisionDistribution(
                probabilities=probabilities,
                calibrated=self._calibrated,
                top_logit_margin=self._default_logit_margin,
            )

        return self._heuristic_predict(query)

    def _heuristic_predict(self, query: DecisionQuery) -> DecisionDistribution:
        """Computes a deterministic keyword/context heuristic distribution."""
        prompt_lower = query.prompt.lower()
        prompt_tokens = _tokenize(query.prompt)
        context_tokens = _extract_context_tokens(query.context)

        raw_scores: list[tuple[str, float]] = []
        n = len(query.candidates)
        for idx, candidate in enumerate(query.candidates):
            base = _score_candidate(
                candidate, prompt_lower, prompt_tokens, context_tokens
            )
            tie_breaker = (n - idx) * 0.01
            raw_scores.append((candidate, base + tie_breaker))

        best_candidate, _ = max(raw_scores, key=lambda item: item[1])
        if n == 1:
            return DecisionDistribution(
                probabilities={query.candidates[0]: 1.0},
                calibrated=self._calibrated,
                top_logit_margin=self._default_logit_margin,
            )

        weights: dict[str, float] = {}
        for candidate, score in raw_scores:
            if candidate == best_candidate:
                weights[candidate] = 9.0 * (1.0 + score)
            else:
                weights[candidate] = (1.0 + score * 0.1) / (n - 1)

        probabilities = _normalize_probabilities(weights, query.candidates)
        return DecisionDistribution(
            probabilities=probabilities,
            calibrated=self._calibrated,
            top_logit_margin=self._default_logit_margin,
        )
