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

from dataclasses import dataclass, field

from modes import LlmTurn


@dataclass
class FakeLlmCaller:
    """Scripted `LlmCaller`: replies are popped per `instruction_key`.

    A key with no scripted replies falls back to the `default` reply so a test
    can script only the stage it cares about.
    """

    replies: dict[str, list[str]] = field(default_factory=dict)
    default: str = ""
    calls: list[dict[str, object]] = field(default_factory=list)

    def script(self, instruction_key: str, *texts: str) -> None:
        self.replies.setdefault(instruction_key, []).extend(texts)

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

    def calls_for(self, instruction_key: str) -> list[dict[str, object]]:
        return [c for c in self.calls if c["instruction_key"] == instruction_key]
