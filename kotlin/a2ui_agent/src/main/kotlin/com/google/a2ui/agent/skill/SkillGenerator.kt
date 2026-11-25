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

package com.google.a2ui.agent.skill

import com.google.a2ui.agent.InferenceFormat
import com.google.a2ui.agent.prompt.EXAMPLES_HEADING
import com.google.a2ui.agent.prompt.assembleInstructions
import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.exceptions.A2uiValidationError

/** Domain model for a single `SKILL.md` document (`skill_generator.blueprint.md` §2). */
data class Skill(
  val name: String,
  val description: String,
  val content: String,
  val metadata: Map<String, String> = emptyMap(),
  val filename: String = "$name/SKILL.md",
) {
  init {
    validateSafeRelativeFilename(filename)
  }

  fun toMarkdown(): String = buildString {
    appendLine("---")
    appendLine("name: $name")
    appendLine("description: $description")
    if (metadata.isNotEmpty()) {
      appendLine("metadata:")
      for ((k, v) in metadata) {
        appendLine("  $k: $v")
      }
    }
    appendLine("---")
    appendLine()
    appendLine(content.trim())
  }

  companion object {
    internal fun validateSafeRelativeFilename(filename: String) {
      if (filename.isEmpty() || filename.startsWith("/") || filename.startsWith("\\")) {
        throw A2uiValidationError("Skill filename must be a relative path: '$filename'")
      }
      val segments = filename.replace('\\', '/').split('/')
      if (segments.any { it.isEmpty() || it == "." || it == ".." }) {
        throw A2uiValidationError("Skill filename contains invalid path segment: '$filename'")
      }
    }
  }
}

/** Collection of modular [Skill] packages with 3-tier lookup (`skill_generator` §3). */
class SkillSet(initial: Map<String, Skill> = emptyMap()) {
  private val entries = linkedMapOf<String, Skill>().apply { putAll(initial) }

  val skills: Map<String, Skill>
    get() = entries.toMap()

  fun add(skill: Skill) {
    entries[skill.filename] = skill
  }

  fun get(query: String): Skill? {
    entries[query]?.let {
      return it
    }
    entries.values
      .firstOrNull { it.name == query }
      ?.let {
        return it
      }
    if (query.length >= 3) {
      return entries.entries.firstOrNull { query in it.key }?.value
    }
    return null
  }

  fun toMap(): Map<String, String> = entries.mapValues { (_, s) -> s.toMarkdown() }
}

/** Derives a clean catalog skill slug such as `"basic"` from `"catalogs/basic/v1/catalog.json"`. */
fun cleanCatalogName(catalog: CatalogApi): String {
  val raw = catalog.id.ifEmpty { "basic" }.replace('\\', '/').removeSuffix(".json")
  val parts = raw.split('/').filter { it.isNotEmpty() && it != "catalog" }
  if (parts.isEmpty()) return "basic"
  val last = parts.last()
  val chosen =
    if (last.startsWith("v", ignoreCase = true) && parts.size >= 2) parts[parts.size - 2] else last
  return chosen.lowercase()
}

/**
 * Compiles an [InferenceFormat] into monolithic or modular `SKILL.md` artifacts (`skill_generator`
 * §4).
 */
class SkillGenerator(val format: InferenceFormat) {
  fun generateCoreSkill(
    name: String = "a2ui-core",
    description: String = "Core A2UI protocol instructions and syntax rules for UI generation.",
  ): Skill =
    Skill(
      name = name,
      description = description,
      content = format.promptGenerator.generateBaseRules(),
    )

  fun generateCatalogSkill(
    catalog: CatalogApi? = null,
    name: String? = null,
    description: String? = null,
    includeExamples: Boolean = true,
  ): Skill {
    val target =
      catalog
        ?: format.promptGenerator.catalogs.firstOrNull()
        ?: throw A2uiValidationError("Format has no bound catalogs for generateCatalogSkill")
    val slug = cleanCatalogName(target)
    val instr = format.promptGenerator.generateCatalogInstructions(catalog = target).trim()
    val examples =
      if (includeExamples) format.promptGenerator.generateExamples(catalog = target).trim() else ""
    val body =
      buildList {
          if (instr.isNotEmpty()) add(instr)
          if (examples.isNotEmpty()) add("$EXAMPLES_HEADING$examples")
        }
        .joinToString("\n\n")
    return Skill(
      name = name ?: "a2ui-$slug",
      description =
        description
          ?: target.description
          ?: "UI component catalog signatures for $slug. Use when building $slug user interface components.",
      content = body,
    )
  }

  fun generateSkill(
    name: String = "a2ui",
    description: String = "Generates interactive user interface components for user requests.",
    catalogs: List<CatalogApi>? = null,
  ): Skill =
    Skill(
      name = name,
      description = description,
      content = assembleInstructions(format.promptGenerator, catalogs),
    )

  fun generateSkillSet(
    catalogs: List<CatalogApi>? = null,
    coreName: String = "a2ui-core",
  ): SkillSet {
    val targets = catalogs ?: format.promptGenerator.catalogs
    val set = SkillSet()
    set.add(generateCoreSkill(name = coreName))
    for (cat in targets) {
      set.add(generateCatalogSkill(catalog = cat))
    }
    return set
  }
}
