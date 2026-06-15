# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import json
import logging
from typing import Any, ClassVar, Optional, Dict

from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2ui.a2a.extension import get_a2ui_agent_extension
from a2ui.adk.send_a2ui_to_client_toolset import A2uiEnabledProvider, A2uiCatalogProvider, A2uiExamplesProvider, SendA2uiToClientToolset
from a2ui.schema.manager import A2uiSchemaManager, VERSION_0_8, VERSION_0_9, CatalogConfig
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.planners.built_in_planner import BuiltInPlanner
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import PrivateAttr
from tools import get_calculator_app, calculate_via_mcp, get_pong_app_a2ui_json, score_update
from agent_executor import get_a2ui_enabled, get_a2ui_catalog, get_a2ui_examples

logger = logging.getLogger(__name__)

ROLE_DESCRIPTION = """
You are an expert A2UI Proxy Agent. Your primary functions are to fetch the Calculator App or the Pong App and display it to the user.
When the user asks for the calculator, you MUST call the `get_calculator_app` tool.
When the user asks for Pong, you MUST call the `get_pong_app_a2ui_json` tool.

IMPORTANT: Do NOT attempt to construct the JSON manually. The tools handle it automatically.

When the user interacts with the calculator and issues a `calculate` action, you MUST call the `calculate_via_mcp` tool to perform the calculation via the remote MCP server. Return the resulting number directly as text to the user.
"""

WORKFLOW_DESCRIPTION = """
1. **Analyze Request**: 
   - If User asks for calculator: Call `get_calculator_app`.
   - If User asks for Pong: Call `get_pong_app_a2ui_json`.
   - If User interacts with the calculator (ACTION: calculate): Extract 'operation', 'a', and 'b' from the event context and call `calculate_via_mcp`. Return the result to the user.
"""

UI_DESCRIPTION = """
Use `McpApp` component to render the external app content.
"""


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

    self._text_runner: Optional[Runner] = self._build_runner(self._build_llm_agent())

    self._schema_managers: Dict[str, A2uiSchemaManager] = {}
    self._ui_runners: Dict[str, Runner] = {}

    for version in [VERSION_0_8, VERSION_0_9]:
      schema_manager = self._build_schema_manager(version)
      self._schema_managers[version] = schema_manager
      agent = self._build_llm_agent(schema_manager)
      self._ui_runners[version] = self._build_runner(agent)

    self._agent_card = self._build_agent_card()

  @property
  def agent_card(self) -> AgentCard:
    return self._agent_card

  def get_runner(self, version: Optional[str]) -> Runner:
    if version is None:
      return self._text_runner
    return self._ui_runners[version]

  def get_schema_manager(self, version: Optional[str]) -> Optional[A2uiSchemaManager]:
    if version is None:
      return None
    return self._schema_managers[version]

  def _build_schema_manager(self, version: str) -> A2uiSchemaManager:
    return A2uiSchemaManager(
        version=version,
        catalogs=[
            CatalogConfig.from_path(
                name="mcp_app_proxy",
                catalog_path=f"catalogs/{version}/mcp_app_catalog.json",
            ),
        ],
        accepts_inline_catalogs=True,
    )

  def _build_agent_card(self) -> AgentCard:
    extensions = []
    if self._schema_managers:
      for version, sm in self._schema_managers.items():
        ext = get_a2ui_agent_extension(
            version,
            sm.accepts_inline_catalogs,
            sm.supported_catalog_ids,
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
                id="open_pong",
                name="Open Pong",
                description="Opens Pong, a simple HTML game.",
                tags=["html", "app", "demo", "tool"],
                examples=["open pong", "show pong"],
            ),
            AgentSkill(
                id="score_update",
                name="Score Update",
                description="Updates the score for Pong game.",
                tags=["pong", "score", "tool"],
                examples=[],
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
      self, schema_manager: Optional[A2uiSchemaManager] = None
  ) -> LlmAgent:
    """Builds the LLM agent for the contact agent."""
    instruction = (
        schema_manager.generate_system_prompt(
            role_description=ROLE_DESCRIPTION,
            workflow_description=WORKFLOW_DESCRIPTION,
            ui_description=UI_DESCRIPTION,
            include_schema=False,
            include_examples=False,
            validate_examples=False,
        )
        if schema_manager
        else ""
    )

    return LlmAgent(
        model=self._model,
        name=self._agent_name,
        description="An agent that provides access to MCP Apps.",
        instruction=instruction,
        tools=[
            get_calculator_app,
            calculate_via_mcp,
            get_pong_app_a2ui_json,
            score_update,
        ],
        planner=BuiltInPlanner(
            thinking_config=types.ThinkingConfig(
                include_thoughts=True,
            )
        ),
        disallow_transfer_to_peers=True,
    )
