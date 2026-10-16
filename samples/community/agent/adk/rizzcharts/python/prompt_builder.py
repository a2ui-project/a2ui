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

"""Prompt builder for the rizzcharts agent.

The instruction of a UI request holds the role, the format rules of the
request's processor, the workflow and the UI description. The catalog schema
and the examples of the request's catalog are added by
`SendA2uiToClientToolset`. The executor writes all of them into the session
state for each request, from the processor that it negotiates with the client.
"""

# pylint: disable=g-importing-member, line-too-long
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json import schema_to_prompt
from a2ui.processor import A2uiGenerator, CatalogConfig
from a2ui.utils import load_examples, to_version_number

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


def get_text_prompt() -> str:
    """Constructs the instruction for a request without A2UI."""
    return """
    You are an expert Ecommerce Dashboard analyst. This client can't show charts or maps, so your final output MUST be a text response.

    1.  Use `get_sales_data` for general sales, revenue and product category trends.
    2.  Use `get_store_sales` for regional performance, store locations and outliers.
    3.  Summarize the data that the tool returns as a short, human-readable text response.
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


if __name__ == "__main__":
    # Builds the prompt of a request from a client that renders the rizzcharts
    # and the basic catalogs, as the agent does: the instruction, then the
    # schema and the examples that `SendA2uiToClientToolset` adds.
    version = ProtocolVersion.V0_9
    rizzcharts_config = CatalogConfig.from_path(
        catalog_path=f"../catalog_schemas/{to_version_number(version)}/rizzcharts_catalog_definition.json",
        protocol_version=version,
    )
    basic_config = CatalogConfig(BasicCatalog(version))
    generator = A2uiGenerator([rizzcharts_config, basic_config])
    processor = generator.create_processor({
        version.value: {
            "supportedCatalogIds": [
                rizzcharts_config.transformed_catalog.catalog_id,
                basic_config.transformed_catalog.catalog_id,
            ]
        }
    })
    rizzcharts_catalog, basic_catalog = processor.active_catalogs

    print("Building prompt and validating rizzcharts examples...")
    rizzcharts_examples = load_examples(
        processor.active_catalogs,
        f"../examples/rizzcharts_catalog/{to_version_number(version)}",
        validate=True,
    )
    prompt_parts = [
        get_ui_prompt(processor.format.prompt_generator.generate_base_rules()),
        schema_to_prompt([rizzcharts_catalog]),
    ]
    if rizzcharts_examples:
        prompt_parts.append(rizzcharts_examples)
    output = "\n\n".join(prompt_parts)

    # Also validate the examples that a client with only the basic catalog gets.
    print("Validating standard catalog examples...")
    std_examples = load_examples(
        [basic_catalog, rizzcharts_catalog],
        f"../examples/standard_catalog/{to_version_number(version)}",
        validate=True,
    )
    if std_examples:
        output += f"\n\n### Standard Catalog Examples:\n{std_examples}"

    print(output)

    with open("generated_prompt.txt", "w") as f:
        f.write(output)
    print("\nGenerated prompt saved to generated_prompt.txt")
