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

import logging
from typing import override

from a2a.server.agent_execution import RequestContext
from a2ui.a2a import try_activate_a2ui_extension
from a2ui.adk import A2uiEventConverter, A2uiProcessorStore
from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY
from google.adk.a2a.converters.request_converter import AgentRunRequest
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutorConfig
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.runners import Runner

logger = logging.getLogger(__name__)

# The processor of each session's latest request. It can't be kept in session
# state, which ADK's session services save as JSON and copy on each load.
_A2UI_PROCESSORS = A2uiProcessorStore()


def get_a2ui_enabled(ctx: ReadonlyContext):
    """Checks if A2UI is enabled in the current session.

    Args:
        ctx: The ReadonlyContext for resolving enablement.

    Returns:
        True if A2UI is enabled, False otherwise.
    """
    return _A2UI_PROCESSORS.is_enabled(ctx)


class McpAppProxyAgentExecutor(A2aAgentExecutor):
    """Executor for the McpAppProxy agent."""

    def __init__(
        self,
        base_url: str,
        agent: "McpAppProxyAgent",
    ):
        self._base_url = base_url
        self._agent = agent

        # Bypass tool check when converting tool responses to A2A parts to escape
        # the need to make the tool call to `SendA2uiJsonToClientTool`. By removing
        # the tool call, we can reduce token usage and LLM hallucination
        # compromising the MCP Apps HTML content embedded in the A2UI JSON,
        # which significantly improves the reliability of the agent.
        config = A2aAgentExecutorConfig(
            event_converter=A2uiEventConverter(
                bypass_tool_check=True, a2ui_processor=_A2UI_PROCESSORS.get
            )
        )
        # Use the text runner as the default runner.
        super().__init__(runner=self._agent.get_runner(None), config=config)

    @override
    async def _prepare_session(
        self,
        context: RequestContext,
        run_request: AgentRunRequest,
        _runner: Runner,
    ):
        logger.info(f"Loading session for message {context.message}")

        active_ui_version = try_activate_a2ui_extension(context, self._agent.agent_card)
        runner = self._agent.get_runner(active_ui_version)

        session = await super()._prepare_session(context, run_request, runner)

        if "base_url" not in session.state:
            session.state["base_url"] = self._base_url

        processor = None
        if active_ui_version:
            client_capabilities = (
                context.message.metadata.get(A2UI_CLIENT_CAPABILITIES_KEY)
                if context.message and context.message.metadata
                else None
            )
            processor = self._agent.create_processor(
                active_ui_version, client_capabilities
            )

        _A2UI_PROCESSORS.set(session.id, processor)

        return session
