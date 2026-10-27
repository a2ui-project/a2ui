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

"""A2A executor for the format playground.

Turns an incoming A2A message into one text query for the agent. Three kinds
of `DataPart` are understood: the `useStreaming` flag, a UI action (either the
v0.9 `{"version", "action"}` shape or the `{"userAction"}` shape the sample
clients send), and anything else, which is treated as a pasted JSON payload.
"""

from __future__ import annotations

from collections.abc import Mapping
import json
import logging
from typing import TYPE_CHECKING, Any, Literal

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import DataPart, Task, TaskState, TextPart, UnsupportedOperationError
from a2a.utils import new_agent_parts_message, new_agent_text_message, new_task
from a2a.utils.errors import ServerError

from a2ui.a2a import try_activate_a2ui_extension
from a2ui.core.schema import ProtocolVersion
from stage1 import UI_ACTION_PREFIX

if TYPE_CHECKING:
    from agent import PlaygroundAgent

logger = logging.getLogger(__name__)

DataPartKind = Literal["streaming", "action", "payload"]


def classify_data_part(data: Any) -> tuple[DataPartKind, Any]:
    """Classifies one `DataPart` payload.

    Returns ``("streaming", bool)`` for the `useStreaming` flag,
    ``("action", mapping)`` for a v0.9 `action` or a `userAction` payload, and
    ``("payload", data)`` for anything else (a pasted JSON object).
    """
    if not isinstance(data, Mapping):
        return "payload", data
    if "useStreaming" in data:
        return "streaming", bool(data["useStreaming"])
    if data.get("version") == ProtocolVersion.V0_9 and isinstance(
        data.get("action"), Mapping
    ):
        return "action", data["action"]
    if isinstance(data.get("userAction"), Mapping):
        return "action", data["userAction"]
    return "payload", data


def action_query(action: Mapping[str, Any]) -> str:
    """The stage-1 text for a UI action."""
    name = action.get("name", "unknown")
    context = action.get("context", {})
    return (
        f"{UI_ACTION_PREFIX} action `{name}` with context {json.dumps(context)}."
        " Reply with an updated interface or a confirmation."
    )


def payload_query(data: Any, text: str) -> str:
    """The stage-1 text for a pasted JSON payload, prefixed by any typed text."""
    encoded = json.dumps(data, indent=2)
    prefix = f"{text}\n\n" if text else ""
    return f"{prefix}Use this JSON verbatim as the payload:\n```json\n{encoded}\n```"


def build_query(parts: list[Any]) -> str:
    """Builds the agent query from the message parts, text first."""
    text = " ".join(
        p.root.text for p in parts if isinstance(p.root, TextPart) and p.root.text
    ).strip()
    for part in parts:
        if not isinstance(part.root, DataPart):
            continue
        kind, value = classify_data_part(part.root.data)
        if kind == "action":
            return action_query(value)
        if kind == "payload":
            return payload_query(value, text)
    return text


class PlaygroundAgentExecutor(AgentExecutor):
    """Routes A2A requests to `PlaygroundAgent.stream`."""

    def __init__(self, agent: PlaygroundAgent) -> None:
        self._agent = agent

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        active_ui_version = try_activate_a2ui_extension(context, self._agent.agent_card)
        parts = list(context.message.parts) if context.message else []
        query = build_query(parts) or context.get_user_input()
        logger.info("Playground query (a2ui %s): %r", active_ui_version, query[:200])

        task = context.current_task
        if not task:
            task = new_task(context.message)  # type: ignore[arg-type]
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        async for item in self._agent.stream(query, task.context_id, active_ui_version):
            if not item["is_task_complete"]:
                if "parts" in item:
                    message = new_agent_parts_message(
                        item["parts"], task.context_id, task.id
                    )
                else:
                    message = new_agent_text_message(
                        item.get("updates", ""), task.context_id, task.id
                    )
                await updater.update_status(TaskState.working, message)
                continue
            await updater.update_status(
                TaskState.input_required,
                new_agent_parts_message(item["parts"], task.context_id, task.id),
                final=False,
            )
            break

    async def cancel(
        self, request: RequestContext, event_queue: EventQueue
    ) -> Task | None:
        raise ServerError(error=UnsupportedOperationError())
