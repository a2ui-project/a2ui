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

package com.google.a2ui.agent.express

import com.google.a2ui.agent.PromptGenerator
import com.google.a2ui.agent.agentCallableFunctions
import com.google.a2ui.agent.validatePayload
import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.Catalog
import com.google.a2ui.core.ProtocolVersion
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Generates LLM system prompt contracts, positional component/function signatures, multi-catalog
 * disambiguation rules, and few-shot examples for A2UI Express v1.0.
 */
internal class ExpressPromptGenerator(
  catalogs: List<Catalog>,
  private val examples: List<List<AgentToRendererMessage>>? = null,
  private val allowedMessages: List<String>? = null,
) : PromptGenerator() {
  private val checkedCatalogs: List<Catalog> = CatalogSchemaHelper.checkMixedCatalogs(catalogs)
  internal val helpers: Map<String, CatalogSchemaHelper> =
    CatalogSchemaHelper.buildCatalogHelpers(checkedCatalogs)
  private val decompiler = ExpressDecompiler(checkedCatalogs)

  override val catalogs: List<Catalog>
    get() = checkedCatalogs.toList()

  companion object {
    private val EXAMPLE_MESSAGE_KEYS =
      setOf(
        "createSurface",
        "updateComponents",
        "updateDataModel",
        "deleteSurface",
        "callFunction",
        "callRendererFunction",
      )
    private val SURFACE_OP_KEYS =
      setOf("createSurface", "updateComponents", "updateDataModel", "deleteSurface")
    private const val ROOT_EXAMPLE_LINE = "root = ComponentA(...)"
    private val RULE_SPLIT_RE = Regex("""\n\n(?=\d+\. )""")
    private val RULE_PREFIX_RE = Regex("""^(\d+\. )""")
    private val RENUMBER_RE = Regex("""(?<=\n\n)(\d+\. )([^\n]*(?:\n(?!\n)[^\n]*)*)""")
    private val FENCED_JSON_RE = Regex("""```json\s*\n([\s\S]*?)\n```""")

    private val TQ = "\"\"\""

    private val EVENT_RULE_V1_0 =
      listOf(
          "8. Action events: represent server-side actions using the Event helper, `Event(name, context?, userMessage=...)`:",
          "   Event(\"save_deal\", {rep: \$/form/rep})",
          "   Event(\"reply\", userMessage=\"Replying now\")",
          "   Event(\"save_deal\", {rep: \$/form/rep}, userMessage=\$/form/summary)",
          "   The context map is optional. Pass `userMessage=` as a keyword argument (a string, `\$path` binding, or function call) to set the message shown on the user's behalf when the event fires.",
        )
        .joinToString("\n")

    private val EXPRESS_RULES_PREFIX =
      listOf(
          "# A2UI Express DSL Output Contract",
          "",
          "You must output the user interface using A2UI Express.",
          "",
          "IMPORTANT: You MUST always surround the entire A2UI Express block with the literal sentinel tags `<a2ui>` and `</a2ui>` (always include both the opening and closing tags; do NOT wrap the tags in backticks or replace the opening tag with a markdown code fence such as ```a2ui).",
          "",
          "The host compiler will compile your A2UI Express output into the correct JSON envelopes automatically.",
          "",
          "## Grammar Rules",
          "",
          "1. Component constructors can be assigned to variables or nested inline inside parent component arguments:",
          "   header = ComponentA(prop1=\"val1\")",
          "   root = ComponentB([header, ComponentC(\"Click\", action=Event(\"submit\"))])",
          "",
          "   Keyword arguments (`param=value`) and positional arguments with `_` placeholders are supported.",
          "",
          "   Variable names MUST start with a letter or underscore, and only contain letters, digits, and underscores.",
          "",
          "2. The interface tree must have a single entry point assigned to the reserved variable 'root'.",
          "",
          "3. Primitives:",
          "   - Strings: Quoted with `\"` or `$TQ`. Support for `\\n`, `\\t`, `\\\\`, and `\\\"` escapes.",
          "     Raw Strings: Prefaced by `r` (e.g., `r\"...\"` or `r$TQ...$TQ`), with no escape processing.",
          "   - Numbers: write as integers or decimals, e.g., 42",
          "   - Booleans: write true or false",
          "   - Null values: write null",
          "   - Dates & Times: Values for date-time inputs (e.g. in DateTimeInput) must strictly use RFC 3339 format with a timezone offset (e.g. \"2026-03-14T00:00:00Z\").",
          "",
          "4. Lists: represent as arrays, e.g., [child1, child2].",
          "",
          "5. Maps: represent as key-value blocks, e.g., {title: \"Overview\", child: contentCol}. Map keys are always literal strings (dynamic variable resolution is not supported for keys).",
          "",
          "6. Data bindings: prefix absolute paths in the data model with '\$', e.g., \$/user/firstName.",
          "   Prefix relative list scopes with '\$', e.g., \$firstName.",
          "   A lone '\$' represents an empty relative path which resolves to the root of the current context (e.g. inside a template, representing the entire item itself).",
          "",
          "7. Logic and validation: prefix client check rules with '?', e.g., ?required or ?regex(\"^[0-9]{5}\$\"). To specify a custom error message for validation failures, append it as an extra string argument, e.g. ?regex(\"^[0-9]{5}\$\", \"Postal code must be 5 digits\").",
        )
        .joinToString("\n")

    private val EXPRESS_RULES_SUFFIX =
      listOf(
          "9. Nested functions: call client functions directly using catalog signatures, for example myFunction(\"value\").",
          "",
          "10. Data model population: Assign a value directly to an absolute data path (e.g. \$/path/to/key = \"value\") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.",
          "",
          "11. Dynamic list templates: If a component expects a template child list, represent it using the _template helper:",
          "    _template(\$/path/to/list, itemTemplate)",
          "    And define the template component variable on another line, utilizing relative path references prefixed with \$:",
          "    itemTemplate = Image(\$url)",
          "",
          "12. To delete a user interface surface, output the standalone `deleteSurface(surfaceId)` command (no variable assignment):",
          "    deleteSurface(\"dashboard-surface-1\")",
          "",
          "13. Static properties: Arguments annotated with '(static)' in the signatures below MUST be defined as literal values or arrays inline. You CANNOT use a dynamic data binding path (prefixed by \$) for these arguments.",
          "",
          "14. Required actions: Parameters named 'action' (or annotated in component signatures) are strictly required. You must pass a valid Event (e.g. Event(\"click\")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event(\"click\") instead of passing null or omitting the parameter.",
          "",
          "15. Surface targeting: Output `surface(surfaceId)` to specify or target a user interface surface:",
          "    surface(\"dashboard-surface-1\")",
          "    root = ComponentA(...)",
        )
        .joinToString("\n")

    val EXPRESS_RULES: String =
      "$EXPRESS_RULES_PREFIX\n\n$EVENT_RULE_V1_0\n\n$EXPRESS_RULES_SUFFIX".replace("\r\n", "\n")
  }

  override fun generateBaseRules(): String = generateBaseRules(allowedMessages = null)

  fun generateBaseRules(allowedMessages: List<String>?): String {
    val effectiveAllowed = allowedMessages ?: this.allowedMessages
    val callableFnNames = agentCallableFunctions(checkedCatalogs)

    var base =
      if (effectiveAllowed == null && callableFnNames.isEmpty()) {
        EXPRESS_RULES
      } else {
        filterExpressRules(effectiveAllowed, callableFnNames, EXPRESS_RULES)
      }

    val rootComp = pickExampleRootComponent()
    if (rootComp != null) {
      base = base.replace(ROOT_EXAMPLE_LINE, "root = $rootComp(...)")
    }

    val allowedSet = effectiveAllowed?.toSet()
    fun allows(vararg names: String): Boolean = allowedSet == null || names.any { it in allowedSet }

    val componentMessages =
      arrayOf(
        "createSurface",
        "CreateSurfaceMessage",
        "updateComponents",
        "UpdateComponentsMessage",
      )
    val dataMessages = arrayOf("updateDataModel", "UpdateDataModelMessage")

    var prompt = base
    if (checkedCatalogs.size > 1 && (allows(*componentMessages) || allows(*dataMessages))) {
      prompt = renumberRules("$base\n\n${multiCatalogRules()}")
    }
    val sections = ArrayList<String>()
    sections.add(prompt)
    if (allows(*componentMessages)) {
      val sysFns = generateSystemFunctionSignatures()
      if (sysFns.isNotEmpty()) {
        sections.add(sysFns)
      }
    }
    return sections.joinToString("\n\n")
  }

  override fun generateCatalogInstructions(includeSchema: Boolean, catalog: Catalog?): String {
    if (!includeSchema) return ""
    if (catalog != null) return catalogDescription(includeSchema = true, catalog = catalog)
    if (checkedCatalogs.size <= 1) return catalogDescription(includeSchema = true, catalog = null)
    return checkedCatalogs.joinToString("\n\n") { cat ->
      "# Catalog `${cat.id}`\n\n${catalogDescription(includeSchema = true, catalog = cat)}"
    }
  }

  override fun generateExamples(catalog: Catalog?, validate: Boolean): String {
    val turns = examples ?: buildCatalogExamples(catalog).takeIf { it.isNotEmpty() } ?: return ""

    val activeCatalogs =
      if (catalog != null) {
        listOf(catalog) + checkedCatalogs.filter { it !== catalog }
      } else {
        checkedCatalogs
      }

    val blocks = ArrayList<String>()
    for (turn in turns) {
      if (validate) {
        validatePayload(activeCatalogs, turn)
      }
      val dsl = decompiler.decompile(turn)
      blocks.add(decompiler.wrapDecompiledBlocks(listOf(dsl)))
    }
    return blocks.joinToString("\n\n")
  }

  private fun buildCatalogExamples(targetCatalog: Catalog?): List<List<AgentToRendererMessage>> {
    val sourceCatalogs = if (targetCatalog != null) listOf(targetCatalog) else checkedCatalogs
    val result = ArrayList<List<AgentToRendererMessage>>()
    for (cat in sourceCatalogs) {
      for (ex in cat.examples) {
        val rawMsgs =
          when (ex) {
            is JsonObject -> listOf(ex)
            is JsonArray -> ex.mapNotNull { it as? JsonObject }
            else -> emptyList()
          }
        if (rawMsgs.isEmpty()) continue
        val normalized =
          runCatching {
              normalizePromptExampleMessages(
                rawMsgs,
                defaultCatalogId = if (checkedCatalogs.size == 1) checkedCatalogs[0].id else cat.id,
              )
            }
            .getOrNull()
        if (normalized != null && normalized.isNotEmpty()) {
          result.add(normalized)
        }
      }
    }
    return result
  }

  private fun pickExampleRootComponent(): String? {
    for (helper in helpers.values) {
      for (compName in helper.components.keys) {
        val props = helper.getComponentProperties(compName)
        if (props.any { helper.getPropertyType(compName, it) == "Child" }) {
          return compName
        }
      }
    }
    return helpers.values.firstNotNullOfOrNull { it.components.keys.firstOrNull() }
  }

  private fun multiCatalogRules(): String {
    val catalogIds = helpers.keys.toList()
    val exampleId = catalogIds.last()
    val listing = catalogIds.joinToString("\n") { "- `$it`" }
    val lines = ArrayList<String>()
    lines.add("## Multiple Catalogs")
    lines.add("")
    lines.add(
      "Several component catalogs are active. Each is identified by its catalog ID, and the signatures below are grouped by catalog:"
    )
    lines.add(listing)
    lines.add("")
    lines.add(
      "16. A surface has no catalog of its own: do not name a catalog on a `surface` line. Each component and function call, including checks, actions, nested function calls and inline child components, is found by its name in whichever catalog defines it."
    )
    lines.add("")
    lines.add(
      "17. When several catalogs define the same component or function name, you MUST say which one you mean: add a `catalogId` keyword argument to the component or function call, or a `{catalogId: ...}` argument to a check. Do not add `catalogId` to any other name:"
    )
    lines.add("    widget = ComponentName(..., catalogId=\"$exampleId\")")
    lines.add("    action = functionName(..., catalogId=\"$exampleId\")")
    lines.add("    ?checkName(..., {catalogId: \"$exampleId\"})")

    val shared = ArrayList<String>()
    for ((kind, label) in listOf("component" to "Component", "function" to "Function")) {
      val names =
        helpers.values
          .flatMap { if (kind == "component") it.components.keys else it.functions.keys }
          .toSortedSet()
      for (name in names) {
        val defining = CatalogSchemaHelper.catalogsDefining(helpers, kind, name)
        if (defining.size > 1) {
          shared.add("- $label `$name`: ${defining.joinToString(", ") { "`$it`" }}")
        }
      }
    }
    if (shared.isNotEmpty()) {
      lines.add("")
      lines.add("These names are defined in several catalogs and need a `catalogId`:")
      lines.addAll(shared)
    }
    return lines.joinToString("\n")
  }

  private fun filterExpressRules(
    allowedMessages: List<String>?,
    callableFns: List<String>,
    rulesSource: String,
  ): String {
    val (creates, components, data, delete, callRenderer) =
      if (allowedMessages == null) {
        listOf(true, true, true, true, true)
      } else {
        val s = allowedMessages.toSet()
        val cr = "createSurface" in s || "CreateSurfaceMessage" in s
        val cp = cr || "updateComponents" in s || "UpdateComponentsMessage" in s
        val dt = "updateDataModel" in s || "UpdateDataModelMessage" in s
        val dl = "deleteSurface" in s || "DeleteSurfaceMessage" in s
        val fn = "callRendererFunction" in s || "CallRendererFunctionMessage" in s
        listOf(cr, cp, dt, dl, fn)
      }

    val marker = "## Grammar Rules\n\n"
    val splitIdx = rulesSource.indexOf(marker)
    val contract = rulesSource.substring(0, splitIdx)
    val rulesBlock = rulesSource.substring(splitIdx + marker.length).trim()
    val rawRules = RULE_SPLIT_RE.split(rulesBlock)
    val ruleBodies = rawRules.map { stripRulePrefix(it) }

    val selected = ArrayList<String>()
    if (components) selected.add(ruleBodies[0])
    if (creates) selected.add(ruleBodies[1])
    selected.addAll(ruleBodies.subList(2, 6))
    if (components) selected.addAll(ruleBodies.subList(6, 9))
    if (data) selected.add(ruleBodies[9])
    if (components) selected.add(ruleBodies[10])
    if (delete) selected.add(ruleBodies[11])
    if (callRenderer && callableFns.isNotEmpty()) {
      val formatted = callableFns.joinToString(", ") { "`$it`" }
      selected.add(
        "To have the renderer run a function right away, output the call as a standalone command (no variable assignment):\n" +
          "${callableFns[0]}(...)\n" +
          "Only these functions can be called this way: $formatted."
      )
    }
    if (components) selected.addAll(ruleBodies.subList(12, 14))
    if (components || data) {
      var surfaceRule = ruleBodies[14]
      if (!creates) {
        surfaceRule = surfaceRule.lines().dropLast(1).joinToString("\n")
      }
      selected.add(surfaceRule)
    }

    val out = ArrayList<String>()
    out.add("$contract## Grammar Rules")
    for ((i, body) in selected.withIndex()) {
      val prefix = "${i + 1}. "
      val indent = " ".repeat(prefix.length)
      val indented = body.replace(Regex("""\n(?!\n)"""), "\n$indent")
      out.add("$prefix$indented")
    }
    return out.joinToString("\n\n")
  }

  private fun stripRulePrefix(rule: String): String {
    val m = RULE_PREFIX_RE.find(rule) ?: return rule
    val prefixLen = m.groupValues[1].length
    return rule.substring(prefixLen).replace(Regex("\n {$prefixLen}"), "\n")
  }

  private fun renumberRules(text: String): String {
    var ruleIndex = 0
    return RENUMBER_RE.replace(text) { m ->
      ruleIndex++
      val oldPrefix = m.groupValues[1]
      var body = m.groupValues[2]
      val newPrefix = "$ruleIndex. "
      if (oldPrefix.length != newPrefix.length) {
        body = body.replace(Regex("\n {${oldPrefix.length}}"), "\n${" ".repeat(newPrefix.length)}")
      }
      "$newPrefix$body"
    }
  }

  private fun generateSystemFunctionSignatures(): String {
    val h = helpers.values.firstOrNull() ?: return ""
    if (h.systemFunctions.isEmpty()) return ""
    val sigs = formatFunctionSignatures(h, h.systemFunctions.keys.sorted())
    return "## System Functions\n\nThese functions are defined by the A2UI protocol, not by a catalog. Call them by their `@` name, like any function, and never add a `catalogId` to them:\n$sigs"
  }

  private fun catalogDescription(includeSchema: Boolean, catalog: Catalog?): String {
    if (!includeSchema) return ""
    val h =
      if (catalog != null) {
        helpers[catalog.id] ?: CatalogSchemaHelper(catalog)
      } else {
        helpers.values.firstOrNull() ?: return ""
      }
    val compSigs = generateComponentSignatures(h)
    val funcSigs = generateFunctionSignatures(h)
    var catalogInstructions =
      h.catalogModel.instructions
        ?: (h.catalogSchema["instructions"] as? JsonPrimitive)?.contentOrNull
        ?: ""
    if (catalogInstructions.isNotEmpty()) {
      val catId = h.catalogModel.id
      catalogInstructions =
        FENCED_JSON_RE.replace(catalogInstructions) { m ->
          val dsl = decompileExampleMessages(m.groupValues[1].trim(), catId)
          if (dsl != null) "```\n${decompiler.wrapDecompiledBlocks(listOf(dsl))}\n```" else m.value
        }
    }
    val instructionsBlock =
      if (catalogInstructions.isNotEmpty()) "\n\n## Catalog Instructions\n\n$catalogInstructions"
      else ""

    return "## Positional Component Signatures\n\nUse these exact positional signatures to instantiate components. Do not output property keys:\n$compSigs\n\n## Positional Function Signatures\n\nUse these exact positional signatures to instantiate check rules or logic functions:\n$funcSigs$instructionsBlock"
  }

  private fun generateComponentSignatures(h: CatalogSchemaHelper): String {
    val signatures = ArrayList<String>()
    for (name in h.components.keys.sorted()) {
      val props = h.getComponentProperties(name)
      val reqs = h.getComponentRequired(name).toSet()
      val compDesc = h.getComponentDescription(name)

      val orderedArgs = ArrayList<String>()
      val propDetails = ArrayList<String>()

      for (p in props) {
        val optSuffix = if (p in reqs) "" else "?"
        val pSchema = h.getPropertySchema(name, p)
        var argLabel = "$p$optSuffix"

        val ref = (pSchema?.get("\$ref") as? JsonPrimitive)?.contentOrNull
        val isComponentId = ref != null && ref.contains("ComponentId")
        if (isComponentId) {
          argLabel += " (component ID)"
        } else if (!promptSchemaAllowsDatabinding(pSchema)) {
          argLabel += " (static)"
        }
        orderedArgs.add(argLabel)

        val pDesc = (pSchema?.get("description") as? JsonPrimitive)?.contentOrNull
        val enumVals = getSchemaEnumStrings(pSchema)
        if (!pDesc.isNullOrEmpty() || !enumVals.isNullOrEmpty()) {
          val lineParts = ArrayList<String>()
          if (!pDesc.isNullOrEmpty()) lineParts.add(pDesc)
          if (!enumVals.isNullOrEmpty()) {
            lineParts.add("Must be one of: ${enumVals.joinToString(", ") { "'$it'" }}")
          }
          propDetails.add("  - $p: ${lineParts.joinToString(" ")}")
        }

        if (pSchema != null) {
          val pType = (pSchema["type"] as? JsonPrimitive)?.contentOrNull
          if (pType == "object" && pSchema["properties"] is JsonObject) {
            val subKeys = formatObjectSubKeys(pSchema["properties"] as JsonObject)
            if (propDetails.isNotEmpty() && propDetails.last().startsWith("  - $p:")) {
              propDetails[propDetails.lastIndex] += "\n    Map keys:\n${subKeys.joinToString("\n")}"
            } else {
              propDetails.add("  - $p: Map with keys:\n${subKeys.joinToString("\n")}")
            }
          } else if (pType == "array" && pSchema["items"] is JsonObject) {
            val itemsSchema = pSchema["items"] as JsonObject
            if (
              (itemsSchema["type"] as? JsonPrimitive)?.contentOrNull == "object" &&
                itemsSchema["properties"] is JsonObject
            ) {
              val subKeys = formatObjectSubKeys(itemsSchema["properties"] as JsonObject)
              if (propDetails.isNotEmpty() && propDetails.last().startsWith("  - $p:")) {
                propDetails[propDetails.lastIndex] +=
                  "\n    List of maps keys:\n${subKeys.joinToString("\n")}"
              } else {
                propDetails.add("  - $p: List of maps with keys:\n${subKeys.joinToString("\n")}")
              }
            }
          }
        }
      }

      val sb = StringBuilder("• $name(${orderedArgs.joinToString(", ")})")
      if (!compDesc.isNullOrEmpty()) {
        sb.append("\n  - Description: ").append(compDesc.replace("\n", "\n    "))
      }
      if (propDetails.isNotEmpty()) {
        sb.append("\n").append(propDetails.joinToString("\n"))
      }
      signatures.add(sb.toString())
    }
    return signatures.joinToString("\n")
  }

  private fun formatObjectSubKeys(propsObj: JsonObject): List<String> =
    propsObj.entries.map { (subK, subV) ->
      val desc =
        ((subV as? JsonObject)?.get("description") as? JsonPrimitive)?.contentOrNull.orEmpty()
      val suffix = if (desc.isNotEmpty()) " - $desc" else ""
      "    * $subK$suffix"
    }

  private fun generateFunctionSignatures(h: CatalogSchemaHelper): String =
    formatFunctionSignatures(h, h.functions.keys.sorted())

  private fun formatFunctionSignatures(h: CatalogSchemaHelper, names: List<String>): String {
    val signatures = ArrayList<String>()
    for (name in names) {
      val props = h.getFunctionProperties(name)
      val reqs = h.getFunctionRequired(name).toSet()
      val fDesc = h.getFunctionDescription(name)
      val fnSchema = h.functions[name] ?: h.systemFunctions[name] ?: JsonObject(emptyMap())
      val argsProperties =
        (((fnSchema["properties"] as? JsonObject)?.get("args") as? JsonObject)?.get("properties")
          as? JsonObject) ?: JsonObject(emptyMap())

      val orderedArgs = ArrayList<String>()
      val propDetails = ArrayList<String>()
      for (p in props) {
        val optSuffix = if (p in reqs) "" else "?"
        orderedArgs.add("$p$optSuffix")
        val pDesc =
          ((argsProperties[p] as? JsonObject)?.get("description") as? JsonPrimitive)?.contentOrNull
        if (!pDesc.isNullOrEmpty()) {
          propDetails.add("  - $p: $pDesc")
        }
      }

      val sb = StringBuilder("• $name(${orderedArgs.joinToString(", ")})")
      if (!fDesc.isNullOrEmpty()) {
        sb.append("\n  - Description: ").append(fDesc.replace("\n", "\n    "))
      }
      if (propDetails.isNotEmpty()) {
        sb.append("\n").append(propDetails.joinToString("\n"))
      }
      signatures.add(sb.toString())
    }
    return signatures.joinToString("\n")
  }

  private fun promptSchemaAllowsDatabinding(propSchema: JsonObject?): Boolean {
    if (propSchema == null) return false
    val ref = (propSchema["\$ref"] as? JsonPrimitive)?.contentOrNull
    if (
      ref != null &&
        (ref.contains("DataBinding") || ref.contains("Dynamic") || ref.contains("ChildList"))
    ) {
      return true
    }
    for (k in listOf("oneOf", "anyOf", "allOf")) {
      val subs = propSchema[k] as? JsonArray ?: continue
      if (subs.any { it is JsonObject && promptSchemaAllowsDatabinding(it) }) return true
    }
    return false
  }

  private fun getSchemaEnumStrings(propSchema: JsonObject?): List<String>? {
    if (propSchema == null) return null
    (propSchema["enum"] as? JsonArray)?.let { arr ->
      return arr.map { (it as? JsonPrimitive)?.content ?: it.toString() }
    }
    for (k in listOf("oneOf", "anyOf")) {
      val subs = propSchema[k] as? JsonArray ?: continue
      for (sub in subs) {
        if (sub is JsonObject) {
          getSchemaEnumStrings(sub)?.let {
            return it
          }
        }
      }
    }
    return null
  }

  private fun decompileExampleMessages(
    jsonContent: String,
    defaultCatalogId: String? = null,
  ): String? {
    return try {
      val parsed = Json.parseToJsonElement(jsonContent)
      val rawList =
        when (parsed) {
          is JsonObject -> listOf(parsed)
          is JsonArray -> parsed.map { it as? JsonObject ?: return null }
          else -> return null
        }
      if (rawList.isEmpty()) return null
      if (rawList.any { msg -> EXAMPLE_MESSAGE_KEYS.none { it in msg } }) return null
      val models =
        normalizePromptExampleMessages(
          rawList,
          defaultCatalogId =
            defaultCatalogId ?: CatalogSchemaHelper.surfaceCatalogId(checkedCatalogs),
        )
      decompiler.decompile(models)
    } catch (_: Exception) {
      null
    }
  }

  private fun normalizePromptExampleMessages(
    items: List<JsonObject>,
    defaultCatalogId: String?,
    defaultSurfaceId: String = "main",
  ): List<AgentToRendererMessage> {
    return items.map { item ->
      val d = LinkedHashMap<String, JsonElement>(item)
      if ("version" !in d && EXAMPLE_MESSAGE_KEYS.any { it in d }) {
        d["version"] = JsonPrimitive(ProtocolVersion.V1_0.value)
      }
      for (k in SURFACE_OP_KEYS) {
        val sub = d[k] as? JsonObject ?: continue
        val subMap = LinkedHashMap<String, JsonElement>(sub)
        if ("surfaceId" !in subMap) {
          subMap["surfaceId"] = JsonPrimitive(defaultSurfaceId)
        }
        if (k == "createSurface" && "catalogId" !in subMap && defaultCatalogId != null) {
          subMap["catalogId"] = JsonPrimitive(defaultCatalogId)
        }
        d[k] = JsonObject(subMap)
      }
      if ("callFunction" in d && "callRendererFunction" !in d) {
        val cf = d.remove("callFunction") as? JsonObject
        if (cf != null) {
          val cfNorm = LinkedHashMap<String, JsonElement>(cf)
          if (defaultCatalogId != null && "catalogId" !in cfNorm) {
            cfNorm["catalogId"] = JsonPrimitive(defaultCatalogId)
          }
          val callId = (d.remove("functionCallId") as? JsonPrimitive)?.contentOrNull ?: "call_1"
          d["callRendererFunction"] =
            JsonObject(
              mapOf("functionCallId" to JsonPrimitive(callId), "callFunction" to JsonObject(cfNorm))
            )
        }
      }
      AgentToRendererMessage.fromJsonObject(JsonObject(d), strict = false)
    }
  }
}
