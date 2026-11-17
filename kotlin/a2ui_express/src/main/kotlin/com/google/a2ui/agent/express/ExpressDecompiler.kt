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

import com.google.a2ui.core.A2uiErrorDetail
import com.google.a2ui.core.A2uiValidationError
import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.Catalog
import com.google.a2ui.core.Uax31Identifier
import com.google.a2ui.core.jsonValuesEqual
import kotlin.math.abs
import kotlin.math.withSign
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Decompilation engine for A2UI Express v1.0.
 *
 * Converts A2UI wire messages back into compact, human- and LLM-readable A2UI Express DSL syntax.
 */
class ExpressDecompiler(catalogs: List<Catalog>) {
  private val checkedCatalogs: List<Catalog> = CatalogSchemaHelper.checkMixedCatalogs(catalogs)
  internal val helpers: Map<String, CatalogSchemaHelper> =
    CatalogSchemaHelper.buildCatalogHelpers(checkedCatalogs)
  private val soleCatalogId: String? = CatalogSchemaHelper.surfaceCatalogId(checkedCatalogs)

  val catalogs: List<Catalog>
    get() = checkedCatalogs.toList()

  companion object {
    private const val DEFAULT_SURFACE_ID = "default_surface"
    private val RESERVED_WORDS = setOf("_", "true", "false", "null")
    const val A2UI_OPEN_TAG = "<a2ui>"
    const val A2UI_CLOSE_TAG = "</a2ui>"

    internal fun isVariableName(name: String): Boolean =
      Uax31Identifier.isValidIdentifier(name) && name !in RESERVED_WORDS

    private fun deriveVariableName(componentId: String): String {
      val sb = StringBuilder(componentId.length + 2)
      var i = 0
      while (i < componentId.length) {
        val cp = componentId.codePointAt(i)
        if (Uax31Identifier.isXidContinue(cp)) {
          sb.appendCodePoint(cp)
        } else {
          sb.append('_')
        }
        i += Character.charCount(cp)
      }
      var base = sb.toString()
      while (!isVariableName(base)) {
        base = "_$base"
      }
      return base
    }

    private fun assignVariableNames(componentIds: List<String>): Map<String, String> {
      val names = LinkedHashMap<String, String>()
      val taken = HashSet<String>()
      for (cid in componentIds) {
        if (isVariableName(cid)) {
          names[cid] = cid
          taken.add(cid)
        }
      }
      for (cid in componentIds) {
        if (cid in names) continue
        val base = deriveVariableName(cid)
        var candidate = base
        var suffix = 2
        while (candidate in taken) {
          candidate = "${base}_${suffix++}"
        }
        names[cid] = candidate
        taken.add(candidate)
      }
      return names
    }

    internal fun decompileString(value: String): String {
      val hasNewline = '\n' in value || '\r' in value
      val hasTab = '\t' in value
      val hasQuote = '"' in value
      val hasBackslash = '\\' in value

      if (hasNewline && !value.endsWith('"') && "\"\"\"" !in value) {
        if (hasBackslash && !hasTab) {
          return "r\"\"\"$value\"\"\""
        }
        val escaped = value.replace("\\", "\\\\").replace("\t", "\\t")
        return "\"\"\"$escaped\"\"\""
      }

      if (hasBackslash && !hasNewline && !hasTab && !hasQuote) {
        return "r\"$value\""
      }

      val escaped =
        value
          .replace("\\", "\\\\")
          .replace("\"", "\\\"")
          .replace("\n", "\\n")
          .replace("\r", "\\r")
          .replace("\t", "\\t")
      return "\"$escaped\""
    }

    private fun decompileKey(key: String): String =
      if (isVariableName(key)) key else decompileString(key)

    private fun decompilePath(pathStr: String): String =
      if (pathStr.startsWith("/")) "$/${pathStr.substring(1)}" else "$$pathStr"

    private fun decompileReference(
      componentId: JsonElement?,
      varNames: Map<String, String>,
    ): String {
      val str =
        (componentId as? JsonPrimitive)?.takeIf { it.isString }?.content
          ?: return decompileString(componentId?.toString() ?: "")
      varNames[str]?.let {
        return it
      }
      if (isVariableName(str) && str !in varNames.values) {
        return str
      }
      return decompileString(str)
    }

    internal fun decompileNumber(prim: JsonPrimitive): String {
      val raw = prim.content
      if (raw.none { it == '.' || it == 'e' || it == 'E' }) {
        return raw
      }
      val d =
        prim.doubleOrNull
          ?: throw ExpressValidationError("The number $raw has no Express notation.")
      if (!d.isFinite()) {
        throw ExpressValidationError("The number $d has no Express notation.")
      }
      val negative = 1.0.withSign(d) < 0.0
      val (digits, exponent) = shortestDigits(abs(d))
      return ecmascriptNotation(negative, digits, exponent)
    }

    private fun shortestDigits(absVal: Double): Pair<String, Int> {
      val repr = java.lang.Double.toString(absVal).lowercase()
      val eIdx = repr.indexOf('e')
      val mantissa = if (eIdx >= 0) repr.substring(0, eIdx) else repr
      val expPart = if (eIdx >= 0) repr.substring(eIdx + 1).toInt() else 0
      val dotIdx = mantissa.indexOf('.')
      val intPart = if (dotIdx >= 0) mantissa.substring(0, dotIdx) else mantissa
      val fracPart = if (dotIdx >= 0) mantissa.substring(dotIdx + 1) else ""
      val rawDigits = intPart + fracPart
      val digits = rawDigits.trimStart('0')
      if (digits.isEmpty()) return "0" to 1
      val exponent = expPart + intPart.length - (rawDigits.length - digits.length)
      return digits.trimEnd('0') to exponent
    }

    private fun ecmascriptNotation(negative: Boolean, digits: String, exponent: Int): String {
      val k = digits.length
      val n = exponent
      val text =
        when {
          n in k..21 -> "${digits}${"0".repeat(n - k)}.0"
          n in 1..21 -> "${digits.substring(0, n)}.${digits.substring(n)}"
          n in -5..0 -> "0.${"0".repeat(-n)}$digits"
          else -> {
            val fraction = if (k > 1) ".${digits.substring(1)}" else ""
            val expVal = n - 1
            val expSign = if (expVal >= 0) "+$expVal" else "$expVal"
            "${digits[0]}${fraction}e$expSign"
          }
        }
      return if (negative) "-$text" else text
    }

    private fun flattenDataModel(dataObj: JsonObject): List<Pair<String, JsonElement>> {
      val results = ArrayList<Pair<String, JsonElement>>()
      fun recurse(current: JsonElement, path: String) {
        if (current is JsonObject && current.isNotEmpty()) {
          for ((k, v) in current) {
            recurse(v, "$path/$k")
          }
        } else {
          results.add(path to current)
        }
      }
      recurse(dataObj, "")
      return results
    }

    private fun isComponentReferenceProperty(propSchema: JsonObject?): Boolean {
      if (propSchema == null) return false
      val ref = (propSchema["\$ref"] as? JsonPrimitive)?.contentOrNull
      if (
        ref != null &&
          (ref.contains("ComponentId") || ref.contains("Child") || ref.contains("ChildList"))
      ) {
        return true
      }
      for (k in listOf("oneOf", "anyOf", "allOf")) {
        val subs = propSchema[k] as? JsonArray ?: continue
        if (subs.any { it is JsonObject && isComponentReferenceProperty(it) }) return true
      }
      if ((propSchema["type"] as? JsonPrimitive)?.contentOrNull == "array") {
        val items = propSchema["items"] as? JsonObject
        if (items != null) return isComponentReferenceProperty(items)
      }
      return false
    }

    private fun stripTrailingPlaceholders(args: MutableList<String>) {
      while (args.isNotEmpty() && args.last() == "_") {
        args.removeAt(args.lastIndex)
      }
    }
  }

  /** Wraps decompiled Express blocks inside `<a2ui>` and `</a2ui>` sentinel tags. */
  fun wrapDecompiledBlocks(blocks: List<String>): String =
    "$A2UI_OPEN_TAG\n${blocks.joinToString("\n")}\n$A2UI_CLOSE_TAG"

  /** Decompiles [a2uiPayload] into compact A2UI Express DSL text. */
  fun decompile(
    a2uiPayload: List<AgentToRendererMessage>,
    useKeywordArgs: Boolean = false,
  ): String = decompileJsonMessages(a2uiPayload.map { it.toJsonObject() }, useKeywordArgs)

  internal fun decompileJsonMessages(
    rawMessages: List<JsonObject>,
    useKeywordArgs: Boolean = false,
  ): String {
    val blocks = ArrayList<String>()
    var callCount = 0
    for ((idx, item) in coalesceJsonMessages(rawMessages).withIndex()) {
      if (item.message.isEmpty()) continue
      val block =
        if ("callRendererFunction" in item.message || "callFunction" in item.message) {
          callCount++
          decompileRendererCall(item.message, callCount)
        } else {
          decompileItem(item, useKeywordArgs = useKeywordArgs, isFirst = (idx == 0))
        }
      if (block.isNotEmpty()) {
        blocks.add(block)
      }
    }
    return blocks.joinToString("\n")
  }

  private fun helperFor(catalogId: String): CatalogSchemaHelper =
    helpers[catalogId]
      ?: throw ExpressValidationError(
        "Unknown catalog '$catalogId'. Available catalogs: ${helpers.keys.toList()}"
      )

  private fun surfaceCatalog(catalogId: String?): String? {
    if (soleCatalogId == null) return catalogId
    if (catalogId != null) helperFor(catalogId)
    return soleCatalogId
  }

  private fun resolve(
    kind: String,
    name: String,
    catalogId: String?,
    surfaceCatId: String?,
    label: String,
  ): Pair<CatalogSchemaHelper, String?> {
    val actual =
      catalogId
        ?: surfaceCatId
        ?: throw ExpressValidationError(
          "${label.replaceFirstChar { it.uppercase() }} '$name' names no catalogId, and its surface has no catalog."
        )
    val helper = helperFor(actual)
    val defined = if (kind == "component") helper.components else helper.functions
    if (name !in defined) {
      throw ExpressValidationError("Unknown $label '$name' not defined in catalog '$actual'.")
    }
    if (soleCatalogId != null) {
      return helper to null
    }
    val found = CatalogSchemaHelper.catalogsDefining(helpers, kind, name)
    return helper to (if (found == listOf(actual)) null else actual)
  }

  private fun systemFunctionHelper(fn: JsonObject, name: String): CatalogSchemaHelper {
    val helper = helpers.values.first()
    if (name !in helper.systemFunctions) {
      throw A2uiValidationError("Unknown system function '$name'.")
    }
    if ("catalogId" in fn) {
      throw A2uiValidationError(
        "System function '$name' is defined by the protocol, not a catalog, so it takes no catalogId."
      )
    }
    return helper
  }

  private fun checkComponentIds(componentIds: List<String>) {
    val details =
      componentIds
        .filter { !Uax31Identifier.isValidIdentifier(it) }
        .map { cid ->
          A2uiErrorDetail(
            path = "components.$cid.id",
            code = "invalid_identifier",
            message = "Component id '$cid' must be a valid UAX #31 identifier",
          )
        }
    if (details.isNotEmpty()) {
      throw A2uiValidationError(details[0].message, details = details)
    }
  }

  private fun surfaceHeader(surfaceId: String): String = "surface(${decompileString(surfaceId)})"

  private fun decompileItem(
    item: CoalescedMessage,
    useKeywordArgs: Boolean,
    isFirst: Boolean,
  ): String {
    val envelope = item.message
    if ("deleteSurface" in envelope) {
      val sid =
        ((envelope["deleteSurface"] as? JsonObject)?.get("surfaceId") as? JsonPrimitive)
          ?.contentOrNull
          .orEmpty()
      return "deleteSurface(${decompileString(sid)})"
    }

    if (item.isUpdate) {
      return decompileUpdate(item, useKeywordArgs = useKeywordArgs, isFirst = isFirst)
    }

    val createSurface = (envelope["createSurface"] as? JsonObject) ?: JsonObject(emptyMap())
    val surfaceId =
      ((createSurface["surfaceId"] as? JsonPrimitive)?.contentOrNull).takeUnless {
        it.isNullOrEmpty()
      } ?: DEFAULT_SURFACE_ID
    val explicitCat =
      (createSurface["catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    val catalogId = surfaceCatalog(explicitCat ?: item.surfaceCatalogId)

    val sendDataModel = (createSurface["sendDataModel"] as? JsonPrimitive)?.booleanOrNull
    val metadata = createSurface["metadata"] as? JsonObject
    val surfaceExtensions = metadata?.get("extensions") as? JsonObject

    val dslLines = ArrayList<String>()
    if (
      !(isFirst &&
        surfaceId == DEFAULT_SURFACE_ID &&
        sendDataModel == null &&
        surfaceExtensions == null)
    ) {
      var header = surfaceHeader(surfaceId)
      if (sendDataModel != null) {
        val flag = if (sendDataModel) "true" else "false"
        header = "${header.dropLast(1)}, sendDataModel=$flag)"
      }
      if (surfaceExtensions != null) {
        val extStr = decompileValue(surfaceExtensions, emptyMap(), false, catalogId)
        header = "${header.dropLast(1)}, extensions=$extStr)"
      }
      dslLines.add(header)
    }

    val dataModel = createSurface["dataModel"] as? JsonObject
    if (dataModel != null && dataModel.isNotEmpty()) {
      for ((path, value) in flattenDataModel(dataModel).sortedBy { it.first }) {
        val valStr = decompileValue(value, emptyMap(), false, catalogId)
        dslLines.add("$$path = $valStr")
      }
    }

    val components =
      (createSurface["components"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
    dslLines.addAll(decompileComponents(components, catalogId, useKeywordArgs))
    return dslLines.joinToString("\n")
  }

  private fun decompileUpdate(
    item: CoalescedMessage,
    useKeywordArgs: Boolean,
    isFirst: Boolean,
  ): String {
    val op = item.operation ?: error("Expected surface update operation key.")
    val body = (item.message[op] as? JsonObject) ?: JsonObject(emptyMap())
    val surfaceId =
      ((body["surfaceId"] as? JsonPrimitive)?.contentOrNull).takeUnless { it.isNullOrEmpty() }
        ?: DEFAULT_SURFACE_ID
    val catalogId = surfaceCatalog(item.surfaceCatalogId)
    val components =
      if (op == "updateComponents") {
        (body["components"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
      } else {
        emptyList()
      }
    val hasRoot = components.any { (it["id"] as? JsonPrimitive)?.contentOrNull == "root" }
    var header = surfaceHeader(surfaceId)
    if (hasRoot) {
      header = "${header.dropLast(1)}, update=true)"
    }

    val dslLines = ArrayList<String>()
    if (hasRoot || !(isFirst && surfaceId == DEFAULT_SURFACE_ID)) {
      dslLines.add(header)
    }

    if (op == "updateComponents") {
      dslLines.addAll(decompileComponents(components, catalogId, useKeywordArgs))
    } else {
      val rawPath =
        ((body["path"] as? JsonPrimitive)?.contentOrNull).takeUnless { it.isNullOrEmpty() } ?: "/"
      val valStr = decompileValue(body["value"] ?: JsonNull, emptyMap(), false, catalogId)
      dslLines.add("${decompilePath(rawPath)} = $valStr")
    }
    return dslLines.joinToString("\n")
  }

  private fun decompileRendererCall(envelope: JsonObject, callIndex: Int): String {
    val rendererCall = envelope["callRendererFunction"] as? JsonObject
    val funcOp: JsonObject
    val functionCallId: String?
    if (rendererCall != null && rendererCall["callFunction"] is JsonObject) {
      funcOp = rendererCall["callFunction"] as JsonObject
      functionCallId =
        (rendererCall["functionCallId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    } else {
      funcOp = (envelope["callFunction"] as? JsonObject) ?: JsonObject(emptyMap())
      functionCallId = null
    }
    var callRepr = decompileCall(funcOp, emptyMap(), soleCatalogId)
    if (!functionCallId.isNullOrEmpty() && functionCallId != "call_$callIndex") {
      val idArg = "functionCallId=${decompileString(functionCallId)}"
      val sep = if (callRepr.endsWith("()")) "" else ", "
      callRepr = "${callRepr.dropLast(1)}$sep$idArg)"
    }
    return callRepr
  }

  private fun decompileComponents(
    components: List<JsonObject>,
    surfaceCatId: String?,
    useKeywordArgs: Boolean,
  ): List<String> {
    val componentIds =
      components.map {
        ((it["id"] as? JsonPrimitive)?.contentOrNull)
          ?: throw ExpressValidationError("Component is missing 'id'.")
      }
    checkComponentIds(componentIds)
    val varNames = assignVariableNames(componentIds)
    val dslLines = ArrayList<String>(components.size)

    for (c in components) {
      val compId = (c["id"] as JsonPrimitive).content
      val varName = varNames.getValue(compId)
      val compName =
        (c["component"] as? JsonPrimitive)?.contentOrNull
          ?: throw ExpressValidationError("Component '$compId' is missing 'component'.")
      val (compHelper, writeCatId) =
        resolve(
          "component",
          compName,
          componentCatalogId(c, surfaceCatId),
          surfaceCatId,
          "component",
        )

      val properties = compHelper.getComponentProperties(compName)
      val customEnvelope = compHelper.getCustomEnvelopeProperties(compName)
      val argsReprs = ArrayList<String>()
      val positionalUntil =
        if (useKeywordArgs && "catalogId" in properties && "catalogId" in c) {
          properties.indexOf("catalogId")
        } else {
          -1
        }

      for ((propIdx, propName) in properties.withIndex()) {
        val keyword = useKeywordArgs && propIdx > positionalUntil
        if (
          propName == "checks" && "checks" !in customEnvelope && compHelper.isCheckable(compName)
        ) {
          val checksArr = (getEnvelopeValue(c, "checks", customEnvelope) as? JsonArray).orEmpty()
          if (checksArr.isEmpty()) {
            argsReprs.add("_")
            continue
          }
          val checkReprs =
            checksArr.mapNotNull { rc ->
              (rc as? JsonObject)?.let { decompileCheck(it, c, varNames, surfaceCatId) }
            }
          if (checkReprs.size == 1) {
            argsReprs.add(checkReprs[0])
          } else {
            argsReprs.add("[${checkReprs.joinToString(", ")}]")
          }
          continue
        }

        if (propName in c) {
          val pSchema = compHelper.getPropertySchema(compName, propName)
          val valStr =
            decompileValue(
              c.getValue(propName),
              varNames,
              isComponentReferenceProperty(pSchema),
              surfaceCatId,
            )
          if (keyword) {
            argsReprs.add("$propName=$valStr")
          } else {
            argsReprs.add(valStr)
          }
        } else if (!keyword) {
          val hasLaterRegularValue =
            properties.subList(propIdx + 1, properties.size).any { laterProp ->
              (laterProp != "checks" || "checks" in customEnvelope) && laterProp in c
            }
          if (hasLaterRegularValue) {
            argsReprs.add("_")
          }
        }
      }

      stripTrailingPlaceholders(argsReprs)

      if ("checks" in customEnvelope && compHelper.isCheckable(compName)) {
        val checksArr = (getEnvelopeValue(c, "checks", customEnvelope) as? JsonArray).orEmpty()
        if (checksArr.isNotEmpty()) {
          val checkReprs =
            checksArr.mapNotNull { rc ->
              (rc as? JsonObject)?.let { decompileCheck(it, c, varNames, surfaceCatId) }
            }
          if (checkReprs.size == 1) {
            argsReprs.add(checkReprs[0])
          } else {
            argsReprs.add("[${checkReprs.joinToString(", ")}]")
          }
        }
      }

      if (writeCatId != null) {
        argsReprs.add("catalogId=${decompileString(writeCatId)}")
      }
      if (varName != compId) {
        argsReprs.add("id=${decompileString(compId)}")
      }
      val compMeta = getEnvelopeValue(c, "metadata", customEnvelope) as? JsonObject
      val compExt = compMeta?.get("extensions") as? JsonObject
      if (compExt != null) {
        val extStr = decompileValue(compExt, varNames, false, surfaceCatId)
        argsReprs.add("extensions=$extStr")
      }

      dslLines.add("$varName = $compName(${argsReprs.joinToString(", ")})")
    }
    return dslLines
  }

  private fun componentCatalogId(component: JsonObject, surfaceCatId: String?): String? {
    if ("@catalogId" in component) {
      val override = (component["@catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
      if (override.isNullOrEmpty()) {
        val id = (component["id"] as? JsonPrimitive)?.contentOrNull ?: "<unknown>"
        throw ExpressValidationError(
          "Component '$id' has an invalid '@catalogId': ${component["@catalogId"]}."
        )
      }
      return override
    }
    val legacy =
      (component["catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
    val home = if (surfaceCatId != null) helpers[surfaceCatId] else null
    val compName = (component["component"] as? JsonPrimitive)?.contentOrNull
    if (compName != null) {
      if (home != null && compName in home.components) {
        if ("catalogId" in home.getCustomEnvelopeProperties(compName)) return null
      } else {
        val declaring = helpers.values.filter { compName in it.components }
        if (
          declaring.isNotEmpty() &&
            declaring.all { "catalogId" in it.getCustomEnvelopeProperties(compName) }
        ) {
          return null
        }
      }
    }
    return legacy
  }

  private fun getEnvelopeValue(
    component: JsonObject,
    name: String,
    customProperties: Set<String>,
  ): JsonElement? {
    component["@$name"]?.let {
      return it
    }
    if (name !in customProperties) {
      return component[name]
    }
    return null
  }

  private fun decompileCheck(
    rawRule: JsonObject,
    component: JsonObject,
    varNames: Map<String, String>,
    surfaceCatId: String?,
  ): String {
    val rule =
      if ("condition" !in rawRule && hasReservedKey(rawRule, "call")) {
        JsonObject(mapOf("condition" to rawRule))
      } else {
        rawRule
      }
    val condition = rule["condition"] as? JsonObject
    if (condition == null || !hasReservedKey(condition, "call")) {
      throw ExpressValidationError(
        "Express cannot write a check whose condition is not a function call: ${rule["condition"]}"
      )
    }
    val checkName =
      (reservedValue(condition, "call") as? JsonPrimitive)?.contentOrNull
        ?: throw ExpressValidationError("Check condition '@call' must be a string.")
    val checkArgs = (condition["args"] as? JsonObject) ?: JsonObject(emptyMap())
    val condCatId = (condition["catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    val (chkHelper, writeCatId) =
      resolve("function", checkName, condCatId, surfaceCatId, "check function")
    val checkProps = chkHelper.getFunctionProperties(checkName)

    val compValue = component["value"] as? JsonObject
    val startIdx =
      if (
        checkProps.isNotEmpty() &&
          checkProps[0] == "value" &&
          compValue != null &&
          hasReservedKey(compValue, "path") &&
          jsonValuesEqual(checkArgs["value"], compValue)
      ) {
        1
      } else {
        0
      }

    val argsReprs = ArrayList<String>()
    for (p in checkProps.subList(startIdx, checkProps.size)) {
      if (p in checkArgs) {
        argsReprs.add(decompileValue(checkArgs.getValue(p), varNames, false, surfaceCatId))
      } else {
        argsReprs.add("_")
      }
    }

    val message = (rule["message"] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
    val defaultMessage = "${checkName.replaceFirstChar { it.uppercase() }} check failed"
    if (message.isNotEmpty() && message != defaultMessage) {
      argsReprs.add(decompileString(message))
    } else {
      stripTrailingPlaceholders(argsReprs)
    }

    if (writeCatId != null) {
      argsReprs.add("{catalogId: ${decompileString(writeCatId)}}")
    }

    return if (argsReprs.isNotEmpty()) "?$checkName(${argsReprs.joinToString(", ")})"
    else "?$checkName"
  }

  private fun decompileCall(
    fn: JsonObject,
    varNames: Map<String, String>,
    surfaceCatId: String?,
  ): String {
    val name = (reservedValue(fn, "call") as? JsonPrimitive)?.contentOrNull.orEmpty()
    val rawArgs = fn["args"]
    val (fnHelper, writeCatId) =
      if (name.startsWith("@")) {
        systemFunctionHelper(fn, name) to null
      } else {
        val catId = (fn["catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        resolve("function", name, catId, surfaceCatId, "function")
      }

    val fnProps = fnHelper.getFunctionProperties(name)
    val argsReprs = ArrayList<String>()
    for ((idx, p) in fnProps.withIndex()) {
      val (present, argVal) =
        when (rawArgs) {
          is JsonObject -> (p in rawArgs) to rawArgs[p]
          is JsonArray -> (idx < rawArgs.size) to rawArgs.getOrNull(idx)
          else -> false to null
        }
      if (present && argVal != null) {
        argsReprs.add(decompileValue(argVal, varNames, false, surfaceCatId))
      } else {
        argsReprs.add("_")
      }
    }
    stripTrailingPlaceholders(argsReprs)
    if (writeCatId != null) {
      argsReprs.add("catalogId=${decompileString(writeCatId)}")
    }
    return "$name(${argsReprs.joinToString(", ")})"
  }

  private fun decompileValue(
    value: JsonElement,
    varNames: Map<String, String>,
    isRef: Boolean,
    surfaceCatId: String?,
  ): String {
    return when (value) {
      is JsonNull -> "null"
      is JsonPrimitive -> {
        if (value.isString) {
          if (isRef) decompileReference(value, varNames) else decompileString(value.content)
        } else if (value.booleanOrNull != null) {
          if (value.booleanOrNull == true) "true" else "false"
        } else {
          decompileNumber(value)
        }
      }
      is JsonArray -> {
        val items = value.map { decompileValue(it, varNames, isRef, surfaceCatId) }
        "[${items.joinToString(", ")}]"
      }
      is JsonObject -> {
        if ("componentId" in value && "path" in value) {
          val compIdRepr = decompileReference(value["componentId"], varNames)
          val pathStr = (value["path"] as? JsonPrimitive)?.contentOrNull.orEmpty()
          return "_template(${decompilePath(pathStr)}, $compIdRepr)"
        }
        val boundPath = (value["@path"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (boundPath != null && value.size == 1) {
          return decompilePath(boundPath)
        }
        val evt = value["event"] as? JsonObject
        if (evt != null) {
          val eventName = (evt["name"] as? JsonPrimitive)?.contentOrNull.orEmpty()
          val eventArgs = ArrayList<String>()
          eventArgs.add(decompileString(eventName))
          if ("context" in evt) {
            val ctxObj = (evt["context"] as? JsonObject) ?: JsonObject(emptyMap())
            val ctxReprs =
              ctxObj.entries.map { (k, v) ->
                "${decompileKey(k)}: ${decompileValue(v, varNames, false, surfaceCatId)}"
              }
            eventArgs.add("{${ctxReprs.joinToString(", ")}}")
          }
          val userMsg = evt["userMessage"]
          if (userMsg != null && userMsg !is JsonNull) {
            eventArgs.add("userMessage=${decompileValue(userMsg, varNames, false, surfaceCatId)}")
          }
          return "Event(${eventArgs.joinToString(", ")})"
        }
        val fnCallWrapper = value["functionCall"] as? JsonObject
        if (fnCallWrapper != null) {
          return decompileCall(fnCallWrapper, varNames, surfaceCatId)
        }
        if ((value["@call"] as? JsonPrimitive)?.isString == true) {
          return decompileCall(value, varNames, surfaceCatId)
        }
        val entries =
          value.entries.map { (k, v) ->
            val itemIsRef = isRef || k == "child" || k == "componentId"
            "${decompileKey(k)}: ${decompileValue(v, varNames, itemIsRef, surfaceCatId)}"
          }
        "{${entries.joinToString(", ")}}"
      }
    }
  }

  private fun hasReservedKey(obj: JsonObject, name: String): Boolean =
    "@$name" in obj || name in obj

  private fun reservedValue(obj: JsonObject, name: String): JsonElement? =
    obj["@$name"] ?: obj[name]
}
