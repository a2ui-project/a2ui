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

from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Protocol

from a2a.types import Part


class RenderMode(str, Enum):
    """Inference mode a turn is rendered through."""

    DECISION = "decision"
    EXPRESS = "express"
    DIRECT = "direct"

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class PlaygroundSettings:
    """Per-conversation state the slash commands change."""

    mode: RenderMode = RenderMode.DECISION
    compare: bool = False
    """When True, the next render goes through all three modes, then resets."""
    turn: int = 0
    """Number of render requests so far; drives the per-turn surface ids."""

    def next_turn(self) -> PlaygroundSettings:
        """The settings for the next render request."""
        return replace(self, turn=self.turn + 1)


@dataclass(frozen=True)
class LlmTurn:
    """One model call: its text and what it cost."""

    text: str
    prompt_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0


class LlmCaller(Protocol):
    """Runs one instruction-plus-message turn against a language model.

    `instruction_key` identifies the system instruction so an implementation
    can keep one configured agent per key. `session_id=None` means a fresh
    session with no history (stage 2); a string keeps conversation history
    under that id (stage 1).
    """

    async def __call__(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
    ) -> LlmTurn:
        ...


@dataclass(frozen=True)
class TurnMetrics:
    """What one render cost, shown in the footer under every surface."""

    mode: RenderMode
    backend: str
    """Decision backend name (`mock`, `local`, `jev`, ...) or `llm` for stage-2 modes."""
    llm_calls: int
    latency_ms: float
    prompt_tokens: int = 0
    output_tokens: int = 0
    archetype: str | None = None
    confidence: float | None = None
    block_count: int | None = None
    fallback: str | None = None
    """A `FallbackSource` value, or `validation_retry` when stage 2 needed a retry."""

    def footer(self) -> str:
        """One line summarizing the turn, fields separated by ` · `."""
        parts: list[str] = [
            f"**{self.mode}**",
            self.backend,
            f"{self.llm_calls} LLM call{'' if self.llm_calls == 1 else 's'}",
            f"{self.latency_ms / 1000.0:.1f} s",
        ]
        if self.prompt_tokens or self.output_tokens:
            parts.append(f"{self.prompt_tokens} in / {self.output_tokens} out tokens")
        if self.archetype is not None:
            conf = f" ({self.confidence:.2f})" if self.confidence is not None else ""
            parts.append(f"archetype {self.archetype}{conf}")
        if self.block_count is not None:
            parts.append(
                f"{self.block_count} block{'' if self.block_count == 1 else 's'}"
            )
        if self.fallback is not None:
            parts.append(f"fallback: {self.fallback}")
        return " · ".join(parts)

    def plus_stage1(self, stage1: LlmTurn) -> TurnMetrics:
        """Folds the stage-1 call into these metrics."""
        return replace(
            self,
            llm_calls=self.llm_calls + 1,
            latency_ms=self.latency_ms + stage1.latency_ms,
            prompt_tokens=self.prompt_tokens + stage1.prompt_tokens,
            output_tokens=self.output_tokens + stage1.output_tokens,
        )


@dataclass(frozen=True)
class RenderResult:
    """The outcome of rendering one block through one mode."""

    parts: list[Part] = field(default_factory=list)
    """A2UI data parts for the rendered surface; empty when `error` is set."""
    metrics: TurnMetrics | None = None
    trace_lines: tuple[str, ...] = ()
    """Decision only: one line per planner question, for `/trace`."""
    error: str | None = None
    """Why rendering failed, if it did."""

    @property
    def ok(self) -> bool:
        """Whether the render produced a surface."""
        return self.error is None and bool(self.parts)


def surface_id_for(settings: PlaygroundSettings, mode: RenderMode | None = None) -> str:
    """The surface id for `settings.turn`, suffixed with `mode` when comparing."""
    base = f"turn-{settings.turn}"
    if mode is not None and settings.compare:
        return f"{base}-{mode}"
    return base


def as_mode(value: Any) -> RenderMode | None:
    """Parses a user-typed mode name, or None when it is not one."""
    try:
        return RenderMode(str(value).strip().lower())
    except ValueError:
        return None
