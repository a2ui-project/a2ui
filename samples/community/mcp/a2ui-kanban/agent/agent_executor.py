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

"""The A2A executor: parses the chat host's turn and publishes the agent's reply.

A turn from the chat host holds a text part and, as A2UI data parts, the
`a2ui.mcpAppMessage` action when the board app spoke (channel D) and the
renderer data model with the app's model context (channel B). The reply is one
final message with the agent's text and its A2UI messages.
"""

from __future__ import annotations

import logging
from typing import Any

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    Part,
    Task,
    TaskState,
    TextPart,
    UnsupportedOperationError,
)
from a2a.utils import new_agent_parts_message, new_task
from a2a.utils.errors import ServerError
from a2ui.a2a import (
    create_a2ui_part,
    get_a2ui_agent_extension,
    get_a2ui_datapart,
    try_activate_a2ui_extension,
)

from a2ui_messages import BASIC_CATALOG_ID, MCP_CATALOG_ID, SURFACE_ID
from turns import KanbanAgent, TurnInput

logger = logging.getLogger(__name__)

A2UI_VERSION = "1.0"
MCP_APP_MESSAGE_ACTION = "a2ui.mcpAppMessage"


def build_agent_card(base_url: str) -> AgentCard:
    return AgentCard(
        name="Kanban Agent",
        description=(
            "Manages a sprint Kanban board through an MCP server and shows it as an"
            " interactive MCP App in the chat."
        ),
        url=base_url,
        version="1.0.0",
        default_input_modes=["text", "text/plain"],
        default_output_modes=["text", "text/plain"],
        capabilities=AgentCapabilities(
            streaming=False,
            extensions=[
                get_a2ui_agent_extension(
                    A2UI_VERSION,
                    accepts_inline_catalogs=False,
                    supported_catalog_ids=[BASIC_CATALOG_ID, MCP_CATALOG_ID],
                )
            ],
        ),
        skills=[
            AgentSkill(
                id="show_board",
                name="Show the sprint board",
                description="Opens the interactive Kanban board.",
                tags=["kanban", "mcp-app"],
                examples=["Show me the sprint board"],
            ),
            AgentSkill(
                id="manage_board",
                name="Manage the board",
                description=(
                    "Moves, creates and assigns cards, and answers questions about"
                    " them."
                ),
                tags=["kanban"],
                examples=[
                    "Move Write docs back to Todo",
                    "What's left for Ana this week?",
                ],
            ),
        ],
    )


def parse_turn(context: RequestContext, session_id: str) -> TurnInput:
    """Reads the text, the app message and the data model out of the A2A message."""
    app_message: dict[str, Any] | None = None
    data_model: dict[str, Any] | None = None
    for part in context.message.parts if context.message else []:
        data_part = get_a2ui_datapart(part)
        if data_part is None:
            continue
        data = data_part.data
        if not isinstance(data, dict):
            continue
        action = data.get("action")
        if isinstance(action, dict) and action.get("name") == MCP_APP_MESSAGE_ACTION:
            app_message = action.get("context") or {}
        surfaces = data.get("surfaces")
        if isinstance(surfaces, dict) and isinstance(surfaces.get(SURFACE_ID), dict):
            data_model = surfaces[SURFACE_ID]
    return TurnInput(
        session_id=session_id,
        text=context.get_user_input(),
        app_message=app_message,
        data_model=data_model,
    )


class KanbanAgentExecutor(AgentExecutor):
    """One A2A task per turn; the A2A context id is the agent session."""

    def __init__(self, agent: KanbanAgent, agent_card: AgentCard):
        self._agent = agent
        self._agent_card = agent_card

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        ui_version = try_activate_a2ui_extension(context, self._agent_card)
        task = context.current_task
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)
        await updater.update_status(TaskState.working)

        turn = parse_turn(context, task.context_id)
        logger.info(
            "Turn %s: %r (app event: %s)", task.context_id, turn.text, turn.app_event()
        )
        try:
            output = await self._agent.run(turn)
        except (
            Exception
        ) as error:  # Surface agent failures as a reply, not a dead task.
            logger.exception("Turn failed")
            output_texts = [f"Something went wrong on my side: {error}"]
            parts = [Part(root=TextPart(text=text)) for text in output_texts]
        else:
            parts = [Part(root=TextPart(text=text)) for text in output.texts]
            if ui_version:
                parts.extend(
                    create_a2ui_part(message, version=ui_version)
                    for message in output.a2ui_messages
                )
            elif output.a2ui_messages:
                parts.append(
                    Part(
                        root=TextPart(text="(The board needs an A2UI-capable client.)")
                    )
                )
        await updater.update_status(
            TaskState.completed,
            new_agent_parts_message(parts, task.context_id, task.id),
            final=True,
        )

    async def cancel(
        self, request: RequestContext, event_queue: EventQueue
    ) -> Task | None:
        raise ServerError(error=UnsupportedOperationError())
