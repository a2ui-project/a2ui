# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Named-predicate agent functions backed by a `DecisionBackend`.

Exposes server-owned boolean predicates over A2UI v1.0 `callAgentFunction`
without opening an arbitrary prompt proxy to untrusted renderers: question
prompts stay on the server, client input is bounded by `maxLength`, rate
limits key on a transport-verified `session_id` rather than client-supplied
`surfaceId`, and backend errors map to a scrubbed message.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
import logging
import math
import threading
import time
from typing import Any

from a2ui.core import (
    A2uiCatalogError,
    A2uiRpcError,
    AgentFunction,
    AgentFunctionContext,
    RpcErrorCode,
    is_valid_uax31_identifier,
)
from a2ui.inference_formats.experimental.decision import (
    DecisionBackend,
    DecisionBackendError,
    DecisionBatch,
    DecisionQuestion,
    QuestionKind,
)
from a2ui.utils._experimental import experimental

logger = logging.getLogger(__name__)

_FORBIDDEN_GENERIC_NAMES = frozenset({"judge", "classify"})
_GENERIC_PREDICATE_ERROR_MESSAGE = "Decision predicate evaluation failed."
_RATE_LIMIT_ERROR_CODE = "RATE_LIMITED"
_RATE_LIMIT_ERROR_MESSAGE = "Decision predicate rate limit exceeded."
_YES_PROBABILITY_THRESHOLD = 0.5


def _validate_non_empty_str(field_name: str, value: Any) -> str:
    """Returns `value` when it is a non-blank string, else raises `ValueError`."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")
    return value


def _validate_positive_int(field_name: str, value: Any) -> int:
    """Returns `value` when it is a positive int (not bool), else raises `ValueError`."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{field_name} must be a positive integer, got {value!r}.")
    return value


def _validate_positive_finite_float(field_name: str, value: Any) -> float:
    """Returns `float(value)` when finite and positive, else raises `ValueError`."""
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value <= 0.0
    ):
        raise ValueError(
            f"{field_name} must be a finite positive number, got {value!r}."
        )
    return float(value)


@experimental
@dataclass(frozen=True)
class NamedPredicateSpec:
    """Server-owned boolean decision predicate exposed as an `AgentFunction`.

    Attributes:
        name: Catalog function identifier (valid UAX #31 identifier, excluding
            generic proxy names such as ``"judge"`` and ``"classify"``).
        question_prompt: Server-owned boolean rubric evaluated by the decision
            backend; never supplied or overridden by the renderer.
        max_input_length: Maximum Unicode code-point length permitted on the
            renderer-supplied ``value`` string.
        timeout_seconds: Per-call deadline enforced via ``asyncio.wait_for`` and
            forwarded to ``DecisionBackend.answer``.
    """

    name: str
    question_prompt: str
    max_input_length: int = 2_000
    timeout_seconds: float = 5.0

    def __post_init__(self) -> None:
        _validate_non_empty_str("NamedPredicateSpec.name", self.name)
        if not is_valid_uax31_identifier(self.name):
            raise ValueError(
                f"NamedPredicateSpec.name {self.name!r} must be a valid"
                " UAX #31 identifier."
            )
        if self.name in _FORBIDDEN_GENERIC_NAMES:
            raise ValueError(
                f"Generic predicate name {self.name!r} is forbidden; register"
                " a domain-specific server-owned predicate instead."
            )
        _validate_non_empty_str(
            "NamedPredicateSpec.question_prompt", self.question_prompt
        )
        _validate_positive_int(
            "NamedPredicateSpec.max_input_length", self.max_input_length
        )
        normalized_timeout = _validate_positive_finite_float(
            "NamedPredicateSpec.timeout_seconds", self.timeout_seconds
        )
        object.__setattr__(self, "timeout_seconds", normalized_timeout)


class _SlidingWindowLimiter:
    """Thread-safe sliding-window call limiter keyed by verified `session_id`."""

    def __init__(
        self,
        max_calls: int = 10,
        window_seconds: float = 60.0,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_sessions: int = 4_096,
    ) -> None:
        self._max_calls = _validate_positive_int("max_calls", max_calls)
        self._window_seconds = _validate_positive_finite_float(
            "window_seconds", window_seconds
        )
        self._max_sessions = _validate_positive_int("max_sessions", max_sessions)
        if not callable(clock):
            raise TypeError("clock must be callable.")
        self._clock = clock
        self._buckets: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    @property
    def max_calls(self) -> int:
        """Maximum calls permitted per session within `window_seconds`."""
        return self._max_calls

    @property
    def window_seconds(self) -> float:
        """Sliding-window duration in seconds."""
        return self._window_seconds

    def _evict_stale_or_oldest(self, cutoff: float) -> None:
        """Bounds tracked session count by sweeping expired buckets then LRU."""
        stale = [
            sid
            for sid, bucket in self._buckets.items()
            if not bucket or bucket[-1] <= cutoff
        ]
        for sid in stale:
            del self._buckets[sid]
        while len(self._buckets) >= self._max_sessions:
            self._buckets.popitem(last=False)

    def try_acquire(self, session_id: str) -> bool:
        """Records one call for `session_id` if within quota, returning True."""
        _validate_non_empty_str("session_id", session_id)
        with self._lock:
            now = float(self._clock())
            cutoff = now - self._window_seconds
            bucket = self._buckets.get(session_id)
            if bucket is None:
                self._evict_stale_or_oldest(cutoff)
                bucket = deque()
                self._buckets[session_id] = bucket
            else:
                self._buckets.move_to_end(session_id)
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self._max_calls:
                return False
            bucket.append(now)
            return True

    def acquire(self, session_id: str) -> None:
        """Records one call for `session_id` or raises `A2uiRpcError`."""
        if not self.try_acquire(session_id):
            raise A2uiRpcError(_RATE_LIMIT_ERROR_MESSAGE, code=_RATE_LIMIT_ERROR_CODE)

    def reset(self, session_id: str | None = None) -> None:
        """Clears recorded call history for `session_id`, or all sessions."""
        with self._lock:
            if session_id is None:
                self._buckets.clear()
            else:
                self._buckets.pop(session_id, None)


@experimental
class SessionRateLimiter(_SlidingWindowLimiter):
    """Per-session sliding-window rate limiter for decision agent functions.

    Share one instance across per-request calls to
    `build_predicate_agent_functions` so call counts persist across turns for
    each transport-verified `session_id`.
    """


def _extract_validated_value(args: Mapping[str, Any], spec: NamedPredicateSpec) -> str:
    """Validates `args` directly as defense-in-depth when `invoke` is called."""
    if not isinstance(args, Mapping) or set(args.keys()) != {"value"}:
        raise A2uiRpcError(
            f"Function '{spec.name}' accepts only the 'value' string argument.",
            code=RpcErrorCode.INVALID_FUNCTION_CALL,
        )
    value = args["value"]
    if not isinstance(value, str):
        raise A2uiRpcError(
            f"Argument 'value' for '{spec.name}' must be a string.",
            code=RpcErrorCode.INVALID_FUNCTION_CALL,
        )
    if len(value) > spec.max_input_length:
        raise A2uiRpcError(
            f"Argument 'value' for '{spec.name}' exceeds maxLength"
            f" ({spec.max_input_length}).",
            code=RpcErrorCode.INVALID_FUNCTION_CALL,
        )
    return value


def _build_single_predicate_function(
    backend: DecisionBackend,
    spec: NamedPredicateSpec,
    *,
    session_id: str,
    limiter: _SlidingWindowLimiter,
) -> AgentFunction:
    """Constructs one session-bound `AgentFunction` for `spec`."""
    question = DecisionQuestion(
        id=f"predicate:{spec.name}",
        kind=QuestionKind.BOOLEAN,
        prompt=spec.question_prompt,
    )
    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "value": {
                "type": "string",
                "maxLength": spec.max_input_length,
            },
        },
        "required": ["value"],
        "additionalProperties": False,
    }

    async def _handle(
        args: dict[str, Any], context: AgentFunctionContext | None = None
    ) -> bool:
        # Rate limiting intentionally ignores client-supplied `context.surface_id`
        # and keys strictly on the transport-verified `session_id`.
        del context
        value = _extract_validated_value(args, spec)
        limiter.acquire(session_id)
        batch = DecisionBatch(state=value, questions=(question,))
        try:
            answers = await asyncio.wait_for(
                backend.answer(batch, timeout_seconds=spec.timeout_seconds),
                timeout=spec.timeout_seconds,
            )
        except Exception as exc:
            logger.warning(
                "Decision predicate '%s' failed for session '%s'.",
                spec.name,
                session_id,
                exc_info=exc,
            )
            raise A2uiRpcError(
                _GENERIC_PREDICATE_ERROR_MESSAGE,
                code=RpcErrorCode.EXECUTION_ERROR,
            ) from None
        if not answers:
            logger.warning(
                "Decision backend returned no answers for predicate '%s'.",
                spec.name,
            )
            raise A2uiRpcError(
                _GENERIC_PREDICATE_ERROR_MESSAGE,
                code=RpcErrorCode.EXECUTION_ERROR,
            )
        return bool(answers[0].yes >= _YES_PROBABILITY_THRESHOLD)

    return AgentFunction(
        spec.name,
        handler=_handle,
        return_type="boolean",
        schema=schema,
    )


@experimental
def build_predicate_agent_functions(
    backend: DecisionBackend,
    specs: Sequence[NamedPredicateSpec],
    *,
    session_id: str,
    rate_limiter: SessionRateLimiter | None = None,
) -> list[AgentFunction]:
    """Builds per-session `AgentFunction` handlers for named decision predicates.

    Attach the returned functions to a catalog via
    ``catalog.copy_with(agent_functions=...)`` and serve renderer calls through
    ``RendererToAgentMessageProcessor(..., agent_function_timeout=...)``.

    Args:
        backend: Decision backend answering boolean predicate batches.
        specs: Server-owned predicate specifications to expose.
        session_id: Transport-verified session or principal identifier used for
            rate-limiting; never derived from client-supplied ``surfaceId``.
        rate_limiter: Shared `SessionRateLimiter` across requests, or None to
            create a default limiter scoped to this factory call.

    Returns:
        `AgentFunction` definitions ready for `Catalog.copy_with`.

    Raises:
        ValueError: If `session_id` is empty or whitespace.
        TypeError: If an element of `specs` is not a `NamedPredicateSpec`.
        A2uiCatalogError: If two specs declare the same `name`.
    """
    _validate_non_empty_str("session_id", session_id)
    limiter: _SlidingWindowLimiter = (
        rate_limiter if rate_limiter is not None else _SlidingWindowLimiter()
    )
    seen_names: set[str] = set()
    functions: list[AgentFunction] = []
    for spec in specs:
        if not isinstance(spec, NamedPredicateSpec):
            raise TypeError(
                "Expected NamedPredicateSpec instances in specs, got"
                f" {type(spec).__name__}."
            )
        if spec.name in seen_names:
            raise A2uiCatalogError(f"Duplicate decision predicate name: '{spec.name}'.")
        seen_names.add(spec.name)
        functions.append(
            _build_single_predicate_function(
                backend,
                spec,
                session_id=session_id,
                limiter=limiter,
            )
        )
    return functions
