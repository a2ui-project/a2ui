# Copyright 2025 Google LLC
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
    DataPart,
    Part,
    Task,
    TaskState,
    TextPart,
    UnsupportedOperationError,
)
from a2a.utils import (
    new_agent_parts_message,
    new_task,
)
from a2a.utils.errors import ServerError
from a2ui.a2a.extension import try_activate_a2ui_extension
from agent import A2uiDemoAgent

logger = logging.getLogger(__name__)

# The A2UI v0.9 client-to-server message envelope tags every message with this
# wire-protocol version string. It is the `version` value in a message shaped
# like `{"version": "v0.9", "action": {...}}` per the A2UI v0.9 client-to-server
# spec. Note this wire value ("v0.9") intentionally differs from the a2ui SDK's
# version constant a2ui.schema.constants.VERSION_0_9 ("0.9").
A2UI_CLIENT_MESSAGE_VERSION = "v0.9"


class A2uiDemoAgentExecutor(AgentExecutor):
    """AgentExecutor for the A2UI v0.9 Demo agent."""

    def __init__(self, agent: A2uiDemoAgent):
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
                "--- AGENT_EXECUTOR: A2UI extension is not active. Using text agent."
                " ---"
            )

        # This executor only supports non-streaming responses for now. Streaming
        # will be re-enabled once the backend changes it requires are in place.
        use_streaming = False
        if context.message and context.message.parts:
            logger.info(
                f"--- AGENT_EXECUTOR: Processing {len(context.message.parts)} message"
                " parts ---"
            )
            for i, part in enumerate(context.message.parts):
                if isinstance(part.root, DataPart):
                    data = part.root.data
                    version = data.get("version") if isinstance(data, dict) else None
                    event = (
                        data.get("action")
                        if isinstance(data, dict)
                        and version == A2UI_CLIENT_MESSAGE_VERSION
                        else None
                    )
                    if isinstance(event, dict) and event.get("name"):
                        logger.info(
                            f"  Part {i}: Found a2ui v0.9 client action payload."
                        )
                        ui_event_part = event
                    else:
                        logger.info(f"  Part {i}: DataPart (data: {data})")
                elif isinstance(part.root, TextPart):
                    logger.info(f"  Part {i}: TextPart (text: {part.root.text})")
                else:
                    logger.info(f"  Part {i}: Unknown part type ({type(part.root)})")

        if ui_event_part:
            logger.info(f"Received a2ui ClientEvent: {ui_event_part}")
            action = ui_event_part.get("name")
            ctx = ui_event_part.get("context")
            if not isinstance(ctx, dict):
                ctx = {}

            if action and action.startswith("run_demo"):
                # The "what can you do?" card renders a button per demo. The demo key is
                # encoded directly in the EVENT NAME as `run_demo_<key>` (e.g.
                # `run_demo_iframe_srcdoc`) so it is always present and never lost -
                # unlike an event `context` value, which the model may omit or fail to
                # bind. We still fall back to a `demo` context value (or the bare
                # `run_demo` name) for backward compatibility.
                demo = ""
                if action.startswith("run_demo_"):
                    demo = action[len("run_demo_") :]
                if not demo:
                    demo = ctx.get("demo", "")
                if not demo and ctx:
                    demo = next(iter(ctx.values()))
                demo = demo or "unknown"
                query = (
                    f"The user clicked the '{demo}' demo button. Render the A2UI UI for"
                    f" the '{demo}' demo now. Respond ONLY with the A2UI UI JSON."
                    " Do NOT call any tool and do NOT ask which demo to show."
                )

            elif action == "book_restaurant":
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

        # Non-streaming: drain the agent's response and only act on the final
        # (is_task_complete=True) item. Intermediate working updates are ignored
        # so the client receives a single, complete response.
        final_parts: list[Part] = []
        async for item in self._agent.stream(
            query, task.context_id, active_ui_version, use_streaming=use_streaming
        ):
            if item.get("is_task_complete"):
                final_parts = item["parts"]

        self._log_parts(final_parts)

        await updater.update_status(
            TaskState.completed,
            new_agent_parts_message(final_parts, task.context_id, task.id),
            final=True,
        )

    def _log_parts(self, parts: list[Part]):
        logger.info("--- FINAL PARTS TO BE SENT ---")
        for i, part in enumerate(parts):
            logger.info("  - Part %d: Type = %s", i, type(part.root))
            if isinstance(part.root, TextPart):
                logger.info("    - Text: %s...", part.root.text[:200])
            elif isinstance(part.root, DataPart):
                logger.info("    - Data: %s...", str(part.root.data)[:200])
        logger.info("-----------------------------")

    async def cancel(
        self, request: RequestContext, event_queue: EventQueue
    ) -> Task | None:
        raise ServerError(error=UnsupportedOperationError())
