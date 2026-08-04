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

import com.google.a2ui.parser.Parser
import com.google.a2ui.prompt.PromptGenerator
import kotlinx.serialization.json.JsonObject

/** Interface coordinating system prompt generation and parsing of LLM response payloads. */
interface InferenceFormat {
  /** The [PromptGenerator] instance associated with this inference format. */
  val promptGenerator: PromptGenerator

  /** The [Parser] instance associated with this inference format. */
  val parser: Parser

  /** Whether this inference format supports streaming token chunk parsing. */
  val supportsStreaming: Boolean
    get() = parser.supportsStreaming

  /**
   * Generates a system prompt for all LLM requests.
   *
   * Deprecated compatibility helper delegating to [promptGenerator].
   */
  @Deprecated(
    message = "generateSystemPrompt is deprecated. Use promptGenerator.generate(...) instead.",
    replaceWith = ReplaceWith("promptGenerator.generate(...)"),
  )
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
  ): String {
    return promptGenerator.generate(
      roleDescription = roleDescription,
      workflowDescription = workflowDescription,
      uiDescription = uiDescription,
      clientUiCapabilities = clientUiCapabilities,
      allowedComponents = allowedComponents,
      allowedMessages = allowedMessages,
      includeSchema = includeSchema,
      includeExamples = includeExamples,
      validateExamples = validateExamples,
    )
  }
}
