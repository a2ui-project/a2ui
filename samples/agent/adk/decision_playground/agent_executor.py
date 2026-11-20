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

"""A2A executor for the decision playground, including direct RPC handling."""

from __future__ import annotations

from collections.abc import Mapping
import json
import logging
from typing import TYPE_CHECKING, Any

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    AgentCard,
    DataPart,
    Part,
    Task,
    TaskState,
    TextPart,
    UnsupportedOperationError,
)
from a2a.utils import new_agent_parts_message, new_task
from a2a.utils.errors import ServerError

from a2ui.a2a import create_a2ui_part, try_activate_a2ui_extension
from modes import PLAYGROUND_TRACE_MIME_TYPE

if TYPE_CHECKING:
    from agent import PlaygroundAgent

logger = logging.getLogger(__name__)


def _handle_data_part(
    data: Any,
    rpc_messages: list[dict[str, Any]],
    texts: list[str],
) -> Any:
    """Classifies one `DataPart.data` payload; returns pasted payload or `None`."""
    if not isinstance(data, Mapping):
        return data
    if "useStreaming" in data:
        return None
    if "callAgentFunction" in data:
        rpc_messages.append(dict(data))
        return None
    if "userAction" in data or "action" in data:
        action = data.get("userAction") or data.get("action")
        texts.append(f"Action triggered: {json.dumps(action)}")
        return None
    return data


def _extract_incoming_parts(
    parts: list[Any],
) -> tuple[list[dict[str, Any]], str, Any]:
    """Splits incoming A2A parts into `(rpc_messages, text_query, pasted_payload)`."""
    rpc_messages: list[dict[str, Any]] = []
    texts: list[str] = []
    pasted_payload: Any = None
    for part in parts:
        root = getattr(part, "root", part)
        if isinstance(root, TextPart) and root.text.strip():
            texts.append(root.text.strip())
        elif isinstance(root, DataPart):
            candidate = _handle_data_part(root.data, rpc_messages, texts)
            if candidate is not None:
                pasted_payload = candidate
    return rpc_messages, "\n".join(texts).strip(), pasted_payload


def _inspector_requested(context: RequestContext) -> bool:
    """Checks whether the A2A client asked for an in-band playground trace."""
    msg = context.message
    meta = getattr(msg, "metadata", None) if msg is not None else None
    if isinstance(meta, Mapping) and meta.get("a2uiPlaygroundInspector"):
        return True
    call_ctx = getattr(context, "call_context", None)
    state = getattr(call_ctx, "state", None)
    return isinstance(state, Mapping) and bool(state.get("a2uiPlaygroundInspector"))


class PlaygroundAgentExecutor(AgentExecutor):
    """A2A `AgentExecutor` bridging `A2UIClient` and `PlaygroundAgent`."""

    def __init__(
        self, agent: PlaygroundAgent, *, agent_card: AgentCard | None = None
    ) -> None:
        self._agent = agent
        self._agent_card = agent_card

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        if self._agent_card is not None:
            try_activate_a2ui_extension(context, self._agent_card)
        task = context.current_task
        if task is None:
            assert context.message is not None
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        parts = list(context.message.parts) if context.message else []
        rpc_messages, text_query, pasted_payload = _extract_incoming_parts(parts)
        include_trace = _inspector_requested(context)

        if rpc_messages:
            result = await self._agent.handle_rpc_messages(
                rpc_messages,
                context_id=task.context_id,
                include_trace=include_trace,
            )
        else:
            result = await self._agent.handle_text_turn(
                text_query,
                context_id=task.context_id,
                pasted_payload=pasted_payload,
                include_trace=include_trace,
            )

        out_parts: list[Part] = [create_a2ui_part(msg) for msg in result.messages]
        if result.trace is not None:
            out_parts.append(
                Part(
                    root=DataPart(
                        data=result.trace,
                        metadata={"mimeType": PLAYGROUND_TRACE_MIME_TYPE},
                    )
                )
            )

        await updater.update_status(
            TaskState.input_required,
            new_agent_parts_message(out_parts, task.context_id, task.id),
            final=True,
        )

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        del context, event_queue
        raise ServerError(error=UnsupportedOperationError())
