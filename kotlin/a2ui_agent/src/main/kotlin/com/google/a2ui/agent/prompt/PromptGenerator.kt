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

const val EXAMPLES_HEADING: String = "### Examples:\n\n"

/**
 * Base contract for format-specific prompt instruction builders (`a2ui_agent.blueprint.md` §3.B).
 *
 * Subclasses implement [catalogs] and the three decomposed hooks; [generate] is `final` (non-`open`
 * in Kotlin) and delegates to [assembleInstructions], guaranteeing byte-for-byte parity between
 * `PromptGenerator.generate()` and `SkillGenerator.generateSkill()`.
 */
abstract class PromptGenerator {
  private val cachedOwnPrompt: String by lazy { assembleInstructions(this, null) }

  abstract val catalogs: List<CatalogApi>

  open fun generateBaseRules(): String = ""

  open fun generateCatalogInstructions(
    includeSchema: Boolean = true,
    catalog: CatalogApi? = null,
  ): String = ""

  open fun generateExamples(catalog: CatalogApi? = null, validate: Boolean = false): String = ""

  fun generate(): String = cachedOwnPrompt
}

/**
 * Joins [generator]'s base rules, catalog instructions, and example turns (`skill_generator` §1).
 */
fun assembleInstructions(generator: PromptGenerator, catalogs: List<CatalogApi>? = null): String {
  val sections = mutableListOf<String>()

  val baseRules = generator.generateBaseRules().trim()
  if (baseRules.isNotEmpty()) {
    sections.add(baseRules)
  }

  if (catalogs == null) {
    val catInstr = generator.generateCatalogInstructions().trim()
    if (catInstr.isNotEmpty()) sections.add(catInstr)

    val examples = generator.generateExamples().trim()
    if (examples.isNotEmpty()) sections.add("$EXAMPLES_HEADING$examples")
  } else {
    val catInstr =
      catalogs
        .map { generator.generateCatalogInstructions(catalog = it).trim() }
        .filter { it.isNotEmpty() }
        .joinToString("\n\n")
    if (catInstr.isNotEmpty()) sections.add(catInstr)

    val distinctExamples =
      catalogs
        .map { generator.generateExamples(catalog = it).trim() }
        .filter { it.isNotEmpty() }
        .distinct()
        .joinToString("\n\n")
    if (distinctExamples.isNotEmpty()) sections.add("$EXAMPLES_HEADING$distinctExamples")
  }

  return sections.joinToString("\n\n")
}
