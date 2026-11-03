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

"""What one turn looks like to the executor, independent of the agent flavour."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class TurnInput:
    """One user turn as the executor hands it to an agent."""

    session_id: str
    text: str
    # The `a2ui.mcpAppMessage` action context when the turn comes from the
    # board app (channel D): `{"role": ..., "content": [...]}`.
    app_message: dict[str, Any] | None = None
    # The surface data model the chat host sends with the turn (channel B).
    data_model: dict[str, Any] | None = None

    def app_event(self) -> dict[str, Any] | None:
        """The structured event the app put in its message's text block `_meta`."""
        if not self.app_message:
            return None
        for block in self.app_message.get("content", []):
            meta = block.get("_meta") if isinstance(block, dict) else None
            event = meta.get("kanban") if isinstance(meta, dict) else None
            if isinstance(event, dict):
                return event
        return None

    def model_context(self) -> dict[str, Any] | None:
        """The app's `ui/update-model-context` payload, as bound to `/kanban/modelContext`."""
        kanban = (self.data_model or {}).get("kanban")
        if isinstance(kanban, dict) and isinstance(kanban.get("modelContext"), dict):
            return kanban["modelContext"]
        return None


@dataclass
class TurnOutput:
    """What an agent produced for one turn."""

    texts: list[str] = field(default_factory=list)
    a2ui_messages: list[dict[str, Any]] = field(default_factory=list)


class KanbanAgent(Protocol):
    """A conversational agent over the Kanban MCP server."""

    async def run(self, turn: TurnInput) -> TurnOutput:
        """Handles one turn."""
