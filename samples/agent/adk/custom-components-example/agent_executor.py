# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import logging
import time

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    DataPart,
    Part,
    Task,
    TaskState,
    TextPart,
    UnsupportedOperationError,
)
from a2a.utils import (
    new_agent_parts_message,
    new_agent_text_message,
    new_task,
)
from a2a.utils.errors import ServerError
from a2ui.a2a import try_activate_a2ui_extension
from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY
from a2ui.core.schema import ProtocolVersion
from a2ui.utils import to_version_number
from agent import ContactAgent

logger = logging.getLogger(__name__)

# The message metadata key of the renderer capabilities in the v1.0 A2A
# extension. v0.8 and v0.9 use `A2UI_CLIENT_CAPABILITIES_KEY`.
RENDERER_CAPABILITIES_KEY = "a2uiRendererCapabilities"
# The versions whose renderers send `{"version": ..., "action": {...}}`.
_ACTION_VERSIONS = (ProtocolVersion.V0_9, ProtocolVersion.V1_0)


class ContactAgentExecutor(AgentExecutor):
    """Contact AgentExecutor Example."""

    def __init__(self, agent: ContactAgent):
        self._agent = agent

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        query = ""
        ui_event_part = None
        action = None
        client_ui_capabilities = None

        logger.info(
            f"--- Client requested extensions: {context.requested_extensions} ---"
        )
        active_ui_version = try_activate_a2ui_extension(context, self._agent.agent_card)

        if active_ui_version:
            logger.info(
                "--- AGENT_EXECUTOR: A2UI extension is active"
                f" (v{to_version_number(active_ui_version)}). Using UI runner. ---"
            )
        else:
            logger.info(
                "--- AGENT_EXECUTOR: A2UI extension is not active. Using text"
                " runner. ---"
            )

        # Renderers send their capabilities in the message metadata, or in the
        # metadata of a DataPart, which is read below. The v1.0 A2A extension
        # renamed the key.
        capabilities_key = (
            RENDERER_CAPABILITIES_KEY
            if active_ui_version == ProtocolVersion.V1_0
            else A2UI_CLIENT_CAPABILITIES_KEY
        )
        if active_ui_version and context.message and context.message.metadata:
            client_ui_capabilities = context.message.metadata.get(capabilities_key)

        if context.message and context.message.parts:
            logger.info(
                f"--- AGENT_EXECUTOR: Processing {len(context.message.parts)} message"
                " parts ---"
            )
            for i, part in enumerate(context.message.parts):
                if isinstance(part.root, DataPart):
                    # Extract client UI capabilities from any DataPart that has them
                    if (
                        active_ui_version
                        and "metadata" in part.root.data
                        and capabilities_key in part.root.data["metadata"]
                    ):
                        logger.info(
                            f"  Part {i}: Found '{capabilities_key}' in DataPart."
                        )
                        client_ui_capabilities = part.root.data["metadata"][
                            capabilities_key
                        ]

                    if (
                        part.root.data.get("version") in _ACTION_VERSIONS
                        and "action" in part.root.data
                    ):
                        logger.info(
                            f"  Part {i}: Found a2ui {part.root.data['version']}"
                            " action payload."
                        )
                        ui_event_part = part.root.data["action"]
                    elif "userAction" in part.root.data:
                        logger.info(f"  Part {i}: Found a2ui UI ClientEvent payload.")
                        ui_event_part = part.root.data["userAction"]
                    elif "request" in part.root.data:
                        logger.info(f"  Part {i}: Found 'request' in DataPart.")
                        query = part.root.data["request"]
                    else:
                        logger.info(f"  Part {i}: DataPart (data: {part.root.data})")
                elif isinstance(part.root, TextPart):
                    logger.info(f"  Part {i}: TextPart (text: {part.root.text})")
                else:
                    logger.info(f"  Part {i}: Unknown part type ({type(part.root)})")

        if ui_event_part:
            logger.info(f"Received a2ui ClientEvent: {ui_event_part}")
            action = ui_event_part.get("name")
            ctx = ui_event_part.get("context", {})

            if action == "view_profile":
                contact_name = ctx.get("contactName", "Unknown")
                department = ctx.get("department", "")
                query = f"WHO_IS: {contact_name} from {department}"

            elif action == "send_email":
                contact_name = ctx.get("contactName", "Unknown")
                email = ctx.get("email", "Unknown")
                query = f"USER_WANTS_TO_EMAIL: {contact_name} at {email}"

            elif action == "send_message":
                contact_name = ctx.get("contactName", "Unknown")
                query = f"ACTION: send_message (contact: {contact_name})"

            elif action == "view_full_profile":
                contact_name = ctx.get("contactName", "Unknown")
                query = f"USER_WANTS_FULL_PROFILE: {contact_name}"

            elif action == "view_location":
                contact_id = ctx.get("contactId", "Unknown")
                query = f"ACTION: view_location (contactId: {contact_id})"

            elif action == "select_desk":
                contact_id = ctx.get("contactId", "Unknown")
                query = f"ACTION: select_desk contactId:{contact_id}"

            elif action == "chart_node_click":
                node_name = ctx.get("clickedNodeName", "Unknown")
                source = ctx.get("source", "")
                query = (
                    f'ACTION: chart_node_click (context: clickedNodeName="{node_name}")'
                )
                if source == "modal":
                    query += " (from modal)"

            elif action == "dismiss_modal" or action == "close_modal":
                query = "ACTION: close_modal"

            else:
                query = f"User submitted an event: {action} with data: {ctx}"
        else:
            if not query:
                logger.info("No a2ui UI event part found. Falling back to text input.")
                query = context.get_user_input()

        logger.info(f"--- AGENT_EXECUTOR: Final query for LLM: '{query}' ---")

        task = context.current_task

        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        async for item in self._agent.stream(
            query, task.context_id, client_ui_capabilities, active_ui_version
        ):
            is_task_complete = item["is_task_complete"]
            if not is_task_complete:
                message = None
                if "parts" in item:
                    message = new_agent_parts_message(
                        item["parts"], task.context_id, task.id
                    )
                elif "updates" in item:
                    message = new_agent_text_message(
                        item["updates"], task.context_id, task.id
                    )

                if message:
                    await updater.update_status(TaskState.working, message)
                continue

            final_state = TaskState.input_required  # Default
            if action in ["send_email", "send_message", "view_full_profile"]:
                final_state = TaskState.completed

            final_parts = item["parts"]

            logger.info("--- FINAL PARTS TO BE SENT ---")
            for i, part in enumerate(final_parts):
                logger.info(f"  - Part {i}: Type = {type(part.root)}")
                if isinstance(part.root, TextPart):
                    logger.info(f"    - Text: {part.root.text[:200]}...")
                elif isinstance(part.root, DataPart):
                    logger.info(f"    - Data: {str(part.root.data)[:200]}...")
            logger.info("-----------------------------")

            await updater.update_status(
                final_state,
                new_agent_parts_message(final_parts, task.context_id, task.id),
                final=(final_state == TaskState.completed),
            )
            break

    async def cancel(
        self, request: RequestContext, event_queue: EventQueue
    ) -> Task | None:
        raise ServerError(error=UnsupportedOperationError())
