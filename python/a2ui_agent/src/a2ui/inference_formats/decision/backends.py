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

import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
import math
import re
import time
from typing import Any, Protocol, TypeVar, cast, runtime_checkable

import httpx

from .models import (
    DecisionAnswer,
    DecisionBackendType,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuery,
    DecisionQuestion,
    DecisionTask,
    DecisionWireFormat,
    QuestionKind,
)

_CAMEL_BOUNDARY_RE = re.compile(r"([a-z0-9])([A-Z])")
_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Lifetime of a cached Application Default Credentials access token.
_ADC_TOKEN_TTL_SECONDS = 1800.0

_BackendT = TypeVar("_BackendT", bound="_AsyncClosable")


def _safe_nonneg_float(value: Any) -> float:
    """Converts `value` to a finite non-negative float, returning 0.0 on invalid input."""
    try:
        parsed = float(value)
    except (ValueError, TypeError):
        return 0.0
    if not math.isfinite(parsed) or parsed <= 0.0:
        return 0.0
    return parsed


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


def _fill_missing_logits(
    logits: Mapping[str, float], candidates: Sequence[str]
) -> dict[str, float]:
    """Populates missing candidate logits with a low floor value."""
    present = [logits[c] for c in candidates if c in logits]
    floor = (min(present) - 10.0) if present else -20.0
    return {c: logits.get(c, floor) for c in candidates}


def _softmax_with_margin(
    logits: Mapping[str, float],
    candidates: Sequence[str],
    *,
    temperature: float = 1.0,
) -> tuple[dict[str, float], float | None]:
    """Computes temperature-scaled softmax probabilities and top-2 logit margin."""
    if not candidates:
        return {}, 0.0
    full_logits = _fill_missing_logits(logits, candidates)
    z_sorted = sorted(full_logits.values(), reverse=True)
    margin = (z_sorted[0] - z_sorted[1]) if len(z_sorted) >= 2 else float("inf")
    z_max = z_sorted[0]
    exp_scores = {
        c: math.exp((z - z_max) / temperature) for c, z in full_logits.items()
    }
    total = sum(exp_scores.values())
    if total <= 0.0:
        return {c: 0.0 for c in candidates}, margin
    probs = {c: val / total for c, val in exp_scores.items()}
    return probs, margin


def _child_slot_clause(query: DecisionQuery, *, full_template: str) -> str | None:
    """Formats the parent/slot clause when `query.task` is `child_component`."""
    if query.task != "child_component":
        return None
    parent = query.context.get("parent_description") or query.context.get("parent")
    slot = query.context.get("slot_description") or query.context.get("slot")
    if parent and slot:
        return full_template.format(parent=parent, slot=slot)
    return f"Slot: {slot}" if slot else None


def _pointers_summary(context: Mapping[str, Any], label: str) -> str | None:
    """Formats the available payload pointers clause if present in `context`."""
    pointers = context.get("pointers")
    if isinstance(pointers, (list, tuple)) and pointers:
        return f"{label}: {', '.join(str(p) for p in pointers)}"
    return None


def _candidate_description(context: Mapping[str, Any], candidate: str) -> str | None:
    """Returns the description string for `candidate` from `context`, if any."""
    cand_descs = context.get("candidate_descriptions")
    if isinstance(cand_descs, Mapping) and cand_descs.get(candidate):
        return str(cand_descs[candidate])
    return None


def _format_query_passage_pairs(
    query: DecisionQuery,
) -> tuple[str, list[str]]:
    """Formats DecisionQuery into (query_text, passage_texts) for cross-encoder scoring."""
    slot_clause = _child_slot_clause(
        query,
        full_template="Selecting child component for {parent}, slot {slot}",
    )
    ptr_clause = _pointers_summary(query.context, "Available data fields")
    query_parts = [p for p in (query.prompt, slot_clause, ptr_clause) if p]
    passage_texts = [
        f"{c}: {desc}" if (desc := _candidate_description(query.context, c)) else c
        for c in query.candidates
    ]
    return ". ".join(query_parts), passage_texts


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
    headers: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Sends an HTTP POST with JSON payload and returns the decoded JSON object."""
    hdrs = dict(headers) if headers else None
    response = await client.post(
        endpoint_url, json=payload, headers=hdrs, timeout=timeout_seconds
    )
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

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Answers every question in `batch`, in order."""
        ...

    async def aclose(self) -> None:
        """Releases resources owned by this backend."""
        ...

    async def __aenter__(self) -> DecisionBackend:
        ...

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        ...


def _question_query(
    question: DecisionQuestion, shared_context: Mapping[str, Any]
) -> DecisionQuery:
    """Builds the `DecisionQuery` a predict-only backend scores for `question`.

    The query context carries the batch's shared context, the question's own
    context, ``question_id`` and ``question_kind``, and candidate descriptions
    from `option_texts` (or the ``yes`` and ``no`` criteria texts in the
    question context for boolean questions).
    """
    context: dict[str, Any] = {
        **shared_context,
        **question.context,
        "question_id": question.id,
        "question_kind": str(question.kind),
    }
    descriptions: dict[str, str] = {}
    if question.option_texts:
        descriptions = dict(zip(question.options, question.option_texts))
    elif question.kind is QuestionKind.BOOLEAN:
        descriptions = {
            label: str(question.context[label])
            for label in ("yes", "no")
            if label in question.context
        }
    if descriptions:
        context["candidate_descriptions"] = descriptions
    return DecisionQuery(
        task=question.task,
        prompt=question.prompt,
        candidates=question.candidates(),
        context=context,
    )


def _boolean_answer(
    question: DecisionQuestion, dist: DecisionDistribution
) -> DecisionAnswer:
    """Normalizes a yes/no distribution into ``{"yes": p, "no": 1 - p}``."""
    yes = dist.probabilities.get("yes", 0.0)
    total = yes + dist.probabilities.get("no", 0.0)
    p_yes = yes / total if total > 0.0 else 0.0
    return DecisionAnswer(
        question_id=question.id,
        distribution=DecisionDistribution(
            probabilities={"yes": p_yes, "no": 1.0 - p_yes},
            calibrated=dist.calibrated,
            top_logit_margin=dist.top_logit_margin,
        ),
    )


def _score_answer(
    question: DecisionQuestion, dist: DecisionDistribution
) -> DecisionAnswer:
    """Normalizes a level distribution and computes its expected level index."""
    weights = [
        max(dist.probabilities.get(level, 0.0), 0.0) for level in question.options
    ]
    total = sum(weights)
    if total <= 0.0:
        return DecisionAnswer(question_id=question.id, distribution=dist)
    probs = {level: w / total for level, w in zip(question.options, weights)}
    expected = sum(p * idx for idx, p in enumerate(probs.values()))
    return DecisionAnswer(
        question_id=question.id,
        distribution=DecisionDistribution(
            probabilities=probs,
            calibrated=dist.calibrated,
            top_logit_margin=dist.top_logit_margin,
        ),
        expected=expected,
    )


def answer_from_distribution(
    question: DecisionQuestion, dist: DecisionDistribution
) -> DecisionAnswer:
    """Converts a candidate distribution into the `DecisionAnswer` for `question`.

    `CHOICE` answers keep the distribution as returned (over the options plus
    ``"none"`` when `allow_none`); `BOOLEAN` answers are normalized to
    ``{"yes": p, "no": 1 - p}``; `SCORE` answers are normalized over the
    levels and carry ``expected = sum(p_i * i)``.
    """
    if question.kind is QuestionKind.BOOLEAN:
        return _boolean_answer(question, dist)
    if question.kind is QuestionKind.SCORE:
        return _score_answer(question, dist)
    return DecisionAnswer(question_id=question.id, distribution=dist)


class _AnswerViaPredict:
    """Mixin giving `answer()` to any backend that only has `predict()`.

    `CHOICE` questions predict over the options (plus ``"none"`` when
    `allow_none`), `BOOLEAN` questions over ``("yes", "no")``, and `SCORE`
    questions over the level labels with ``expected = sum(p_i * i)``.
    Questions run concurrently through `asyncio.gather`, so backends that
    coalesce concurrent requests batch them naturally.
    """

    predict: Callable[[DecisionQuery], Awaitable[DecisionDistribution]]

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Answers every question in `batch` through `predict`, in order."""
        queries = [_question_query(q, batch.shared_context) for q in batch.questions]
        distributions = await asyncio.gather(*(self.predict(q) for q in queries))
        return tuple(
            answer_from_distribution(question, dist)
            for question, dist in zip(batch.questions, distributions)
        )


class _AsyncClosable:
    """Mixin giving a backend `aclose()` and `async with` support.

    Backends that own no resources inherit the no-op `aclose`; backends that
    hold an HTTP client override it.
    """

    async def aclose(self) -> None:
        """Releases resources owned by this backend. No-op by default."""

    async def aclose_current_loop(self) -> None:
        """Closes resources owned by the currently running event loop, if any."""

    async def __aenter__(self: _BackendT) -> _BackendT:
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.aclose()


class _HttpClientOwner(_AsyncClosable):
    """Mixin that lazily owns an `httpx.AsyncClient` per active event loop.

    An `httpx.AsyncClient` opens connections on the loop that first uses it,
    so a client created on one loop fails when used from another (for
    example when `DecisionSynthesizer.synthesize_sync` runs synthesis on a
    helper thread). Owned clients are keyed by their `AbstractEventLoop` so
    concurrent loops do not overwrite each other's client, and temporary
    loops can close their own client via `aclose_current_loop()`.
    """

    _client: httpx.AsyncClient | None
    _owned_clients: dict[asyncio.AbstractEventLoop, httpx.AsyncClient]
    _timeout_seconds: float

    def _init_http_client(
        self, client: httpx.AsyncClient | None, timeout_seconds: float
    ) -> None:
        self._client = client
        self._owned_clients = {}
        self._timeout_seconds = timeout_seconds

    @property
    def _owned_client(self) -> httpx.AsyncClient | None:
        """Returns the client owned by the current loop, or the most recent one."""
        if not self._owned_clients:
            return None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return next(reversed(self._owned_clients.values()))
        return self._owned_clients.get(loop)

    def _sweep_closed_loops(self) -> None:
        """Removes entries whose event loop has already been closed."""
        closed = [lp for lp in self._owned_clients if lp.is_closed()]
        for lp in closed:
            self._owned_clients.pop(lp, None)

    def _get_client(self) -> httpx.AsyncClient:
        """Returns the caller-supplied client or a loop-local owned one."""
        if self._client is not None:
            return self._client
        self._sweep_closed_loops()
        loop = asyncio.get_running_loop()
        client = self._owned_clients.get(loop)
        if client is None or client.is_closed:
            client = httpx.AsyncClient(timeout=self._timeout_seconds)
            self._owned_clients[loop] = client
        return client

    async def aclose_current_loop(self) -> None:
        """Closes and removes the client owned by the currently running event loop."""
        self._sweep_closed_loops()
        loop = asyncio.get_running_loop()
        client = self._owned_clients.pop(loop, None)
        if client is not None and not client.is_closed:
            await client.aclose()

    async def aclose(self) -> None:
        """Closes all internally owned `httpx.AsyncClient` instances."""
        if not self._owned_clients:
            return
        current_loop = asyncio.get_running_loop()
        items = list(self._owned_clients.items())
        self._owned_clients.clear()
        for loop, client in items:
            if client.is_closed:
                continue
            if loop is current_loop or loop.is_closed():
                await client.aclose()
            else:
                try:
                    asyncio.run_coroutine_threadsafe(client.aclose(), loop)
                except RuntimeError:
                    pass


def _get_adc_token_sync() -> str | None:
    """Attempts to retrieve an ADC access token synchronously in a worker thread."""
    try:
        import google.auth
        import google.auth.transport.requests

        creds: Any
        creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        creds.refresh(google.auth.transport.requests.Request())
        if creds.token:
            return str(creds.token)
    except Exception:
        pass

    try:
        import subprocess

        res = subprocess.run(
            ["gcloud", "auth", "print-access-token"],
            capture_output=True,
            text=True,
            timeout=5.0,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception:
        pass

    return None


def _build_systemone_request(query: DecisionQuery, model: str) -> dict[str, Any]:
    """Builds a structured /v1/systemone choice request envelope."""
    criteria = {
        c: (
            _candidate_description(query.context, c)
            or f"Candidate component or template: {c}"
        )
        for c in query.candidates
    }
    slot_clause = _child_slot_clause(
        query, full_template="Parent container: {parent}. Slot: {slot}"
    )
    ptr_clause = _pointers_summary(query.context, "Payload data fields")
    state_parts = [
        p for p in (f"User intent: {query.prompt}", slot_clause, ptr_clause) if p
    ]
    return {
        "model": model,
        "state": ". ".join(state_parts),
        "questions": {
            "q": {
                "type": "choice",
                "instructions": (
                    "Evaluate which candidate best satisfies the user intent and"
                    " UI structure."
                ),
                "criteria": criteria,
            }
        },
    }


def _probability_margin(probabilities: Mapping[str, float]) -> float:
    """Computes log-ratio margin between the top two probabilities."""
    sorted_probs = sorted(probabilities.values(), reverse=True)
    if len(sorted_probs) < 2:
        return float("inf") if sorted_probs and sorted_probs[0] > 0.0 else 0.0
    p0, p1 = sorted_probs[0], sorted_probs[1]
    if p0 <= 0.0:
        return 0.0
    return float("inf") if p1 <= 0.0 else math.log(p0 / p1)


def _parse_systemone_response(
    data: Mapping[str, Any], candidates: tuple[str, ...]
) -> tuple[dict[str, float], bool, float | None]:
    """Extracts probabilities and logit margin from /v1/systemone response."""
    answers = data.get("answers")
    if not isinstance(answers, Mapping) or not answers:
        return {c: 0.0 for c in candidates}, True, 0.0

    first_val = answers.get("q") or next(iter(answers.values()), None)
    q_data = first_val if isinstance(first_val, Mapping) else {}
    raw_probs = q_data.get("probabilities")
    probs_map = raw_probs if isinstance(raw_probs, Mapping) else {}
    probabilities = _normalize_probabilities(probs_map, candidates)
    calibrated = "confidence" in q_data or bool(data.get("calibrated", True))
    return probabilities, calibrated, _probability_margin(probabilities)


class JevHttpBackend(_AnswerViaPredict, _HttpClientOwner):
    """HTTP backend for local Jev /predict or /v1/systemone decision endpoints.

    Supports `async with` to close the owned HTTP client on exit. ADC access
    tokens (``auth="adc"``) are cached per instance for 30 minutes.
    """

    def __init__(
        self,
        endpoint_url: str,
        *,
        wire_format: DecisionWireFormat | str = DecisionWireFormat.AUTO,
        model: str = "default",
        auth: str | Callable[[], str | Any] | None = None,
        headers: Mapping[str, str] | None = None,
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 5.0,
    ) -> None:
        self._endpoint_url = endpoint_url
        self._wire_format = str(getattr(wire_format, "value", wire_format))
        self._model = model
        self._auth = auth
        self._headers = dict(headers) if headers else None
        self._init_http_client(client, timeout_seconds)
        self._adc_token: str | None = None
        self._adc_expires_at: float = 0.0
        self._adc_lock = asyncio.Lock()

    async def _resolve_adc_token(self) -> str | None:
        """Returns this instance's cached ADC token, refreshing it when expired."""
        now = time.time()
        if self._adc_token and now < self._adc_expires_at:
            return self._adc_token

        async with self._adc_lock:
            now = time.time()
            if self._adc_token and now < self._adc_expires_at:
                return self._adc_token
            token = await asyncio.to_thread(_get_adc_token_sync)
            if token:
                self._adc_token = token
                self._adc_expires_at = now + _ADC_TOKEN_TTL_SECONDS
                return token
            return None

    async def _resolve_auth_token(self) -> str | None:
        """Resolves bearer token string from auth argument or environment."""
        auth_target = self._auth
        if auth_target is None:
            import os

            auth_target = os.environ.get("A2UI_DECISION_TOKEN") or os.environ.get(
                "A2UI_DECISION_AUTH"
            )
            if not auth_target:
                return None

        if auth_target == "adc":
            return await self._resolve_adc_token()
        if callable(auth_target):
            res = auth_target()
            if asyncio.iscoroutine(res):
                res = await res
            return str(res) if res else None
        token_str = str(auth_target).strip()
        return token_str if token_str else None

    async def _build_headers(self) -> dict[str, str]:
        """Constructs headers including Authorization Bearer token if configured."""
        headers = dict(self._headers or {})
        token = await self._resolve_auth_token()
        if token and "Authorization" not in headers:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def predict(self, query: DecisionQuery) -> DecisionDistribution:
        """Queries the decision endpoint and normalizes candidate probabilities."""
        if not query.candidates:
            return DecisionDistribution(
                probabilities={},
                calibrated=True,
                top_logit_margin=0.0,
            )

        headers = await self._build_headers()
        is_systemone = self._wire_format == "systemone" or (
            self._wire_format == "auto"
            and self._endpoint_url.rstrip("/").endswith("/v1/systemone")
        )

        if is_systemone:
            payload = _build_systemone_request(query, self._model)
        else:
            payload = {
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
            headers=headers,
        )

        if is_systemone or "answers" in data:
            probs, calibrated, margin = _parse_systemone_response(
                data, query.candidates
            )
            return DecisionDistribution(
                probabilities=probs,
                calibrated=calibrated,
                top_logit_margin=margin,
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


class StepZeroLogprobBackend(_AnswerViaPredict, _HttpClientOwner):
    """OpenAI-compatible step-0 top-logprob decision backend.

    Supports `async with` to close the owned HTTP client on exit.
    """

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
        self._init_http_client(client, timeout_seconds)

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
        probabilities, top_logit_margin = _softmax_with_margin(
            logits, query.candidates, temperature=self._temperature
        )
        return DecisionDistribution(
            probabilities=probabilities,
            calibrated=calibrated,
            top_logit_margin=top_logit_margin,
        )


class DeterministicMockBackend(_AnswerViaPredict, _AsyncClosable):
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


class LocalCrossEncoderBackend(_AnswerViaPredict, _AsyncClosable):
    """In-process CPU cross-encoder backend backed by ONNX Runtime."""

    def __init__(
        self,
        model_id: str = "cross-encoder/ms-marco-MiniLM-L-6-v2",
        *,
        onnx_subpath: str = "onnx/model.onnx",
        temperature: float = 1.0,
        calibrated: bool = True,
        cache_dir: str | None = None,
        session: Any | None = None,
        tokenizer: Any | None = None,
    ) -> None:
        if temperature <= 0.0:
            raise ValueError(f"temperature must be positive, got {temperature}")
        self.model_id = model_id
        self.onnx_subpath = onnx_subpath
        self.temperature = float(temperature)
        self.calibrated = bool(calibrated)
        self.cache_dir = cache_dir

        self._session = session
        self._tokenizer = tokenizer

    def _ensure_loaded(self) -> tuple[Any, Any]:
        """Lazy-loads ONNX Runtime session and Hugging Face tokenizer."""
        if self._session is not None and self._tokenizer is not None:
            return self._session, self._tokenizer

        try:
            from huggingface_hub import hf_hub_download
            import onnxruntime as ort  # type: ignore[import-not-found]
            from tokenizers import Tokenizer
        except ImportError as err:
            raise ImportError(
                "LocalCrossEncoderBackend requires the 'decision-local' extra. "
                'Install it with: pip install "a2ui-agent-sdk[decision-local]" '
                f"(missing dependency: {err})"
            ) from err

        if self._session is None:
            model_path = hf_hub_download(
                repo_id=self.model_id,
                filename=self.onnx_subpath,
                cache_dir=self.cache_dir,
            )
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            opts.inter_op_num_threads = 1
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self._session = ort.InferenceSession(
                model_path, opts, providers=["CPUExecutionProvider"]
            )

        if self._tokenizer is None:
            tok_path = hf_hub_download(
                repo_id=self.model_id,
                filename="tokenizer.json",
                cache_dir=self.cache_dir,
            )
            self._tokenizer = Tokenizer.from_file(tok_path)
            self._tokenizer.enable_padding()
            self._tokenizer.enable_truncation(max_length=512)

        return self._session, self._tokenizer

    def _infer_sync(
        self, query: DecisionQuery
    ) -> tuple[dict[str, float], float | None]:
        """Loads the ONNX model if needed and scores candidates synchronously."""
        import numpy as np

        session, tokenizer = self._ensure_loaded()
        query_text, passage_texts = _format_query_passage_pairs(query)
        encodings = tokenizer.encode_batch([(query_text, p) for p in passage_texts])
        feed: dict[str, Any] = {
            "input_ids": np.array([e.ids for e in encodings], dtype=np.int64),
            "attention_mask": np.array(
                [e.attention_mask for e in encodings], dtype=np.int64
            ),
        }
        input_names = [inp.name for inp in getattr(session, "get_inputs", lambda: ())()]
        if "token_type_ids" in input_names:
            feed["token_type_ids"] = np.array(
                [e.type_ids for e in encodings], dtype=np.int64
            )
        logits = np.atleast_1d(np.squeeze(session.run(None, feed)[0]).astype(float))
        token_logits = {
            cand: float(logits[i]) for i, cand in enumerate(query.candidates)
        }
        return _softmax_with_margin(
            token_logits, query.candidates, temperature=self.temperature
        )

    async def predict(self, query: DecisionQuery) -> DecisionDistribution:
        """Scores candidates in-process using the ONNX cross-encoder."""
        if not query.candidates:
            return DecisionDistribution(
                probabilities={},
                calibrated=self.calibrated,
                top_logit_margin=0.0,
            )
        if len(query.candidates) == 1:
            return DecisionDistribution(
                probabilities={query.candidates[0]: 1.0},
                calibrated=self.calibrated,
                top_logit_margin=float("inf"),
            )

        probs, margin = await asyncio.to_thread(self._infer_sync, query)
        return DecisionDistribution(
            probabilities=probs,
            calibrated=self.calibrated,
            top_logit_margin=margin,
        )


def _infer_backend_kind(url: str | None) -> str:
    """Picks a backend kind from the endpoint URL, or from installed extras."""
    if url:
        clean_url = url.rstrip("/").lower()
        if clean_url.endswith("/v1/systemone"):
            return DecisionBackendType.SYSTEMONE.value
        if clean_url.endswith("/v1/completions"):
            return DecisionBackendType.STEP_ZERO.value
        return DecisionBackendType.JEV.value
    try:
        import onnxruntime  # noqa: F401
        import tokenizers  # noqa: F401
    except ImportError:
        return DecisionBackendType.MOCK.value
    return DecisionBackendType.LOCAL.value


def _require_url(kind: str, url: str | None) -> str:
    """Returns `url`, or raises a ValueError naming the backend that needs it."""
    if not url:
        raise ValueError(
            f"{kind} backend requires an endpoint URL (pass endpoint_url or set"
            " A2UI_DECISION_URL)"
        )
    return url


def _create_local_backend(
    model_name: str | None, temperature: float
) -> LocalCrossEncoderBackend:
    kw: dict[str, Any] = {"temperature": temperature}
    if model_name:
        kw["model_id"] = model_name
    return LocalCrossEncoderBackend(**kw)


def _create_jev_backend(
    kind: str,
    url: str | None,
    model_name: str | None,
    auth_val: str | Callable[[], str | Any] | None,
) -> JevHttpBackend:
    endpoint = _require_url(kind, url)
    if kind == DecisionBackendType.SYSTEMONE.value:
        return JevHttpBackend(
            endpoint,
            wire_format=DecisionWireFormat.SYSTEMONE,
            model=model_name or "default",
            auth=auth_val,
        )
    return JevHttpBackend(endpoint, wire_format=DecisionWireFormat.JEV, auth=auth_val)


def _create_step_zero_backend(
    url: str | None, model_name: str | None, temperature: float
) -> StepZeroLogprobBackend:
    endpoint = _require_url(DecisionBackendType.STEP_ZERO.value, url)
    return StepZeroLogprobBackend(
        endpoint, model=model_name or "default", temperature=temperature
    )


def create_decision_backend(
    backend_type: str | DecisionBackendType | None = None,
    *,
    endpoint_url: str | None = None,
    model: str | None = None,
    auth: str | Callable[[], str | Any] | None = None,
    temperature: float | None = None,
) -> DecisionBackend:
    """Creates a DecisionBackend from explicit arguments or environment variables.

    Args:
        backend_type: A `DecisionBackendType` or its string value. When
            omitted, read from `A2UI_DECISION_BACKEND`, then inferred from
            the endpoint URL, then from the installed extras.
        endpoint_url: Endpoint for the HTTP backends.
        model: Model identifier (cross-encoder ID or remote model name).
        auth: `"adc"`, a bearer token, or a callable returning one.
        temperature: Softmax temperature for the local and step-0 backends.

    Environment variables:
        A2UI_DECISION_BACKEND: 'local' (alias 'onnx'), 'systemone', 'jev', 'step0', 'mock'
        A2UI_DECISION_URL: Endpoint URL for HTTP backends
        A2UI_DECISION_MODEL: Model identifier (e.g. cross-encoder ID or remote model)
        A2UI_DECISION_AUTH: 'adc', Bearer token string, or omitted
        A2UI_DECISION_TEMPERATURE: Float temperature scaling parameter

    Raises:
        ValueError: If the backend kind is unknown or needs a URL that is
            missing.
    """
    import os

    raw_kind = backend_type or os.environ.get("A2UI_DECISION_BACKEND")
    url = endpoint_url or os.environ.get("A2UI_DECISION_URL")
    model_name = model or os.environ.get("A2UI_DECISION_MODEL")
    auth_val = (
        auth
        or os.environ.get("A2UI_DECISION_AUTH")
        or os.environ.get("A2UI_DECISION_TOKEN")
    )
    temp = _resolve_temperature(
        temperature, os.environ.get("A2UI_DECISION_TEMPERATURE")
    )
    kind = _normalize_backend_kind(raw_kind) or _infer_backend_kind(url)

    def build_local() -> DecisionBackend:
        return _create_local_backend(model_name, temp)

    builders: dict[str, Callable[[], DecisionBackend]] = {
        DecisionBackendType.LOCAL.value: build_local,
        # "onnx" names the same in-process backend; kept as an alias.
        DecisionBackendType.ONNX.value: build_local,
        DecisionBackendType.SYSTEMONE.value: lambda: _create_jev_backend(
            kind, url, model_name, auth_val
        ),
        DecisionBackendType.JEV.value: lambda: _create_jev_backend(
            kind, url, model_name, auth_val
        ),
        DecisionBackendType.STEP_ZERO.value: lambda: _create_step_zero_backend(
            url, model_name, temp
        ),
        DecisionBackendType.MOCK.value: DeterministicMockBackend,
    }
    builder = builders.get(kind)
    if builder is None:
        choices = ", ".join(f"'{k}'" for k in builders)
        raise ValueError(
            f"Unknown decision backend type '{raw_kind}'. Choose from: {choices}."
        )
    return builder()


def _normalize_backend_kind(raw_kind: str | DecisionBackendType | None) -> str | None:
    """Lower-cases a backend kind given as a string or enum; None stays None."""
    if not raw_kind:
        return None
    return str(getattr(raw_kind, "value", raw_kind)).strip().lower()


def _resolve_temperature(explicit: float | None, from_env: str | None) -> float:
    """Picks the explicit temperature, else the environment value, else 1.0."""
    if explicit is not None:
        return float(explicit)
    return float(from_env) if from_env else 1.0


__all__ = [
    "DecisionBackend",
    "DeterministicMockBackend",
    "JevHttpBackend",
    "LocalCrossEncoderBackend",
    "StepZeroLogprobBackend",
    "create_decision_backend",
]
