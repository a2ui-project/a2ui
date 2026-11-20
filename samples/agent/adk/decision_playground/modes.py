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

"""Shared contracts for the decision playground: modes, settings, and metrics."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Protocol

PLAYGROUND_TRACE_MIME_TYPE = "application/x-a2ui-playground-trace+json"


class RenderMode(str, Enum):
    """Interactive mode a playground turn executes in."""

    CASCADE = "cascade"
    BINDER = "binder"
    RPC = "rpc"
    EXPRESS = "express"
    DIRECT = "direct"

    def __str__(self) -> str:
        return self.value


COMPARE_MODES: tuple[RenderMode, ...] = (
    RenderMode.CASCADE,
    RenderMode.EXPRESS,
    RenderMode.DIRECT,
)


@dataclass(frozen=True)
class PlaygroundSettings:
    """Per-conversation settings controlled by slash commands or header pills."""

    mode: RenderMode = RenderMode.CASCADE
    backend_kind: str = "mock"
    budget_ms: float | None = None
    compare: bool = False
    turn: int = 0

    def next_turn(self) -> PlaygroundSettings:
        """Returns updated settings with `turn` incremented by 1."""
        return replace(self, turn=self.turn + 1)


@dataclass(frozen=True)
class LlmTurn:
    """Result and usage metrics of a single language model call."""

    text: str
    prompt_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0


@dataclass(frozen=True)
class LlmToolTurn:
    """Result and usage metrics of a tool-enabled language model call."""

    tool_name: str | None = None
    arguments: dict[str, Any] = field(default_factory=dict)
    result: Any = None
    prompt_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0
    text: str = ""


class LlmCaller(Protocol):
    """Protocol for running text or tool-enabled turns against an LLM."""

    async def __call__(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
    ) -> LlmTurn:
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
        ...


@dataclass(frozen=True)
class RenderOutcome:
    """Normalized output of one mode runner for UI rendering and trace assembly."""

    mode: RenderMode
    surface_id: str
    messages: tuple[dict[str, Any], ...] = ()
    text: str = ""
    ok: bool = True
    error: str | None = None
    stage: str = "template_select"
    confidence: float = 1.0
    selected_template_id: str | None = None
    fallback_source: str | None = None
    fallback_reason: str | None = None
    operation: str = "create_surface"
    llm_calls: int = 0
    prompt_tokens: int = 0
    output_tokens: int = 0
    total_latency_ms: float = 0.0
    decompiled_express: str = ""
    extra_summary: str = ""
