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
from a2a.types import DataPart, Task, TaskState, UnsupportedOperationError
from a2a.utils import new_agent_parts_message, new_task
from a2a.utils.errors import ServerError

from a2ui.a2a import try_activate_a2ui_extension
from agent import SalesDashboardAgent

logger = logging.getLogger(__name__)

# The message metadata key of the renderer capabilities in the v1.0 A2A
# extension.
RENDERER_CAPABILITIES_KEY = "a2uiRendererCapabilities"


class SalesDashboardAgentExecutor(AgentExecutor):
    """Runs the sales dashboard agent for A2A requests."""

    def __init__(self, agent: SalesDashboardAgent):
        self._agent = agent

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        active_ui_version = try_activate_a2ui_extension(context, self._agent.agent_card)
        metadata = (context.message.metadata if context.message else None) or {}

        # The renderer sends the catalogs it renders, keyed by protocol version,
        # in the metadata key that the v1.0 A2A extension defines. The client
        # also says whether it reads the response as a stream.
        client_ui_capabilities = (
            metadata.get(RENDERER_CAPABILITIES_KEY) if active_ui_version else None
        )
        use_streaming = bool(metadata.get("useStreaming", True))
        logger.info(
            f"--- A2UI version: {active_ui_version}, streaming: {use_streaming},"
            f" capabilities: {client_ui_capabilities} ---"
        )

        query = context.get_user_input()
        for part in context.message.parts if context.message else []:
            if not isinstance(part.root, DataPart):
                continue
            action = part.root.data.get("action")
            if not isinstance(action, dict):
                continue
            logger.info(f"--- Received A2UI action: {action} ---")
            action_context = action.get("context") or {}
            if action.get("name") == "refresh_dashboard":
                query = (
                    "USER_REFRESHED_DASHBOARD:"
                    f" {action_context.get('region', 'North America')}"
                )
            else:
                query = (
                    f"User sent the event {action.get('name')} with {action_context}"
                )
        logger.info(f"--- Query for the model: {query!r} ---")

        task = context.current_task
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        async for item in self._agent.stream(
            query,
            task.context_id,
            client_ui_capabilities,
            use_streaming=use_streaming,
        ):
            message = new_agent_parts_message(item["parts"], task.context_id, task.id)
            if not item["is_task_complete"]:
                await updater.update_status(TaskState.working, message)
                continue
            logger.info(f"--- Sending {len(item['parts'])} final parts ---")
            await updater.update_status(TaskState.input_required, message, final=True)
            break

    async def cancel(
        self, request: RequestContext, event_queue: EventQueue
    ) -> Task | None:
        raise ServerError(error=UnsupportedOperationError())
