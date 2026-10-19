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

import hashlib
import json
import logging
from typing import TYPE_CHECKING, Any

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
from typing_extensions import override

from a2ui.a2a import try_activate_a2ui_extension
from a2ui.adk import A2uiEventConverter
from a2ui.constants import (
    A2UI_CLIENT_CAPABILITIES_KEY,
    A2UI_RENDERER_CAPABILITIES_KEY,
)
from a2ui.core import A2uiError
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiRequestProcessor

if TYPE_CHECKING:
    from agent import RizzchartsAgent

logger = logging.getLogger(__name__)

_A2UI_ENABLED_KEY = "system:a2ui_enabled"
_A2UI_CATALOGS_KEY = "system:a2ui_catalogs"
_A2UI_EXAMPLES_KEY = "system:a2ui_examples"
_A2UI_RULES_KEY = "system:a2ui_rules"
_A2UI_NEGOTIATION_KEY = "system:a2ui_negotiation"


def _capabilities_key(version: ProtocolVersion) -> str:
    """Returns the message metadata key of the client's capabilities.

    v1.0 renames the client to the renderer, and its capabilities key with it.
    """
    if version in (ProtocolVersion.V0_8, ProtocolVersion.V0_9):
        return A2UI_CLIENT_CAPABILITIES_KEY
    return A2UI_RENDERER_CAPABILITIES_KEY


def _negotiation_key(version: ProtocolVersion | None, capabilities: Any | None) -> str:
    """Returns a digest of what the request's A2UI session state follows from.

    The state follows from the negotiated version and the client's
    capabilities alone, so two requests with the same digest get the same
    state.
    """
    negotiation = [version.value if version else None, capabilities]
    return hashlib.sha256(
        json.dumps(negotiation, sort_keys=True, default=str).encode()
    ).hexdigest()


def get_a2ui_catalogs(ctx: ReadonlyContext):
    """Retrieves the active A2UI catalogs from the session state.

    Args:
        ctx: The ReadonlyContext for resolving the catalogs.

    Returns:
        The active A2UI catalogs, or an empty list if none are found.
    """
    return ctx.state.get(_A2UI_CATALOGS_KEY) or []


def get_a2ui_examples(ctx: ReadonlyContext):
    """Retrieves the A2UI examples from the session state.

    Args:
        ctx: The ReadonlyContext for resolving the examples.

    Returns:
        The A2UI examples or None if not found.
    """
    return ctx.state.get(_A2UI_EXAMPLES_KEY)


def get_a2ui_enabled(ctx: ReadonlyContext):
    """Checks if A2UI is enabled in the current session.

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


class RizzchartsAgentExecutor(A2aAgentExecutor):
    """Executor for the Rizzcharts agent that handles A2UI session setup."""

    def __init__(
        self,
        base_url: str,
        agent: "RizzchartsAgent",
    ):
        self._base_url = base_url
        self._agent = agent

        config = A2aAgentExecutorConfig(event_converter=A2uiEventConverter())
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

        if "base_url" not in session.state:
            session.state["base_url"] = self._base_url

        # The processor lives for this request only. What the prompt needs
        # from it replaces the values of the previous request, so a request
        # without A2UI doesn't get the UI tool or instruction of an earlier one.
        # A request that negotiates as the previous one did finds its values
        # in the session state already, so it adds no event to the session.
        capabilities = self._client_capabilities(context, active_ui_version)
        negotiation = _negotiation_key(active_ui_version, capabilities)
        if session.state.get(_A2UI_NEGOTIATION_KEY) == negotiation:
            return session
        state_delta = self._a2ui_state(
            active_ui_version,
            self._create_processor(active_ui_version, capabilities),
        )
        state_delta[_A2UI_NEGOTIATION_KEY] = negotiation
        await runner.session_service.append_event(
            session,
            Event(
                invocation_id=new_invocation_context_id(),
                author="system",
                actions=EventActions(state_delta=state_delta),
            ),
        )

        return session

    @staticmethod
    def _client_capabilities(
        context: RequestContext, version: ProtocolVersion | None
    ) -> Any | None:
        """Returns the capabilities that the client sent for `version`, if any."""
        if not version:
            return None
        metadata = (
            context.message.metadata
            if context.message and context.message.metadata
            else {}
        )
        return metadata.get(_capabilities_key(version))

    def _create_processor(
        self, version: ProtocolVersion | None, capabilities: Any | None
    ) -> A2uiRequestProcessor | None:
        """Negotiates the request's processor from the client's capabilities.

        Returns:
            The processor, or None if the request doesn't use A2UI or the
            client renders none of the agent's catalogs.
        """
        if not version:
            return None
        try:
            return self._agent.create_processor(version, capabilities)
        except A2uiError as e:
            logger.warning(f"Cannot negotiate A2UI catalogs, answering in text: {e}")
            return None

    def _a2ui_state(
        self, version: ProtocolVersion | None, processor: A2uiRequestProcessor | None
    ) -> dict[str, Any]:
        """Returns the session state that the instruction and UI tool read.

        The request is answered in text if it doesn't use A2UI, or if the
        negotiated catalogs can't render the agent's examples, such as a v1.0
        client that names the rizzcharts catalog without the basic catalog
        that a v1.0 rizzcharts surface defaults to.
        """
        text_state = {
            _A2UI_ENABLED_KEY: False,
            _A2UI_CATALOGS_KEY: [],
            _A2UI_EXAMPLES_KEY: "",
            _A2UI_RULES_KEY: "",
        }
        if version is None or processor is None:
            return text_state
        # A v1.0 surface mixes catalogs: the basic catalog is its default and
        # the rizzcharts components name their own catalog, so the prompt and
        # validation need every negotiated catalog. Up to v0.9 a surface uses
        # one catalog, and the rizzcharts catalog already contains every basic
        # component, so only the preferred catalog is passed on.
        if version in (ProtocolVersion.V0_8, ProtocolVersion.V0_9):
            a2ui_catalogs = processor.active_catalogs[:1]
        else:
            a2ui_catalogs = processor.active_catalogs
        catalog_ids = [c.catalog_id for c in a2ui_catalogs]
        examples = self._agent.get_examples(version, catalog_ids)
        if examples is None:
            logger.warning(
                f"No examples fit the A2UI catalogs {catalog_ids}, answering in text."
            )
            return text_state
        try:
            rules = processor.format.prompt_generator.generate_base_rules()
        except A2uiError as e:
            logger.warning(
                f"Cannot build the A2UI format rules, answering in text: {e}"
            )
            return text_state
        return {
            _A2UI_ENABLED_KEY: True,
            _A2UI_CATALOGS_KEY: a2ui_catalogs,
            _A2UI_EXAMPLES_KEY: examples,
            _A2UI_RULES_KEY: rules,
        }
