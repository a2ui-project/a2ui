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
from a2ui.adk import SendA2uiToClientToolset
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.utils import to_version_number
from agent_executor import (
    get_a2ui_catalogs,
    get_a2ui_enabled,
    get_a2ui_examples,
    get_a2ui_rules,
)
from prompt_builder import get_text_prompt, get_ui_prompt
from tools import get_sales_data, get_store_sales

logger = logging.getLogger(__name__)


class RizzchartsAgent:
    """An agent that runs an ecommerce dashboard.

    The agent holds one generator for each protocol version it speaks. The
    executor negotiates a processor for each request from the client's
    capabilities, and writes what the request's prompt needs into the session
    state: whether the request uses A2UI, the format rules, the catalog and
    its examples. The instruction and `SendA2uiToClientToolset` read them from
    there, so one runner serves every request.
    """

    SUPPORTED_CONTENT_TYPES: ClassVar[list[str]] = ["text", "text/plain"]

    def __init__(
        self,
        base_url: str,
        model: Any,
    ):
        self.base_url = base_url
        self._model = model

        self._agent_name = "rizzcharts_agent"
        self._user_id = "remote_agent"

        self._session_service = InMemorySessionService()
        self._memory_service = InMemoryMemoryService()
        self._artifact_service = InMemoryArtifactService()

        self._examples_paths: dict[ProtocolVersion, dict[str, str]] = {}
        self._generators: dict[ProtocolVersion, A2uiGenerator] = {
            version: self._build_generator(version)
            for version in [
                ProtocolVersion.V0_8,
                ProtocolVersion.V0_9,
                ProtocolVersion.V1_0,
            ]
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
            client_ui_capabilities: The capabilities that the client sent,
                keyed by protocol version (`a2uiClientCapabilities` up to v0.9,
                `a2uiRendererCapabilities` from v1.0), or None if it sent none.

        Raises:
            A2uiError: If the client sent no capabilities, or they are
                malformed or name no catalog that the agent can use.
        """
        return self._generators[version].create_processor(client_ui_capabilities)

    def get_examples_path(
        self, version: ProtocolVersion, catalog_id: str
    ) -> str | None:
        """Returns the examples directory path for the given version and catalog."""
        return self._examples_paths.get(version, {}).get(catalog_id)

    def _build_generator(self, version: ProtocolVersion) -> A2uiGenerator:
        rizzcharts_config = CatalogConfig.from_path(
            catalog_path=(
                f"../catalog_schemas/{to_version_number(version)}/rizzcharts_catalog_definition.json"
            ),
            protocol_version=version,
        )
        basic_config = CatalogConfig(BasicCatalog(version))
        self._examples_paths[version] = {
            rizzcharts_config.transformed_catalog.catalog_id: (
                f"../examples/rizzcharts_catalog/{to_version_number(version)}"
            ),
            basic_config.transformed_catalog.catalog_id: (
                f"../examples/standard_catalog/{to_version_number(version)}"
            ),
        }
        return A2uiGenerator(
            [rizzcharts_config, basic_config],
            accepts_inline_catalogs=True,
        )

    def _build_agent_card(self) -> AgentCard:
        """Returns the AgentCard defining this agent's metadata and skills.

        Returns:
            An AgentCard object.
        """
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
            name="Ecommerce Dashboard Agent",
            description=(
                "This agent visualizes ecommerce data, showing sales breakdowns, YOY"
                " revenue performance, and regional sales outliers."
            ),
            url=self.base_url,
            version="1.0.0",
            default_input_modes=RizzchartsAgent.SUPPORTED_CONTENT_TYPES,
            default_output_modes=RizzchartsAgent.SUPPORTED_CONTENT_TYPES,
            capabilities=capabilities,
            skills=[
                AgentSkill(
                    id="view_sales_by_category",
                    name="View Sales by Category",
                    description=(
                        "Displays a pie chart of sales broken down by product category"
                        " for a given time period."
                    ),
                    tags=["sales", "breakdown", "category", "pie chart", "revenue"],
                    examples=[
                        "show my sales breakdown by product category for q3",
                        "What's the sales breakdown for last month?",
                    ],
                ),
                AgentSkill(
                    id="view_regional_outliers",
                    name="View Regional Sales Outliers",
                    description=(
                        "Displays a map showing regional sales outliers or store-level"
                        " performance."
                    ),
                    tags=[
                        "sales",
                        "regional",
                        "outliers",
                        "stores",
                        "map",
                        "performance",
                    ],
                    examples=[
                        "interesting. were there any outlier stores",
                        "show me a map of store performance",
                    ],
                ),
            ],
        )

    def _instruction(self, ctx: ReadonlyContext) -> str:
        """Returns the instruction of the current request.

        The executor records in the session state whether the request uses
        A2UI and the format rules of the request's processor.
        """
        if not get_a2ui_enabled(ctx):
            return get_text_prompt()
        return get_ui_prompt(get_a2ui_rules(ctx))

    def _build_runner(self) -> Runner:
        """Builds the runner, whose instruction and UI tool follow each request."""
        agent = LlmAgent(
            model=self._model,
            name=self._agent_name,
            description="An agent that lets sales managers request sales data.",
            instruction=self._instruction,
            tools=[
                get_store_sales,
                get_sales_data,
                SendA2uiToClientToolset(
                    a2ui_catalogs=get_a2ui_catalogs,
                    a2ui_enabled=get_a2ui_enabled,
                    a2ui_examples=get_a2ui_examples,
                ),
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
