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

package com.google.a2ui.inference_formats.transport

import com.google.a2ui.prompt.PromptGenerator
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiConstants
import kotlinx.serialization.json.JsonObject

/** Standard JSON prompt generator. */
class TransportPromptGenerator(
  private val catalog: A2uiCatalog?,
  private val examplesPath: String? = null,
) : PromptGenerator {

  override fun generate(
    roleDescription: String,
    workflowDescription: String,
    uiDescription: String,
    clientUiCapabilities: JsonObject?,
    allowedComponents: List<String>,
    allowedMessages: List<String>,
    includeSchema: Boolean,
    includeExamples: Boolean,
    validateExamples: Boolean,
  ): String {
    var workingCatalog = catalog
    if (
      workingCatalog != null && (allowedComponents.isNotEmpty() || allowedMessages.isNotEmpty())
    ) {
      workingCatalog = workingCatalog.withPruning(allowedComponents, allowedMessages)
    }

    val parts = mutableListOf<String>()
    parts.add(roleDescription)

    var rules = A2uiConstants.DEFAULT_WORKFLOW_RULES
    if (workflowDescription.isNotEmpty()) {
      rules += "\n\n$workflowDescription"
    }
    parts.add("## Workflow Description:\n$rules")

    if (uiDescription.isNotEmpty()) {
      parts.add("## UI Description:\n$uiDescription")
    }

    if (includeSchema && workingCatalog != null) {
      parts.add(workingCatalog.renderAsLlmInstructions())
    }

    if (includeExamples && workingCatalog != null && !examplesPath.isNullOrEmpty()) {
      val rawExamples = workingCatalog.loadExamples(examplesPath, validate = validateExamples)
      if (rawExamples.isNotEmpty()) {
        parts.add("### Examples:\n$rawExamples")
      }
    }

    return parts.joinToString("\n\n")
  }
}
