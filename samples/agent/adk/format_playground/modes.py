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

"""Shared contracts for the format playground: modes, settings, and metrics.

This module has no ADK or A2A imports so the renderers, commands, and tests can
depend on it without pulling in a model runtime.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Protocol

from a2a.types import Part


class RenderMode(str, Enum):
    """Inference mode a turn is rendered through."""

    DECISION = "decision"
    EXPRESS = "express"
    DIRECT = "direct"
    TOOL = "tool"

    def __str__(self) -> str:
        """Returns the lowercase string value of this render mode."""
        return self.value


CHAT_MODES: tuple[RenderMode, ...] = (
    RenderMode.DECISION,
    RenderMode.EXPRESS,
    RenderMode.DIRECT,
)


@dataclass(frozen=True)
class PlaygroundSettings:
    """Per-conversation state controlled by slash commands.

    Attributes:
        mode: Active render mode for subsequent turns.
        compare: Whether the next render request runs through all three chat
            modes before resetting to `False`.
        turn: Number of render requests processed so far, used to derive
            per-turn surface identifiers.
    """

    mode: RenderMode = RenderMode.DECISION
    compare: bool = False
    turn: int = 0

    def next_turn(self) -> PlaygroundSettings:
        """Returns updated settings with `turn` incremented by 1.

        Returns:
            A new `PlaygroundSettings` instance for the next render request.
        """
        return replace(self, turn=self.turn + 1)


@dataclass(frozen=True)
class LlmTurn:
    """Result and usage metrics of a single language model call.

    Attributes:
        text: Concatenated text response from the model.
        prompt_tokens: Input prompt token count.
        output_tokens: Generated output token count.
        latency_ms: Wall-clock duration of the model call in milliseconds.
    """

    text: str
    prompt_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0


@dataclass(frozen=True)
class LlmToolTurn:
    """Result and usage metrics of a tool-enabled language model call.

    Attributes:
        tool_name: Name of the tool invoked by the model, or `None` if no tool
            was called.
        arguments: Arguments passed to the invoked tool.
        result: Return value produced by the invoked tool.
        prompt_tokens: Input prompt token count.
        output_tokens: Generated output token count.
        latency_ms: Wall-clock duration of the model call in milliseconds.
        text: Any accompanying prose emitted by the model.
    """

    tool_name: str | None = None
    arguments: dict[str, Any] = field(default_factory=dict)
    result: Any = None
    prompt_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0
    text: str = ""


class LlmCaller(Protocol):
    """Protocol for running instruction-plus-message turns against a language model.

    `instruction_key` identifies the system instruction so an implementation
    can cache one configured agent per key. Passing `session_id=None` starts a
    stateless one-shot call (stage 2), whereas a string preserves conversation
    history under that identifier (stage 1).
    """

    async def __call__(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
    ) -> LlmTurn:
        """Executes a text-only turn against the language model.

        Args:
            instruction_key: Cache key for the system instruction.
            instruction: System instruction text.
            user_text: User message text.
            session_id: Conversation session identifier, or `None` for a
                stateless call.

        Returns:
            The completed `LlmTurn`.
        """
        ...

    async def call_with_tools(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
        tools: Sequence[Any],
    ) -> LlmToolTurn:
        """Executes a tool-enabled turn against the language model.

        Args:
            instruction_key: Cache key for the system instruction.
            instruction: System instruction text.
            user_text: User message text.
            session_id: Conversation session identifier, or `None` for a
                stateless call.
            tools: Sequence of callable tool functions exposed to the model.

        Returns:
            The completed `LlmToolTurn`.
        """
        ...


def format_decision_ms(ms: float) -> str:
    """Formats a decision-model latency in milliseconds or seconds.

    Args:
        ms: Latency duration in milliseconds.

    Returns:
        A human-readable latency string.
    """
    if ms < 1.0:
        return f"{ms:.2f} ms"
    if ms < 1000.0:
        return f"{ms:.0f} ms"
    return f"{ms / 1000.0:.2f} s ({ms:.0f} ms)"


@dataclass(frozen=True)
class TurnMetrics:
    """Cost and synthesis metadata for one rendered candidate.

    Attributes:
        mode: Render mode that produced the candidate.
        backend: Decision `backend_kind` (`"mock"`, `"jev"`, `"gemini"`, etc.)
            or `"llm"` for stage-2 LLM modes.
        llm_calls: Number of language model calls executed.
        latency_ms: Total wall-clock latency in milliseconds.
        prompt_tokens: Total input prompt tokens consumed.
        output_tokens: Total output tokens generated.
        archetype: Selected archetype identifier when `stage == "archetype"`.
        confidence: Winning archetype or template confidence score.
        block_count: Number of planned blocks in the layout plan.
        fallback: `FallbackSource` value, or `"validation_retry"` when stage 2
            required a retry.
        fallback_reason: Reason the decision fallback chain ran.
        stage: `SynthesisStage` value (`"template_select"`, `"archetype"`, or
            `"abstain_fallback"`).
        decision_latency_ms: Milliseconds spent waiting on the decision backend.
        decision_calls: Number of decision backend `answer()` calls.
        template_id: Selected template identifier when
            `stage == "template_select"`.
        model_id: Pinned model identifier on the decision backend.
        operation: `SurfaceOperation` emitted by the decision synthesizer.
        cache_hit: Whether a cached plan answered without calling the backend.
        fit_score: Fit score of the chosen archetype against the payload.
    """

    mode: RenderMode
    backend: str
    llm_calls: int
    latency_ms: float
    prompt_tokens: int = 0
    output_tokens: int = 0
    archetype: str | None = None
    confidence: float | None = None
    block_count: int | None = None
    fallback: str | None = None
    fallback_reason: str | None = None
    stage: str | None = None
    decision_latency_ms: float | None = None
    decision_calls: int | None = None
    template_id: str | None = None
    model_id: str | None = None
    operation: str | None = None
    cache_hit: bool = False
    fit_score: float | None = None

    def path_summary(self) -> str | None:
        """Formats the synthesis path summary for the footer card.

        Returns:
            A summary string describing whether rendering used a template, the
            decision model, or a fallback, or `None` for non-decision modes.
        """
        conf = f" ({self.confidence:.2f})" if self.confidence is not None else ""
        if self.stage == "template_select":
            tpl = f" {self.template_id}" if self.template_id else ""
            return f"path: templates · template{tpl}{conf}"
        if self.stage == "archetype":
            arch = f"archetype {self.archetype}" if self.archetype else "archetype"
            if self.block_count is None:
                return f"path: decision model · {arch}{conf}"
            blocks = f"{self.block_count} block{'' if self.block_count == 1 else 's'}"
            return f"path: decision model · {arch}{conf} · {blocks}"
        if self.stage == "abstain_fallback":
            source = self.fallback or "abstained"
            reason = f": {self.fallback_reason}" if self.fallback_reason else ""
            return f"path: fallback ({source}) · decision model abstained{reason}"
        return None

    def backend_label(self) -> str:
        """Formats the backend kind and optional pinned model identifier.

        Returns:
            The backend label string.
        """
        if self.model_id and self.model_id != self.backend:
            return f"{self.backend} ({self.model_id})"
        return self.backend

    def _timing(self) -> str:
        """Formats decision and total latency for the footer card.

        Returns:
            A formatted timing string.
        """
        if self.decision_latency_ms is None:
            return f"{self.latency_ms / 1000.0:.1f} s"
        dec_time = f"decision {format_decision_ms(self.decision_latency_ms)}"
        if self.llm_calls > 0:
            return f"{dec_time} (total {self.latency_ms / 1000.0:.1f} s)"
        return dec_time

    def _call_label(self) -> str:
        """Formats the LLM call count label for the footer card.

        Returns:
            A singular or plural LLM call count string.
        """
        plural = "" if self.llm_calls == 1 else "s"
        if self.mode == RenderMode.TOOL and self.llm_calls > 0:
            return f"{self.llm_calls} LLM call{plural} (tool call{plural} only)"
        return f"{self.llm_calls} LLM call{plural}"

    def footer(self) -> str:
        """Formats a single-line footer summarizing this turn's metrics.

        Returns:
            A middle-dot-separated summary string.
        """
        parts: list[str] = [
            f"**{self.mode}**",
            self.backend_label(),
            self._call_label(),
            self._timing(),
        ]
        if self.prompt_tokens or self.output_tokens:
            parts.append(f"{self.prompt_tokens} in / {self.output_tokens} out tokens")
        if self.operation and self.operation != "create":
            parts.append(f"surface {self.operation}")
        if self.cache_hit:
            parts.append("cache hit")
        if self.fit_score is not None:
            parts.append(f"fit {self.fit_score:.2f}")
        path = self.path_summary()
        parts.extend([path] if path is not None else self._plan_parts())
        return " · ".join(parts)

    def _plan_parts(self) -> list[str]:
        """Formats archetype, block count, and fallback when `stage` is unset.

        Returns:
            A list of summary fragments.
        """
        parts: list[str] = []
        if self.archetype is not None:
            conf = f" ({self.confidence:.2f})" if self.confidence is not None else ""
            parts.append(f"archetype {self.archetype}{conf}")
        if self.block_count is not None:
            parts.append(
                f"{self.block_count} block{'' if self.block_count == 1 else 's'}"
            )
        if self.fallback is not None:
            parts.append(f"fallback: {self.fallback}")
        return parts

    def plus_stage1(self, stage1: LlmTurn) -> TurnMetrics:
        """Folds stage-1 LLM call counts, latency, and tokens into these metrics.

        Args:
            stage1: Completed stage-1 `LlmTurn`.

        Returns:
            A new `TurnMetrics` including the stage-1 call.
        """
        return replace(
            self,
            llm_calls=self.llm_calls + 1,
            latency_ms=self.latency_ms + stage1.latency_ms,
            prompt_tokens=self.prompt_tokens + stage1.prompt_tokens,
            output_tokens=self.output_tokens + stage1.output_tokens,
        )


@dataclass(frozen=True)
class RenderResult:
    """Outcome of rendering one decision block through one mode.

    Attributes:
        parts: A2UI `Part` wrappers for the rendered surface; empty on failure.
        metrics: Cost and synthesis metrics for the render.
        trace_lines: Formatted planner question trace lines for `/trace`.
        error: Error message when rendering failed, or `None` on success.
        decision_answers: Raw `DecisionAnswer` tuple from the decision backend.
        output: Full `SynthesisOutput` from the decision synthesizer, if any.
        messages: Raw A2UI protocol message dictionaries.
        raw_stage2_text: Raw stage-2 LLM reply text for `express` or `direct`.
        decompiled_express: A2UI Express DSL decompiled from `messages`.
    """

    parts: list[Part] = field(default_factory=list)
    metrics: TurnMetrics | None = None
    trace_lines: tuple[str, ...] = ()
    error: str | None = None
    decision_answers: tuple[Any, ...] = ()
    output: Any = None
    messages: tuple[dict[str, Any], ...] = ()
    raw_stage2_text: str | None = None
    decompiled_express: str = ""

    @property
    def ok(self) -> bool:
        """Whether the render produced at least one surface part without error."""
        return self.error is None and bool(self.parts)


MAIN_SURFACE_ID = "main"
"""The surface decision and tool renders reuse, so later turns update it in place."""


def surface_id_for(settings: PlaygroundSettings, mode: RenderMode | None = None) -> str:
    """Determines the target surface identifier for a render of `mode`.

    Decision and tool renders reuse `MAIN_SURFACE_ID` across turns so repeated
    shapes update in place. Express, direct, and `/compare` renders use
    per-turn surface identifiers.

    Args:
        settings: Active conversation settings containing `turn` and `compare`.
        mode: Render mode being executed, or `None` for the base turn id.

    Returns:
        The target A2UI surface identifier string.
    """
    base = f"turn-{settings.turn}"
    if settings.compare:
        return f"{base}-{mode}" if mode is not None else base
    if mode in (RenderMode.DECISION, RenderMode.TOOL):
        return MAIN_SURFACE_ID
    return base


def status_surface_id(settings: PlaygroundSettings, suffix: str) -> str:
    """Builds the per-turn surface identifier for a status or footer card.

    Args:
        settings: Active conversation settings.
        suffix: Card suffix such as `"status"`, `"compare"`, or `"tool-footer"`.

    Returns:
        The status surface identifier string.
    """
    return f"turn-{settings.turn}-{suffix}"


def as_mode(value: Any) -> RenderMode | None:
    """Parses a user-supplied mode name into a `RenderMode`.

    Args:
        value: Raw mode name value.

    Returns:
        The matching `RenderMode`, or `None` if `value` is not a valid mode.
    """
    try:
        return RenderMode(str(value).strip().lower())
    except ValueError:
        return None
