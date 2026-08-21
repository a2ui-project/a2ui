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

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    Task,
    TaskState,
    UnsupportedOperationError,
)
from a2ui.a2a import _compat
from a2ui.a2a.parts import part_data_as_dict
from a2a.utils import (
    new_agent_parts_message,
    new_agent_text_message,
    new_task,
)
from a2a.utils.errors import ServerError
from a2ui.a2a.extension import try_activate_a2ui_extension
from agent import RestaurantAgent

logger = logging.getLogger(__name__)


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

        use_streaming = True
        if context.message and context.message.parts:
            logger.info(
                f"--- AGENT_EXECUTOR: Processing {len(context.message.parts)} message"
                " parts ---"
            )
            for i, part in enumerate(context.message.parts):
                data = part_data_as_dict(part)
                if data is not None:
                    if "useStreaming" in data:
                        use_streaming = data["useStreaming"]
                        logger.info(f"  Part {i}: Found useStreaming={use_streaming}")

                    if data.get("version") == "v0.9" and "action" in data:
                        logger.info(f"  Part {i}: Found a2ui v0.9 action payload.")
                        ui_event_part = data["action"]
                    elif "userAction" in data:
                        logger.info(
                            f"  Part {i}: Found a2ui v0.8 UI ClientEvent payload."
                        )
                        ui_event_part = data["userAction"]
                    else:
                        logger.info(f"  Part {i}: DataPart (data: {data})")
                elif _compat.is_text_part(part):
                    logger.info(
                        f"  Part {i}: TextPart (text: {_compat.part_text(part)})"
                    )
                else:
                    logger.info(f"  Part {i}: Unknown part type ({type(part)})")

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
            query, task.context_id, active_ui_version, use_streaming=use_streaming
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
                if _compat.is_text_part(part):
                    logger.info(
                        f"  - Part {i}: Text = {_compat.part_text(part)[:200]}..."
                    )
                elif _compat.is_data_part(part):
                    logger.info(
                        f"  - Part {i}: Data = {str(part_data_as_dict(part))[:200]}..."
                    )
                else:
                    logger.info(f"  - Part {i}: Type = {type(part)}")
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
