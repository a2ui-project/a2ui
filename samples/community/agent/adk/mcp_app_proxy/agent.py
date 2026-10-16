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

from collections.abc import Mapping
import logging
from typing import Any, ClassVar

from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from google.adk.agents.llm_agent import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.planners.built_in_planner import BuiltInPlanner
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from a2ui.a2a import get_a2ui_agent_extension
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.utils import to_version_number
from agent_executor import get_a2ui_enabled, get_a2ui_rules
from tools import (
    calculate_via_mcp,
    commentate_pong_game,
    get_calculator_app,
    get_pong_app_web_frame_json,
    get_pong_app_web_frame_srcdoc_json,
    get_pong_mcp_app_json,
)

logger = logging.getLogger(__name__)

ROLE_DESCRIPTION = """
You are an expert A2UI Proxy Agent. Your primary functions are to fetch the Calculator App or the Pong App and display it to the user.
When the user asks for the calculator, you MUST call the `get_calculator_app` tool.
When the user asks for Pong with MCP Apps, you MUST call the `get_pong_mcp_app_json` tool.
When the user asks for Pong with WebApp URL, you MUST call the `get_pong_app_web_frame_json` tool.
When the user asks for Pong with WebApp Srcdoc, you MUST call the `get_pong_app_web_frame_srcdoc_json` tool.

IMPORTANT: Do NOT attempt to construct the JSON manually. The tools handle it automatically.

When the user interacts with the calculator and issues a `calculate` action, you MUST call the `calculate_via_mcp` tool. Return the resulting number directly as text to the user.

When you receive a `"commentate_pong"` action, immediately call `commentate_pong_game` tool with `"game_event"` from `"context" -> "game_event"`. Do not reply with text; only call the tool.
"""

WORKFLOW_DESCRIPTION = """
1. **Analyze Request**: 
   - If User asks for calculator: Call `get_calculator_app`.
   - If User asks for Pong with MCP Apps: Call `get_pong_mcp_app_json`.
   - If User asks for Pong with WebApp URL: Call `get_pong_app_web_frame_json`.
   - If User asks for Pong with WebApp Srcdoc: Call `get_pong_app_web_frame_srcdoc_json`.
   - If User interacts with the calculator (ACTION: calculate): Extract 'operation', 'a', and 'b' from the event context and call `calculate_via_mcp`. Return the result to the user.
   - If you receive a `"commentate_pong"` action: Call `commentate_pong_game` with `"game_event"` from `"context" -> "game_event"`. Do not generate text responses; only call the tool.
"""

UI_DESCRIPTION = """
Use `McpApp` component to render the external app content.
"""

TEXT_DESCRIPTION = """
You are an A2UI Proxy Agent. This client can't display apps, so your final output MUST be a text response.
Do NOT call `get_calculator_app`, `get_pong_mcp_app_json`, `get_pong_app_web_frame_json` or `get_pong_app_web_frame_srcdoc_json`. If the user asks for the Calculator App or the Pong App, tell them that it needs a client that renders A2UI MCP Apps.
"""


def get_ui_prompt(base_rules: str) -> str:
    """Constructs the instruction for one UI request.

    Args:
        base_rules: The format rules of the request's processor, from
            `processor.format.prompt_generator.generate_base_rules()`.
    """
    return "\n\n".join([
        ROLE_DESCRIPTION,
        base_rules,
        WORKFLOW_DESCRIPTION,
        f"## UI Description:\n{UI_DESCRIPTION}",
    ])


class McpAppProxyAgent:
    """An agent that proxies MCP Apps.

    The agent holds one generator for each protocol version it speaks. The
    executor negotiates a processor for each request from the client's
    capabilities, and writes what the request needs into the session state:
    whether it uses A2UI, the format rules and the catalog that A2UI in the
    response is converted with. The instruction reads them from there, so one
    runner serves every request.
    """

    SUPPORTED_CONTENT_TYPES: ClassVar[list[str]] = ["text", "text/plain"]

    def __init__(
        self,
        base_url: str,
        model: Any,
    ):
        self.base_url = base_url
        self._model = model

        self._agent_name = "mcp_app_proxy_agent"
        self._user_id = "remote_agent"

        self._session_service = InMemorySessionService()
        self._memory_service = InMemoryMemoryService()
        self._artifact_service = InMemoryArtifactService()

        self._generators: dict[ProtocolVersion, A2uiGenerator] = {
            version: self._build_generator(version)
            for version in [ProtocolVersion.V0_8, ProtocolVersion.V0_9]
        }
        self._runner = self._build_runner()
        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    @property
    def runner(self) -> Runner:
        """The runner of every request, with or without A2UI."""
        return self._runner

    def create_processor(
        self, version: ProtocolVersion, client_ui_capabilities: Mapping[str, Any] | None
    ) -> A2uiRequestProcessor:
        """Negotiates the processor of one request from the client's capabilities.

        Args:
            version: The negotiated A2UI protocol version.
            client_ui_capabilities: The `a2uiClientCapabilities` that the client
                sent, keyed by protocol version, or None if it sent none.

        Raises:
            A2uiError: If the client sent no capabilities, or they are
                malformed or name no catalog that the agent can use.
        """
        return self._generators[version].create_processor(client_ui_capabilities)

    def _build_generator(self, version: ProtocolVersion) -> A2uiGenerator:
        config = CatalogConfig.from_path(
            catalog_path=f"catalogs/{to_version_number(version)}/mcp_app_catalog.json",
            protocol_version=version,
        )
        return A2uiGenerator([config], accepts_inline_catalogs=True)

    def _build_agent_card(self) -> AgentCard:
        extensions = [
            get_a2ui_agent_extension(
                version,
                generator.accepts_inline_catalogs,
                [c.transformed_catalog.catalog_id for c in generator.catalogs],
            )
            for version, generator in self._generators.items()
        ]

        capabilities = AgentCapabilities(
            streaming=True,
            extensions=extensions,
        )

        return AgentCard(
            name="MCP App Proxy Agent",
            description=(
                "Provides access to MCP Apps and HTML demos, such as the Calculator and"
                " Pong apps."
            ),
            url=self.base_url,
            version="1.0.0",
            default_input_modes=McpAppProxyAgent.SUPPORTED_CONTENT_TYPES,
            default_output_modes=McpAppProxyAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=capabilities,
            skills=[
                AgentSkill(
                    id="open_calculator",
                    name="Open Calculator",
                    description="Opens the calculator app.",
                    tags=["calculator", "app", "tool"],
                    examples=["open calculator", "show calculator"],
                ),
                AgentSkill(
                    id="open_pong_mcp",
                    name="Open Pong with MCP Apps",
                    description="Opens Pong using the MCP App method.",
                    tags=["html", "app", "demo", "tool"],
                    examples=["open pong with mcp apps"],
                ),
                AgentSkill(
                    id="open_pong_web_frame",
                    name="Open Pong with WebApp URL",
                    description="Opens Pong using the new WebAppFrame URL method.",
                    tags=["html", "app", "demo", "tool"],
                    examples=["open pong with webapp url"],
                ),
                AgentSkill(
                    id="open_pong_web_frame_srcdoc",
                    name="Open Pong with WebApp Srcdoc",
                    description="Opens Pong using the new WebAppFrame Srcdoc method.",
                    tags=["html", "app", "demo", "tool"],
                    examples=["open pong with webapp srcdoc"],
                ),
            ],
        )

    def _instruction(self, ctx: ReadonlyContext) -> str:
        """Returns the instruction of the current request.

        The executor records in the session state whether the request uses
        A2UI and the format rules of the request's processor.
        """
        if not get_a2ui_enabled(ctx):
            return TEXT_DESCRIPTION
        return get_ui_prompt(get_a2ui_rules(ctx))

    def _build_runner(self) -> Runner:
        """Builds the runner, whose instruction follows each request."""
        agent = LlmAgent(
            model=self._model,
            name=self._agent_name,
            description="An agent that provides access to MCP Apps.",
            instruction=self._instruction,
            tools=[
                get_calculator_app,
                calculate_via_mcp,
                get_pong_mcp_app_json,
                get_pong_app_web_frame_json,
                get_pong_app_web_frame_srcdoc_json,
                commentate_pong_game,
            ],
            planner=BuiltInPlanner(
                thinking_config=types.ThinkingConfig(
                    include_thoughts=True,
                )
            ),
            disallow_transfer_to_peers=True,
        )
        return Runner(
            app_name=self._agent_name,
            agent=agent,
            artifact_service=self._artifact_service,
            session_service=self._session_service,
            memory_service=self._memory_service,
        )
