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

package com.google.a2ui.inference_formats.experimental.express

import com.google.a2ui.prompt.PromptGenerator
import com.google.a2ui.schema.A2uiCatalog
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private val JSON_BLOCK_PATTERN = Regex("```json\\s*\\n(.*?)\\n```", RegexOption.DOT_MATCHES_ALL)

val EXPRESS_RULES =
  """# A2UI Express DSL Output Contract

You must output the user interface using A2UI Express.

IMPORTANT: You MUST always surround the entire A2UI Express block with the sentinel tags `<a2ui>` and `</a2ui>`.

The host compiler will compile your A2UI Express output into the correct JSON envelopes automatically.

## Grammar Rules

1. Component constructors can be assigned to variables or nested inline inside parent component arguments:
   header = ComponentA(prop1="val1")
   root = ComponentB([header, ComponentC("Click", action=Event("submit"))])

   Keyword arguments (`param=value`) and positional arguments with `_` placeholders are supported.

   Variable names MUST start with a letter or underscore, and only contain letters, digits, and underscores.

2. The interface tree must have a single entry point assigned to the reserved variable 'root'.

3. Primitives:
   - Strings: Quoted with `"` or `${"\"\"\""}`. Support for `\n`, `\t`, `\\`, and `\"` escapes.
     Raw Strings: Prefaced by `r` (e.g., `r"..."` or `r${"\"\"\""}...${"\"\"\""}`), with no escape processing.
   - Numbers: write as integers or decimals, e.g., 42
   - Booleans: write true or false
   - Null values: write null
   - Dates & Times: Values for date-time inputs (e.g. in DateTimeInput) must strictly use RFC 3339 format with a timezone offset (e.g. "2026-03-14T00:00:00Z").

4. Lists: represent as arrays, e.g., [child1, child2].

5. Maps: represent as key-value blocks, e.g., {title: "Overview", child: contentCol}. Map keys are always literal strings (dynamic variable resolution is not supported for keys).

6. Data bindings: prefix absolute paths in the data model with '$', e.g., $/user/firstName.
   Prefix relative list scopes with '$', e.g., ${"$"}firstName.
   A lone '$' represents an empty relative path which resolves to the root of the current context (e.g. inside a template, representing the entire item itself).

7. Logic and validation: prefix client check rules with '?', e.g., ?required or ?regex("^[0-9]{5}${'$'}"). To specify a custom error message for validation failures, append it as an extra string argument, e.g. ?regex("^[0-9]{5}${'$'}", "Postal code must be 5 digits").

8. Action events: represent server-side actions using the Event helper:
   Event("save_deal", {rep: $/form/rep})

9. Nested functions: call client functions directly using catalog signatures, for example myFunction("value").

10. Data model population: Assign a value directly to an absolute data path (e.g. $/path/to/key = "value") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.

11. Dynamic list templates: If a component expects a template child list, represent it using the _template helper:
    _template($/path/to/list, itemTemplate)
    And define the template component variable on another line, utilizing relative path references prefixed with $:
    itemTemplate = Image(${'$'}url)

12. To delete a user interface surface, output the standalone `deleteSurface(surfaceId)` command (no variable assignment):
    deleteSurface("dashboard-surface-1")

13. Static properties: Arguments annotated with '(static)' in the signatures below MUST be defined as literal values or arrays inline. You CANNOT use a dynamic data binding path (prefixed by $) for these arguments.

14. Required actions: Parameters named 'action' (or annotated in component signatures) are strictly required. You must pass a valid Event (e.g. Event("click")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event("click") instead of passing null or omitting the parameter."""

/** Generates system prompt contracts guiding models to produce A2UI Express DSL payloads. */
class ExpressPromptGenerator(val formatInst: ExpressFormat) : PromptGenerator {
  var catalog: A2uiCatalog? = formatInst.catalog
  var helper: CatalogSchemaHelper? = catalog?.let { CatalogSchemaHelper(it) }

  fun generateComponentSignatures(): String {
    val h = helper ?: return ""
    val signatures = mutableListOf<String>()

    for (name in h.componentProperties.keys.sorted()) {
      val props = h.getComponentProperties(name)
      val reqs = h.getComponentRequired(name)
      val compDesc = h.getComponentDescription(name)

      val orderedArgs = mutableListOf<String>()
      val propDetails = mutableListOf<String>()

      for (p in props) {
        val isReq = p in reqs
        val optSuffix = if (isReq) "" else "?"
        var argLabel = "$p$optSuffix"

        val pSchema = h.getPropertySchema(name, p)
        var isComponentId = false
        val ref = (pSchema?.get("\$ref") as? JsonPrimitive)?.content
        if (ref != null && ref.contains("ComponentId")) {
          isComponentId = true
        }

        if (isComponentId) {
          argLabel += " (component ID)"
        }

        orderedArgs.add(argLabel)

        val pDesc = (pSchema?.get("description") as? JsonPrimitive)?.content
        val enumVals = h.getPropertyEnum(name, p)

        if (pDesc != null || enumVals != null) {
          val pParts = mutableListOf<String>()
          if (pDesc != null) pParts.add(pDesc)
          if (enumVals != null)
            pParts.add("Must be one of: " + enumVals.joinToString(", ") { "'$it'" })
          propDetails.add("  - $p: ${pParts.joinToString(" ")}")
        }
      }

      var sig = "• $name(${orderedArgs.joinToString(", ")})"
      if (compDesc != null) {
        val descIndented = compDesc.replace("\n", "\n    ")
        sig += "\n  - Description: $descIndented"
      }
      if (propDetails.isNotEmpty()) {
        sig += "\n" + propDetails.joinToString("\n")
      }
      signatures.add(sig)
    }

    return signatures.joinToString("\n")
  }

  fun generateFunctionSignatures(): String {
    val h = helper ?: return ""
    val signatures = mutableListOf<String>()

    for (name in h.functionProperties.keys.sorted()) {
      val props = h.getFunctionProperties(name)
      val reqs = h.getFunctionRequired(name)
      val fDesc = h.getFunctionDescription(name)

      val orderedArgs = mutableListOf<String>()
      val propDetails = mutableListOf<String>()

      for (p in props) {
        val isReq = p in reqs
        val optSuffix = if (isReq) "" else "?"
        orderedArgs.add("$p$optSuffix")

        val pSchema = h.getFunctionPropertySchema(name, p)
        val pDesc = (pSchema?.get("description") as? JsonPrimitive)?.content
        if (pDesc != null) {
          propDetails.add("  - $p: $pDesc")
        }
      }

      var sig = "• $name(${orderedArgs.joinToString(", ")})"
      if (fDesc != null) {
        val descIndented = fDesc.replace("\n", "\n    ")
        sig += "\n  - Description: $descIndented"
      }
      if (propDetails.isNotEmpty()) {
        sig += "\n" + propDetails.joinToString("\n")
      }
      signatures.add(sig)
    }

    return signatures.joinToString("\n")
  }

  fun catalogDescription(includeSchema: Boolean = true): String {
    if (!includeSchema || helper == null) return ""

    val compSigs = generateComponentSignatures()
    val funcSigs = generateFunctionSignatures()

    return """## Positional Component Signatures

Use these exact positional signatures to instantiate components. Do not output property keys:
$compSigs

## Positional Function Signatures

Use these exact positional signatures to instantiate check rules or logic functions:
$funcSigs"""
  }

  fun transformExamples(rawExamplesMarkdown: String): String {
    val cat = catalog ?: return rawExamplesMarkdown

    return JSON_BLOCK_PATTERN.replace(rawExamplesMarkdown) { match ->
      val jsonContent = match.groupValues[1].trim()
      try {
        val parsed = Json.parseToJsonElement(jsonContent)
        val messages =
          when (parsed) {
            is JsonObject -> listOf(parsed)
            is JsonArray -> parsed.mapNotNull { it as? JsonObject }
            else -> return@replace match.value
          }

        val decompiler = ExpressDecompiler(cat)
        val blocks = mutableListOf<String>()
        for (msg in messages) {
          if (
            msg.keys.any {
              it in listOf("createSurface", "updateDataModel", "deleteSurface", "callFunction")
            }
          ) {
            blocks.add(decompiler.decompile(msg))
          } else {
            return@replace match.value
          }
        }

        "```\n${decompiler.wrapDecompiledBlocks(blocks)}\n```"
      } catch (_: Exception) {
        match.value
      }
    }
  }

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
    var workingCatalog = formatInst.catalog
    if (
      workingCatalog != null && (allowedComponents.isNotEmpty() || allowedMessages.isNotEmpty())
    ) {
      workingCatalog = workingCatalog.withPruning(allowedComponents, allowedMessages)
    }

    if (workingCatalog != null) {
      this.catalog = workingCatalog
      this.helper = CatalogSchemaHelper(workingCatalog)
    }

    val parts = mutableListOf<String>()
    parts.add(roleDescription)

    var rules = EXPRESS_RULES
    if (workflowDescription.isNotEmpty()) {
      rules += "\n\n$workflowDescription"
    }
    parts.add("## Workflow Description:\n$rules")

    if (uiDescription.isNotEmpty()) {
      parts.add("## UI Description:\n$uiDescription")
    }

    if (includeSchema && helper != null) {
      parts.add(catalogDescription(includeSchema = true))
    }

    if (includeExamples && formatInst.examplesPath != null && workingCatalog != null) {
      val rawExamples =
        workingCatalog.loadExamples(formatInst.examplesPath, validate = validateExamples)
      if (rawExamples.isNotEmpty()) {
        val formatted = transformExamples(rawExamples)
        parts.add("### Examples:\n$formatted")
      }
    }

    return parts.joinToString("\n\n")
  }
}
