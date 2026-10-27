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

"""Scripted test doubles for the format playground."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from a2ui.inference_formats.decision import DeterministicMockBackend
from modes import LlmToolTurn, LlmTurn


@dataclass
class FakeLlmCaller:
    """Scripted `LlmCaller`: replies are popped per `instruction_key`.

    A key with no scripted replies falls back to the `default` reply so a test
    can script only the stage it cares about.
    """

    replies: dict[str, list[str]] = field(default_factory=dict)
    default: str = ""
    tool_replies: dict[str, list[LlmToolTurn]] = field(default_factory=dict)
    default_tool_turn: LlmToolTurn = field(
        default_factory=lambda: LlmToolTurn(text="No tool found.")
    )
    calls: list[dict[str, object]] = field(default_factory=list)

    def script(self, instruction_key: str, *texts: str) -> None:
        self.replies.setdefault(instruction_key, []).extend(texts)

    def script_tool(self, instruction_key: str, *turns: LlmToolTurn) -> None:
        self.tool_replies.setdefault(instruction_key, []).extend(turns)

    async def __call__(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
    ) -> LlmTurn:
        self.calls.append({
            "instruction_key": instruction_key,
            "instruction": instruction,
            "user_text": user_text,
            "session_id": session_id,
        })
        queue = self.replies.get(instruction_key)
        text = queue.pop(0) if queue else self.default
        return LlmTurn(text=text, prompt_tokens=100, output_tokens=40, latency_ms=5.0)

    async def call_with_tools(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
        tools: Sequence[Any],
    ) -> LlmToolTurn:
        self.calls.append({
            "instruction_key": instruction_key,
            "instruction": instruction,
            "user_text": user_text,
            "session_id": session_id,
            "tools": tools,
        })
        queue = self.tool_replies.get(instruction_key)
        if queue:
            return queue.pop(0)
        return self.default_tool_turn

    def calls_for(self, instruction_key: str) -> list[dict[str, object]]:
        return [c for c in self.calls if c["instruction_key"] == instruction_key]


HOST_ANSWERS: dict[str, Any] = {
    "family": ("monitor", 0.90),
    "stakes": 1.0,
    "urgency": 1.4,
    "archetype:monitor": ("dashboard", 0.85),
    "gate:banner": 0.80,
    "gate:headline": 0.90,
    "gate:facts": 0.80,
    "anatomy:headline.deltas": 0.85,
    "salience:/cpu": 2.8,
    "salience:/status": 2.1,
    "salience:/uptimeHours": 1.2,
    "salience:/host": 0.4,
    "instance:banner.tone:/status": ("warning", 0.90),
    "instance:headline.news:/cpu": ("bad", 0.85),
    "instance:headline.state_tone:/status": ("warning", 0.80),
}

RESORT_ANSWERS: dict[str, Any] = {
    "family": ("browse", 0.92),
    "stakes": 0.5,
    "urgency": 0.3,
    "archetype:browse": ("feed", 0.88),
    "gate:collection": 0.95,
    "gate:filters": 0.20,
    "salience:/resorts": 2.5,
}

TRANSFER_ANSWERS: dict[str, Any] = {
    "family": ("act", 0.85),
    "stakes": 2.1,
    "urgency": 0.6,
    "archetype:act": ("confirm", 0.90),
    "gate:banner": 0.20,
    "gate:prose": 0.45,
    "gate:facts": 0.85,
    "gate:actions": 0.90,
    "instance:actions.primary:/actions": ("Confirm Transfer", 0.90),
    "salience:/amount": 2.9,
    "salience:/recipient": 2.6,
    "salience:/fee": 1.9,
}

SETTINGS_ANSWERS: dict[str, Any] = {
    "family": ("input", 0.92),
    "stakes": 1.0,
    "urgency": 0.3,
    "archetype:input": ("form", 0.88),
    "gate:form": 0.98,
    "gate:actions": 0.95,
    "instance:actions.primary:/actions": ("Save", 0.98),
    "salience:/volume": 2.5,
    "salience:/subtitles": 2.1,
    "salience:/theme": 1.8,
}


def scripted_backend(answers: dict[str, Any]) -> DeterministicMockBackend:
    """Builds a DeterministicMockBackend with scripted question answers."""
    return DeterministicMockBackend(scripted_answers=answers)
