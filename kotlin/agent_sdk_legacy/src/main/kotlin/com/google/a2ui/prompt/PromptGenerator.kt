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

package com.google.a2ui.prompt

import kotlinx.serialization.json.JsonObject

/** Abstract interface for inference format prompt generators. */
interface PromptGenerator {
  /**
   * Assembles prompt system instructions contract.
   *
   * @param roleDescription Description of the agent's role.
   * @param workflowDescription Optional description of the task workflow.
   * @param uiDescription Optional UI context or rules.
   * @param clientUiCapabilities Optional client UI capability details.
   * @param allowedComponents Optional list of component tags the LLM may use.
   * @param allowedMessages Optional list of A2UI message types allowed.
   * @param includeSchema Whether to include component schemas in the prompt.
   * @param includeExamples Whether to include few-shot examples.
   * @param validateExamples Whether to validate few-shot examples on generation.
   * @return The complete generated prompt system instruction.
   */
  fun generate(
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
