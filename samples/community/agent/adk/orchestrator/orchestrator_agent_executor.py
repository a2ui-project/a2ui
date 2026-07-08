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
import json
import asyncio
import re
import os
import httpx
from typing import Optional, Any, List, override

from google.adk.agents.invocation_context import new_invocation_context_id, InvocationContext
from google.adk.events.event_actions import EventActions
from google.adk.events.event import Event
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.a2a.converters.request_converter import AgentRunRequest
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutorConfig, A2aAgentExecutor
from google.adk.a2a.converters import event_converter, part_converter
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.agents.remote_a2a_agent import RemoteA2aAgent, DEFAULT_TIMEOUT, convert_genai_part_to_a2a_part
from google.adk.models.lite_llm import LiteLlm
from google.adk.agents.llm_agent import LlmAgent
from google.adk.planners.built_in_planner import BuiltInPlanner
from google.genai import types as genai_types

from a2a.server.agent_execution import RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.server.events import Event as A2AEvent
from a2a.client import A2ACardResolver
from a2a.client.client import Client, Consumer
from a2a.client.client import ClientConfig as A2AClientConfig
from a2a.client.client_factory import ClientFactory as A2AClientFactory
from a2a.client.middleware import ClientCallContext, ClientCallInterceptor
from a2a.extensions.common import HTTP_EXTENSION_HEADER
from a2a.types import TransportProtocol as A2ATransport, AgentCard, AgentCapabilities

from a2ui.a2a.extension import (
    try_activate_a2ui_extension,
    A2UI_EXTENSION_BASE_URI,
    AGENT_EXTENSION_SUPPORTED_CATALOG_IDS_KEY,
    AGENT_EXTENSION_ACCEPTS_INLINE_CATALOGS_KEY,
)
from a2ui.a2a.parts import is_a2ui_part
from a2ui.schema.constants import A2UI_CLIENT_CAPABILITIES_KEY

from subagent_route_manager import SubagentRouteManager

logger = logging.getLogger(__name__)


class A2UIMetadataInterceptor(ClientCallInterceptor):

    @override
    async def intercept(
        self,
        method_name: str,
        request_payload: dict[str, Any],
        http_kwargs: dict[str, Any],
        agent_card: AgentCard | None,
        context: ClientCallContext | None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Enables the A2UI extension header and adds A2UI client capabilities to remote agent message metadata."""
        logger.info(
            "Intercepting client call to method: "
            + method_name
            + " and payload "
            + json.dumps(request_payload)
        )

        if context and context.state and context.state.get("active_ui_version"):
            # Add A2UI extension header
            a2ui_extension_uri = (
                f"{A2UI_EXTENSION_BASE_URI}/v{context.state.get('active_ui_version')}"
            )
            http_kwargs["headers"] = {HTTP_EXTENSION_HEADER: a2ui_extension_uri}

            # Add A2UI client capabilities (supported catalogs, etc) to message metadata
            if (params := request_payload.get("params")) and (
                message := params.get("message")
            ):
                client_capabilities = context.state.get("client_capabilities")
                if "metadata" not in message:
                    message["metadata"] = {}
                message["metadata"][A2UI_CLIENT_CAPABILITIES_KEY] = client_capabilities
                logger.info(
                    "Added client capabilities to remote agent message metadata:"
                    f" {client_capabilities}"
                )

                # Data Model Stripping to prevent data leakage
                data_model = message.get("metadata", {}).get("a2uiClientDataModel")
                if data_model and "surfaces" in data_model:
                    if agent_card and agent_card.name:
                        current_surfaces = data_model["surfaces"]
                        surface_ids_to_check = list(current_surfaces.keys())
                        owner_agents = await asyncio.gather(*[
                            SubagentRouteManager.get_route_to_subagent_name(
                                sid, context.state
                            )
                            for sid in surface_ids_to_check
                        ])

                        filtered_surfaces = {}
                        for i, surface_id in enumerate(surface_ids_to_check):
                            if owner_agents[i] == agent_card.name:
                                filtered_surfaces[surface_id] = current_surfaces[
                                    surface_id
                                ]

                        message["metadata"]["a2uiClientDataModel"][
                            "surfaces"
                        ] = filtered_surfaces
                        logger.info(
                            f"Stripped data model for {agent_card.name}. "
                            f"Kept surfaces: {list(filtered_surfaces.keys())}"
                        )
                    else:
                        message["metadata"]["a2uiClientDataModel"]["surfaces"] = {}
                        logger.warning(
                            "No agent card or name provided. Stripped all surfaces from"
                            " data model."
                        )

        return request_payload, http_kwargs


class A2AClientFactoryWithA2UIMetadata(A2AClientFactory):

    @override
    def create(
        self,
        card: AgentCard,
        consumers: list[Consumer] | None = None,
        interceptors: list[ClientCallInterceptor] | None = None,
    ) -> Client:
        # Add A2UI metadata interceptor
        return super().create(
            card, consumers, (interceptors or []) + [A2UIMetadataInterceptor()]
        )


class OrchestratorAgentExecutor(A2aAgentExecutor):
    """Orchestrator AgentExecutor."""

    @classmethod
    async def programmtically_route_user_action_to_subagent(
        cls,
        callback_context: CallbackContext,
        llm_request: LlmRequest,
    ) -> LlmResponse:
        if (
            llm_request.contents
            and (last_content := llm_request.contents[-1]).parts
            and (a2a_part := convert_genai_part_to_a2a_part(last_content.parts[-1]))
            and is_a2ui_part(a2a_part)
            and (user_action := a2a_part.root.data.get("userAction"))
            and (surface_id := user_action.get("surfaceId"))
            and (
                target_agent := await SubagentRouteManager.get_route_to_subagent_name(
                    surface_id, callback_context.state
                )
            )
        ):
            logger.info(
                f"Programmatically routing userAction for surfaceId '{surface_id}' to"
                f" subagent '{target_agent}'"
            )
            return LlmResponse(
                content=genai_types.Content(
                    parts=[
                        genai_types.Part(
                            function_call=genai_types.FunctionCall(
                                name="transfer_to_agent",
                                args={"agent_name": target_agent},
                            )
                        )
                    ]
                )
            )

        return None

    @classmethod
    async def create(
        cls, base_url: str, subagent_urls: List[str]
    ) -> tuple["OrchestratorAgentExecutor", AgentCard]:
        """Creates the OrchestratorAgentExecutor and AgentCard."""
        orchestrator_agent, agent_card = await cls._build_agent(
            base_url=base_url, subagent_urls=subagent_urls
        )

        return cls(agent=orchestrator_agent, agent_card=agent_card), agent_card

    @classmethod
    async def _build_agent(
        cls, base_url: str, subagent_urls: List[str]
    ) -> tuple[LlmAgent, AgentCard]:
        """Builds the LLM agent for the orchestrator_agent agent."""

        subagents = []
        supported_catalog_ids = set()
        skills = []
        extensions = []
        accepts_inline_catalogs = False
        for subagent_url in subagent_urls:
            async with httpx.AsyncClient() as httpx_client:
                resolver = A2ACardResolver(
                    httpx_client=httpx_client,
                    base_url=subagent_url,
                )

                subagent_card = await resolver.get_agent_card()
                for extension in subagent_card.capabilities.extensions or []:
                    if extension.uri.startswith(A2UI_EXTENSION_BASE_URI):
                        if extension.params:
                            supported_catalog_ids.update(
                                extension.params.get(
                                    AGENT_EXTENSION_SUPPORTED_CATALOG_IDS_KEY
                                )
                                or []
                            )
                            accepts_inline_catalogs |= bool(
                                extension.params.get(
                                    AGENT_EXTENSION_ACCEPTS_INLINE_CATALOGS_KEY
                                )
                            )
                        # Only append unique extensions
                        if not any(ext.uri == extension.uri for ext in extensions):
                            extensions.append(extension)
                skills.extend(subagent_card.skills)

                logger.info(
                    "Successfully fetched public agent card:"
                    + subagent_card.model_dump_json(indent=2, exclude_none=True)
                )

                # clean name for adk
                clean_name = re.sub(r"[^0-9a-zA-Z_]+", "_", subagent_card.name)
                if clean_name == "":
                    clean_name = "_"
                if clean_name[0].isdigit():
                    clean_name = f"_{clean_name}"

                # make remote agent
                description = json.dumps(
                    {
                        "id": clean_name,
                        "name": subagent_card.name,
                        "description": subagent_card.description,
                        "skills": [
                            {
                                "name": skill.name,
                                "description": skill.description,
                                "examples": skill.examples,
                                "tags": skill.tags,
                            }
                            for skill in subagent_card.skills
                        ],
                    },
                    indent=2,
                )
                remote_a2a_agent = RemoteA2aAgent(
                    clean_name,
                    subagent_card,
                    description=description,  # This will be appended to system instructions
                    a2a_client_factory=A2AClientFactoryWithA2UIMetadata(
                        config=A2AClientConfig(
                            httpx_client=httpx.AsyncClient(
                                timeout=httpx.Timeout(timeout=DEFAULT_TIMEOUT),
                            ),
                            streaming=False,
                            polling=False,
                            supported_transports=[A2ATransport.jsonrpc],
                        )
                    ),
                )
                subagents.append(remote_a2a_agent)

                logger.info(f"Created remote agent with description: {description}")

        LITELLM_MODEL = os.getenv("LITELLM_MODEL", "gemini/gemini-3.5-flash")
        agent = LlmAgent(
            model=LiteLlm(model=LITELLM_MODEL),
            name="orchestrator_agent",
            description="An agent that orchestrates requests to multiple other agents",
            instruction=(
                "You are an orchestrator agent. Your sole responsibility is to analyze"
                " the incoming user request, determine the user's intent, and route the"
                " task to exactly one of your expert subagents"
            ),
            tools=[],
            planner=BuiltInPlanner(
                thinking_config=genai_types.ThinkingConfig(
                    include_thoughts=True,
                )
            ),
            sub_agents=subagents,
            before_model_callback=cls.programmtically_route_user_action_to_subagent,
        )

        agent_card = AgentCard(
            name="Orchestrator Agent",
            description="This agent orchestrates requests to multiple subagents.",
            url=base_url,
            version="1.0.0",
            default_input_modes=["text", "text/plain"],
            default_output_modes=["text", "text/plain"],
            capabilities=AgentCapabilities(
                streaming=True,
                extensions=extensions,
            ),
            skills=skills,
        )

        return agent, agent_card

    def __init__(self, agent: LlmAgent, agent_card: AgentCard):
        self._agent_card = agent_card
        config = A2aAgentExecutorConfig(
            event_converter=self.convert_event_to_a2a_events_and_save_surface_id_to_subagent_name,
        )

        runner = Runner(
            app_name=agent.name,
            agent=agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

        super().__init__(runner=runner, config=config)

    @classmethod
    def convert_event_to_a2a_events_and_save_surface_id_to_subagent_name(
        cls,
        event: Event,
        invocation_context: InvocationContext,
        task_id: Optional[str] = None,
        context_id: Optional[str] = None,
        part_converter: part_converter.GenAIPartToA2APartConverter = part_converter.convert_genai_part_to_a2a_part,
    ) -> List[A2AEvent]:
        a2a_events = event_converter.convert_event_to_a2a_events(
            event,
            invocation_context,
            task_id,
            context_id,
            part_converter,
        )

        for a2a_event in a2a_events:
            # Try to populate subagent agent card if available.
            subagent_card = None
            if active_subagent_name := event.author:
                # We need to find the subagent by name
                if subagent := next(
                    (
                        sub
                        for sub in invocation_context.agent.sub_agents
                        if sub.name == active_subagent_name
                    ),
                    None,
                ):
                    try:
                        subagent_card = json.loads(subagent.description)
                    except Exception:
                        logger.warning(
                            "Failed to parse agent description for"
                            f" {active_subagent_name}"
                        )
            if subagent_card:
                if a2a_event.metadata is None:
                    a2a_event.metadata = {}
                a2a_event.metadata["a2a_subagent"] = subagent_card

            for a2a_part in a2a_event.status.message.parts:
                if (
                    is_a2ui_part(a2a_part)
                    and (begin_rendering := a2a_part.root.data.get("beginRendering"))
                    and (surface_id := begin_rendering.get("surfaceId"))
                ):
                    asyncio.run_coroutine_threadsafe(
                        SubagentRouteManager.set_route_to_subagent_name(
                            surface_id,
                            event.author,
                            invocation_context.session_service,
                            invocation_context.session,
                        ),
                        asyncio.get_event_loop(),
                    )

        return a2a_events

    @override
    async def _prepare_session(
        self,
        context: RequestContext,
        run_request: AgentRunRequest,
        runner: Runner,
    ):
        session = await super()._prepare_session(context, run_request, runner)

        active_ui_version = try_activate_a2ui_extension(context, self._agent_card)
        if active_ui_version:
            client_capabilities = (
                context.message.metadata.get(A2UI_CLIENT_CAPABILITIES_KEY)
                if context.message and context.message.metadata
                else None
            )

            await runner.session_service.append_event(
                session,
                Event(
                    invocation_id=new_invocation_context_id(),
                    author="system",
                    actions=EventActions(
                        state_delta={
                            # These values are used to configure A2UI messages to remote agent calls
                            "active_ui_version": active_ui_version,
                            "client_capabilities": client_capabilities,
                        }
                    ),
                ),
            )

        return session
