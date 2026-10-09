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

import logging
import re
from collections.abc import Mapping, Sequence
from typing import Any, ClassVar
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2ui.a2a import get_a2ui_agent_extension
from a2ui.adk import SendA2uiToClientToolset
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.schema import VERSION_0_8, VERSION_0_9
from google.adk.agents.llm_agent import LlmAgent
from google.adk.planners.built_in_planner import BuiltInPlanner
from google.genai import types
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from agent_executor import get_a2ui_enabled, get_a2ui_catalog, get_a2ui_examples
from google.adk.runners import Runner

try:
    from tools import get_sales_data, get_store_sales
except ImportError:
    from tools import get_sales_data, get_store_sales

logger = logging.getLogger(__name__)

RIZZCHARTS_CATALOG_URI = "https://github.com/a2ui-project/a2ui/blob/main/samples/agent/adk/rizzcharts/rizzcharts_catalog_definition.json"

ROLE_DESCRIPTION = """
You are an expert A2UI Ecommerce Dashboard analyst. Your primary function is to translate user requests for ecommerce data into A2UI JSON payloads to display charts and visualizations. You MUST use the `send_a2ui_json_to_client` tool with the `a2ui_json` argument set to the A2UI JSON payload to send to the client.
"""

WORKFLOW_DESCRIPTION = """
Your task is to analyze the user's request, fetch the necessary data, select the correct generic template, and send the corresponding A2UI JSON payload.

1.  **Analyze the Request:** Determine the user's intent (Visual Chart vs. Geospatial Map).
    * "show my sales breakdown by product category for q3" -> **Intent:** Chart.
    * "show revenue trends yoy by month" -> **Intent:** Chart.
    * "were there any outlier stores in the northeast region" -> **Intent:** Map.

2.  **Fetch Data:** Select and use the appropriate tool to retrieve the necessary data.
    * Use **`get_sales_data`** for general sales, revenue, and product category trends (typically for Charts).
    * Use **`get_store_sales`** for regional performance, store locations, and geospatial outliers (typically for Maps).

3.  **Select Example:** Based on the intent, choose the correct example block to use as your template.
    * **Intent** (Chart/Data Viz) -> Use `---BEGIN CHART EXAMPLE---`.
    * **Intent** (Map/Geospatial) -> Use `---BEGIN MAP EXAMPLE---`.

4.  **Construct the JSON Payload:**
    * Use the **entire** JSON array from the chosen example as the base value for the `a2ui_json` argument.
    * **Generate a new `surfaceId`:** You MUST generate a new, unique `surfaceId` for this request (e.g., `sales_breakdown_q3_surface`, `regional_outliers_northeast_surface`). This new ID must be used for the `surfaceId` in all three messages within the JSON array (`createSurface`, `updateComponents`, `updateDataModel`).
    * **Update the title Text:** You MUST update the `text` property of the `Text` component (the component with `id: "page_header"`) to accurately reflect the specific user query. For example, if the user asks for "Q3" sales, update the generic template text to "Q3 2025 Sales by Product Category".
    * Ensure the generated JSON perfectly matches the A2UI specification. It will be validated against the json_schema and rejected if it does not conform.  
    * If you get an error in the tool response apologize to the user and let them know they should try again.

5.  **Call the Tool:** Call the `send_a2ui_json_to_client` tool with the fully constructed `a2ui_json` payload.
"""

UI_DESCRIPTION = """
**Core Objective:** To provide a dynamic and interactive dashboard by constructing UI surfaces with the appropriate visualization components based on user queries.

**Key Components & Examples:**

You will be provided a schema that defines the A2UI message structure and two key generic component templates for displaying data.

1.  **Charts:** Used for requests about sales breakdowns, revenue performance, comparisons, or trends.
    * **Template:** Use the JSON from `---BEGIN CHART EXAMPLE---`.
2.  **Maps:** Used for requests about regional data, store locations, geography-based performance, or regional outliers.
    * **Template:** Use the JSON from `---BEGIN MAP EXAMPLE---`.

You will also use layout components like `Column` (as the `root`) and `Text` (to provide a title).
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


class RizzchartsAgent:
    """An agent that runs an ecommerce dashboard"""

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
        self._examples_paths: dict[str, dict[str, str | None]] = {}
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

    def get_examples_path(self, version: str, catalog_id: str) -> str | None:
        """Returns the examples directory path for the given version and catalog."""
        return self._examples_paths.get(version, {}).get(catalog_id)

    def _build_generator(self, version: str) -> A2uiGenerator:
        rizzcharts_config = CatalogConfig.from_path(
            catalog_path=(
                f"../catalog_schemas/{version}/rizzcharts_catalog_definition.json"
            ),
            protocol_version=version,
        )
        basic_config = CatalogConfig(BasicCatalog(version))
        configs = [rizzcharts_config, basic_config]
        catalogs = [config.transformed_catalog for config in configs]
        self._examples_paths[version] = {
            catalogs[0].catalog_id: f"../examples/rizzcharts_catalog/{version}",
            catalogs[1].catalog_id: f"../examples/standard_catalog/{version}",
        }
        return A2uiGenerator(
            configs,
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
        """Returns the AgentCard defining this agent's metadata and skills.

        Returns:
            An AgentCard object.
        """
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
            description="An agent that lets sales managers request sales data.",
            instruction=instruction,
            tools=[
                get_store_sales,
                get_sales_data,
                SendA2uiToClientToolset(
                    a2ui_catalog=self._a2ui_catalog_provider,
                    a2ui_enabled=self._a2ui_enabled_provider,
                    a2ui_examples=self._a2ui_examples_provider,
                ),
            ],
            planner=BuiltInPlanner(
                thinking_config=types.ThinkingConfig(
                    include_thoughts=True,
                )
            ),
            disallow_transfer_to_peers=True,
        )
