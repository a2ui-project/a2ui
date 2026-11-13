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
    """Classifies one incoming A2A `DataPart` payload.

    Args:
        data: Decoded JSON value carried inside `DataPart.data`.

    Returns:
        A `(kind, value)` pair: `("streaming", bool)` for the `useStreaming`
        flag, `("action", mapping)` for a v0.9/v1.0 `action` or a `userAction`
        payload, and `("payload", data)` for any other JSON payload.
    """
    if not isinstance(data, Mapping):
        return "payload", data
    if "useStreaming" in data:
        return "streaming", bool(data["useStreaming"])
    if data.get("version") in (
        ProtocolVersion.V0_9,
        ProtocolVersion.V0_9_1,
        ProtocolVersion.V1_0,
    ) and isinstance(data.get("action"), Mapping):
        return "action", data["action"]
    if isinstance(data.get("userAction"), Mapping):
        return "action", data["userAction"]
    return "payload", data


def action_query(action: Mapping[str, Any]) -> str:
    """Formats the stage-1 user message for a client UI action event.

    The event name is the action identifier declared on the decision block, and
    its context carries bound values such as form fields or item identifiers.
    Including the surface identifier allows stage 1 to update the same surface.

    Args:
        action: Action dictionary containing `name`, `context`, and optional
            `surfaceId`.

    Returns:
        A formatted stage-1 prompt describing the user interaction.
    """
    action_id = action.get("name", "unknown")
    context = action.get("context", {})
    surface_id = action.get("surfaceId")
    on_surface = f" on surface `{surface_id}`" if surface_id else ""
    return (
        f"{UI_ACTION_PREFIX} action `{action_id}`{on_surface} with context"
        f" {json.dumps(context, ensure_ascii=False)}. Reply with an updated"
        " interface for the same surface or a confirmation."
    )


def payload_query(data: Any, text: str) -> str:
    """Formats the stage-1 prompt for a pasted JSON payload.

    Args:
        data: Parsed JSON payload value from a `DataPart`.
        text: Optional user text accompanying the payload.

    Returns:
        A stage-1 prompt pinning `data` as the verbatim payload.
    """
    encoded = json.dumps(data, indent=2)
    prefix = f"{text}\n\n" if text else ""
    return f"{prefix}Use this JSON verbatim as the payload:\n```json\n{encoded}\n```"


def build_query(parts: list[Any]) -> str:
    """Builds the stage-1 query string from incoming A2A message parts.

    Args:
        parts: List of A2A `Part` wrappers from the user message.

    Returns:
        The resolved query string, prioritizing UI action parts, then JSON
        payload parts, and finally plain text parts.
    """
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


def _is_inspector_enabled(context: RequestContext) -> bool:
    """Returns whether the incoming A2A message requested the playground inspector.

    Args:
        context: A2A request context for the active turn.

    Returns:
        `True` if `a2uiPlaygroundInspector` is truthy in message metadata.
    """
    if context.message is None:
        return False
    return bool((context.message.metadata or {}).get("a2uiPlaygroundInspector"))


class PlaygroundAgentExecutor(AgentExecutor):
    """Routes A2A execution requests to `PlaygroundAgent.stream`."""

    def __init__(self, agent: PlaygroundAgent) -> None:
        """Initializes the executor with a configured `PlaygroundAgent`.

        Args:
            agent: The playground agent instance that handles turns.
        """
        self._agent = agent

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Executes one A2A message turn and publishes status updates.

        Args:
            context: Incoming A2A request context containing message parts and
                client extension metadata.
            event_queue: Event queue receiving task creation and status updates.
        """
        active_ui_version = try_activate_a2ui_extension(context, self._agent.agent_card)
        parts = list(context.message.parts) if context.message else []
        query = build_query(parts) or context.get_user_input()
        inspector_enabled = _is_inspector_enabled(context)
        logger.info("Playground query (a2ui %s): %r", active_ui_version, query[:200])

        task = context.current_task
        if not task:
            task = new_task(context.message)  # type: ignore[arg-type]
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        async for item in self._agent.stream(
            query,
            task.context_id,
            active_ui_version,
            inspector_enabled=inspector_enabled,
        ):
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
        """Rejects task cancellation requests as unsupported.

        Args:
            request: Incoming cancellation request context.
            event_queue: Event queue for task updates.

        Raises:
            ServerError: Always raised with `UnsupportedOperationError`.
        """
        raise ServerError(error=UnsupportedOperationError())
