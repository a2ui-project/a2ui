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

package com.google.a2ui

import kotlinx.serialization.json.JsonObject

/**
 * Defines the contract for an A2UI inference strategy, responsible for constructing the LLM system
 * prompt and providing schema/catalog-driven context to the agent.
 */
interface InferenceStrategy {
  /**
   * Generates a complete system prompt including the provided descriptions, A2UI JSON schema
   * constraints, workflow guidelines, and examples.
   *
   * @param roleDescription The foundational role or persona for the agent.
   * @param workflowDescription Optional workflow instructions to guide agent behavior.
   * @param uiDescription Optional UI context or descriptive instruction.
   * @param clientUiCapabilities Capabilities reported by the client for targeted schema pruning.
   * @param allowedComponents A specific list of component IDs allowed for rendering.
   * @param allowedMessages A specific list of message IDs allowed for rendering.
   * @param includeSchema Whether to embed the A2UI JSON schema directly in the instructions.
   * @param includeExamples Whether to embed few-shot examples in the instructions.
   * @param validateExamples Whether to preemptively validate loaded examples against the schema.
   * @return A consolidated system prompt string.
   */
  fun generateSystemPrompt(
    roleDescription: String,
    workflowDescription: String = "",
    uiDescription: String = "",
    clientUiCapabilities: JsonObject? = null,
    allowedComponents: List<String> = emptyList(),
    allowedMessages: List<String> = emptyList(),
    includeSchema: Boolean = false,
    includeExamples: Boolean = false,
    validateExamples: Boolean = false,
  ): String
}
