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
from typing import TYPE_CHECKING, Any, override

from a2a.server.agent_execution import RequestContext
from google.adk.a2a.converters.request_converter import AgentRunRequest
from google.adk.a2a.executor.a2a_agent_executor import (
    A2aAgentExecutor,
    A2aAgentExecutorConfig,
)
from google.adk.agents.invocation_context import new_invocation_context_id
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.runners import Runner

from a2ui.a2a import try_activate_a2ui_extension
from a2ui.adk import A2uiEventConverter
from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY
from a2ui.core import A2uiError
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiRequestProcessor
from file_resolution import STATE_KEY_BASE_URL

if TYPE_CHECKING:
    from agent import FileUploadSummarizerAgent

logger = logging.getLogger(__name__)

_A2UI_ENABLED_KEY = "system:a2ui_enabled"
_A2UI_CATALOGS_KEY = "system:a2ui_catalogs"
_A2UI_EXAMPLES_KEY = "system:a2ui_examples"
_A2UI_RULES_KEY = "system:a2ui_rules"


def get_a2ui_enabled(ctx: ReadonlyContext) -> bool:
    """Checks if A2UI is enabled for the current request.

    Args:
        ctx: The ReadonlyContext for resolving enablement.

    Returns:
        True if A2UI is enabled, False otherwise.
    """
    return ctx.state.get(_A2UI_ENABLED_KEY, False)


def get_a2ui_rules(ctx: ReadonlyContext) -> str:
    """Retrieves the format rules of the request's processor from the session state.

    Args:
        ctx: The ReadonlyContext for resolving the rules.

    Returns:
        The format rules, or an empty string if not found.
    """
    return ctx.state.get(_A2UI_RULES_KEY) or ""


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
        super().__init__(runner=self._agent.runner, config=config)

    @override
    async def _prepare_session(
        self,
        context: RequestContext,
        run_request: AgentRunRequest,
        runner: Runner,
    ):
        logger.info(f"Loading session for message {context.message}")

        active_ui_version = try_activate_a2ui_extension(context, self._agent.agent_card)

        session = await super()._prepare_session(context, run_request, runner)

        # The processor lives for this request only. What the request needs
        # from it replaces the values of the previous request, so a request
        # without A2UI doesn't get the UI instruction or catalog of an earlier
        # one.
        state_delta = self._a2ui_state(
            self._create_processor(context, active_ui_version)
        )
        if STATE_KEY_BASE_URL not in session.state:
            state_delta[STATE_KEY_BASE_URL] = self._base_url
        await runner.session_service.append_event(
            session,
            Event(
                invocation_id=new_invocation_context_id(),
                author="system",
                actions=EventActions(state_delta=state_delta),
            ),
        )

        return session

    def _create_processor(
        self, context: RequestContext, version: ProtocolVersion | None
    ) -> A2uiRequestProcessor | None:
        """Negotiates the request's processor from the client's capabilities.

        Returns:
            The processor, or None if the request doesn't use A2UI or the
            client renders none of the agent's catalogs.
        """
        if not version:
            return None
        capabilities = (
            context.message.metadata.get(A2UI_CLIENT_CAPABILITIES_KEY)
            if context.message and context.message.metadata
            else None
        )
        try:
            return self._agent.create_processor(version, capabilities)
        except A2uiError as e:
            logger.warning(f"Cannot negotiate A2UI catalogs, answering in text: {e}")
            return None

    def _a2ui_state(self, processor: A2uiRequestProcessor | None) -> dict[str, Any]:
        """Returns the session state that the instruction and converter read."""
        if processor is None:
            return {
                _A2UI_ENABLED_KEY: False,
                _A2UI_CATALOGS_KEY: [],
                _A2UI_EXAMPLES_KEY: "",
                _A2UI_RULES_KEY: "",
            }
        return {
            _A2UI_ENABLED_KEY: True,
            _A2UI_CATALOGS_KEY: processor.active_catalogs,
            _A2UI_EXAMPLES_KEY: "",
            _A2UI_RULES_KEY: processor.format.prompt_generator.generate_base_rules(),
        }
