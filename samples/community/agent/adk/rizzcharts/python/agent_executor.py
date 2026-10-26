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

import json
import logging
import pathlib
from typing import override

from a2a.server.agent_execution import RequestContext
from a2ui.a2a import try_activate_a2ui_extension
from a2ui.adk import A2uiEventConverter
from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats import to_message_models
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.processor import A2uiRequestProcessor

from google.adk.a2a.converters.request_converter import AgentRunRequest
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutorConfig
from google.adk.agents.invocation_context import new_invocation_context_id
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.runners import Runner

logger = logging.getLogger(__name__)

_A2UI_ENABLED_KEY = "system:a2ui_enabled"
_A2UI_PROCESSOR_KEY = "system:a2ui_processor"


def _load_example_turns(path: str | None) -> list[list[AgentToRendererMessage]]:
    """Loads each JSON file in the directory as one example turn."""
    if not path:
        return []
    return [
        to_message_models(json.loads(file.read_text(encoding="utf-8")))
        for file in sorted(pathlib.Path(path).glob("*.json"))
    ]


def get_a2ui_processor(ctx: ReadonlyContext) -> A2uiRequestProcessor:
    """Retrieves the request's A2UI processor from the session state.

    Args:
        ctx: The ReadonlyContext for resolving the processor.

    Returns:
        The A2uiRequestProcessor negotiated for the client's capabilities.
    """
    return ctx.state[_A2UI_PROCESSOR_KEY]


def get_a2ui_enabled(ctx: ReadonlyContext):
    """Checks if A2UI is enabled in the current session.

    Args:
        ctx: The ReadonlyContext for resolving enablement.

    Returns:
        True if A2UI is enabled, False otherwise.
    """
    return ctx.state.get(_A2UI_ENABLED_KEY, False)


from agent import RizzchartsAgent


class RizzchartsAgentExecutor(A2aAgentExecutor):
    """Executor for the Rizzcharts agent that handles A2UI session setup."""

    def __init__(
        self,
        base_url: str,
        agent: RizzchartsAgent,
    ):
        self._base_url = base_url
        self._agent = agent

        config = A2aAgentExecutorConfig(event_converter=A2uiEventConverter())
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

        if active_ui_version:
            capabilities = (
                context.message.metadata.get(A2UI_CLIENT_CAPABILITIES_KEY)
                if context.message and context.message.metadata
                else None
            )
            negotiated = self._agent.create_processor(active_ui_version, capabilities)
            # The rizzcharts catalog already contains every basic component, so
            # passing the basic catalog too would repeat those schemas in the
            # prompt. Use only the preferred catalog, which the examples match.
            a2ui_catalogs = negotiated.active_catalogs[:1]
            examples_path = self._agent.get_examples_path(
                active_ui_version, a2ui_catalogs[0].catalog_id
            )
            processor = A2uiRequestProcessor(
                a2ui_catalogs,
                examples=_load_example_turns(examples_path),
                format_factory=DirectJsonFormatFactory(),
            )

            await runner.session_service.append_event(
                session,
                Event(
                    invocation_id=new_invocation_context_id(),
                    author="system",
                    actions=EventActions(
                        state_delta={
                            _A2UI_ENABLED_KEY: True,
                            _A2UI_PROCESSOR_KEY: processor,
                        }
                    ),
                ),
            )

        return session
