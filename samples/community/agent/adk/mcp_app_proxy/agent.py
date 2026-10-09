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
import re
from collections.abc import Mapping, Sequence
from typing import Any, ClassVar

from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2ui.a2a import get_a2ui_agent_extension
from a2ui.core import CatalogApi
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.schema import VERSION_0_8, VERSION_0_9
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.planners.built_in_planner import BuiltInPlanner
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from tools import get_calculator_app, calculate_via_mcp, get_pong_mcp_app_json, get_pong_app_web_frame_json, get_pong_app_web_frame_srcdoc_json, commentate_pong_game
from agent_executor import get_a2ui_enabled, get_a2ui_catalog, get_a2ui_examples

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


def _renderer_capabilities(
    version: str,
    client_ui_capabilities: Mapping[str, Any] | None,
    catalog_ids: Sequence[str],
) -> dict[str, Any]:
    """Returns the client's capabilities keyed by protocol version.

    Clients may send the bare capabilities entry, and may leave out
    `supportedCatalogIds`, which then names every catalog of the agent.
    Capabilities that are already keyed by protocol version are only read
    under the negotiated version's key.

    Args:
        version: The negotiated A2UI protocol version.
        client_ui_capabilities: The capabilities that the client sent.
        catalog_ids: The ids of the agent's catalogs.

    Returns:
        The capabilities for `A2uiGenerator.create_processor`.
    """
    key = f"v{version}"
    if not client_ui_capabilities:
        return {key: {"supportedCatalogIds": list(catalog_ids)}}
    raw: Any = client_ui_capabilities
    if any(_is_version_key(k) for k in client_ui_capabilities):
        raw = client_ui_capabilities.get(key)
        if raw is None:
            return {key: {"supportedCatalogIds": list(catalog_ids)}}
        if not isinstance(raw, Mapping):
            # Left for `create_processor` to reject with a validation error.
            return {key: raw}
    entry = dict(raw)
    if "supportedCatalogIds" not in entry and "supported_catalog_ids" not in entry:
        entry["supportedCatalogIds"] = list(catalog_ids)
    return {key: entry}


def _is_version_key(key: Any) -> bool:
    """Whether a capabilities key names a protocol version, such as `v0.9`."""
    return (
        isinstance(key, str)
        and key.startswith("v")
        and bool(re.fullmatch(r"\d+(\.\d+)*", key[1:]))
    )


class McpAppProxyAgent:
    """An agent that proxies MCP Apps."""

    SUPPORTED_CONTENT_TYPES: ClassVar[list[str]] = ["text", "text/plain"]

    def __init__(
        self,
        base_url: str,
        model: Any,
    ):
        self.base_url = base_url
        self._model = model

        self._a2ui_enabled_provider = get_a2ui_enabled
        self._a2ui_catalog_provider = get_a2ui_catalog
        self._a2ui_examples_provider = get_a2ui_examples

        self._agent_name = "mcp_app_proxy_agent"
        self._user_id = "remote_agent"

        self._session_service = InMemorySessionService()
        self._memory_service = InMemoryMemoryService()
        self._artifact_service = InMemoryArtifactService()

        self._text_runner: Runner | None = self._build_runner(self._build_llm_agent())

        self._accepts_inline_catalogs = True
        self._generators: dict[str, A2uiGenerator] = {}
        self._processors: dict[str, A2uiRequestProcessor] = {}
        self._ui_runners: dict[str, Runner] = {}

        for version in [VERSION_0_8, VERSION_0_9]:
            generator = self._build_generator(version)
            processor = self._build_default_processor(version, generator)
            self._generators[version] = generator
            self._processors[version] = processor
            agent = self._build_llm_agent(processor)
            self._ui_runners[version] = self._build_runner(agent)

        self._agent_card = self._build_agent_card()

    @property
    def agent_card(self) -> AgentCard:
        return self._agent_card

    def get_runner(self, version: str | None) -> Runner:
        if version is None:
            return self._text_runner
        return self._ui_runners[version]

    def get_processor(self, version: str | None) -> A2uiRequestProcessor | None:
        if version is None:
            return None
        return self._processors[version]

    def create_processor(
        self, version: str, client_ui_capabilities: Mapping[str, Any] | None
    ) -> A2uiRequestProcessor:
        """Creates an A2uiRequestProcessor negotiated for the client's capabilities."""
        catalog_ids = [c.catalog_id for c in self._processors[version].active_catalogs]
        return self._generators[version].create_processor(
            _renderer_capabilities(version, client_ui_capabilities, catalog_ids)
        )

    def resolve_catalogs(
        self, version: str, client_ui_capabilities: Mapping[str, Any] | None
    ) -> list[CatalogApi]:
        """Returns the catalogs active for the client's capabilities."""
        return self.create_processor(version, client_ui_capabilities).active_catalogs

    def _build_generator(self, version: str) -> A2uiGenerator:
        config = CatalogConfig.from_path(
            catalog_path=f"catalogs/{version}/mcp_app_catalog.json",
            protocol_version=version,
        )
        return A2uiGenerator(
            [config],
            accepts_inline_catalogs=self._accepts_inline_catalogs,
        )

    def _build_default_processor(
        self, version: str, generator: A2uiGenerator
    ) -> A2uiRequestProcessor:
        catalog_ids = [c.transformed_catalog.catalog_id for c in generator.catalogs]
        return generator.create_processor(
            _renderer_capabilities(version, None, catalog_ids)
        )

    def _build_agent_card(self) -> AgentCard:
        extensions = []
        if self._processors:
            for version, processor in self._processors.items():
                ext = get_a2ui_agent_extension(
                    version,
                    self._accepts_inline_catalogs,
                    [c.catalog_id for c in processor.active_catalogs],
                )
                extensions.append(ext)

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

    def _build_runner(self, agent: LlmAgent) -> Runner:
        return Runner(
            app_name=self._agent_name,
            agent=agent,
            artifact_service=self._artifact_service,
            session_service=self._session_service,
            memory_service=self._memory_service,
        )

    def _build_llm_agent(
        self, processor: A2uiRequestProcessor | None = None
    ) -> LlmAgent:
        """Builds the LLM agent for the contact agent."""
        if processor:
            instruction = "\n\n".join([
                ROLE_DESCRIPTION,
                processor.format.prompt_generator.generate_base_rules(),
                WORKFLOW_DESCRIPTION,
                f"## UI Description:\n{UI_DESCRIPTION}",
            ])
        else:
            instruction = ""

        return LlmAgent(
            model=self._model,
            name=self._agent_name,
            description="An agent that provides access to MCP Apps.",
            instruction=instruction,
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
