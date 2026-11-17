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

package com.google.a2ui.agent.prompt

import com.google.a2ui.core.catalog.CatalogApi

/**
 * Base contract for format-specific prompt instruction builders (`a2ui_agent.blueprint.md` §3.B).
 */
abstract class PromptGenerator {
  abstract val catalogs: List<CatalogApi>

  open fun generateBaseRules(): String = ""

  open fun generateCatalogInstructions(
    includeSchema: Boolean = true,
    catalog: CatalogApi? = null,
  ): String = ""

  open fun generateExamples(catalog: CatalogApi? = null, validate: Boolean = false): String = ""

  /**
   * Assembles the complete system prompt snippet across rules, catalog signatures, and examples.
   */
  fun generate(): String {
    val parts = ArrayList<String>()
    val rules = generateBaseRules().trim()
    if (rules.isNotEmpty()) parts.add(rules)
    val instructions = generateCatalogInstructions(includeSchema = true, catalog = null).trim()
    if (instructions.isNotEmpty()) parts.add(instructions)
    val examples = generateExamples(catalog = null, validate = false).trim()
    if (examples.isNotEmpty()) parts.add("### Examples:\n\n$examples")
    return parts.joinToString("\n\n")
  }
}
