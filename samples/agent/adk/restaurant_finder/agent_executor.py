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

from collections.abc import Mapping
import logging
from typing import Any

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    DataPart,
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
from a2ui.constants import (
    A2UI_ACTIONS_KEY,
    A2UI_CLIENT_CAPABILITIES_KEY,
    A2UI_RENDERER_CAPABILITIES_KEY,
    A2UI_VERSION_KEY,
)
from a2ui.core.schema import ProtocolVersion
from agent import RestaurantAgent

logger = logging.getLogger(__name__)

# The versions whose renderers send `{"version": ..., "action": {...}}`.
_ACTION_VERSIONS = (ProtocolVersion.V0_9, ProtocolVersion.V1_0)


def _find_ui_event(data: Any) -> Mapping[str, Any] | None:
    """Returns the action that a renderer sent in a DataPart's data, if any.

    A v0.8 renderer sends `{"userAction": {...}}`, and later renderers send
    `{"version": ..., "action": {...}}`. The v1.0 A2A extension sends a list
    of messages, or `{"messages": [...]}` where the transport needs an
    object; the first message with an action is used.
    """
    if isinstance(data, Mapping) and isinstance(data.get("messages"), list):
        data = data["messages"]
    messages = data if isinstance(data, list) else [data]
    for message in messages:
        if not isinstance(message, Mapping):
            continue
        action = message.get(A2UI_ACTIONS_KEY)
        if message.get(A2UI_VERSION_KEY) in _ACTION_VERSIONS and isinstance(
            action, Mapping
        ):
            return action
        user_action = message.get("userAction")
        if isinstance(user_action, Mapping):
            return user_action
    return None


class RestaurantAgentExecutor(AgentExecutor):
    """Restaurant AgentExecutor Example."""

    def __init__(self, agent: RestaurantAgent):
        self._agent = agent

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        query = ""
        ui_event_part = None
        action = None

        logger.info(
            f"--- Client requested extensions: {context.requested_extensions} ---"
        )
        active_ui_version = try_activate_a2ui_extension(context, self._agent.agent_card)

        # Determine which agent to use based on whether the a2ui extension is active.
        if active_ui_version:
            logger.info(
                "--- AGENT_EXECUTOR: A2UI extension is active. Using UI agent. ---"
            )
        else:
            logger.info(
                "--- AGENT_EXECUTOR: A2UI extension is not active. Using text"
                " agent. ---"
            )

        # Renderers send their capabilities in the message metadata. The v1.0
        # A2A extension renamed the key.
        client_ui_capabilities = None
        if active_ui_version and context.message and context.message.metadata:
            client_ui_capabilities = context.message.metadata.get(
                A2UI_RENDERER_CAPABILITIES_KEY
                if active_ui_version == ProtocolVersion.V1_0
                else A2UI_CLIENT_CAPABILITIES_KEY
            )

        use_streaming = True
        if context.message and context.message.parts:
            logger.info(
                f"--- AGENT_EXECUTOR: Processing {len(context.message.parts)} message"
                " parts ---"
            )
            for i, part in enumerate(context.message.parts):
                if isinstance(part.root, DataPart):
                    if "useStreaming" in part.root.data:
                        use_streaming = part.root.data["useStreaming"]
                        logger.info(f"  Part {i}: Found useStreaming={use_streaming}")

                    found_event = _find_ui_event(part.root.data)
                    if found_event is not None:
                        logger.info(f"  Part {i}: Found a2ui action payload.")
                        ui_event_part = found_event
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

            if action == "book_restaurant":
                restaurant_name = ctx.get("restaurantName", "Unknown Restaurant")
                address = ctx.get("address", "Address not provided")
                image_url = ctx.get("imageUrl", "")
                query = (
                    f"USER_WANTS_TO_BOOK: {restaurant_name}, Address: {address},"
                    f" ImageURL: {image_url}"
                )

            elif action == "submit_booking":
                restaurant_name = ctx.get("restaurantName", "Unknown Restaurant")
                party_size = ctx.get("partySize", "Unknown Size")
                reservation_time = ctx.get("reservationTime", "Unknown Time")
                dietary_reqs = ctx.get("dietary", "None")
                image_url = ctx.get("imageUrl", "")
                query = (
                    f"User submitted a booking for {restaurant_name} for {party_size}"
                    f" people at {reservation_time} with dietary requirements:"
                    f" {dietary_reqs}. The image URL is {image_url}"
                )

            else:
                query = f"User submitted an event: {action} with data: {ctx}"
        else:
            logger.info("No a2ui UI event part found. Falling back to text input.")
            query = context.get_user_input()

        logger.info(f"--- AGENT_EXECUTOR: Final query for LLM: '{query}' ---")

        task = context.current_task

        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        async for item in self._agent.stream(
            query,
            task.context_id,
            active_ui_version,
            client_ui_capabilities,
            use_streaming=use_streaming,
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

            final_state = (
                TaskState.completed
                if action == "submit_booking"
                else TaskState.input_required
            )

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
