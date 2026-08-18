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
from a2ui.a2a.extension import try_activate_a2ui_extension
from a2ui.adk.a2a.event_converter import A2uiEventConverter
from a2ui.schema.constants import A2UI_CLIENT_CAPABILITIES_KEY
from google.adk.a2a.converters.request_converter import AgentRunRequest
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor, A2aAgentExecutorConfig
from google.adk.agents.invocation_context import new_invocation_context_id
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.runners import Runner
from file_resolution import STATE_KEY_BASE_URL

logger = logging.getLogger(__name__)

_A2UI_ENABLED_KEY = "system:a2ui_enabled"
_A2UI_CATALOG_KEY = "system:a2ui_catalog"
_A2UI_EXAMPLES_KEY = "system:a2ui_examples"


class FileUploadSummarizerAgentExecutor(A2aAgentExecutor):
    """Executor for the FileUploadSummarizer agent."""

    def __init__(
        self,
        base_url: str,
        agent: "FileUploadSummarizerAgent",
    ):
        self._base_url = base_url
        self._agent = agent

        config = A2aAgentExecutorConfig(
            event_converter=A2uiEventConverter(bypass_tool_check=True)
        )
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
        inference_format = self._agent.get_inference_format(active_ui_version)

        session = await super()._prepare_session(context, run_request, runner)

        if STATE_KEY_BASE_URL not in session.state:
            await runner.session_service.append_event(
                session,
                Event(
                    invocation_id=new_invocation_context_id(),
                    author="system",
                    actions=EventActions(
                        state_delta={STATE_KEY_BASE_URL: self._base_url}
                    ),
                ),
            )

        if active_ui_version:
            client_capabilities = (
                context.message.metadata.get(A2UI_CLIENT_CAPABILITIES_KEY)
                if context.message and context.message.metadata
                else None
            )
            a2ui_catalog = (
                inference_format.get_selected_catalog(
                    client_ui_capabilities=client_capabilities
                )
                if inference_format
                else None
            )

            examples = ""

            await runner.session_service.append_event(
                session,
                Event(
                    invocation_id=new_invocation_context_id(),
                    author="system",
                    actions=EventActions(
                        state_delta={
                            _A2UI_ENABLED_KEY: True,
                            _A2UI_CATALOG_KEY: a2ui_catalog,
                            _A2UI_EXAMPLES_KEY: examples,
                        }
                    ),
                ),
            )

        return session
