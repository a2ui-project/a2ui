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

"""Inference backends for local decision-model A2UI synthesis.

Every backend answers a whole `DecisionBatch` in one `answer` call, names
itself through `backend_kind` and a pinned `model_id`, declares its
`BackendCapabilities`, and applies a per-model `Calibration`. Failures and
timeouts raise `DecisionBackendError`.

Environment variables read by `create_decision_backend`:
- `A2UI_DECISION_BACKEND`: Backend kind ('mock', 'jev', 'gemini', 'systemone',
  'step0'). Required unless the kind is passed explicitly.
- `A2UI_DECISION_URL`: Default URL for remote backends.
- `A2UI_DECISION_MODEL`: Default model identifier.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from typing import Any, Protocol, TypeAlias, TypeVar, cast, runtime_checkable
import urllib.parse

import httpx

from a2ui.core import A2uiValidationError

from .models import (
    DecisionAnswer,
    DecisionBackendError,
    DecisionBackendType,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuestion,
    DecisionWireFormat,
    QuestionKind,
)

_CAMEL_BOUNDARY_RE = re.compile(r"([a-z0-9])([A-Z])")
_TOKEN_RE = re.compile(r"[a-z0-9]+")

DEFAULT_TIMEOUT_SECONDS = 30.0
"""Default deadline, in seconds, for one backend request (and for fetching an
access token with ``gcloud``)."""

DEFAULT_TYPESAFE_MODEL = "jev-1.14.0"
"""Pinned TypeSafe model id; the bundled calibration was fitted on it."""

DEFAULT_GEMINI_DECISION_MODEL = "gemini-decision-1"
"""Pinned Google Gemini Decisions API model id."""

_DEFAULT_VERCEL_TYPESAFE_MODEL = "jev"

# Lifetime of a cached Application Default Credentials access token.
_ADC_TOKEN_TTL_SECONDS = 1800.0

_DEFAULT_TYPESAFE_SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone"
_DEFAULT_VERCEL_TYPESAFE_SYSTEMONE_URL = (
    "https://ai-gateway.vercel.sh/typesafe/v1/systemone"
)
_DEFAULT_GEMINI_DECISIONS_URL = (
    "https://generativelanguage.googleapis.com/v1beta/decisions"
)

_BUNDLED_CALIBRATION_PATH = Path(__file__).with_name("calibration_profiles.json")

_STEP_ZERO_LABELS: tuple[str, ...] = tuple("ABCDEFGHIJ")

_BackendT = TypeVar("_BackendT", bound="_AsyncClosable")
_T = TypeVar("_T")

ScriptedAnswerSpec: TypeAlias = (
    DecisionAnswer | float | int | str | tuple[str, float] | Mapping[str, float]
)

AuthSpec: TypeAlias = str | Callable[[], str | Any] | None
"""``"adc"``, a bearer token, or a callable returning one."""


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


def _pointers_summary(
    context: Mapping[str, Any], label: str, *, max_pointers: int | None = 12
) -> str | None:
    """Formats the available payload pointers clause if present in `context`."""
    pointers = context.get("pointers")
    if isinstance(pointers, (list, tuple)) and pointers:
        pts = list(pointers)
        if max_pointers is not None and max_pointers > 0 and len(pts) > max_pointers:
            pts = pts[:max_pointers]
        return f"{label}: {', '.join(str(p) for p in pts)}"
    return None


def _validate_step_zero_candidates(candidates: Sequence[str]) -> None:
    """Raises `A2uiValidationError` when `candidates` exceeds the A-J label cap."""
    if len(candidates) > len(_STEP_ZERO_LABELS):
        raise A2uiValidationError(
            "StepZeroLogprobBackend supports at most"
            f" {len(_STEP_ZERO_LABELS)} options (A-J), got {len(candidates)}."
        )


def _format_step_zero_prompt(
    question: DecisionQuestion,
    context: Mapping[str, Any],
    *,
    shared_prefix: str = "",
) -> str:
    """Formats one question into a single-character (A-J) step-0 prompt."""
    candidates = question.candidates()
    _validate_step_zero_candidates(candidates)
    labeled = [f"{_STEP_ZERO_LABELS[i]}: {cand}" for i, cand in enumerate(candidates)]
    lines: list[str] = []
    if shared_prefix:
        lines.append(shared_prefix)
    lines.append(f"Task: {question.task}")
    lines.append(f"Candidates: [{', '.join(labeled)}]")
    if context:
        lines.append(f"Context: {dict(context)}")
    lines.append(f"Intent: {question.prompt}")
    lines.append("Selection:")
    return "\n".join(lines)


def _match_step_zero_logprobs(
    candidates: Sequence[str], top_logprobs: Mapping[str, float]
) -> dict[str, float]:
    """Maps single-character label (`A`-`J`) or candidate token logprobs to option ids."""
    matched: dict[str, float] = {}
    norm_logprobs = {k.strip().lower(): v for k, v in top_logprobs.items()}
    for idx, cand in enumerate(candidates):
        label = _STEP_ZERO_LABELS[idx]
        cand_clean = cand.strip()
        if label in top_logprobs:
            matched[cand] = top_logprobs[label]
        elif cand in top_logprobs:
            matched[cand] = top_logprobs[cand]
        elif cand_clean in top_logprobs:
            matched[cand] = top_logprobs[cand_clean]
        elif label.lower() in norm_logprobs:
            matched[cand] = norm_logprobs[label.lower()]
        elif cand_clean.lower() in norm_logprobs:
            matched[cand] = norm_logprobs[cand_clean.lower()]
    return matched


def _extract_http_error_detail(response: httpx.Response) -> str | None:
    """Extracts a human-readable error message from a JSON error response, if any."""
    try:
        body = response.json()
    except Exception:
        return None
    if not isinstance(body, Mapping):
        return None
    for key in ("error", "detail"):
        val = body.get(key)
        if isinstance(val, Mapping) and val.get("message"):
            msg = str(val["message"])
            code = val.get("code")
            if (
                isinstance(code, str)
                and code
                and not msg.lower().startswith(f"{code.lower()}:")
            ):
                return f"{code}: {msg}"
            return msg
        if isinstance(val, str) and val:
            return val
    return None


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
    if response.is_error:
        detail = _extract_http_error_detail(response)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as err:
            if detail:
                raise httpx.HTTPStatusError(
                    f"{err}: {detail}",
                    request=err.request,
                    response=err.response,
                ) from err
            raise
    return cast(dict[str, Any], response.json())


def _record_token_logprob(result: dict[str, float], token: Any, logprob: Any) -> None:
    """Inserts `token` and its stripped form into `result` with max finite `logprob`."""
    try:
        lp = float(logprob)
    except (TypeError, ValueError):
        return
    if not math.isfinite(lp):
        return
    token_str = str(token)
    result[token_str] = lp
    stripped = token_str.strip()
    if stripped and (stripped not in result or lp > result[stripped]):
        result[stripped] = lp


def _extract_chat_logprobs(logprobs_obj: Mapping[str, Any]) -> dict[str, float] | None:
    """Extracts chat-completion format `content[0].top_logprobs` if present."""
    content_list = logprobs_obj.get("content")
    if not isinstance(content_list, list) or not content_list:
        return None
    first_pos = content_list[0]
    if not isinstance(first_pos, Mapping):
        return None
    chat_top = first_pos.get("top_logprobs")
    if not isinstance(chat_top, list):
        return None
    result: dict[str, float] = {}
    for entry in chat_top:
        if isinstance(entry, Mapping) and "token" in entry and "logprob" in entry:
            _record_token_logprob(result, entry["token"], entry["logprob"])
    return result


def _extract_top_logprobs(data: Mapping[str, Any]) -> dict[str, float]:
    """Extracts token-to-logprob mappings from an OpenAI-compatible response."""
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return {}
    first_choice = choices[0]
    if not isinstance(first_choice, Mapping):
        return {}
    logprobs_obj = first_choice.get("logprobs")
    if not isinstance(logprobs_obj, Mapping):
        return {}

    chat_res = _extract_chat_logprobs(logprobs_obj)
    if chat_res is not None:
        return chat_res

    top_list = logprobs_obj.get("top_logprobs")
    if not isinstance(top_list, list) or not top_list:
        return {}
    first_step = top_list[0]
    if not isinstance(first_step, Mapping):
        return {}

    result: dict[str, float] = {}
    for token, logprob in first_step.items():
        _record_token_logprob(result, token, logprob)
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


@dataclass(frozen=True)
class BackendCapabilities:
    """What a decision backend can do, read by the planner.

    Attributes:
        two_stage: Whether the planner should split a surface into two
            `answer` calls (family and archetype first, then the winning
            archetype's blocks). Backends that pay per question, such as the
            step-0 backend, set it to cut the number of questions asked.
        max_questions_per_call: Most questions one `answer` call accepts,
            or None when there is no limit.
    """

    two_stage: bool = False
    max_questions_per_call: int | None = None


@dataclass(frozen=True)
class Calibration:
    """Per-model temperature scaling applied to every answer distribution.

    Each probability is raised to the power ``1 / temperature`` and the
    distribution is renormalized, which divides the log-probabilities by
    the temperature. A temperature of 1.0 leaves distributions unchanged.
    """

    temperature: float = 1.0

    def __post_init__(self) -> None:
        if not math.isfinite(self.temperature) or self.temperature <= 0.0:
            raise ValueError(
                f"Calibration temperature must be positive, got {self.temperature}."
            )

    @classmethod
    def load(cls, path: Path, *, backend_kind: str, model_id: str) -> Calibration:
        """Loads the profile for ``backend_kind/model_id`` from a JSON file.

        The file maps ``"<backend_kind>/<model_id>"`` keys to objects such as
        ``{"temperature": 4.0}``. A model with no entry gets the identity
        calibration.

        Raises:
            OSError: If the file cannot be read.
            ValueError: If the file is not a JSON object of profile objects
                or a temperature is not positive.
        """
        profiles = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(profiles, Mapping):
            raise ValueError(f"Calibration file {path} must hold a JSON object.")
        profile = profiles.get(f"{backend_kind}/{model_id}")
        if profile is None:
            return cls()
        if not isinstance(profile, Mapping):
            raise ValueError(
                f"Calibration profile {backend_kind}/{model_id} in {path} must be"
                " an object."
            )
        return cls(temperature=float(profile.get("temperature", 1.0)))

    def apply(self, probabilities: Mapping[str, float]) -> dict[str, float]:
        """Returns `probabilities` scaled by this calibration's temperature."""
        if self.temperature == 1.0:
            return dict(probabilities)
        max_p = max(
            (p for p in probabilities.values() if math.isfinite(p) and p > 0.0),
            default=0.0,
        )
        if max_p <= 0.0:
            return dict(probabilities)
        inv_temp = 1.0 / self.temperature
        scaled = {
            option: (p / max_p) ** inv_temp if math.isfinite(p) and p > 0.0 else 0.0
            for option, p in probabilities.items()
        }
        total = sum(scaled.values())
        if total <= 0.0:
            return dict(probabilities)
        return {option: value / total for option, value in scaled.items()}


def _resolve_calibration(
    calibration: Calibration | Path | None, *, backend_kind: str, model_id: str
) -> Calibration:
    """Returns `calibration`, a profile loaded from a path, or the bundled one."""
    if isinstance(calibration, Calibration):
        return calibration
    path = _BUNDLED_CALIBRATION_PATH if calibration is None else Path(calibration)
    return Calibration.load(path, backend_kind=backend_kind, model_id=model_id)


@runtime_checkable
class DecisionBackend(Protocol):
    """Protocol for decision-model inference backends.

    A backend answers a whole `DecisionBatch` per `answer` call. It owns any
    HTTP clients it creates and releases them in `aclose`, which
    ``async with`` calls on exit.
    """

    @property
    def backend_kind(self) -> str:
        """Short backend family name, such as ``"jev"`` or ``"step0"``."""
        ...

    @property
    def model_id(self) -> str:
        """The pinned model identifier the backend queries."""
        ...

    @property
    def capabilities(self) -> BackendCapabilities:
        """What the planner may rely on when batching questions."""
        ...

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Answers every question in `batch`, in order.

        Raises:
            DecisionBackendError: If the backend times out or fails.
        """
        ...

    async def aclose(self) -> None:
        """Releases resources owned by this backend."""
        ...

    async def aclose_current_loop(self) -> None:
        """Releases resources bound to the running event loop only.

        `DecisionSynthesizer.synthesize_sync` calls this before its temporary
        loop closes; backends with no loop-scoped state implement it as a
        no-op.
        """
        ...

    async def __aenter__(self) -> DecisionBackend:
        ...

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        ...


def _question_context(
    question: DecisionQuestion, shared_context: Mapping[str, Any]
) -> dict[str, Any]:
    """Builds the context a per-question scorer shows the model for `question`.

    The context carries the batch's shared context, the question's own
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
    return context


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
    _lock: threading.Lock

    def _init_http_client(
        self, client: httpx.AsyncClient | None, timeout_seconds: float
    ) -> None:
        self._client = client
        self._owned_clients = {}
        self._timeout_seconds = timeout_seconds
        self._lock = threading.Lock()

    @property
    def _owned_client(self) -> httpx.AsyncClient | None:
        """Returns the client owned by the current loop, or the most recent one."""
        with self._lock:
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
        loop = asyncio.get_running_loop()
        with self._lock:
            self._sweep_closed_loops()
            client = self._owned_clients.get(loop)
            if client is None or client.is_closed:
                client = httpx.AsyncClient(timeout=self._timeout_seconds)
                self._owned_clients[loop] = client
            return client

    async def aclose_current_loop(self) -> None:
        """Closes and removes the client owned by the currently running event loop."""
        loop = asyncio.get_running_loop()
        with self._lock:
            self._sweep_closed_loops()
            client = self._owned_clients.pop(loop, None)
        if client is not None and not client.is_closed:
            await client.aclose()

    async def aclose(self) -> None:
        """Closes all internally owned `httpx.AsyncClient` instances."""
        with self._lock:
            if not self._owned_clients:
                return
            items = list(self._owned_clients.items())
            self._owned_clients.clear()
        current_loop = asyncio.get_running_loop()
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

    backend_kind: str
    model_id: str

    async def _post(
        self, endpoint_url: str, payload: Mapping[str, Any], headers: Any
    ) -> dict[str, Any]:
        """POSTs `payload` within `_timeout_seconds` and decodes the JSON reply.

        The deadline covers the whole request, including connection setup and
        reading the body.

        Raises:
            DecisionBackendError: On a timeout, a transport or HTTP status
                error, or a body that is not JSON.
        """
        request = _post_json(
            endpoint_url,
            payload,
            client=self._get_client(),
            timeout_seconds=self._timeout_seconds,
            headers=headers,
        )
        return await self._guard(request, endpoint_url)

    async def _guard(self, request: Awaitable[_T], endpoint_url: str) -> _T:
        """Awaits `request` under the deadline, mapping failures to one error type."""
        try:
            return await asyncio.wait_for(request, timeout=self._timeout_seconds)
        except (asyncio.TimeoutError, httpx.TimeoutException) as exc:
            reason = f"timed out after {self._timeout_seconds:g} s"
            raise self._backend_error(reason, endpoint_url, exc) from exc
        except httpx.HTTPError as exc:
            raise self._backend_error(f"failed: {exc}", endpoint_url, exc) from exc
        except ValueError as exc:
            reason = f"returned a body that is not JSON: {exc}"
            raise self._backend_error(reason, endpoint_url, exc) from exc

    def _backend_error(
        self, reason: str, endpoint_url: str, cause: BaseException
    ) -> DecisionBackendError:
        """Builds a `DecisionBackendError` tagged with this backend's kind and model."""
        return DecisionBackendError(
            f"Decision backend {self.backend_kind!r} (model {self.model_id!r})"
            f" request to {endpoint_url} {reason}",
            backend_kind=self.backend_kind,
            model_id=self.model_id,
            cause=cause,
        )


def _get_adc_token_sync(timeout_seconds: float) -> str | None:
    """Retrieves an access token from ADC, then from ``gcloud``, synchronously.

    Args:
        timeout_seconds: Deadline for the ``gcloud auth print-access-token``
            subprocess.

    Returns:
        The token, or None when neither source produced one.
    """
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

    gcloud_path = shutil.which("gcloud")
    if not gcloud_path:
        return None
    try:
        res = subprocess.run(
            [gcloud_path, "auth", "print-access-token"],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception:
        pass

    return None


def _probability_margin(probabilities: Mapping[str, float]) -> float:
    """Computes log-ratio margin between the top two probabilities."""
    sorted_probs = sorted(probabilities.values(), reverse=True)
    if len(sorted_probs) < 2:
        return float("inf") if sorted_probs and sorted_probs[0] > 0.0 else 0.0
    p0, p1 = sorted_probs[0], sorted_probs[1]
    if p0 <= 0.0:
        return 0.0
    return float("inf") if p1 <= 0.0 else math.log(p0 / p1)


def _apply_calibration(
    question: DecisionQuestion, answer: DecisionAnswer, calibration: Calibration
) -> DecisionAnswer:
    """Rescales `answer` by `calibration`, recomputing derived fields.

    The top logit margin is divided by the temperature, and a `SCORE`
    answer's expected level is recomputed from the rescaled levels.
    """
    raw = answer.distribution
    if calibration.temperature == 1.0 or not any(raw.probabilities.values()):
        return answer
    margin = raw.top_logit_margin
    scaled = DecisionDistribution(
        probabilities=calibration.apply(raw.probabilities),
        calibrated=True,
        top_logit_margin=None if margin is None else margin / calibration.temperature,
    )
    return answer_from_distribution(question, scaled)


def _serialize_native_question(question: DecisionQuestion) -> dict[str, Any]:
    """Serializes one `DecisionQuestion` into a native Jev batch request item."""
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


def _extract_native_answer_entry(
    raw_answers: Any, question_id: str, index: int
) -> Mapping[str, Any]:
    """Finds the response object for `question_id` (or `index`) from `raw_answers`."""
    if isinstance(raw_answers, Mapping):
        item = raw_answers.get(question_id)
        return item if isinstance(item, Mapping) else {}
    if not isinstance(raw_answers, list):
        return {}
    for elem in raw_answers:
        if (
            isinstance(elem, Mapping)
            and elem.get("id", elem.get("question_id")) == question_id
        ):
            return elem
    indexed = raw_answers[index] if index < len(raw_answers) else None
    if isinstance(indexed, Mapping) and indexed.get(
        "id", indexed.get("question_id")
    ) in (None, question_id):
        return indexed
    return {}


def _parse_native_question_answer(
    question: DecisionQuestion,
    entry: Mapping[str, Any],
    envelope: Mapping[str, Any],
) -> DecisionAnswer:
    """Builds a `DecisionAnswer` for `question` from a native Jev answer entry."""
    raw_probs = entry.get("probabilities")
    if not isinstance(raw_probs, Mapping) and "yes" in entry:
        p_yes = _safe_nonneg_float(entry["yes"])
        raw_probs = {"yes": p_yes, "no": max(0.0, 1.0 - p_yes)}
    probs_map = raw_probs if isinstance(raw_probs, Mapping) else {}
    candidates = question.candidates()
    probabilities = _normalize_probabilities(probs_map, candidates)
    calibrated = bool(entry.get("calibrated", envelope.get("calibrated", False)))
    raw_margin = entry.get("top_logit_margin", envelope.get("top_logit_margin"))
    top_logit_margin = float(raw_margin) if raw_margin is not None else None
    dist = DecisionDistribution(
        probabilities=probabilities,
        calibrated=calibrated,
        top_logit_margin=top_logit_margin,
    )
    answer = answer_from_distribution(question, dist)
    if question.kind is QuestionKind.SCORE and entry.get("expected") is not None:
        return DecisionAnswer(
            question_id=question.id,
            distribution=answer.distribution,
            expected=float(entry["expected"]),
        )
    return answer


def _build_systemone_state(shared_context: Mapping[str, Any]) -> str:
    """Formats `shared_context` into a non-empty `/v1/systemone` state string."""
    intent = shared_context.get("intent")
    intent_part = f"User intent: {intent}" if intent else None
    ptr_part = _pointers_summary(shared_context, "Payload data fields")
    parts = [p for p in (intent_part, ptr_part) if p]
    if not parts and shared_context:
        parts = [f"{k}: {v}" for k, v in shared_context.items()]
    return ". ".join(parts) if parts else "(no context)"


def _serialize_systemone_choice_criteria(
    question: DecisionQuestion,
) -> dict[str, str]:
    """Builds the candidate->description map for a `/v1/systemone` choice question."""
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


def _serialize_systemone_score_criteria(question: DecisionQuestion) -> list[str]:
    """Serializes level criteria for a `/v1/systemone` score question."""
    if question.option_texts and len(question.option_texts) == len(question.options):
        return [
            f"{lvl}: {txt}" if txt else str(lvl)
            for lvl, txt in zip(question.options, question.option_texts)
        ]
    return [str(lvl) for lvl in question.options]


def _serialize_systemone_question(
    question: DecisionQuestion, *, gemini_decisions: bool = False
) -> dict[str, Any]:
    """Serializes one `DecisionQuestion` into a `/v1/systemone` or `/v1beta/decisions` question spec."""
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
            "criteria": _serialize_systemone_score_criteria(question),
        }
    return {
        "type": "choice",
        "instructions": question.prompt,
        "criteria": _serialize_systemone_choice_criteria(question),
    }


def _parse_systemone_boolean_probs(entry: Mapping[str, Any]) -> dict[str, float]:
    """Extracts `{"yes": p, "no": 1 - p}` from a `/v1/systemone` noul/boolean answer."""
    for key in ("noul", "probability", "yes"):
        if key in entry:
            p_yes = min(1.0, _safe_nonneg_float(entry[key]))
            return {"yes": p_yes, "no": max(0.0, 1.0 - p_yes)}
    raw_probs = entry.get("probabilities")
    if isinstance(raw_probs, Mapping):
        mapped = {
            "yes": raw_probs.get("yes", raw_probs.get("true", 0.0)),
            "no": raw_probs.get("no", raw_probs.get("false", 0.0)),
        }
        return _normalize_probabilities(mapped, ("yes", "no"))
    return {"yes": 0.0, "no": 0.0}


def _parse_systemone_score_probs(
    question: DecisionQuestion, entry: Mapping[str, Any]
) -> dict[str, float]:
    """Extracts level probabilities from a `/v1/systemone` score answer."""
    raw_probs = entry.get("probabilities")
    mapped: dict[str, Any] = {}
    if isinstance(raw_probs, Mapping):
        for idx, level in enumerate(question.options):
            if level in raw_probs:
                mapped[level] = raw_probs[level]
            elif str(idx) in raw_probs:
                mapped[level] = raw_probs[str(idx)]
            elif idx in raw_probs:
                mapped[level] = raw_probs[idx]
    elif isinstance(raw_probs, Sequence) and not isinstance(raw_probs, (str, bytes)):
        for idx, level in enumerate(question.options):
            if idx < len(raw_probs):
                mapped[level] = raw_probs[idx]
    return _normalize_probabilities(mapped, question.options)


def _parse_systemone_question_answer(
    question: DecisionQuestion,
    entry: Mapping[str, Any],
    envelope: Mapping[str, Any],
) -> DecisionAnswer:
    """Builds a `DecisionAnswer` for `question` from a `/v1/systemone` answer entry."""
    if question.kind is QuestionKind.BOOLEAN:
        probabilities = _parse_systemone_boolean_probs(entry)
    elif question.kind is QuestionKind.SCORE:
        probabilities = _parse_systemone_score_probs(question, entry)
    else:
        raw_probs = entry.get("probabilities")
        probs_map = raw_probs if isinstance(raw_probs, Mapping) else {}
        probabilities = _normalize_probabilities(probs_map, question.candidates())

    calibrated = (
        "confidence" in entry
        or "noul" in entry
        or bool(envelope.get("calibrated", True))
    )
    dist = DecisionDistribution(
        probabilities=probabilities,
        calibrated=calibrated,
        top_logit_margin=_probability_margin(probabilities),
    )
    answer = answer_from_distribution(question, dist)
    raw_score = entry.get("score", entry.get("expected"))
    if question.kind is QuestionKind.SCORE and raw_score is not None:
        if sum(answer.distribution.probabilities.values()) <= 0.0:
            return DecisionAnswer(
                question_id=question.id,
                distribution=answer.distribution,
                expected=float(raw_score),
            )
    return answer


def _single_candidate_answer(question: DecisionQuestion) -> DecisionAnswer:
    """Returns a deterministic `DecisionAnswer` for a `< 2` candidate choice."""
    cands = question.candidates()
    probs = {cands[0]: 1.0} if cands else {}
    return DecisionAnswer(
        question_id=question.id,
        distribution=DecisionDistribution(
            probabilities=probs,
            calibrated=True,
            top_logit_margin=float("inf") if probs else 0.0,
        ),
    )


def _extract_systemone_answer_entry(
    answers_map: Mapping[str, Any],
    wire_id: str,
    question_id: str,
    *,
    allow_fallback_q: bool,
) -> Mapping[str, Any]:
    """Resolves a question's answer mapping from a systemone ``answers`` dictionary."""
    raw_entry = answers_map.get(wire_id)
    if not isinstance(raw_entry, Mapping) and wire_id != question_id:
        raw_entry = answers_map.get(question_id)
    if isinstance(raw_entry, Mapping):
        return raw_entry
    if allow_fallback_q:
        fallback_q = answers_map.get("q")
        if isinstance(fallback_q, Mapping):
            return fallback_q
    return {}


class JevHttpBackend(_HttpClientOwner):
    """HTTP backend for Jev and Gemini Decisions endpoints (native, ``/v1/systemone``, or ``/v1beta/decisions``).

    Sends a whole batch in one request. Supports `async with` to close the
    owned HTTP client on exit. ADC access tokens (``auth="adc"``) are cached
    per instance for 30 minutes.
    """

    def __init__(
        self,
        endpoint_url: str,
        *,
        wire_format: DecisionWireFormat | str = DecisionWireFormat.AUTO,
        model: str = "default",
        auth: AuthSpec = None,
        headers: Mapping[str, str] | None = None,
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        calibration: Calibration | Path | None = None,
    ) -> None:
        """Creates a Jev or Gemini Decisions HTTP backend.

        Args:
            endpoint_url: The native Jev endpoint, a ``/v1/systemone`` URL, or
                a ``/v1beta/decisions`` URL.
            wire_format: Request format; `AUTO` picks Gemini Decisions when
                the URL ends in ``/v1beta/decisions``, SystemOne when it ends
                in ``/v1/systemone``, and Jev otherwise.
            model: Model id sent on ``/v1/systemone`` or ``/v1beta/decisions``
                requests. The Vercel gateway's ``"default"`` maps to its
                ``"jev"`` model, and ``/v1beta/decisions`` ``"default"`` maps
                to `DEFAULT_GEMINI_DECISION_MODEL`.
            auth: ``"adc"``, a bearer token or API key, or a callable
                returning one.
            headers: Extra request headers.
            client: Caller-owned HTTP client; when omitted the backend owns
                one per event loop.
            timeout_seconds: Deadline for each request, and for fetching an
                ADC token with ``gcloud``.
            calibration: A `Calibration`, a profile file to load it from, or
                None for the bundled profile of ``<backend_kind>/<model>``.
        """
        self._endpoint_url = endpoint_url
        self._wire_format = str(getattr(wire_format, "value", wire_format))
        if self._is_gemini_decisions():
            if model == "default":
                model = DEFAULT_GEMINI_DECISION_MODEL
            self.backend_kind = DecisionBackendType.GEMINI.value
        else:
            if "ai-gateway.vercel.sh/typesafe" in endpoint_url.lower() and (
                model == "default"
            ):
                model = _DEFAULT_VERCEL_TYPESAFE_MODEL
            self.backend_kind = DecisionBackendType.JEV.value
        self.model_id = model
        self.capabilities = BackendCapabilities()
        self.calibration = _resolve_calibration(
            calibration, backend_kind=self.backend_kind, model_id=model
        )
        self._auth = auth
        self._headers = dict(headers) if headers else None
        self._init_http_client(client, timeout_seconds)
        self._adc_token: str | None = None
        self._adc_expires_at: float = 0.0
        self._adc_lock = threading.Lock()
        self._last_call_latency_ms: float | None = None

    @property
    def last_call_latency_ms(self) -> float | None:
        """Server-reported execution latency (in ms) from the last request, if any."""
        return self._last_call_latency_ms

    def _record_server_latency(self, data: Mapping[str, Any]) -> None:
        """Records server-reported `ms` or `model_ms` from `data` when present."""
        raw_ms = data.get("ms", data.get("model_ms"))
        val = _safe_nonneg_float(raw_ms) if raw_ms is not None else 0.0
        self._last_call_latency_ms = val if val > 0.0 else None

    @property
    def endpoint_url(self) -> str:
        """The HTTP endpoint URL queried by this backend."""
        return self._endpoint_url

    @property
    def model(self) -> str:
        """The decision model identifier; the same as `model_id`."""
        return self.model_id

    def _is_systemone(self) -> bool:
        """Returns whether this backend uses the /v1/systemone wire format."""
        return self._wire_format == "systemone" or (
            self._wire_format == "auto"
            and self._endpoint_url.rstrip("/").endswith("/v1/systemone")
        )

    def _is_gemini_decisions(self) -> bool:
        """Returns whether this backend uses the Google Gemini Decisions API wire format."""
        return self._wire_format == DecisionWireFormat.GEMINI_DECISIONS.value or (
            self._wire_format == "auto"
            and self._endpoint_url.rstrip("/").endswith("/v1beta/decisions")
        )

    def _refresh_adc_token_sync(self) -> str | None:
        """Refreshes the cached ADC token under a thread lock."""
        with self._adc_lock:
            now = time.time()
            if self._adc_token and now < self._adc_expires_at:
                return self._adc_token
            token = _get_adc_token_sync(self._timeout_seconds)
            if token:
                self._adc_token = token
                self._adc_expires_at = now + _ADC_TOKEN_TTL_SECONDS
                return token
            return None

    async def _resolve_adc_token(self) -> str | None:
        """Returns this instance's cached ADC token, refreshing it when expired."""
        now = time.time()
        if self._adc_token and now < self._adc_expires_at:
            return self._adc_token
        return await asyncio.to_thread(self._refresh_adc_token_sync)

    async def _resolve_auth_token(self) -> str | None:
        """Resolves bearer token string from the configured auth argument."""
        auth_target = self._auth
        if auth_target is None:
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
        """Constructs headers including Bearer or x-goog-api-key authentication."""
        headers = dict(self._headers or {})
        token = await self._resolve_auth_token()
        if not token:
            return headers
        lower_keys = {k.lower() for k in headers}
        if self._is_gemini_decisions() and self._auth != "adc":
            if "x-goog-api-key" not in lower_keys and "authorization" not in lower_keys:
                headers["x-goog-api-key"] = token
        elif "authorization" not in lower_keys:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def _answer_systemone(
        self, batch: DecisionBatch
    ) -> tuple[DecisionAnswer, ...]:
        """Sends `batch` as one `/v1/systemone` or `/v1beta/decisions` request, short-circuiting 1-option choices."""
        is_gemini = self._is_gemini_decisions()
        wire_questions: dict[str, dict[str, Any]] = {}
        wire_id_by_index: dict[int, str] = {}
        for idx, q in enumerate(batch.questions):
            if q.kind is QuestionKind.CHOICE and len(q.candidates()) < 2:
                continue
            wire_id = f"q_{idx}" if is_gemini else q.id
            wire_id_by_index[idx] = wire_id
            wire_questions[wire_id] = _serialize_systemone_question(
                q, gemini_decisions=is_gemini
            )
        self._last_call_latency_ms = None
        data: Mapping[str, Any] = {}
        if wire_questions:
            context_key = "input" if is_gemini else "state"
            payload = {
                "model": self.model_id,
                context_key: _build_systemone_state(batch.shared_context),
                "questions": wire_questions,
            }
            data = await self._post(
                self._endpoint_url, payload, await self._build_headers()
            )
            self._record_server_latency(data)
        raw_answers = data.get("answers", {})
        answers_map = raw_answers if isinstance(raw_answers, Mapping) else {}
        allow_fallback_q = len(batch.questions) == 1
        results: list[DecisionAnswer] = []
        for idx, q in enumerate(batch.questions):
            if q.kind is QuestionKind.CHOICE and len(q.candidates()) < 2:
                results.append(_single_candidate_answer(q))
                continue
            entry = _extract_systemone_answer_entry(
                answers_map,
                wire_id_by_index[idx],
                q.id,
                allow_fallback_q=allow_fallback_q,
            )
            answer = _parse_systemone_question_answer(q, entry, data)
            results.append(_apply_calibration(q, answer, self.calibration))
        return tuple(results)

    async def _answer_native(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Sends `batch` as one native Jev request."""
        self._last_call_latency_ms = None
        payload: dict[str, Any] = {
            "shared_context": dict(batch.shared_context),
            "questions": [_serialize_native_question(q) for q in batch.questions],
        }
        data = await self._post(
            self._endpoint_url, payload, await self._build_headers()
        )
        self._record_server_latency(data)
        raw_answers = data.get("answers", data.get("questions", ()))
        return tuple(
            _apply_calibration(
                q,
                _parse_native_question_answer(
                    q, _extract_native_answer_entry(raw_answers, q.id, idx), data
                ),
                self.calibration,
            )
            for idx, q in enumerate(batch.questions)
        )

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Sends `batch` as one request in the configured wire format.

        Raises:
            DecisionBackendError: On a timeout, transport, or HTTP error.
        """
        if not batch.questions:
            return ()
        if self._is_systemone() or self._is_gemini_decisions():
            return await self._answer_systemone(batch)
        return await self._answer_native(batch)


class StepZeroLogprobBackend(_HttpClientOwner):
    """OpenAI-compatible step-0 top-logprob decision backend.

    Scores each question with its own one-token completion, sharing a prompt
    prefix so servers with prefix caching reuse it. Because each question
    costs a request, `capabilities.two_stage` is True. Supports `async with`
    to close the owned HTTP client on exit.
    """

    def __init__(
        self,
        endpoint_url: str,
        model: str,
        *,
        max_logprobs: int = 20,
        auth: AuthSpec = None,
        client: httpx.AsyncClient | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        calibration: Calibration | Path | None = None,
    ) -> None:
        """Creates a step-0 backend.

        Args:
            endpoint_url: A ``/v1/completions`` or ``/chat/completions`` URL.
            model: The model id sent on every request.
            max_logprobs: Most top logprobs requested per completion, 1 to 20.
            auth: ``"adc"``, a bearer token, or a callable returning one.
            client: Caller-owned HTTP client; when omitted the backend owns
                one per event loop.
            timeout_seconds: Deadline for each request, and for fetching an
                ADC token with ``gcloud``.
            calibration: A `Calibration`, a profile file to load it from, or
                None for the bundled profile of ``step0/<model>``.

        Raises:
            ValueError: If `max_logprobs` is outside [1, 20].
        """
        if not (1 <= max_logprobs <= 20):
            raise ValueError(f"max_logprobs must be in [1, 20], got {max_logprobs}")
        self._endpoint_url = endpoint_url
        self.backend_kind = DecisionBackendType.STEP_ZERO.value
        self.model_id = model
        self.capabilities = BackendCapabilities(two_stage=True)
        self.calibration = _resolve_calibration(
            calibration, backend_kind=self.backend_kind, model_id=model
        )
        self._max_logprobs = int(max_logprobs)
        self._auth = auth
        self._init_http_client(client, timeout_seconds)

    async def _build_headers(self) -> dict[str, str] | None:
        """Builds optional Bearer authorization headers."""
        if self._auth is None:
            return None
        raw = self._auth() if callable(self._auth) else self._auth
        if asyncio.iscoroutine(raw):
            raw = await raw
        if raw == "adc":
            raw = await asyncio.to_thread(_get_adc_token_sync, self._timeout_seconds)
        token = str(raw).strip() if raw else ""
        return {"Authorization": f"Bearer {token}"} if token else None

    def _completion_payload(self, prompt: str, num_logprobs: int) -> dict[str, Any]:
        """Builds a one-token completion request for the configured endpoint."""
        endpoint_path = (
            urllib.parse.urlsplit(self._endpoint_url).path.rstrip("/").lower()
        )
        if not endpoint_path.endswith("/chat/completions"):
            return {
                "model": self.model_id,
                "prompt": prompt,
                "max_tokens": 1,
                "temperature": 0.0,
                "logprobs": num_logprobs,
            }
        return {
            "model": self.model_id,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Reply with ONLY the single uppercase letter (A-J)"
                        " of the best candidate."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "max_tokens": 1,
            "temperature": 0.0,
            "logprobs": True,
            "top_logprobs": num_logprobs,
        }

    async def _score_question(
        self,
        question: DecisionQuestion,
        shared_context: Mapping[str, Any],
        headers: dict[str, str] | None,
    ) -> DecisionAnswer:
        """Scores one question from step-0 logprobs over ``A``-``J`` labels."""
        candidates = question.candidates()
        temperature = self.calibration.temperature
        calibrated = temperature != 1.0
        if not candidates:
            empty = DecisionDistribution(
                probabilities={}, calibrated=calibrated, top_logit_margin=0.0
            )
            return answer_from_distribution(question, empty)
        prompt = _format_step_zero_prompt(
            question,
            _question_context(question, shared_context),
            shared_prefix=f"Shared context: {dict(shared_context)}",
        )
        num_logprobs = min(max(len(candidates), 5), self._max_logprobs)
        data = await self._post(
            self._endpoint_url, self._completion_payload(prompt, num_logprobs), headers
        )
        matched = _match_step_zero_logprobs(candidates, _extract_top_logprobs(data))
        default_floor = (min(matched.values()) - 10.0) if matched else -20.0
        logits = {c: matched.get(c, default_floor) for c in candidates}
        probabilities, top_logit_margin = _softmax_with_margin(
            logits, candidates, temperature=temperature
        )
        dist = DecisionDistribution(
            probabilities=probabilities,
            calibrated=calibrated,
            top_logit_margin=top_logit_margin,
        )
        return answer_from_distribution(question, dist)

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Scores every question concurrently with a shared prompt prefix.

        Raises:
            A2uiValidationError: If a question has more than ten candidates.
            DecisionBackendError: On a timeout, transport, or HTTP error.
        """
        if not batch.questions:
            return ()
        for question in batch.questions:
            _validate_step_zero_candidates(question.candidates())
        headers = await self._build_headers()
        return tuple(
            await asyncio.gather(*(
                self._score_question(q, batch.shared_context, headers)
                for q in batch.questions
            ))
        )


def _choice_option_probabilities(
    chosen: str, probability: float, candidates: tuple[str, ...]
) -> dict[str, float]:
    """Assigns `probability` to `chosen` and distributes the remainder evenly."""
    if chosen not in candidates:
        raise ValueError(f"Scripted option {chosen!r} is not among {candidates}.")
    others = [c for c in candidates if c != chosen]
    if not others:
        return {chosen: 1.0}
    rest = max(0.0, 1.0 - probability) / len(others)
    return {c: probability if c == chosen else rest for c in candidates}


def _score_expected_probabilities(
    expected: float, levels: tuple[str, ...]
) -> dict[str, float]:
    """Constructs a level distribution whose expected index equals `expected`."""
    top = len(levels) - 1
    clamped = min(max(expected, 0.0), float(top))
    low = min(int(math.floor(clamped)), top)
    high = min(low + 1, top)
    weight_high = clamped - low
    probs = {level: 0.0 for level in levels}
    probs[levels[low]] += 1.0 - weight_high
    probs[levels[high]] += weight_high
    return probs


class DeterministicMockBackend(_AsyncClosable):
    """Deterministic offline decision backend for tests and local evaluation.

    Answers come from, in order: `scripted_answers` by question id, the
    `scorer` callback, `scripted` distributions, and a keyword heuristic.
    Every batch answered is appended to `batches`.
    """

    def __init__(
        self,
        scripted: Mapping[str, Mapping[str, float]] | None = None,
        *,
        scripted_answers: Mapping[str, ScriptedAnswerSpec] | None = None,
        scorer: Callable[[DecisionQuestion], DecisionDistribution] | None = None,
        calibrated: bool = True,
        default_logit_margin: float = 2.5,
        capabilities: BackendCapabilities | None = None,
        model_id: str = "mock",
    ) -> None:
        """Creates a mock backend.

        Args:
            scripted: Distributions keyed by question id, by task, or by
                ``"<task>:<prompt>"``.
            scripted_answers: Answers keyed by question id: a
                `DecisionAnswer`; a chosen option (probability 0.9); an
                ``(option, probability)`` pair; a full distribution; or a
                number, which is a boolean's yes probability or a score's
                expected level.
            scorer: Callback that returns the distribution for a question.
            calibrated: The `calibrated` flag on every distribution.
            default_logit_margin: The top logit margin on every distribution.
            capabilities: Capabilities to report; defaults to one-call
                batching.
            model_id: The model id to report.
        """
        self._scripted: dict[str, dict[str, float]] = (
            {k: dict(v) for k, v in scripted.items()} if scripted else {}
        )
        self._scripted_answers: dict[str, ScriptedAnswerSpec] = (
            dict(scripted_answers) if scripted_answers else {}
        )
        self._scorer = scorer
        self._calibrated = calibrated
        self._default_logit_margin = float(default_logit_margin)
        self.backend_kind = DecisionBackendType.MOCK.value
        self.model_id = model_id
        self.capabilities = capabilities or BackendCapabilities()
        self.batches: list[DecisionBatch] = []

    def _distribution(self, probabilities: Mapping[str, float]) -> DecisionDistribution:
        return DecisionDistribution(
            probabilities=dict(probabilities),
            calibrated=self._calibrated,
            top_logit_margin=self._default_logit_margin,
        )

    def _lookup_scripted_entry(
        self, question: DecisionQuestion
    ) -> dict[str, float] | None:
        """Finds a matching probability dict in `self._scripted`, if any."""
        task = question.task
        for key in (question.id, f"{task}:{question.prompt}", str(task)):
            if key in self._scripted:
                return self._scripted[key]
        return None

    def _scripted_probabilities(
        self,
        question: DecisionQuestion,
        spec: float | str | tuple[str, float] | Mapping[str, float],
    ) -> dict[str, float]:
        """Converts a non-`DecisionAnswer` scripted spec into probabilities."""
        candidates = question.candidates()
        if isinstance(spec, Mapping):
            return _normalize_probabilities(spec, candidates)
        if isinstance(spec, tuple):
            return _choice_option_probabilities(
                str(spec[0]), float(spec[1]), candidates
            )
        if isinstance(spec, str):
            return _choice_option_probabilities(spec, 0.9, candidates)
        if question.kind is QuestionKind.BOOLEAN:
            p_yes = min(max(float(spec), 0.0), 1.0)
            return {"yes": p_yes, "no": 1.0 - p_yes}
        if question.kind is QuestionKind.SCORE:
            return _score_expected_probabilities(float(spec), question.options)
        raise ValueError(
            f"Numeric scripted_answers value {spec!r} requires boolean or"
            f" score question, got {question.kind}."
        )

    def _answer_question(
        self, question: DecisionQuestion, shared_context: Mapping[str, Any]
    ) -> DecisionAnswer:
        """Answers one question; see the class docstring for the precedence."""
        spec = self._scripted_answers.get(question.id)
        if isinstance(spec, DecisionAnswer):
            return spec
        if spec is not None:
            probs = self._scripted_probabilities(question, spec)
            return answer_from_distribution(question, self._distribution(probs))
        if self._scorer is not None:
            return answer_from_distribution(question, self._scorer(question))
        scripted_entry = self._lookup_scripted_entry(question)
        if scripted_entry is not None:
            probs = _normalize_probabilities(scripted_entry, question.candidates())
            return answer_from_distribution(question, self._distribution(probs))
        return self._heuristic_answer(question, shared_context)

    def _heuristic_answer(
        self, question: DecisionQuestion, shared_context: Mapping[str, Any]
    ) -> DecisionAnswer:
        """Computes a deterministic fallback answer for an unscripted question."""
        if question.kind is QuestionKind.BOOLEAN:
            return _boolean_answer(
                question, self._distribution({"yes": 0.5, "no": 0.5})
            )
        if question.kind is QuestionKind.SCORE:
            midpoint = (len(question.options) - 1) / 2.0
            probs = _score_expected_probabilities(midpoint, question.options)
            return _score_answer(question, self._distribution(probs))
        context = _question_context(question, shared_context)
        probs = self._heuristic_probabilities(
            question.prompt, question.candidates(), context
        )
        return answer_from_distribution(question, self._distribution(probs))

    def _heuristic_probabilities(
        self, prompt: str, candidates: tuple[str, ...], context: Mapping[str, Any]
    ) -> dict[str, float]:
        """Scores candidates by keyword overlap with the prompt and context."""
        if len(candidates) <= 1:
            return {c: 1.0 for c in candidates}
        prompt_lower = prompt.lower()
        prompt_tokens = _tokenize(prompt)
        context_tokens = _extract_context_tokens(context)
        n = len(candidates)
        raw_scores = [
            (
                candidate,
                _score_candidate(candidate, prompt_lower, prompt_tokens, context_tokens)
                + (n - idx) * 0.01,
            )
            for idx, candidate in enumerate(candidates)
        ]
        best_candidate, _ = max(raw_scores, key=lambda item: item[1])
        weights = {
            candidate: (
                9.0 * (1.0 + score)
                if candidate == best_candidate
                else (1.0 + score * 0.1) / (n - 1)
            )
            for candidate, score in raw_scores
        }
        return _normalize_probabilities(weights, candidates)

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Records `batch` on `batches` and answers every question in order."""
        self.batches.append(batch)
        return tuple(
            self._answer_question(q, batch.shared_context) for q in batch.questions
        )


@dataclass(frozen=True)
class _BackendSettings:
    """Resolved arguments and environment for `create_decision_backend`."""

    kind: str
    url: str | None
    model: str | None
    auth: AuthSpec
    vendor_key: str | None
    calibration: Calibration | Path | None
    timeout_seconds: float


def _require_url(kind: str, url: str | None) -> str:
    """Returns `url`, or raises a ValueError naming the backend that needs it."""
    if not url:
        raise ValueError(
            f"{kind} backend requires an endpoint URL (pass endpoint_url or set"
            " A2UI_DECISION_URL)"
        )
    return url


def _default_jev_url_and_model(vendor_key: str | None) -> tuple[str | None, str]:
    """Resolves the hosted `/v1/systemone` URL and pinned model for a vendor key.

    Keys starting with ``vcp_`` select the Vercel gateway; other keys select
    TypeSafe with `DEFAULT_TYPESAFE_MODEL`. ``JEV_MODEL`` overrides the model.
    """
    jev_model = os.environ.get("JEV_MODEL")
    token = vendor_key.strip() if vendor_key else ""
    if not token or token == "adc":
        return None, jev_model or "default"
    if token.startswith("vcp_"):
        return (
            _DEFAULT_VERCEL_TYPESAFE_SYSTEMONE_URL,
            jev_model or _DEFAULT_VERCEL_TYPESAFE_MODEL,
        )
    return _DEFAULT_TYPESAFE_SYSTEMONE_URL, jev_model or DEFAULT_TYPESAFE_MODEL


def _create_jev_backend(settings: _BackendSettings) -> JevHttpBackend:
    """Creates a `JevHttpBackend` configured for Jev, SystemOne, or Gemini Decisions."""
    default_url, default_model = _default_jev_url_and_model(settings.vendor_key)
    endpoint = _require_url(settings.kind, settings.url or default_url)
    if endpoint.rstrip("/").endswith("/v1beta/decisions"):
        return JevHttpBackend(
            endpoint,
            wire_format=DecisionWireFormat.GEMINI_DECISIONS,
            model=settings.model or DEFAULT_GEMINI_DECISION_MODEL,
            auth=settings.auth,
            timeout_seconds=settings.timeout_seconds,
            calibration=settings.calibration,
        )
    systemone = settings.kind == DecisionBackendType.SYSTEMONE.value or (
        endpoint.rstrip("/").endswith("/v1/systemone")
    )
    return JevHttpBackend(
        endpoint,
        wire_format=(
            DecisionWireFormat.SYSTEMONE if systemone else DecisionWireFormat.JEV
        ),
        model=settings.model or (default_model if systemone else "default"),
        auth=settings.auth,
        timeout_seconds=settings.timeout_seconds,
        calibration=settings.calibration,
    )


def _create_gemini_backend(settings: _BackendSettings) -> JevHttpBackend:
    """Creates a `JevHttpBackend` configured for the Gemini Decisions API."""
    default_url = _DEFAULT_GEMINI_DECISIONS_URL if settings.vendor_key else None
    default_model = (
        os.environ.get("GEMINI_DECISION_MODEL") or DEFAULT_GEMINI_DECISION_MODEL
    )
    endpoint = _require_url(settings.kind, settings.url or default_url)
    return JevHttpBackend(
        endpoint,
        wire_format=DecisionWireFormat.GEMINI_DECISIONS,
        model=settings.model or default_model,
        auth=settings.auth,
        timeout_seconds=settings.timeout_seconds,
        calibration=settings.calibration,
    )


def _create_step_zero_backend(settings: _BackendSettings) -> StepZeroLogprobBackend:
    """Creates a `StepZeroLogprobBackend` from resolved backend settings."""
    endpoint = _require_url(DecisionBackendType.STEP_ZERO.value, settings.url)
    return StepZeroLogprobBackend(
        endpoint,
        model=settings.model or "default",
        auth=settings.auth,
        timeout_seconds=settings.timeout_seconds,
        calibration=settings.calibration,
    )


def _create_mock_backend(settings: _BackendSettings) -> DeterministicMockBackend:
    """Creates a default `DeterministicMockBackend`."""
    del settings  # The mock takes no configuration from the factory.
    return DeterministicMockBackend()


_BACKEND_BUILDERS: dict[str, Callable[[_BackendSettings], DecisionBackend]] = {
    DecisionBackendType.SYSTEMONE.value: _create_jev_backend,
    DecisionBackendType.JEV.value: _create_jev_backend,
    DecisionBackendType.GEMINI.value: _create_gemini_backend,
    DecisionBackendType.STEP_ZERO.value: _create_step_zero_backend,
    DecisionBackendType.MOCK.value: _create_mock_backend,
}


def _backend_choices() -> str:
    """Returns a comma-separated string of supported backend kind names."""
    return ", ".join(f"'{k}'" for k in _BACKEND_BUILDERS)


def create_decision_backend(
    kind: str | DecisionBackendType | None = None,
    *,
    endpoint_url: str | None = None,
    model: str | None = None,
    auth: AuthSpec = None,
    calibration: Calibration | Path | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> DecisionBackend:
    """Creates a `DecisionBackend` from explicit arguments or the environment.

    There is no default backend: the kind must be passed or set in
    ``A2UI_DECISION_BACKEND``. The mock backend is used only when asked for.

    Args:
        kind: A `DecisionBackendType` or its string value. When omitted, read
            from ``A2UI_DECISION_BACKEND``.
        endpoint_url: Endpoint for the HTTP backends.
        model: Model identifier for remote backends.
        auth: ``"adc"``, a bearer token or API key, or a callable returning one.
        calibration: A `Calibration`, a profile file, or None for the bundled
            profile of the backend's kind and model.
        timeout_seconds: Deadline for each backend request.

    Environment variables:
        A2UI_DECISION_BACKEND: 'systemone', 'jev', 'gemini', 'step0', or 'mock'.
        A2UI_DECISION_URL: Endpoint URL for HTTP backends.
        A2UI_DECISION_MODEL: Model identifier for remote backends.
        A2UI_DECISION_AUTH: 'adc' or a bearer token / API key.
        JEV_API_KEY / TYPESAFE_API_KEY: API key for hosted Jev
            (``/v1/systemone``); selects the hosted URL and pinned model.
        JEV_MODEL: Overrides the hosted Jev model id.
        GEMINI_API_KEY / GOOGLE_API_KEY: API key for the Google Gemini
            Decisions API (``/v1beta/decisions``); selects the public URL and
            pinned `DEFAULT_GEMINI_DECISION_MODEL`.
        GEMINI_DECISION_MODEL: Overrides the Gemini Decisions model id.

    Raises:
        ValueError: If no kind is configured, the kind is unknown, or the
            backend needs a URL that is missing.
    """
    raw_kind = kind or os.environ.get("A2UI_DECISION_BACKEND")
    normalized = _normalize_backend_kind(raw_kind)
    if normalized is None:
        raise ValueError(
            "No decision backend is configured. Pass kind to"
            " create_decision_backend or set A2UI_DECISION_BACKEND to one of"
            f" {_backend_choices()}."
        )
    builder = _BACKEND_BUILDERS.get(normalized)
    if builder is None:
        raise ValueError(
            f"Unknown decision backend type '{raw_kind}'. Choose from:"
            f" {_backend_choices()}."
        )
    if normalized == DecisionBackendType.GEMINI.value:
        vendor_key = os.environ.get("GEMINI_API_KEY") or os.environ.get(
            "GOOGLE_API_KEY"
        )
    else:
        vendor_key = os.environ.get("JEV_API_KEY") or os.environ.get("TYPESAFE_API_KEY")
    settings = _BackendSettings(
        kind=normalized,
        url=endpoint_url or os.environ.get("A2UI_DECISION_URL"),
        model=model or os.environ.get("A2UI_DECISION_MODEL"),
        auth=(
            auth
            or os.environ.get("A2UI_DECISION_AUTH")
            or os.environ.get("A2UI_DECISION_TOKEN")
            or vendor_key
        ),
        vendor_key=vendor_key,
        calibration=calibration,
        timeout_seconds=timeout_seconds,
    )
    return builder(settings)


def _normalize_backend_kind(raw_kind: str | DecisionBackendType | None) -> str | None:
    """Lower-cases a backend kind given as a string or enum; None stays None."""
    if not raw_kind:
        return None
    return str(getattr(raw_kind, "value", raw_kind)).strip().lower() or None


__all__ = [
    "DEFAULT_GEMINI_DECISION_MODEL",
    "DEFAULT_TIMEOUT_SECONDS",
    "DEFAULT_TYPESAFE_MODEL",
    "BackendCapabilities",
    "Calibration",
    "DecisionBackend",
    "DeterministicMockBackend",
    "JevHttpBackend",
    "StepZeroLogprobBackend",
    "answer_from_distribution",
    "create_decision_backend",
]
