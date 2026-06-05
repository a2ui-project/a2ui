/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.a2ui.samples.rizzcharts;

import com.google.a2ui.adk.a2a_extension.SendA2uiToClientToolset;
import com.google.a2ui.schema.A2uiCatalog;
import com.google.a2ui.schema.A2uiSchemaManager;
import com.google.adk.agents.Instruction;
import com.google.adk.agents.LlmAgent;
import com.google.adk.agents.ReadonlyContext;
import com.google.adk.models.BaseLlm;
import java.util.List;
import java.util.function.Function;

public class RizzchartsAgent extends LlmAgent {

  private static final String ROLE_DESCRIPTION =
      "You are an expert A2UI Ecommerce Dashboard analyst. Your primary function is to translate user requests for ecommerce data into A2UI JSON payloads to display charts and visualizations. You MUST use the `send_a2ui_json_to_client` tool with the `a2ui_json` argument set to the A2UI JSON payload to send to the client.\n";

  private static final String WORKFLOW_DESCRIPTION =
      "Your task is to analyze the user's request, fetch the necessary data, select the correct generic template, and send the corresponding A2UI JSON payload.\n\n"
          + "1.  **Analyze the Request:** Determine the user's intent (Visual Chart vs. Geospatial Map).\n"
          + "    * \"show my sales breakdown by product category for q3\" -> **Intent:** Chart.\n"
          + "    * \"show revenue trends yoy by month\" -> **Intent:** Chart.\n"
          + "    * \"were there any outlier stores in the northeast region\" -> **Intent:** Map.\n\n"
          + "2.  **Fetch Data:** Select and use the appropriate tool to retrieve the necessary data.\n"
          + "    * Use **`get_sales_data`** for general sales, revenue, and product category trends (typically for Charts).\n"
          + "    * Use **`get_store_sales`** for regional performance, store locations, and geospatial outliers (typically for Maps).\n\n"
          + "3.  **Select Example:** Based on the intent, choose the correct example block to use as your template.\n"
          + "    * **Intent** (Chart/Data Viz) -> Use `---BEGIN chart---`.\n"
          + "    * **Intent** (Map/Geospatial) -> Use `---BEGIN map---`.\n\n"
          + "4.  **Construct the JSON Payload:**\n"
          + "    * Use the **entire** JSON array from the chosen example as the base value for the `a2ui_json` argument.\n"
          + "    * **Generate a new `surfaceId`:** You MUST generate a new, unique `surfaceId` for this request (e.g., `sales_breakdown_q3_surface`, `regional_outliers_northeast_surface`). This new ID must be used for the `surfaceId` in all three messages within the JSON array (`beginRendering`, `surfaceUpdate`, `dataModelUpdate`).\n"
          + "    * **Update the title Text:** You MUST update the `literalString` value for the `Text` component (the component with `id: \"page_header\"`) to accurately reflect the specific user query. For example, if the user asks for \"Q3\" sales, update the generic template text to \"Q3 2025 Sales by Product Category\".\n"
          + "    * Ensure the generated JSON perfectly matches the A2UI specification. It will be validated against the json_schema and rejected if it does not conform.  \n"
          + "    * If you get an error in the tool response apologize to the user and let them know they should try again.\n\n"
          + "5.  **Call the Tool:** Call the `send_a2ui_json_to_client` tool with the fully constructed `a2ui_json` payload.\n";

  private static final String UI_DESCRIPTION =
      "**Core Objective:** To provide a dynamic and interactive dashboard by constructing UI surfaces with the appropriate visualization components based on user queries.\n\n"
          + "**Key Components & Examples:**\n\n"
          + "You will be provided a schema that defines the A2UI message structure and two key generic component templates for displaying data.\n\n"
          + "1.  **Charts:** Used for requests about sales breakdowns, revenue performance, comparisons, or trends.\n"
          + "    * **Template:** Use the JSON from `---BEGIN chart---`.\n"
          + "2.  **Maps:** Used for requests about regional data, store locations, geography-based performance, or regional outliers.\n"
          + "    * **Template:** Use the JSON from `---BEGIN map---`.\n\n"
          + "You will also use layout components like `Column` (as the `root`) and `Text` (to provide a title).\n";

  private final String baseUrl;
  private final A2uiSchemaManager schemaManager;

  public RizzchartsAgent(
      String baseUrl,
      BaseLlm llm,
      A2uiSchemaManager schemaManager,
      Function<ReadonlyContext, Boolean> uiEnabledChecker,
      Function<ReadonlyContext, A2uiCatalog> catalogChecker,
      Function<ReadonlyContext, String> examplesChecker) {

    super(
        LlmAgent.builder()
            .name("Ecommerce Dashboard Agent")
            .description("An agent that lets sales managers request sales data.")
            .model(llm)
            .disallowTransferToParent(false)
            .disallowTransferToPeers(true)
            .instruction(
                new Instruction.Static(
                    schemaManager.generateSystemPrompt(
                        ROLE_DESCRIPTION,
                        WORKFLOW_DESCRIPTION,
                        UI_DESCRIPTION,
                        null,
                        java.util.Collections.emptyList(),
                        false,
                        false,
                        false)))
            .tools(
                List.of(
                    new RizzchartsTools.GetStoreSalesTool(),
                    new RizzchartsTools.GetSalesDataTool(),
                    new SendA2uiToClientToolset(
                        ctx -> uiEnabledChecker.apply(ctx),
                        ctx -> catalogChecker.apply(ctx),
                        ctx -> examplesChecker.apply(ctx)))));
    this.baseUrl = baseUrl;
    this.schemaManager = schemaManager;
  }

  // AgentCard logic not strictly needed since A2AServerApplication is stripped.
  public Object getAgentCard() {
    return null; // A2A card representation empty when stubbing for local rest
  }
}
