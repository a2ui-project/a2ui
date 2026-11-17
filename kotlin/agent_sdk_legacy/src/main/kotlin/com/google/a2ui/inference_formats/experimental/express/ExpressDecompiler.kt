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

import com.google.a2ui.exceptions.A2uiValidationException
import com.google.a2ui.inference_formats.experimental.express.constants.SurfaceOperation
import com.google.a2ui.schema.A2uiCatalog
import java.math.BigDecimal
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Decompilation engine for A2UI Express (v1.0 and v0.9/v0.9.1).
 *
 * Converts standard A2UI wire JSON message envelopes back into idiomatic A2UI Express DSL syntax.
 */
class ExpressDecompiler(
  val catalogs: List<A2uiCatalog>,
  protocolVersion: String? = null,
  private val preserveFloatDecimals: Boolean = false,
) {
  @JvmOverloads
  constructor(
    catalog: A2uiCatalog,
    protocolVersion: String? = null,
  ) : this(listOf(catalog), protocolVersion)

  val protocolVersion: String = resolveExpressVersion(catalogs, protocolVersion)
  val helpers: Map<String, CatalogSchemaHelper>
  private val soleCatalogId: String? = if (catalogs.size == 1) catalogs.first().catalogId else null
  private val isV1: Boolean = isExpressV1OrLater(this.protocolVersion)

  init {
    val map = LinkedHashMap<String, CatalogSchemaHelper>()
    for (cat in catalogs) {
      map[cat.catalogId] = CatalogSchemaHelper(cat, this.protocolVersion)
    }
    helpers = map
  }

  /** Legacy single-message overload delegating to multi-message [decompile]. */
  @JvmOverloads
  fun decompile(envelopeJson: JsonObject, useKeywordArgs: Boolean = false): String =
    decompile(listOf(envelopeJson), useKeywordArgs)

  /** Decompiles a sequence of A2UI wire messages into Express DSL statements. */
  @JvmOverloads
  fun decompile(messages: List<JsonObject>, useKeywordArgs: Boolean = false): String {
    val coalesced = coalesceSurfaceMessages(messages)
    val surfaceCatalogs = LinkedHashMap<String, String>()
    val blocks = mutableListOf<String>()
    var callIndex = 0

    for (envelope in coalesced) {
      val isFirst = blocks.isEmpty()

      (envelope[SurfaceOperation.DELETE] as? JsonObject)?.let { ds ->
        blocks.add(decompileDeleteSurface(ds, surfaceCatalogs))
        return@let
      }
        ?: run {
          val crf = envelope["callRendererFunction"] as? JsonObject
          val funcOp =
            if (crf != null) (crf[SurfaceOperation.CALL_FUNC] as? JsonObject)
            else (envelope[SurfaceOperation.CALL_FUNC] as? JsonObject)
          if (funcOp != null) {
            callIndex++
            val callId =
              (crf?.get("functionCallId") as? JsonPrimitive)
                ?.takeIf { it.isString && it.content.isNotEmpty() }
                ?.content
            blocks.add(decompileCallFunction(funcOp, callId, callIndex))
            return@run
          }

          (envelope[SurfaceOperation.UPDATE_DATA] as? JsonObject)?.let { udm ->
            decompileUpdateDataModel(udm, surfaceCatalogs, isFirst)?.let { blocks.add(it) }
            return@run
          }

          (envelope[SurfaceOperation.CREATE] as? JsonObject)?.let { cs ->
            decompileCreateSurface(cs, surfaceCatalogs, useKeywordArgs, isFirst)?.let {
              blocks.add(it)
            }
            return@run
          }

          (envelope[SurfaceOperation.UPDATE_COMPONENTS] as? JsonObject)?.let { uc ->
            decompileUpdateComponents(uc, surfaceCatalogs, useKeywordArgs, isFirst)?.let {
              blocks.add(it)
            }
            return@run
          }
        }
    }
    return blocks.joinToString("\n")
  }

  private fun coalesceSurfaceMessages(messages: List<JsonObject>): List<JsonObject> {
    val result = mutableListOf<MutableMap<String, JsonElement>>()
    val openBySurface = HashMap<String, Int>()

    for (msg in messages) {
      if (msg.isEmpty()) continue

      val cs = msg[SurfaceOperation.CREATE] as? JsonObject
      if (cs != null) {
        val sid =
          cs["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
        val copy = LinkedHashMap<String, JsonElement>(msg)
        copy[SurfaceOperation.CREATE] = JsonObject(LinkedHashMap(cs))
        openBySurface[sid] = result.size
        result.add(copy)
        continue
      }

      val ds = msg[SurfaceOperation.DELETE] as? JsonObject
      if (ds != null) {
        val sid =
          ds["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
        openBySurface.remove(sid)
        result.add(LinkedHashMap(msg))
        continue
      }

      if (
        msg["callRendererFunction"] is JsonObject || msg[SurfaceOperation.CALL_FUNC] is JsonObject
      ) {
        openBySurface.clear()
        result.add(LinkedHashMap(msg))
        continue
      }

      val uc = msg[SurfaceOperation.UPDATE_COMPONENTS] as? JsonObject
      if (uc != null) {
        val sid =
          uc["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
        val openIdx = openBySurface[sid]
        if (openIdx != null) {
          val openCs = result[openIdx][SurfaceOperation.CREATE] as JsonObject
          if (!openCs.containsKey("components") && uc.containsKey("components")) {
            val updatedCs = LinkedHashMap<String, JsonElement>(openCs)
            updatedCs["components"] = uc["components"]!!
            result[openIdx][SurfaceOperation.CREATE] = JsonObject(updatedCs)
            continue
          }
          openBySurface.remove(sid)
        }
        result.add(LinkedHashMap(msg))
        continue
      }

      val udm = msg[SurfaceOperation.UPDATE_DATA] as? JsonObject
      if (udm != null) {
        val sid =
          udm["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
        val openIdx = openBySurface[sid]
        if (openIdx != null) {
          val openCs = result[openIdx][SurfaceOperation.CREATE] as JsonObject
          val rawPath = udm["path"]?.jsonPrimitive?.contentOrNull
          val isRoot = rawPath == null || rawPath.isEmpty() || rawPath == "/"
          val valObj = udm["value"] as? JsonObject
          if (isRoot && valObj != null) {
            val updatedCs = LinkedHashMap<String, JsonElement>(openCs)
            updatedCs["dataModel"] = valObj
            result[openIdx][SurfaceOperation.CREATE] = JsonObject(updatedCs)
            continue
          }
          openBySurface.remove(sid)
        }
        result.add(LinkedHashMap(msg))
        continue
      }

      result.add(LinkedHashMap(msg))
    }

    return result.map { JsonObject(it) }
  }

  private fun formatSurfaceHeader(
    surfaceId: String,
    sendDataModel: Boolean? = null,
    update: Boolean = false,
    extensions: JsonObject? = null,
  ): String {
    val parts = mutableListOf(decompileString(surfaceId))
    if (sendDataModel != null) {
      parts.add("sendDataModel=$sendDataModel")
    }
    if (update) {
      parts.add("update=true")
    }
    if (extensions != null) {
      parts.add("extensions=${decompileValue(extensions, emptyMap(), isRef = false)}")
    }
    return "surface(${parts.joinToString(", ")})"
  }

  private fun decompileDeleteSurface(
    ds: JsonObject,
    surfaceCatalogs: MutableMap<String, String>,
  ): String {
    val sid = ds["surfaceId"]?.jsonPrimitive?.contentOrNull ?: ""
    surfaceCatalogs.remove(sid.ifEmpty { "default_surface" })
    return "deleteSurface(${decompileString(sid)})"
  }

  private fun decompileCallFunction(
    funcOp: JsonObject,
    functionCallId: String?,
    callIndex: Int,
  ): String {
    val extraKwargs =
      if (!functionCallId.isNullOrEmpty() && functionCallId != "call_$callIndex") {
        listOf("functionCallId=${decompileString(functionCallId)}")
      } else {
        emptyList()
      }
    return formatFunctionCall(funcOp, emptyMap(), soleCatalogId, extraKwargs)
  }

  private fun decompileUpdateDataModel(
    udm: JsonObject,
    surfaceCatalogs: Map<String, String>,
    isFirst: Boolean,
  ): String? {
    val sid = udm["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
    val (surfCatId, helper) = resolveSurfaceContext(sid, surfaceCatalogs)
    val rawPath = udm["path"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "/"
    val basePath = rawPath.trimEnd('/')
    val dataVal =
      if (basePath.isNotEmpty()) (udm["value"] ?: JsonNull)
      else (udm["value"] ?: JsonObject(emptyMap()))
    val valStr =
      decompileValue(
        dataVal,
        emptyMap(),
        isRef = false,
        helper = helper,
        surfaceCatalogId = surfCatId,
      )
    val pathStr = if (basePath.isNotEmpty()) "$$basePath" else "$/"

    val lines = mutableListOf<String>()
    if (!(isFirst && sid == "default_surface")) {
      lines.add(formatSurfaceHeader(sid))
    }
    lines.add("$pathStr = $valStr")
    return lines.joinToString("\n")
  }

  private fun decompileCreateSurface(
    cs: JsonObject,
    surfaceCatalogs: MutableMap<String, String>,
    useKeywordArgs: Boolean,
    isFirst: Boolean,
  ): String? {
    val sid = cs["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
    val explicitCat = cs["catalogId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null }
    if (explicitCat != null) {
      if (!helpers.containsKey(explicitCat)) {
        throw A2uiValidationException("Surface '$sid' names unknown catalog '$explicitCat'.")
      }
      surfaceCatalogs[sid] = explicitCat
    } else {
      surfaceCatalogs.remove(sid)
    }
    val (surfCatId, helper) = resolveSurfaceContext(sid, surfaceCatalogs)

    val sendDataModel = (cs["sendDataModel"] as? JsonPrimitive)?.booleanOrNull
    val extensions =
      if (isV1) ((cs["metadata"] as? JsonObject)?.get("extensions") as? JsonObject) else null

    val lines = mutableListOf<String>()
    if (!(isFirst && sid == "default_surface" && sendDataModel == null && extensions == null)) {
      lines.add(formatSurfaceHeader(sid, sendDataModel = sendDataModel, extensions = extensions))
    }

    val components =
      (cs["components"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
    val varNames = collectVariableNames(components)

    (cs["dataModel"] as? JsonObject)?.let { dm ->
      lines.addAll(formatDataModelLines(dm, "", varNames, helper, surfCatId))
    }

    for (comp in components) {
      lines.add(formatComponent(comp, varNames, surfCatId, useKeywordArgs))
    }
    return lines.takeIf { it.isNotEmpty() }?.joinToString("\n")
  }

  private fun decompileUpdateComponents(
    uc: JsonObject,
    surfaceCatalogs: Map<String, String>,
    useKeywordArgs: Boolean,
    isFirst: Boolean,
  ): String? {
    val sid = uc["surfaceId"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null } ?: "default_surface"
    val (surfCatId, _) = resolveSurfaceContext(sid, surfaceCatalogs)
    val components =
      (uc["components"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
    val hasRoot = components.any { it["id"]?.jsonPrimitive?.contentOrNull == "root" }

    val lines = mutableListOf<String>()
    if (hasRoot || !(isFirst && sid == "default_surface")) {
      lines.add(formatSurfaceHeader(sid, update = hasRoot))
    }
    val varNames = collectVariableNames(components)
    for (comp in components) {
      lines.add(formatComponent(comp, varNames, surfCatId, useKeywordArgs))
    }
    return lines.takeIf { it.isNotEmpty() }?.joinToString("\n")
  }

  private fun resolveSurfaceContext(
    surfaceId: String,
    surfaceCatalogs: Map<String, String>,
  ): Pair<String?, CatalogSchemaHelper> {
    val surfCatId = surfaceCatalogs[surfaceId] ?: soleCatalogId
    val helper = (if (surfCatId != null) helpers[surfCatId] else null) ?: helpers.values.first()
    return surfCatId to helper
  }

  private fun collectVariableNames(components: List<JsonObject>): Map<String, String> {
    val ids = components.mapNotNull { it["id"]?.jsonPrimitive?.contentOrNull }
    if (isV1) {
      val bad = ids.firstOrNull { !isValidUax31Identifier(it) }
      if (bad != null) {
        throw A2uiValidationException("Component id '$bad' must be a valid UAX #31 identifier.")
      }
    }
    return assignVariableNames(ids)
  }

  private fun formatDataModelLines(
    dataObj: JsonObject,
    basePath: String,
    varNames: Map<String, String>,
    helper: CatalogSchemaHelper,
    surfaceCatalogId: String?,
  ): List<String> {
    if (basePath.isEmpty() && dataObj.isEmpty()) return emptyList()
    val flattened = flattenDataModel(dataObj).sortedBy { it.first }
    return flattened.map { (leafPath, valEl) ->
      val combinedPath = if (basePath.isNotEmpty()) "$basePath$leafPath" else leafPath
      val valStr =
        decompileValue(
          valEl,
          varNames,
          isRef = false,
          helper = helper,
          surfaceCatalogId = surfaceCatalogId,
        )
      "$$combinedPath = $valStr"
    }
  }

  private fun formatComponent(
    comp: JsonObject,
    varNames: Map<String, String>,
    surfaceCatalogId: String?,
    useKeywordArgs: Boolean,
  ): String {
    val compId = comp["id"]?.jsonPrimitive?.contentOrNull ?: ""
    val varName = varNames[compId] ?: compId
    val compName = comp["component"]?.jsonPrimitive?.contentOrNull ?: ""

    val (helper, emitCatalogId) =
      resolveSymbol(
        kind = "component",
        name = compName,
        itemCatalogId = getComponentCatalogId(comp, surfaceCatalogId),
        surfaceCatalogId = surfaceCatalogId,
      )
    val meta = helper.components[compName]!!
    val properties = meta.properties
    val customEnvelope = meta.customEnvelopeProperties

    val metaRecord = if (isV1) getEnvelopeObject(comp, "metadata", true, customEnvelope) else null
    val compExtensions = metaRecord?.get("extensions") as? JsonObject

    val positionalUntil =
      if (useKeywordArgs && "catalogId" in properties && comp.containsKey("catalogId")) {
        properties.indexOf("catalogId")
      } else {
        -1
      }

    val argsReprs = mutableListOf<String>()
    for ((propIdx, propName) in properties.withIndex()) {
      val keyword = useKeywordArgs && propIdx > positionalUntil
      if (propName == "metadata" && "metadata" !in customEnvelope && compExtensions != null) {
        continue
      }
      if (comp.containsKey(propName)) {
        val pSchema = meta.propertySchemas[propName]
        val isRef =
          propName in meta.childProperties ||
            propName in meta.childListProperties ||
            isComponentRefSchema(pSchema, helper)
        val valStr =
          decompileValue(
            comp[propName]!!,
            varNames,
            isRef = isRef,
            helper = helper,
            surfaceCatalogId = surfaceCatalogId,
          )
        argsReprs.add(if (keyword) "$propName=$valStr" else valStr)
      } else if (!keyword) {
        val hasSubsequent =
          properties.subList(propIdx + 1, properties.size).any { comp.containsKey(it) }
        if (hasSubsequent) {
          argsReprs.add("_")
        }
      }
    }

    trimTrailingPlaceholders(argsReprs)

    if (meta.hasChecks) {
      val checksVal = getEnvelopeArray(comp, "checks", isV1, customEnvelope)
      if (checksVal != null && checksVal.isNotEmpty()) {
        val checkRules =
          checksVal.mapNotNull {
            (it as? JsonObject)?.let { r -> formatCheckRule(r, comp, varNames, surfaceCatalogId) }
          }
        if (checkRules.isNotEmpty()) {
          val checksRepr =
            if (checkRules.size == 1) checkRules.first() else "[${checkRules.joinToString(", ")}]"
          argsReprs.add(checksRepr)
        }
      }
    }

    if (emitCatalogId != null) {
      argsReprs.add("catalogId=${decompileString(emitCatalogId)}")
    }
    if (varName != compId) {
      argsReprs.add("id=${decompileString(compId)}")
    }
    if (compExtensions != null) {
      argsReprs.add(
        "extensions=${decompileValue(compExtensions, varNames, isRef = false, helper = helper, surfaceCatalogId = surfaceCatalogId)}"
      )
    }

    return "$varName = $compName(${argsReprs.joinToString(", ")})"
  }

  private fun getComponentCatalogId(comp: JsonObject, surfaceCatalogId: String?): JsonElement? {
    if (!isV1) return comp["catalogId"]
    if (comp.containsKey("@catalogId")) return comp["@catalogId"]
    val legacy = comp["catalogId"] ?: return null
    val compName = comp["component"]?.jsonPrimitive?.contentOrNull
    if (compName != null) {
      val home = surfaceCatalogId?.let { helpers[it] }
      if (home != null && home.components.containsKey(compName)) {
        if ("catalogId" in home.components[compName]!!.customEnvelopeProperties) return null
      } else {
        val declaring = helpers.values.filter { it.components.containsKey(compName) }
        if (
          declaring.isNotEmpty() &&
            declaring.all { "catalogId" in it.components[compName]!!.customEnvelopeProperties }
        ) {
          return null
        }
      }
    }
    return legacy
  }

  private fun formatCheckRule(
    rule: JsonObject,
    component: JsonObject,
    varNames: Map<String, String>,
    surfaceCatalogId: String?,
  ): String {
    val condition = (rule["condition"] as? JsonObject) ?: rule
    val message =
      if (rule.containsKey("condition")) rule["message"]?.jsonPrimitive?.contentOrNull ?: "" else ""
    val funcName =
      (condition["@call"] ?: condition["call"])?.jsonPrimitive?.contentOrNull?.ifEmpty { null }
        ?: "None"
    val checkArgs = optionalObjectField(condition["args"], "Check '$funcName'", "args")

    var chkHelper: CatalogSchemaHelper? = null
    var emitCatalogId: String? = null
    if (funcName != "None") {
      val resolved = resolveSymbol("function", funcName, condition["catalogId"], surfaceCatalogId)
      chkHelper = resolved.first
      emitCatalogId = resolved.second
    }

    val checkProps = chkHelper?.functions?.get(funcName)?.parameters ?: emptyList()
    val helper = chkHelper ?: helpers.values.first()

    val compValObj = component["value"] as? JsonObject
    val chkValObj = checkArgs["value"] as? JsonObject
    val compValPath =
      (compValObj?.get("@path") ?: compValObj?.get("path"))?.jsonPrimitive?.contentOrNull
    val chkValPath =
      (chkValObj?.get("@path") ?: chkValObj?.get("path"))?.jsonPrimitive?.contentOrNull

    val startIdx =
      if (checkProps.firstOrNull() == "value" && compValPath != null && compValPath == chkValPath) 1
      else 0

    val explicitArgs = mutableListOf<String>()
    for (idx in startIdx until checkProps.size) {
      val p = checkProps[idx]
      if (checkArgs.containsKey(p)) {
        explicitArgs.add(
          decompileValue(
            checkArgs[p]!!,
            varNames,
            isRef = false,
            helper = helper,
            surfaceCatalogId = surfaceCatalogId,
          )
        )
      } else {
        explicitArgs.add("_")
      }
    }

    val defaultMsg1 =
      if (funcName.isNotEmpty()) {
        "${funcName[0].uppercaseChar()}${funcName.substring(1).lowercase()} check failed"
      } else {
        ""
      }
    val defaultMsg2 =
      if (funcName.isNotEmpty()) {
        "${funcName[0].uppercaseChar()}${funcName.substring(1)} check failed"
      } else {
        ""
      }
    if (
      funcName != "None" && message.isNotEmpty() && message != defaultMsg1 && message != defaultMsg2
    ) {
      explicitArgs.add(decompileString(message))
    } else {
      trimTrailingPlaceholders(explicitArgs)
    }

    if (emitCatalogId != null) {
      explicitArgs.add("{catalogId: ${decompileString(emitCatalogId)}}")
    }

    return if (explicitArgs.isNotEmpty()) {
      "?$funcName(${explicitArgs.joinToString(", ")})"
    } else {
      "?$funcName"
    }
  }

  private fun formatFunctionCall(
    funcCall: JsonObject,
    varNames: Map<String, String>,
    surfaceCatalogId: String?,
    extraKwargs: List<String> = emptyList(),
  ): String {
    val funcName = (funcCall["@call"] ?: funcCall["call"])?.jsonPrimitive?.contentOrNull ?: ""
    val rawArgs = funcCall["args"]
    val listArgs = rawArgs as? JsonArray
    val dictArgs =
      if (listArgs != null) JsonObject(emptyMap())
      else optionalObjectField(rawArgs, "Function call '$funcName'", "args")

    val (helper, emitCatalogId) =
      if (funcName.startsWith("@")) {
        systemFunctionHelper(funcCall, funcName) to null
      } else {
        resolveSymbol("function", funcName, funcCall["catalogId"], surfaceCatalogId)
      }

    val fnProps =
      if (funcName.startsWith("@")) helper.systemFunctions[funcName]?.parameters.orEmpty()
      else helper.functions[funcName]?.parameters.orEmpty()

    val argsReprs = mutableListOf<String>()
    for ((idx, p) in fnProps.withIndex()) {
      val argEl = if (listArgs != null) listArgs.getOrNull(idx) else dictArgs[p]
      if (argEl != null) {
        argsReprs.add(
          decompileValue(
            argEl,
            varNames,
            isRef = false,
            helper = helper,
            surfaceCatalogId = surfaceCatalogId,
          )
        )
      } else {
        argsReprs.add("_")
      }
    }
    trimTrailingPlaceholders(argsReprs)

    if (emitCatalogId != null) {
      argsReprs.add("catalogId=${decompileString(emitCatalogId)}")
    }
    argsReprs.addAll(extraKwargs)
    return "$funcName(${argsReprs.joinToString(", ")})"
  }

  internal fun decompileValue(
    el: JsonElement,
    varNames: Map<String, String>,
    isRef: Boolean = false,
    helper: CatalogSchemaHelper = helpers.values.first(),
    surfaceCatalogId: String? = soleCatalogId,
  ): String {
    when (el) {
      is JsonNull -> return "null"
      is JsonPrimitive -> {
        if (el.isString) {
          return if (isRef) decompileReference(el.content, varNames)
          else decompileString(el.content)
        }
        el.booleanOrNull?.let {
          return it.toString()
        }
        return decompileJsonNumber(el, preserveFloatDecimals)
      }
      is JsonArray -> {
        val items =
          el.map {
            decompileValue(
              it,
              varNames,
              isRef = isRef,
              helper = helper,
              surfaceCatalogId = surfaceCatalogId,
            )
          }
        return "[${items.joinToString(", ")}]"
      }
      is JsonObject -> {
        val tplPath = (el["path"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val tplComp = (el["componentId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (tplPath != null && tplComp != null) {
          val pathRepr =
            decompileValue(
              JsonObject(mapOf(helper.reservedKeys.path to JsonPrimitive(tplPath))),
              varNames,
              isRef = false,
              helper = helper,
              surfaceCatalogId = surfaceCatalogId,
            )
          val compRepr = decompileReference(tplComp, varNames)
          return "_template($pathRepr, $compRepr)"
        }

        val boundPath =
          (el[helper.reservedKeys.path] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (boundPath != null && el.size == 1) {
          return if (boundPath.startsWith("/")) "$/${boundPath.substring(1)}" else "$$boundPath"
        }

        val evObj = el["event"] as? JsonObject
        if (evObj != null && (isV1 || !evObj.containsKey("userMessage"))) {
          val nameVal = evObj["name"]
          val nameStr =
            if (nameVal != null) {
              decompileValue(
                nameVal,
                varNames,
                isRef = false,
                helper = helper,
                surfaceCatalogId = surfaceCatalogId,
              )
            } else {
              decompileString("")
            }
          val evArgs = mutableListOf(nameStr)
          val ctxEl = evObj["context"]
          if (ctxEl != null && ctxEl !is JsonNull) {
            val ctxObj = optionalObjectField(ctxEl, "Event", "context")
            val entries =
              ctxObj.entries.map { (k, v) ->
                val kRepr = if (isExpressIdentifier(k)) k else decompileString(k)
                "$kRepr: ${decompileValue(v, varNames, isRef = false, helper = helper, surfaceCatalogId = surfaceCatalogId)}"
              }
            evArgs.add("{${entries.joinToString(", ")}}")
          }
          val userMsgEl = evObj["userMessage"]
          if (userMsgEl != null && userMsgEl !is JsonNull) {
            val umStr =
              decompileValue(
                userMsgEl,
                varNames,
                isRef = false,
                helper = helper,
                surfaceCatalogId = surfaceCatalogId,
              )
            evArgs.add("userMessage=$umStr")
          }
          return "Event(${evArgs.joinToString(", ")})"
        }

        val fnCallObj = el["functionCall"] as? JsonObject
        if (fnCallObj != null) {
          return formatFunctionCall(fnCallObj, varNames, surfaceCatalogId)
        }

        val callName =
          (el[helper.reservedKeys.call] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (callName != null) {
          return formatFunctionCall(el, varNames, surfaceCatalogId)
        }

        val mapEntries =
          el.entries.map { (k, v) ->
            val itemIsRef = isRef || k == "child" || k == "componentId"
            val kRepr = if (isExpressIdentifier(k)) k else decompileString(k)
            "$kRepr: ${decompileValue(v, varNames, isRef = itemIsRef, helper = helper, surfaceCatalogId = surfaceCatalogId)}"
          }
        return "{${mapEntries.joinToString(", ")}}"
      }
    }
  }

  private fun systemFunctionHelper(funcCall: JsonObject, name: String): CatalogSchemaHelper {
    val helper = helpers.values.first()
    if (!helper.systemFunctions.containsKey(name)) {
      throw A2uiValidationException("Unknown system function '$name'.")
    }
    if (funcCall.containsKey("catalogId")) {
      throw A2uiValidationException(
        "System function '$name' is defined by the protocol, not a catalog, so it takes no catalogId."
      )
    }
    return helper
  }

  private fun resolveSymbol(
    kind: String,
    name: String,
    itemCatalogId: JsonElement?,
    surfaceCatalogId: String?,
  ): Pair<CatalogSchemaHelper, String?> {
    val label = if (kind == "component") "Component" else "Function"
    val explicitStr =
      (itemCatalogId as? JsonPrimitive)?.takeIf { it.isString && it.content.isNotEmpty() }?.content
    val actual =
      explicitStr
        ?: surfaceCatalogId
        ?: throw A2uiValidationException(
          "$label '$name' has no catalogId and its surface has no catalogId."
        )
    val helper =
      helpers[actual]
        ?: throw A2uiValidationException(
          "$label '$name' names unknown catalog '$actual'. Active catalogs: ${helpers.keys.joinToString(", ")}."
        )
    val exists =
      if (kind == "component") helper.components.containsKey(name)
      else helper.functions.containsKey(name)
    if (!exists) {
      throw A2uiValidationException("Catalog '$actual' does not define $kind '$name'.")
    }
    if (soleCatalogId != null) {
      return helper to null
    }
    val defining =
      helpers.entries
        .filter { (_, h) ->
          if (kind == "component") h.components.containsKey(name) else h.functions.containsKey(name)
        }
        .map { it.key }
    return if (defining.size == 1 && defining.first() == actual) {
      helper to null
    } else {
      helper to actual
    }
  }

  private fun optionalObjectField(value: JsonElement?, owner: String, field: String): JsonObject {
    if (value == null || value is JsonNull) return JsonObject(emptyMap())
    return value as? JsonObject
      ?: throw A2uiValidationException("$owner has a non-object '$field'.")
  }

  private fun trimTrailingPlaceholders(argsReprs: MutableList<String>) {
    while (argsReprs.lastOrNull() == "_") {
      argsReprs.removeAt(argsReprs.lastIndex)
    }
  }
}

private fun getEnvelopeObject(
  comp: JsonObject,
  base: String,
  isV1: Boolean,
  customEnvelope: Set<String>,
): JsonObject? {
  if (!isV1) return comp[base] as? JsonObject
  (comp["@$base"] as? JsonObject)?.let {
    return it
  }
  return if (base !in customEnvelope) (comp[base] as? JsonObject) else null
}

private fun getEnvelopeArray(
  comp: JsonObject,
  base: String,
  isV1: Boolean,
  customEnvelope: Set<String>,
): JsonArray? {
  if (!isV1) return comp[base] as? JsonArray
  (comp["@$base"] as? JsonArray)?.let {
    return it
  }
  return if (base !in customEnvelope) (comp[base] as? JsonArray) else null
}

private fun isComponentRefSchema(schema: JsonObject?, helper: CatalogSchemaHelper): Boolean =
  helper.isComponentIdSchema(schema) || helper.isChildListSchema(schema)

private fun flattenDataModel(dataElement: JsonElement): List<Pair<String, JsonElement>> {
  val results = mutableListOf<Pair<String, JsonElement>>()
  fun recurse(cur: JsonElement, path: String) {
    if (cur is JsonObject && cur.isNotEmpty()) {
      for ((k, v) in cur) {
        recurse(v, "$path/$k")
      }
    } else {
      results.add(path to cur)
    }
  }
  recurse(dataElement, "")
  return results
}

private fun decompileReference(componentId: String, varNames: Map<String, String>): String {
  varNames[componentId]?.let {
    return it
  }
  if (isExpressIdentifier(componentId) && !varNames.containsValue(componentId)) {
    return componentId
  }
  return decompileString(componentId)
}

internal fun decompileString(value: String): String {
  val hasNewline = value.contains('\n') || value.contains('\r')
  val hasTab = value.contains('\t')
  val hasBackslash = value.contains('\\')

  if (hasNewline && !value.endsWith('"') && !value.contains("\"\"\"")) {
    if (hasBackslash && !hasTab) {
      return "r\"\"\"$value\"\"\""
    }
    val escaped = value.replace("\\", "\\\\").replace("\t", "\\t")
    return "\"\"\"$escaped\"\"\""
  }
  if (hasBackslash && !hasNewline && !hasTab && !value.contains('"')) {
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

private const val MAX_SAFE_INT = 9007199254740991L

internal fun decompileJsonNumber(prim: JsonPrimitive, preserveFloatDecimals: Boolean): String {
  val raw = prim.content
  if (raw == "-0" || raw == "-0.0") return "-0.0"

  val longVal = prim.longOrNull
  if (longVal != null && !raw.contains('.') && !raw.contains('e') && !raw.contains('E')) {
    if (longVal in -MAX_SAFE_INT..MAX_SAFE_INT) {
      return longVal.toString()
    }
  }

  val dbl =
    prim.doubleOrNull ?: throw A2uiValidationException("The number '$raw' has no Express notation.")
  if (!dbl.isFinite()) {
    throw A2uiValidationException("The number $dbl has no Express notation.")
  }
  if (dbl == 0.0) {
    return if (1.0 / dbl < 0.0) "-0.0"
    else (if (preserveFloatDecimals && raw.contains('.')) "0.0" else "0")
  }
  val formatted = formatEcmaNumber(dbl)
  if (
    preserveFloatDecimals &&
      raw.contains('.') &&
      !formatted.contains('.') &&
      !formatted.contains('e')
  ) {
    return "$formatted.0"
  }
  return formatted
}

internal fun formatEcmaNumber(value: Double): String {
  if (!value.isFinite()) {
    throw A2uiValidationException("The number $value has no Express notation.")
  }
  if (value == 0.0) {
    return if (1.0 / value < 0.0) "-0.0" else "0"
  }
  val bd = BigDecimal(java.lang.Double.toString(value)).stripTrailingZeros()
  val sciExp = bd.precision() - 1 - bd.scale()
  if (sciExp in -6..20) {
    return bd.toPlainString()
  }
  val digits = bd.unscaledValue().abs().toString()
  val mantissa = if (digits.length == 1) digits else "${digits[0]}.${digits.substring(1)}"
  val sign = if (value < 0.0) "-" else ""
  val expSign = if (sciExp >= 0) "+" else ""
  return "$sign${mantissa}e$expSign$sciExp"
}
