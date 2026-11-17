/*
 * Copyright 2024 Google LLC
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
import com.google.a2ui.schema.A2uiConstants
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Prompt generator for A2UI Express (v1.0 and v0.9/v0.9.1).
 *
 * Supports both the v1.0 multi-catalog snippet contract ([generateSnippet]) and the legacy
 * [PromptGenerator.generate] role-based system prompt contract.
 */
class ExpressPromptGenerator(
  val catalogs: List<A2uiCatalog>,
  val exampleTurns: List<List<JsonObject>> = emptyList(),
  val allowedMessages: List<String>? = null,
  version: String? = null,
) : PromptGenerator {

  @JvmOverloads
  constructor(
    catalog: A2uiCatalog,
    allowedMessages: List<String>? = null,
    version: String? = null,
  ) : this(listOf(catalog), emptyList(), allowedMessages, version)

  init {
    validateExpressCatalogs(catalogs)
  }

  val catalog: A2uiCatalog = catalogs.first()

  val version: String = resolveExpressVersion(catalogs, version)
  private val isV1: Boolean = isExpressV1OrLater(this.version)
  val helpers: Map<String, CatalogSchemaHelper>

  init {
    val map = LinkedHashMap<String, CatalogSchemaHelper>()
    for (cat in catalogs) {
      map[cat.catalogId] = CatalogSchemaHelper(cat, this.version)
    }
    helpers = map
  }

  /** Names of agent-callable functions across active catalogs in registration order. */
  val agentCallableFunctions: List<String>
    get() {
      if (!isV1) return emptyList()
      val seen = LinkedHashSet<String>()
      for (helper in helpers.values) {
        for (fn in helper.agentCallableFunctions) {
          seen.add(fn.name)
        }
      }
      return seen.toList()
    }

  /** Renders the v1.0/v0.9 Express prompt snippet for the active catalogs and supplied examples. */
  fun generateSnippet(): String {
    val parts = mutableListOf<String>()
    parts.add(generateBaseRules())

    val writesComponents =
      allowedMessages == null ||
        allowedMessages.any {
          it in
            setOf(
              "createSurface",
              "CreateSurfaceMessage",
              "updateComponents",
              "UpdateComponentsMessage",
            )
        }

    if (writesComponents) {
      for (cat in catalogs) {
        parts.add(renderCatalogSection(cat))
      }
    }

    val renderedExamples = renderSuppliedExamples()
    if (renderedExamples.isNotEmpty()) {
      parts.add("## Examples\n\n$renderedExamples")
    }

    return parts.joinToString("\n\n")
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
    val effectiveCatalogs =
      if (allowedComponents.isNotEmpty()) {
        catalogs.map { it.prune(allowedComponents = allowedComponents.toSet()) }
      } else {
        catalogs
      }
    val effectiveAllowedMsgs =
      if (allowedMessages.isNotEmpty()) allowedMessages else this.allowedMessages
    val delegate =
      if (effectiveCatalogs !== catalogs || effectiveAllowedMsgs != this.allowedMessages) {
        ExpressPromptGenerator(
          catalogs = effectiveCatalogs,
          exampleTurns = exampleTurns,
          allowedMessages = effectiveAllowedMsgs,
          version = version,
        )
      } else {
        this
      }

    val parts = mutableListOf<String>()
    if (roleDescription.isNotBlank()) parts.add(roleDescription)
    if (workflowDescription.isNotBlank()) parts.add(workflowDescription)
    if (uiDescription.isNotBlank()) parts.add(uiDescription)

    parts.add(delegate.generateBaseRules())

    if (includeSchema) {
      for (cat in effectiveCatalogs) {
        parts.add(delegate.renderCatalogSection(cat))
      }
    }

    if (includeExamples && exampleTurns.isNotEmpty()) {
      val exBlock = delegate.renderSuppliedExamples()
      if (exBlock.isNotEmpty()) {
        parts.add("## Examples\n\n$exBlock")
      }
    }

    return parts.joinToString("\n\n")
  }

  fun generateBaseRules(): String {
    var rules = if (isV1) EXPRESS_RULES_V10 else EXPRESS_RULES_PRE_V10
    var wantsComponentsOrData = true
    var wantsComponents = true

    val callableFns = agentCallableFunctions
    val callRendererAllowed =
      allowedMessages == null ||
        "callRendererFunction" in allowedMessages ||
        "CallRendererFunctionMessage" in allowedMessages

    if (allowedMessages != null) {
      if ("deleteSurface" !in allowedMessages && "DeleteSurfaceMessage" !in allowedMessages) {
        rules =
          rules.replace(
            "\n\n12. To delete a user interface surface, output the standalone `deleteSurface(surfaceId)` command (no variable assignment):\n    deleteSurface(\"dashboard-surface-1\")",
            "",
          )
      }
      if ("updateDataModel" !in allowedMessages && "UpdateDataModelMessage" !in allowedMessages) {
        rules =
          rules.replace(
            "\n\n10. Data model population: Assign a value directly to an absolute data path (e.g. $/path/to/key = \"value\") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.",
            "",
          )
      }
      val writesComponents =
        allowedMessages.any {
          it in
            setOf(
              "createSurface",
              "CreateSurfaceMessage",
              "updateComponents",
              "UpdateComponentsMessage",
            )
        }
      val writesData =
        "updateDataModel" in allowedMessages || "UpdateDataModelMessage" in allowedMessages
      wantsComponentsOrData = writesComponents || writesData
      wantsComponents = writesComponents
      if (!writesComponents) {
        rules = rules.replace("\n    root = ComponentA(...)", "")
        if (!writesData) {
          rules =
            rules.replace(
              "\n\n15. Surface targeting: Output `surface(surfaceId)` to specify or target a user interface surface:\n    surface(\"dashboard-surface-1\")",
              "",
            )
        }
      }
    }

    val hasCallableRule = callRendererAllowed && callableFns.isNotEmpty()
    if (hasCallableRule) {
      val formatted = callableFns.joinToString(", ") { "`$it`" }
      val callRule =
        "To have the renderer run a function right away, output the call as a standalone command (no variable assignment):\n" +
          "    ${callableFns.first()}(...)\n" +
          "    Only these functions can be called this way: $formatted."
      rules =
        rules.replace("\n\n13. Static properties:", "\n\n13. $callRule\n\n14. Static properties:")
    }

    exampleRootComponent()?.let { rootComp ->
      rules = rules.replace("root = ComponentA(...)", "root = $rootComp(...)")
    }

    val hasMultiCatalogRules = catalogs.size > 1 && wantsComponentsOrData
    var combined =
      if (hasMultiCatalogRules) {
        "$rules\n${multiCatalogRules()}"
      } else {
        rules
      }

    if (allowedMessages != null || hasCallableRule || hasMultiCatalogRules) {
      combined = renumberRules(combined)
    }

    if (wantsComponents) {
      val sysSigs = generateSystemFunctionSignatures()
      if (sysSigs.isNotEmpty()) {
        combined += "\n\n$sysSigs"
      }
    }
    return combined
  }

  private fun exampleRootComponent(): String? {
    for (helper in helpers.values) {
      for ((name, meta) in helper.components) {
        if (meta.childProperties.isNotEmpty()) return name
      }
    }
    for (helper in helpers.values) {
      helper.components.keys.firstOrNull()?.let {
        return it
      }
    }
    return null
  }

  private fun multiCatalogRules(): String {
    val catalogIds = helpers.keys.toList()
    val exampleId = catalogIds.last()
    val listing = catalogIds.joinToString("\n") { "- `$it`" }
    val lines =
      mutableListOf(
        "",
        "## Multiple Catalogs",
        "",
        "Several component catalogs are active. Each is identified by its catalog ID, and the signatures below are grouped by catalog:",
        listing,
        "",
        "16. A surface has no catalog of its own: do not name a catalog on a `surface` line. Each component and function call, including checks, actions, nested function calls and inline child components, is found by its name in whichever catalog defines it.",
        "",
        "17. When several catalogs define the same component or function name, you MUST say which one you mean: add a `catalogId` keyword argument to the component or function call, or a `{catalogId: ...}` argument to a check. Do not add `catalogId` to any other name:",
        "    widget = ComponentName(..., catalogId=\"$exampleId\")",
        "    action = functionName(..., catalogId=\"$exampleId\")",
        "    ?checkName(..., {catalogId: \"$exampleId\"})",
      )

    val sharedLines = mutableListOf<String>()
    val allCompNames = helpers.values.flatMap { it.components.keys }.toSortedSet()
    for (name in allCompNames) {
      val defining = helpers.entries.filter { it.value.components.containsKey(name) }.map { it.key }
      if (defining.size > 1) {
        sharedLines.add("- Component `$name`: ${defining.joinToString(", ") { "`$it`" }}")
      }
    }
    val allFnNames = helpers.values.flatMap { it.functions.keys }.toSortedSet()
    for (name in allFnNames) {
      val defining = helpers.entries.filter { it.value.functions.containsKey(name) }.map { it.key }
      if (defining.size > 1) {
        sharedLines.add("- Function `$name`: ${defining.joinToString(", ") { "`$it`" }}")
      }
    }

    if (sharedLines.isNotEmpty()) {
      lines.add("")
      lines.add("These names are defined in several catalogs and need a `catalogId`:")
      lines.addAll(sharedLines)
    }
    return lines.joinToString("\n")
  }

  private fun generateSystemFunctionSignatures(): String {
    val helper = helpers.values.firstOrNull() ?: return ""
    if (helper.systemFunctions.isEmpty()) return ""
    val sigs =
      formatFunctionSignatures(helper, helper.systemFunctions.keys.sorted(), isSystem = true)
    return "## System Functions\n\n" +
      "These functions are defined by the A2UI protocol, not by a catalog. " +
      "Call them by their `@` name, like any function, and never add a `catalogId` to them:\n$sigs"
  }

  private fun renderCatalogSection(cat: A2uiCatalog): String {
    val helper = helpers[cat.catalogId]!!
    val compSigs = generateComponentSignatures(helper)
    val funcSigs = generateFunctionSignatures(helper)

    val rawInstructions = cat.catalogSchema["instructions"]?.jsonPrimitive?.contentOrNull ?: ""
    val translatedInstructions =
      if (rawInstructions.isNotEmpty()) {
        JSON_FENCE_REGEX.replace(rawInstructions) { m ->
          translateJsonFenceInInstructions(m.value, m.groupValues[1], cat)
        }
      } else {
        ""
      }

    val header = if (catalogs.size > 1) "# Catalog: ${cat.catalogId}\n\n" else ""
    val instrBlock =
      if (translatedInstructions.isNotEmpty()) {
        "\n\n## Catalog Instructions\n\n$translatedInstructions"
      } else {
        ""
      }

    return header +
      "## Positional Component Signatures\n\n" +
      "Use these exact positional signatures to instantiate components. Do not output property keys:\n" +
      compSigs +
      "\n\n## Positional Function Signatures\n\n" +
      "Use these exact positional signatures to instantiate check rules or logic functions:\n" +
      funcSigs +
      instrBlock
  }

  private fun translateJsonFenceInInstructions(
    originalMatch: String,
    jsonBody: String,
    cat: A2uiCatalog,
  ): String {
    return try {
      val parsed = Json.parseToJsonElement(jsonBody.trim())
      val msgs =
        when (parsed) {
          is JsonArray -> parsed.mapNotNull { it as? JsonObject }
          is JsonObject -> listOf(parsed)
          else -> emptyList()
        }
      if (msgs.isEmpty() || !msgs.all { isTranslatableMessage(it) }) {
        return originalMatch
      }
      val decompiler = ExpressDecompiler(catalogs, version, preserveFloatDecimals = true)
      val normalized = withDefaultCatalog(msgs, cat.catalogId, isV1, helpers[cat.catalogId])
      val dsl = decompiler.decompile(normalized)
      "```\n$dsl\n```"
    } catch (_: Throwable) {
      originalMatch
    }
  }

  private fun renderSuppliedExamples(): String {
    if (exampleTurns.isEmpty()) return ""
    val decompiler = ExpressDecompiler(catalogs, version)
    val blocks = mutableListOf<String>()
    for (turn in exampleTurns) {
      val defaultCat = inferExampleCatalogId(turn)
      val normalized =
        if (defaultCat != null) {
          withDefaultCatalog(turn, defaultCat, isV1, helpers[defaultCat])
        } else {
          turn
        }
      val dsl = decompiler.decompile(normalized)
      if (dsl.isNotBlank()) {
        blocks.add(
          "${A2uiConstants.A2UI_INFERENCE_OPEN_TAG}\n$dsl\n${A2uiConstants.A2UI_INFERENCE_CLOSE_TAG}"
        )
      }
    }
    return blocks.joinToString("\n\n")
  }

  private fun inferExampleCatalogId(turn: List<JsonObject>): String? {
    if (catalogs.size == 1) return catalogs.first().catalogId
    for (msg in turn) {
      val cs = msg["createSurface"] as? JsonObject
      val cid = cs?.get("catalogId")?.jsonPrimitive?.contentOrNull
      if (!cid.isNullOrEmpty() && helpers.containsKey(cid)) return cid
    }
    // Check component names across active catalogs when example omits catalogId
    val compNames = mutableSetOf<String>()
    for (msg in turn) {
      val comps =
        ((msg["createSurface"] as? JsonObject)?.get("components") as? JsonArray)
          ?: ((msg["updateComponents"] as? JsonObject)?.get("components") as? JsonArray)
      comps?.forEach { c ->
        (c as? JsonObject)?.get("component")?.jsonPrimitive?.contentOrNull?.let {
          compNames.add(it)
        }
      }
    }
    if (compNames.isNotEmpty()) {
      helpers.entries
        .firstOrNull { (_, h) -> compNames.all { h.components.containsKey(it) } }
        ?.let {
          return it.key
        }
    }
    return null
  }

  fun generateComponentSignatures(helper: CatalogSchemaHelper): String {
    val compNames = helper.components.keys.sorted()
    val compsDict = helper.catalog.catalogSchema["components"] as? JsonObject
    return compNames.joinToString("\n") { name ->
      val meta = helper.components[name]!!
      val orderedArgs = mutableListOf<String>()
      val propDetails = mutableListOf<String>()

      for (p in meta.properties) {
        val pSchema = meta.propertySchemas[p]
        val isReq = p in meta.required
        val suffix =
          when {
            helper.isComponentIdSchema(pSchema) -> " (component ID)"
            !helper.admitsPath(pSchema) -> " (static)"
            else -> ""
          }
        orderedArgs.add("$p${if (isReq) "" else "?"}$suffix")
        formatComponentPropertyDetail(p, pSchema, helper)?.let { propDetails.add(it) }
      }

      val compDesc =
        (compsDict?.get(name) as? JsonObject)?.get("description")?.jsonPrimitive?.contentOrNull
      formatSignatureEntry(name, orderedArgs, compDesc, propDetails)
    }
  }

  fun generateFunctionSignatures(helper: CatalogSchemaHelper): String =
    formatFunctionSignatures(helper, helper.functions.keys.sorted(), isSystem = false)

  private fun formatFunctionSignatures(
    helper: CatalogSchemaHelper,
    fnNames: List<String>,
    isSystem: Boolean,
  ): String {
    val funcsEl = helper.catalog.catalogSchema["functions"]
    return fnNames.joinToString("\n") { name ->
      val meta = if (isSystem) helper.systemFunctions[name]!! else helper.functions[name]!!
      val orderedArgs = mutableListOf<String>()
      val propDetails = mutableListOf<String>()

      for (p in meta.parameters) {
        orderedArgs.add("$p${if (p in meta.required) "" else "?"}")
        val pDesc = meta.propertySchemas[p]?.get("description")?.jsonPrimitive?.contentOrNull
        if (!pDesc.isNullOrEmpty()) {
          propDetails.add("  - $p: $pDesc")
        }
      }

      val fnDesc =
        if (!isSystem) {
          when (funcsEl) {
            is JsonObject ->
              (funcsEl[name] as? JsonObject)?.get("description")?.jsonPrimitive?.contentOrNull
            is JsonArray ->
              funcsEl
                .firstOrNull {
                  (it as? JsonObject)?.get("name")?.jsonPrimitive?.contentOrNull == name
                }
                ?.let { (it as JsonObject)["description"]?.jsonPrimitive?.contentOrNull }
            else -> null
          }
        } else {
          null
        }
      formatSignatureEntry(name, orderedArgs, fnDesc, propDetails)
    }
  }

  private fun formatComponentPropertyDetail(
    propName: String,
    pSchema: JsonObject?,
    helper: CatalogSchemaHelper,
  ): String? {
    if (pSchema == null) return null
    val pDesc = pSchema["description"]?.jsonPrimitive?.contentOrNull
    val enumVals = helper.extractEnumValues(pSchema)
    val lineParts = mutableListOf<String>()
    if (!pDesc.isNullOrEmpty()) lineParts.add(pDesc)
    if (!enumVals.isNullOrEmpty()) {
      lineParts.add("Must be one of: ${enumVals.joinToString(", ") { "'$it'" }}")
    }
    var detail =
      if (lineParts.isNotEmpty()) "  - $propName: ${lineParts.joinToString(" ")}" else null

    val resolved = helper.resolveLocalSchema(pSchema)
    val subProps = resolved["properties"] as? JsonObject
    if (resolved["type"]?.jsonPrimitive?.contentOrNull == "object" && subProps != null) {
      val subKeys = formatSubKeyLines(subProps)
      detail =
        if (detail != null) "$detail\n    Map keys:\n$subKeys"
        else "  - $propName: Map with keys:\n$subKeys"
    } else if (resolved["type"]?.jsonPrimitive?.contentOrNull == "array") {
      val itemSchema = (resolved["items"] as? JsonObject)?.let { helper.resolveLocalSchema(it) }
      val itemProps = itemSchema?.get("properties") as? JsonObject
      if (itemSchema?.get("type")?.jsonPrimitive?.contentOrNull == "object" && itemProps != null) {
        val subKeys = formatSubKeyLines(itemProps)
        detail =
          if (detail != null) "$detail\n    List of maps keys:\n$subKeys"
          else "  - $propName: List of maps with keys:\n$subKeys"
      }
    }
    return detail
  }

  private fun formatSubKeyLines(props: JsonObject): String =
    props.entries.joinToString("\n") { (subK, subV) ->
      val desc = (subV as? JsonObject)?.get("description")?.jsonPrimitive?.contentOrNull ?: ""
      "    * $subK${if (desc.isNotEmpty()) " - $desc" else ""}"
    }

  private fun formatSignatureEntry(
    name: String,
    orderedArgs: List<String>,
    description: String?,
    propDetails: List<String>,
  ): String {
    val sb = StringBuilder("• $name(${orderedArgs.joinToString(", ")})")
    if (!description.isNullOrEmpty()) {
      sb.append("\n  - Description: ").append(description.replace("\n", "\n    "))
    }
    if (propDetails.isNotEmpty()) {
      sb.append("\n").append(propDetails.joinToString("\n"))
    }
    return sb.toString()
  }

  companion object {
    private val JSON_FENCE_REGEX = Regex("""```json\s*\n([\s\S]*?)\n```""")
    private val RULE_BLOCK_REGEX = Regex("""(?<=\n\n)(\d+\. )([^\n]*(?:\n(?!\n)[^\n]*)*)""")
    private val TRANSLATABLE_KEYS =
      setOf(
        "createSurface",
        "updateComponents",
        "updateDataModel",
        "deleteSurface",
        "callFunction",
        "callRendererFunction",
      )

    private fun isTranslatableMessage(obj: JsonObject): Boolean =
      TRANSLATABLE_KEYS.any { obj.containsKey(it) }

    private fun renumberRules(text: String): String {
      var ruleIndex = 0
      return RULE_BLOCK_REGEX.replace(text) { m ->
        ruleIndex++
        val oldPrefix = m.groupValues[1]
        val body = m.groupValues[2]
        val newPrefix = "$ruleIndex. "
        val adjustedBody =
          if (oldPrefix.length == newPrefix.length) {
            body
          } else {
            body.replace(Regex("""\n {${oldPrefix.length}}"""), "\n" + " ".repeat(newPrefix.length))
          }
        "$newPrefix$adjustedBody"
      }
    }

    private fun withDefaultCatalog(
      messages: List<JsonObject>,
      defaultCatalogId: String,
      isV1: Boolean,
      helper: CatalogSchemaHelper?,
    ): List<JsonObject> {
      val createdSurfaces = HashSet<String>()
      return messages.map { rawMsg ->
        val copy = LinkedHashMap<String, JsonElement>(rawMsg)
        val cs = copy["createSurface"] as? JsonObject
        if (cs != null) {
          val sid =
            cs["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
          createdSurfaces.add(sid)
          if (!cs.containsKey("catalogId")) {
            val csCopy = LinkedHashMap<String, JsonElement>(cs)
            csCopy["catalogId"] = JsonPrimitive(defaultCatalogId)
            copy["createSurface"] = JsonObject(csCopy)
          }
        } else if (copy["deleteSurface"] is JsonObject) {
          val ds = copy["deleteSurface"] as JsonObject
          val sid =
            ds["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
          createdSurfaces.remove(sid)
        } else if (copy["updateComponents"] is JsonObject) {
          val uc = copy["updateComponents"] as JsonObject
          val sid =
            uc["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
          val comps = uc["components"] as? JsonArray
          if (sid !in createdSurfaces && comps != null) {
            val stamped =
              comps.map { el ->
                if (el is JsonObject) stampDefaultCatalogOnComp(el, defaultCatalogId, isV1, helper)
                else el
              }
            val ucCopy = LinkedHashMap<String, JsonElement>(uc)
            ucCopy["components"] = JsonArray(stamped)
            copy["updateComponents"] = JsonObject(ucCopy)
          }
        } else if (copy["callRendererFunction"] is JsonObject) {
          val crf = copy["callRendererFunction"] as JsonObject
          val cf = crf["callFunction"] as? JsonObject
          if (cf != null && !cf.containsKey("catalogId")) {
            val cfCopy = LinkedHashMap<String, JsonElement>(cf)
            cfCopy["catalogId"] = JsonPrimitive(defaultCatalogId)
            val crfCopy = LinkedHashMap<String, JsonElement>(crf)
            crfCopy["callFunction"] = JsonObject(cfCopy)
            copy["callRendererFunction"] = JsonObject(crfCopy)
          }
        }
        JsonObject(copy)
      }
    }

    private fun stampDefaultCatalogOnComp(
      comp: JsonObject,
      defaultCatalogId: String,
      isV1: Boolean,
      helper: CatalogSchemaHelper?,
    ): JsonObject {
      val copy = LinkedHashMap<String, JsonElement>(comp.size + 1)
      for ((k, v) in comp) {
        copy[k] = stampCallsRecursively(v, defaultCatalogId)
      }
      val compName = comp["component"]?.jsonPrimitive?.contentOrNull ?: return JsonObject(copy)
      val customEnvelope = helper?.components?.get(compName)?.customEnvelopeProperties.orEmpty()
      val catKey = if (isV1 && "catalogId" !in customEnvelope) "@catalogId" else "catalogId"
      if (!copy.containsKey(catKey)) {
        copy[catKey] = JsonPrimitive(defaultCatalogId)
      }
      return JsonObject(copy)
    }

    private fun stampCallsRecursively(el: JsonElement, defaultCatalogId: String): JsonElement =
      when (el) {
        is JsonArray -> JsonArray(el.map { stampCallsRecursively(it, defaultCatalogId) })
        is JsonObject -> {
          val copy = LinkedHashMap<String, JsonElement>(el.size + 1)
          for ((k, v) in el) copy[k] = stampCallsRecursively(v, defaultCatalogId)
          val callName =
            (copy["@call"] ?: copy["call"])?.let {
              (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content
            }
          if (callName != null && !callName.startsWith("@") && !copy.containsKey("catalogId")) {
            copy["catalogId"] = JsonPrimitive(defaultCatalogId)
          }
          JsonObject(copy)
        }
        else -> el
      }

    private val EVENT_RULE_V10 =
      """8. Action events: represent server-side actions using the Event helper, `Event(name, context?, userMessage=...)`:
   Event("save_deal", {rep: ${'$'}/form/rep})
   Event("reply", userMessage="Replying now")
   Event("save_deal", {rep: ${'$'}/form/rep}, userMessage=${'$'}/form/summary)
   The context map is optional. Pass `userMessage=` as a keyword argument (a string, `${'$'}path` binding, or function call) to set the message shown on the user's behalf when the event fires."""

    private val EVENT_RULE_PRE_V10 =
      """8. Action events: represent server-side actions using the Event helper:
   Event("save_deal", {rep: ${'$'}/form/rep})"""

    private val EXPRESS_RULES_PREFIX =
      """# A2UI Express DSL Output Contract

You must output the user interface using A2UI Express.

IMPORTANT: You MUST always surround the entire A2UI Express block with the literal sentinel tags `<a2ui>` and `</a2ui>` (always include both the opening and closing tags; do NOT wrap the tags in backticks or replace the opening tag with a markdown code fence such as ```a2ui).

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

6. Data bindings: prefix absolute paths in the data model with '${'$'}', e.g., ${'$'}/user/firstName.
   Prefix relative list scopes with '${'$'}', e.g., ${'$'}firstName.
   A lone '${'$'}' represents an empty relative path which resolves to the root of the current context (e.g. inside a template, representing the entire item itself).

7. Logic and validation: prefix client check rules with '?', e.g., ?required or ?regex("^[0-9]{5}${'$'}"). To specify a custom error message for validation failures, append it as an extra string argument, e.g. ?regex("^[0-9]{5}${'$'}", "Postal code must be 5 digits")."""

    private val EXPRESS_RULES_SUFFIX =
      """9. Nested functions: call client functions directly using catalog signatures, for example myFunction("value").

10. Data model population: Assign a value directly to an absolute data path (e.g. ${'$'}/path/to/key = "value") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.

11. Dynamic list templates: If a component expects a template child list, represent it using the _template helper:
    _template(${'$'}/path/to/list, itemTemplate)
    And define the template component variable on another line, utilizing relative path references prefixed with ${'$'}:
    itemTemplate = Image(${'$'}url)

12. To delete a user interface surface, output the standalone `deleteSurface(surfaceId)` command (no variable assignment):
    deleteSurface("dashboard-surface-1")

13. Static properties: Arguments annotated with '(static)' in the signatures below MUST be defined as literal values or arrays inline. You CANNOT use a dynamic data binding path (prefixed by ${'$'}) for these arguments.

14. Required actions: Parameters named 'action' (or annotated in component signatures) are strictly required. You must pass a valid Event (e.g. Event("click")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event("click") instead of passing null or omitting the parameter.

15. Surface targeting: Output `surface(surfaceId)` to specify or target a user interface surface:
    surface("dashboard-surface-1")
    root = ComponentA(...)"""

    val EXPRESS_RULES_V10 = "$EXPRESS_RULES_PREFIX\n\n$EVENT_RULE_V10\n\n$EXPRESS_RULES_SUFFIX"
    val EXPRESS_RULES_PRE_V10 =
      "$EXPRESS_RULES_PREFIX\n\n$EVENT_RULE_PRE_V10\n\n$EXPRESS_RULES_SUFFIX"
  }
}
