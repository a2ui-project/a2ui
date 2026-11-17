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

import com.google.a2ui.exceptions.A2uiIntegrityException
import com.google.a2ui.exceptions.A2uiRecursionException
import com.google.a2ui.exceptions.A2uiValidationException
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.SchemaResourceLoader
import com.networknt.schema.InputFormat
import com.networknt.schema.Schema
import com.networknt.schema.SchemaLocation
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.dialect.Dialects
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Stateful mirror of renderer surfaces for validating compiled Express messages across single-shot
 * blocks, full responses, and incremental streams.
 */
class ExpressRendererState
internal constructor(
  val catalogs: List<A2uiCatalog>,
  internal val assumesUnknownSurfaces: Boolean,
  prebuiltHelpers: Map<String, CatalogSchemaHelper>?,
  prebuiltValidators: Map<String, CatalogJsonSchemaValidator>?,
) {
  @JvmOverloads
  constructor(
    catalogs: List<A2uiCatalog>,
    assumesUnknownSurfaces: Boolean = false,
  ) : this(catalogs, assumesUnknownSurfaces, null, null)

  private val targetVersion: String
  private val isV1OrLater: Boolean
  private val helpers: Map<String, CatalogSchemaHelper>
  private val validators: Map<String, CatalogJsonSchemaValidator>

  private data class SurfaceEntry(
    val id: String,
    val defaultCatalogId: String?,
    val assumed: Boolean,
    val components: LinkedHashMap<String, JsonObject> = LinkedHashMap(),
  ) {
    fun deepCopy(): SurfaceEntry =
      SurfaceEntry(
        id = id,
        defaultCatalogId = defaultCatalogId,
        assumed = assumed,
        components = LinkedHashMap(components),
      )
  }

  private var surfaces = LinkedHashMap<String, SurfaceEntry>()
  private var changedBySurface = LinkedHashMap<String, LinkedHashSet<String>>()
  private var baselineBySurface = LinkedHashMap<String, LinkedHashMap<String, JsonObject?>>()

  init {
    targetVersion = resolveExpressVersion(catalogs)
    isV1OrLater = isExpressV1OrLater(targetVersion)
    if (prebuiltHelpers != null && prebuiltValidators != null) {
      helpers = prebuiltHelpers
      validators = prebuiltValidators
    } else {
      val helperMap = LinkedHashMap<String, CatalogSchemaHelper>()
      val validatorMap = LinkedHashMap<String, CatalogJsonSchemaValidator>()
      for (cat in catalogs) {
        val cid = cat.catalogId
        helperMap[cid] = prebuiltHelpers?.get(cid) ?: CatalogSchemaHelper(cat, targetVersion)
        validatorMap[cid] =
          prebuiltValidators?.get(cid) ?: CatalogJsonSchemaValidator.build(cat, isV1OrLater)
      }
      helpers = helperMap
      validators = validatorMap
    }
  }

  val surfaceIds: Set<String>
    get() = surfaces.keys.toSet()

  fun hasSurface(surfaceId: String): Boolean = surfaces.containsKey(surfaceId)

  private data class StateSnapshot(
    val surfaces: LinkedHashMap<String, SurfaceEntry>,
    val changed: LinkedHashMap<String, LinkedHashSet<String>>,
    val baseline: LinkedHashMap<String, LinkedHashMap<String, JsonObject?>>,
  )

  private fun snapshot(): StateSnapshot {
    val surfCopy = LinkedHashMap<String, SurfaceEntry>()
    for ((k, v) in surfaces) surfCopy[k] = v.deepCopy()
    val changedCopy = LinkedHashMap<String, LinkedHashSet<String>>()
    for ((k, v) in changedBySurface) changedCopy[k] = LinkedHashSet(v)
    val baseCopy = LinkedHashMap<String, LinkedHashMap<String, JsonObject?>>()
    for ((k, v) in baselineBySurface) baseCopy[k] = LinkedHashMap(v)
    return StateSnapshot(surfCopy, changedCopy, baseCopy)
  }

  private fun restore(saved: StateSnapshot) {
    surfaces = saved.surfaces
    changedBySurface = saved.changed
    baselineBySurface = saved.baseline
  }

  fun <T> transaction(block: (ExpressRendererState) -> T): T {
    val snap = snapshot()
    return try {
      block(this)
    } catch (t: Throwable) {
      restore(snap)
      throw t
    }
  }

  /** Drops or restores a provisional component whose ID was superseded later in the same scope. */
  fun dropProvisionalComponent(surfaceId: String, componentId: String) {
    val surface = surfaces[surfaceId] ?: return
    val baseMap = baselineBySurface[surfaceId] ?: return
    if (!baseMap.containsKey(componentId)) return
    val prev = baseMap.remove(componentId)
    if (prev == null) {
      surface.components.remove(componentId)
    } else {
      surface.components[componentId] = prev
    }
    changedBySurface[surfaceId]?.remove(componentId)
  }

  fun markChecked(surfaceIdsToMark: Iterable<String>) {
    for (sid in surfaceIdsToMark) {
      changedBySurface.remove(sid)
      baselineBySurface.remove(sid)
    }
  }

  /** Applies [messages] atomically, returning the touched surface IDs in encounter order. */
  fun apply(messages: List<JsonObject>): List<String> = transaction {
    val touched = LinkedHashSet<String>()
    messages.forEachIndexed { idx, msg -> checkEnvelopeVersion(msg, idx) }
    messages.forEachIndexed { idx, msg ->
      val sid = applySingleMessage(messages, idx, msg)
      if (sid != null) touched.add(sid)
    }
    touched.toList()
  }

  /**
   * Validates root presence, reference integrity, cycles, and reachability for [surfaceIdsToCheck].
   */
  fun checkTopology(surfaceIdsToCheck: Iterable<String>) {
    val uniqueIds = surfaceIdsToCheck.toSet()
    for (sid in uniqueIds) {
      val surf = surfaces[sid] ?: continue
      if (surf.assumed || surf.components.isEmpty()) continue
      val comps = surf.components
      if (!comps.containsKey("root")) {
        throw A2uiIntegrityException("Surface '$sid' has components but no 'root' component.")
      }

      // Check all component references & collect reachability from root
      for ((cid, compObj) in comps) {
        val helper = resolveComponentHelper(surf, compObj)
        val compName = compObj["component"]?.jsonPrimitive?.contentOrNull ?: ""
        val refs = extractChildRefs(compObj, compName, helper)
        for (refId in refs) {
          if (!comps.containsKey(refId)) {
            throw A2uiIntegrityException(
              "Component '$cid' on surface '$sid' references missing child component '$refId'."
            )
          }
        }
      }

      val reachable = LinkedHashSet<String>()
      val visiting = LinkedHashSet<String>()

      fun dfs(cid: String, depth: Int) {
        if (depth > MAX_COMPONENT_DEPTH) {
          throw A2uiRecursionException(
            "Component tree on surface '$sid' exceeds max depth $MAX_COMPONENT_DEPTH."
          )
        }
        if (cid in visiting) {
          throw A2uiIntegrityException(
            "Circular component reference involving '$cid' on surface '$sid'."
          )
        }
        if (!reachable.add(cid)) return
        val compObj = comps[cid] ?: return
        val helper = resolveComponentHelper(surf, compObj)
        val compName = compObj["component"]?.jsonPrimitive?.contentOrNull ?: ""
        visiting.add(cid)
        for (childId in extractChildRefs(compObj, compName, helper)) {
          dfs(childId, depth + 1)
        }
        visiting.remove(cid)
      }

      dfs("root", 0)

      // Also detect cycles in any newly changed unreachable subgraphs before reporting orphans
      val changed = changedBySurface[sid] ?: emptySet()
      val unreachable = changed.filter { comps.containsKey(it) && it !in reachable }.sorted()
      if (unreachable.isNotEmpty()) {
        throw A2uiIntegrityException(
          "Component '${unreachable.first()}' is not reachable from 'root' on surface '$sid'."
        )
      }
    }
    markChecked(uniqueIds.filter { surfaces[it]?.assumed != true })
  }

  private fun checkEnvelopeVersion(msg: JsonObject, index: Int) {
    val versionEl = msg["version"] as? JsonPrimitive
    val stated = if (versionEl != null && versionEl.isString) versionEl.content else null
    if (stated == null) {
      throw A2uiValidationException("Message $index is missing required string 'version'.")
    }
    if (isV1OrLater) {
      if (stated != "1.0") {
        throw A2uiValidationException("Message $index states version '$stated', expected '1.0'.")
      }
    } else {
      if (stated != "v0.9" && stated != "v0.9.1") {
        throw A2uiValidationException(
          "Message $index states version '$stated', expected 'v0.9' or 'v0.9.1'."
        )
      }
    }
    checkNestingDepth(msg, 0)
  }

  private fun checkNestingDepth(el: JsonElement, depth: Int) {
    if (depth > MAX_JSON_DEPTH) {
      throw A2uiRecursionException("Payload exceeds maximum JSON nesting depth ($MAX_JSON_DEPTH).")
    }
    when (el) {
      is JsonObject -> el.values.forEach { checkNestingDepth(it, depth + 1) }
      is JsonArray -> el.forEach { checkNestingDepth(it, depth + 1) }
      else -> {}
    }
  }

  private fun applySingleMessage(payload: List<JsonObject>, index: Int, msg: JsonObject): String? {
    when {
      msg.containsKey("createSurface") -> {
        val body =
          msg["createSurface"] as? JsonObject
            ?: throw A2uiValidationException("'createSurface' must be an object.")
        val sid = requireNonEmptyString(body["surfaceId"], "createSurface.surfaceId")
        if (surfaces.containsKey(sid)) {
          throw A2uiValidationException(
            "Surface '$sid' already exists; delete it before recreating."
          )
        }
        val explicitCatId =
          (body["catalogId"] as? JsonPrimitive)?.let {
            if (!it.isString || it.content.isEmpty()) {
              throw A2uiValidationException("createSurface.catalogId must be a non-empty string.")
            }
            it.content
          }
        if (!isV1OrLater && explicitCatId == null) {
          throw A2uiValidationException("Pre-v1.0 createSurface requires 'catalogId'.")
        }
        if (explicitCatId != null && !helpers.containsKey(explicitCatId)) {
          throw A2uiValidationException(
            "createSurface on '$sid' names unknown catalog '$explicitCatId'."
          )
        }
        val surf =
          SurfaceEntry(
            id = sid,
            defaultCatalogId =
              explicitCatId ?: if (catalogs.size == 1) catalogs.first().catalogId else null,
            assumed = false,
          )
        // Validate message envelope schema (without component catalog specifics when multi-catalog)
        validateEnvelopeStructure(msg, surf.defaultCatalogId ?: catalogs.first().catalogId)

        val compsEl = body["components"]
        if (compsEl != null) {
          if (!isV1OrLater) {
            throw A2uiValidationException("Inline 'components' on createSurface requires v1.0+.")
          }
          val compsArr =
            compsEl as? JsonArray
              ?: throw A2uiValidationException(
                "createSurface.components must be a non-empty array."
              )
          if (compsArr.isEmpty()) {
            throw A2uiValidationException("createSurface.components must not be empty.")
          }
          validateAndInsertComponents(surf, compsArr, isCreate = true)
        }
        if (body.containsKey("dataModel")) {
          if (!isV1OrLater) {
            throw A2uiValidationException("Inline 'dataModel' on createSurface requires v1.0+.")
          }
          if (body["dataModel"] !is JsonObject) {
            throw A2uiValidationException("createSurface.dataModel must be an object.")
          }
        }
        if (body.containsKey("metadata")) {
          if (!isV1OrLater) {
            throw A2uiValidationException("'metadata' on createSurface requires v1.0+.")
          }
          validateMetadataObject(body["metadata"], "createSurface.metadata")
        }
        surfaces[sid] = surf
        return sid
      }

      msg.containsKey("updateComponents") -> {
        val body =
          msg["updateComponents"] as? JsonObject
            ?: throw A2uiValidationException("'updateComponents' must be an object.")
        val sid = requireNonEmptyString(body["surfaceId"], "updateComponents.surfaceId")
        val surf = resolveOrAssumeSurface(sid, payload, index)
        val compsArr =
          body["components"] as? JsonArray
            ?: throw A2uiValidationException(
              "updateComponents.components must be a non-empty array."
            )
        if (compsArr.isEmpty()) {
          throw A2uiValidationException("updateComponents.components must not be empty.")
        }
        validateAndInsertComponents(surf, compsArr, isCreate = false)
        return sid
      }

      msg.containsKey("updateDataModel") -> {
        val body =
          msg["updateDataModel"] as? JsonObject
            ?: throw A2uiValidationException("'updateDataModel' must be an object.")
        val sid = requireNonEmptyString(body["surfaceId"], "updateDataModel.surfaceId")
        val surf = resolveOrAssumeSurface(sid, payload, index)
        validateEnvelopeStructure(msg, surf.defaultCatalogId ?: catalogs.first().catalogId)
        val pathEl = body["path"]
        if (pathEl != null) {
          val p =
            (pathEl as? JsonPrimitive)?.takeIf { it.isString }?.content
              ?: throw A2uiValidationException("updateDataModel.path must be a string.")
          if (p.isNotEmpty() && !p.startsWith("/")) {
            throw A2uiValidationException(
              "updateDataModel.path '$p' must be a JSON Pointer starting with '/'."
            )
          }
          if (
            (p == "/" || p.isEmpty()) && body.containsKey("value") && body["value"] !is JsonObject
          ) {
            throw A2uiValidationException("Root data model value at '$p' must be an object.")
          }
        }
        return sid
      }

      msg.containsKey("deleteSurface") -> {
        val body =
          msg["deleteSurface"] as? JsonObject
            ?: throw A2uiValidationException("'deleteSurface' must be an object.")
        val sid = requireNonEmptyString(body["surfaceId"], "deleteSurface.surfaceId")
        if (!surfaces.containsKey(sid) && !canAssumeSurface(sid, payload, index)) {
          throw A2uiValidationException("Cannot delete non-existent surface '$sid'.")
        }
        validateEnvelopeStructure(msg, catalogs.first().catalogId)
        surfaces.remove(sid)
        changedBySurface.remove(sid)
        baselineBySurface.remove(sid)
        return sid
      }

      msg.containsKey("callRendererFunction") -> {
        if (!isV1OrLater) {
          throw A2uiValidationException("'callRendererFunction' requires A2UI v1.0 or later.")
        }
        val body =
          msg["callRendererFunction"] as? JsonObject
            ?: throw A2uiValidationException("'callRendererFunction' must be an object.")
        validateCallRendererFunction(body, payload, index)
        return null
      }

      else -> throw A2uiValidationException("Unrecognized A2UI message envelope keys: ${msg.keys}")
    }
  }

  private fun resolveOrAssumeSurface(
    sid: String,
    payload: List<JsonObject>,
    index: Int,
  ): SurfaceEntry {
    surfaces[sid]?.let {
      return it
    }
    if (!canAssumeSurface(sid, payload, index)) {
      throw A2uiValidationException("Surface '$sid' has not been created.")
    }
    val defaultCat = if (catalogs.size == 1) catalogs.first().catalogId else null
    val assumed = SurfaceEntry(id = sid, defaultCatalogId = defaultCat, assumed = true)
    surfaces[sid] = assumed
    return assumed
  }

  private fun canAssumeSurface(sid: String, payload: List<JsonObject>, index: Int): Boolean {
    if (!assumesUnknownSurfaces) return false
    for (earlier in payload.subList(0, index)) {
      if (targetSurfaceId(earlier) == sid) return false
    }
    for (later in payload.subList(index + 1, payload.size)) {
      val targetId = targetSurfaceId(later)
      if (targetId != sid) continue
      if (later.containsKey("createSurface")) return false
      if (later.containsKey("deleteSurface")) break
    }
    return true
  }

  private fun targetSurfaceId(msg: JsonObject): String? {
    for (k in listOf("createSurface", "updateComponents", "updateDataModel", "deleteSurface")) {
      val body = msg[k] as? JsonObject ?: continue
      return body["surfaceId"]?.jsonPrimitive?.contentOrNull
    }
    return null
  }

  private fun validateAndInsertComponents(
    surf: SurfaceEntry,
    compsArr: JsonArray,
    isCreate: Boolean,
  ) {
    val seenInMessage = HashSet<String>()
    val idsToNote = LinkedHashSet<String>()
    val validatedComps = ArrayList<Pair<String, JsonObject>>(compsArr.size)

    for (item in compsArr) {
      val compObj =
        item as? JsonObject
          ?: throw A2uiValidationException("Each entry in 'components' must be an object.")
      val cid = requireNonEmptyString(compObj["id"], "component.id")
      if (isV1OrLater && !isValidUax31Identifier(cid)) {
        throw A2uiValidationException("Component id '$cid' is not a valid UAX #31 identifier.")
      }
      if (!seenInMessage.add(cid)) {
        throw A2uiIntegrityException(
          "Duplicate component id '$cid' in message on surface '${surf.id}'."
        )
      }
      val compName = requireNonEmptyString(compObj["component"], "component.component")
      if (compName == "Surface") {
        throw A2uiValidationException("Reserved component name 'Surface' cannot be instantiated.")
      }

      val helper = resolveComponentHelper(surf, compObj)
      val validator =
        validators[helper.catalogId]
          ?: throw A2uiValidationException("No validator for catalog '${helper.catalogId}'.")
      validator.validateComponent(compObj)
      validateComponentCallsAndChecks(surf, compObj, compName, helper)

      idsToNote.add(cid)
      validatedComps.add(cid to compObj)
    }

    val baseMap = baselineBySurface.getOrPut(surf.id) { LinkedHashMap() }
    for (cid in idsToNote) {
      if (!baseMap.containsKey(cid)) {
        baseMap[cid] = if (isCreate) null else surf.components[cid]
      }
    }
    val changedSet = changedBySurface.getOrPut(surf.id) { LinkedHashSet() }
    for ((cid, compObj) in validatedComps) {
      surf.components[cid] = compObj
      changedSet.add(cid)
    }
  }

  private fun resolveComponentHelper(surf: SurfaceEntry, compObj: JsonObject): CatalogSchemaHelper {
    val explicitCatEl = if (isV1OrLater) compObj["@catalogId"] else null
    if (explicitCatEl != null) {
      val cid =
        (explicitCatEl as? JsonPrimitive)
          ?.takeIf { it.isString && it.content.isNotEmpty() }
          ?.content
          ?: throw A2uiValidationException("Component '@catalogId' must be a non-empty string.")
      return helpers[cid]
        ?: throw A2uiValidationException("Component references unknown catalog '$cid'.")
    }
    if (surf.defaultCatalogId != null) {
      return helpers[surf.defaultCatalogId]
        ?: throw A2uiValidationException(
          "Surface '${surf.id}' default catalog '${surf.defaultCatalogId}' is not active."
        )
    }
    if (surf.assumed) {
      val compName = compObj["component"]?.jsonPrimitive?.contentOrNull
      if (compName != null) {
        helpers.values
          .firstOrNull { it.components.containsKey(compName) }
          ?.let {
            return it
          }
      }
    }
    throw A2uiValidationException(
      "Component '${compObj["id"]?.jsonPrimitive?.contentOrNull}' omits '@catalogId' on surface '${surf.id}' which has no default catalogId."
    )
  }

  private fun validateComponentCallsAndChecks(
    surf: SurfaceEntry,
    compObj: JsonObject,
    compName: String,
    compHelper: CatalogSchemaHelper,
  ) {
    val meta =
      compHelper.components[compName]
        ?: throw A2uiValidationException(
          "Unknown component '$compName' in catalog '${compHelper.catalogId}'."
        )

    // Validate check rules (condition returnType must be boolean or any, and calls valid)
    val checkKey =
      if (isV1OrLater && "checks" !in meta.customEnvelopeProperties) "@checks" else "checks"
    val checksArr = compObj[checkKey] as? JsonArray
    if (checksArr != null) {
      for (ruleEl in checksArr) {
        val ruleObj = ruleEl as? JsonObject ?: continue
        val cond = ruleObj["condition"] as? JsonObject ?: continue
        validateEmbeddedExpression(
          surf,
          cond,
          compHelper,
          expectedReturnType = "boolean",
          inAction = false,
        )
      }
    }

    for ((propName, propVal) in compObj) {
      if (
        propName == "id" ||
          propName == "component" ||
          propName == "@catalogId" ||
          propName == checkKey
      ) {
        continue
      }
      if (propName == "@metadata") {
        validateMetadataObject(
          propVal,
          "component '${compObj["id"]?.jsonPrimitive?.contentOrNull}' @metadata",
        )
        validateEmbeddedExpression(
          surf,
          propVal,
          compHelper,
          expectedReturnType = null,
          inAction = false,
        )
        continue
      }
      val propSchema = meta.propertySchemas[propName]
      val isAction = compHelper.isActionSlot(propSchema)
      val expectedType = inferExpectedScalarType(propSchema)
      validateEmbeddedExpression(
        surf,
        propVal,
        compHelper,
        expectedReturnType = expectedType,
        inAction = isAction,
      )
    }
  }

  private fun inferExpectedScalarType(schema: JsonObject?): String? {
    if (schema == null) return null
    val ref = schema["\$ref"]?.jsonPrimitive?.contentOrNull ?: ""
    return when {
      ref.endsWith("/DynamicString") -> "string"
      ref.endsWith("/DynamicNumber") -> "number"
      ref.endsWith("/DynamicBoolean") -> "boolean"
      ref.endsWith("/DynamicStringList") -> "array"
      else -> null
    }
  }

  private fun validateEmbeddedExpression(
    surf: SurfaceEntry,
    value: JsonElement,
    defaultHelper: CatalogSchemaHelper,
    expectedReturnType: String?,
    inAction: Boolean,
  ) {
    when (value) {
      is JsonArray ->
        value.forEach { validateEmbeddedExpression(surf, it, defaultHelper, null, inAction) }
      is JsonObject -> {
        val callKey = defaultHelper.reservedKeys.call
        val pathKey = defaultHelper.reservedKeys.path

        if (isV1OrLater) {
          for (k in value.keys) {
            if (k.startsWith("@") && k !in ALLOWED_AT_DIRECTIVES) {
              throw A2uiValidationException("Unrecognized reserved '@' directive '$k'.")
            }
          }
        }

        if (
          value.containsKey(pathKey) &&
            value.size == 1 &&
            (value[pathKey] as? JsonPrimitive)?.isString == true
        ) {
          return
        }

        if (inAction && value.containsKey("functionCall") && value["functionCall"] is JsonObject) {
          validateFunctionCallObject(
            surf,
            value["functionCall"] as JsonObject,
            defaultHelper,
            null,
            inAction = true,
          )
          return
        }
        if (inAction && value.containsKey("event") && value["event"] is JsonObject) {
          val evObj = value["event"] as JsonObject
          evObj["name"]?.let {
            validateEmbeddedExpression(surf, it, defaultHelper, "string", false)
          }
          evObj["userMessage"]?.let {
            validateEmbeddedExpression(surf, it, defaultHelper, "string", false)
          }
          evObj["context"]?.let { validateEmbeddedExpression(surf, it, defaultHelper, null, false) }
          return
        }

        val callName = (value[callKey] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (
          callName != null &&
            (isV1OrLater || value.keys.none { it in defaultHelper.reservedKeys.nonCallKeys })
        ) {
          validateFunctionCallObject(
            surf,
            value,
            defaultHelper,
            expectedReturnType,
            inAction = false,
          )
          return
        }

        for ((_, subVal) in value) {
          validateEmbeddedExpression(surf, subVal, defaultHelper, null, inAction)
        }
      }
      else -> {}
    }
  }

  private fun validateFunctionCallObject(
    surf: SurfaceEntry,
    callObj: JsonObject,
    defaultHelper: CatalogSchemaHelper,
    expectedReturnType: String?,
    inAction: Boolean,
  ) {
    val callKey = defaultHelper.reservedKeys.call
    val fnName = requireNonEmptyString(callObj[callKey], "functionCall.$callKey")
    val allowedKeys = setOf(callKey, "catalogId", "args", "returnType")
    for (k in callObj.keys) {
      if (k !in allowedKeys) {
        throw A2uiValidationException("Function call '$fnName' has unrecognized field '$k'.")
      }
    }

    if (fnName.startsWith("@")) {
      if (callObj.containsKey("catalogId")) {
        throw A2uiValidationException("System function '$fnName' cannot specify 'catalogId'.")
      }
      val sysMeta =
        defaultHelper.systemFunctions[fnName]
          ?: throw A2uiValidationException("Unknown system function '$fnName'.")
      checkReturnTypeCompatible(fnName, sysMeta.returnType, expectedReturnType)
      val argsObj = (callObj["args"] as? JsonObject) ?: JsonObject(emptyMap())
      validateFunctionArguments(
        surf,
        fnName,
        sysMeta,
        defaultHelper,
        argsObj,
        inAction = false,
        allowIndex = true,
      )
      return
    }

    val targetHelper =
      if (callObj.containsKey("catalogId")) {
        if (!isV1OrLater) {
          throw A2uiValidationException(
            "Function call 'catalogId' is only supported in A2UI v1.0+."
          )
        }
        val cid = requireNonEmptyString(callObj["catalogId"], "functionCall.catalogId")
        helpers[cid]
          ?: throw A2uiValidationException("Function '$fnName' names unknown catalog '$cid'.")
      } else {
        val defaultCat = surf.defaultCatalogId
        if (defaultCat != null) {
          helpers[defaultCat]!!
        } else if (surf.assumed) {
          helpers.values.firstOrNull { it.functions.containsKey(fnName) } ?: defaultHelper
        } else {
          throw A2uiValidationException(
            "Function '$fnName' omits 'catalogId' on surface '${surf.id}' which has no default catalog."
          )
        }
      }

    val fnMeta =
      targetHelper.functions[fnName]
        ?: throw A2uiValidationException(
          "Catalog '${targetHelper.catalogId}' does not declare function '$fnName'."
        )

    if (fnMeta.allowedCallers == "agentOnly") {
      throw A2uiValidationException(
        "Function '$fnName' has allowedCallers='agentOnly' and cannot be called on a surface."
      )
    }
    if (!inAction && fnMeta.requiresUserActivation) {
      throw A2uiValidationException(
        "Function '$fnName' requires user activation and can only be called inside an Action."
      )
    }
    checkReturnTypeCompatible(fnName, fnMeta.returnType, expectedReturnType)

    val argsEl = callObj["args"]
    val argsObj =
      when (argsEl) {
        null -> JsonObject(emptyMap())
        is JsonObject -> argsEl
        else -> throw A2uiValidationException("Function '$fnName' args must be an object.")
      }
    validateFunctionArguments(
      surf,
      fnName,
      fnMeta,
      targetHelper,
      argsObj,
      inAction = false,
      allowIndex = true,
    )
  }

  private fun checkReturnTypeCompatible(fnName: String, actual: String, expected: String?) {
    if (expected == null || actual == "any" || expected == "any") return
    if (actual == "void") {
      throw A2uiValidationException(
        "Function '$fnName' returns 'void' and cannot be used in a value expression expecting '$expected'."
      )
    }
  }

  private fun validateFunctionArguments(
    surf: SurfaceEntry?,
    fnName: String,
    fnMeta: FunctionMetadata,
    fnHelper: CatalogSchemaHelper,
    argsObj: JsonObject,
    inAction: Boolean,
    allowIndex: Boolean,
  ) {
    for (req in fnMeta.required) {
      if (!argsObj.containsKey(req)) {
        throw A2uiValidationException("Function '$fnName' is missing required argument '$req'.")
      }
    }
    for ((argKey, argVal) in argsObj) {
      if (argKey !in fnMeta.parameters) {
        throw A2uiValidationException("Function '$fnName' received unknown argument '$argKey'.")
      }
      val paramSchema = fnMeta.propertySchemas[argKey]
      validateFunctionArgValue(fnName, argKey, argVal, paramSchema, fnHelper)
      if (!allowIndex) {
        forbidSystemIndexInStandaloneCall(argVal, fnHelper)
      }
      if (surf != null) {
        val expected = inferExpectedScalarType(paramSchema)
        validateEmbeddedExpression(surf, argVal, fnHelper, expected, inAction)
      }
    }
  }

  private fun validateFunctionArgValue(
    fnName: String,
    argKey: String,
    argVal: JsonElement,
    paramSchema: JsonObject?,
    helper: CatalogSchemaHelper,
  ) {
    if (paramSchema == null) return
    val validator = validators[helper.catalogId]
    if (validator != null) {
      validator.validateValueAgainstSchema(
        argVal,
        paramSchema,
        "Function '$fnName' argument '$argKey'",
        useCommonTypesAsBase = fnName.startsWith("@"),
      )
    }
  }

  private fun forbidSystemIndexInStandaloneCall(el: JsonElement, helper: CatalogSchemaHelper) {
    when (el) {
      is JsonArray -> el.forEach { forbidSystemIndexInStandaloneCall(it, helper) }
      is JsonObject -> {
        val callName =
          (el[helper.reservedKeys.call] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (callName == "@index") {
          throw A2uiValidationException(
            "'@index' cannot be used in standalone callRendererFunction arguments."
          )
        }
        el.values.forEach { forbidSystemIndexInStandaloneCall(it, helper) }
      }
      else -> {}
    }
  }

  private fun validateCallRendererFunction(
    body: JsonObject,
    payload: List<JsonObject>,
    index: Int,
  ) {
    val callId =
      requireNonEmptyString(body["functionCallId"], "callRendererFunction.functionCallId")
    val sidEl = body["surfaceId"]
    val surf =
      if (sidEl != null) {
        val sid = requireNonEmptyString(sidEl, "callRendererFunction.surfaceId")
        resolveOrAssumeSurface(sid, payload, index)
      } else {
        null
      }
    val callFn =
      body["callFunction"] as? JsonObject
        ?: throw A2uiValidationException("Function call '$callId' requires 'callFunction' object.")
    val fnName = requireNonEmptyString(callFn["@call"], "callFunction.@call")
    val cid = requireNonEmptyString(callFn["catalogId"], "callFunction.catalogId")
    for (k in callFn.keys) {
      if (k !in setOf("@call", "catalogId", "args")) {
        throw A2uiValidationException("Function call '$callId' has unrecognized field '$k'.")
      }
    }
    val helper =
      helpers[cid]
        ?: throw A2uiValidationException("Function call '$callId' names unknown catalog '$cid'.")
    val fnMeta =
      helper.functions[fnName]
        ?: throw A2uiValidationException(
          "Function call '$callId' names '$fnName', which catalog '$cid' does not declare."
        )
    if (fnMeta.allowedCallers != "agentOnly" && fnMeta.allowedCallers != "rendererOrAgent") {
      throw A2uiValidationException(
        "Function call '$callId' names '$fnName' with allowedCallers='${fnMeta.allowedCallers}'."
      )
    }
    if (fnMeta.requiresUserActivation) {
      throw A2uiValidationException(
        "Function call '$callId' names '$fnName', which requires user activation."
      )
    }
    val argsObj =
      when (val argsEl = callFn["args"]) {
        null -> JsonObject(emptyMap())
        is JsonObject -> argsEl
        else -> throw A2uiValidationException("Function call '$callId' args must be an object.")
      }
    validateFunctionArguments(
      surf,
      fnName,
      fnMeta,
      helper,
      argsObj,
      inAction = false,
      allowIndex = false,
    )
    // Validate nested calls inside standalone args
    validateStandaloneNestedCalls(callId, argsObj, surf, helper)
  }

  private fun validateStandaloneNestedCalls(
    callId: String,
    el: JsonElement,
    surf: SurfaceEntry?,
    outerHelper: CatalogSchemaHelper,
  ) {
    when (el) {
      is JsonArray -> el.forEach { validateStandaloneNestedCalls(callId, it, surf, outerHelper) }
      is JsonObject -> {
        for (k in el.keys) {
          if (k.startsWith("@") && k !in setOf("@path", "@call")) {
            throw A2uiValidationException("Unrecognized '@' directive '$k' in call '$callId'.")
          }
        }
        if (el.containsKey("@path")) {
          if ((el["@path"] as? JsonPrimitive)?.isString != true || el.size > 1) {
            throw A2uiValidationException("Invalid '@path' data binding in call '$callId'.")
          }
          return
        }
        val nestedName = (el["@call"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (nestedName != null) {
          if (nestedName.startsWith("@")) {
            if (nestedName == "@index" || el.containsKey("catalogId")) {
              throw A2uiValidationException(
                "Invalid system function '$nestedName' in call '$callId'."
              )
            }
          } else {
            val nestedHelper =
              if (el.containsKey("catalogId")) {
                val ncid = requireNonEmptyString(el["catalogId"], "nested catalogId")
                helpers[ncid]
                  ?: throw A2uiValidationException("Unknown catalog '$ncid' in call '$callId'.")
              } else if (surf != null) {
                val defCat =
                  surf.defaultCatalogId
                    ?: throw A2uiValidationException(
                      "Surface '${surf.id}' has no default catalog for nested call '$nestedName'."
                    )
                helpers[defCat]!!
              } else {
                outerHelper
              }
            val nestedMeta =
              nestedHelper.functions[nestedName]
                ?: throw A2uiValidationException(
                  "Unknown nested function '$nestedName' in call '$callId'."
                )
            if (nestedMeta.allowedCallers == "agentOnly" || nestedMeta.requiresUserActivation) {
              throw A2uiValidationException(
                "Nested function '$nestedName' cannot be evaluated on renderer."
              )
            }
            val nestedArgs = (el["args"] as? JsonObject) ?: JsonObject(emptyMap())
            validateFunctionArguments(
              surf,
              nestedName,
              nestedMeta,
              nestedHelper,
              nestedArgs,
              inAction = false,
              allowIndex = false,
            )
          }
        }
        el.values.forEach { validateStandaloneNestedCalls(callId, it, surf, outerHelper) }
      }
      else -> {}
    }
  }

  private fun validateEnvelopeStructure(msg: JsonObject, catalogId: String) {
    // Only validate non-component messages strictly via envelope schema; component messages are
    // validated component-by-component so multi-catalog surfaces work seamlessly!
    if (msg.containsKey("createSurface")) {
      val createBody = msg["createSurface"] as? JsonObject ?: return
      val allowedKeys =
        if (isV1OrLater) {
          setOf("surfaceId", "catalogId", "sendDataModel", "components", "dataModel", "metadata")
        } else {
          setOf("surfaceId", "catalogId", "sendDataModel")
        }
      for (k in createBody.keys) {
        if (k !in allowedKeys) {
          throw A2uiValidationException("Unrecognized field '$k' on createSurface.")
        }
      }
      val sendDm = createBody["sendDataModel"]
      if (sendDm != null && (sendDm as? JsonPrimitive)?.booleanOrNull == null) {
        throw A2uiValidationException("createSurface.sendDataModel must be a boolean.")
      }
      return
    }
    validators[catalogId]?.validateNonComponentEnvelope(msg)
  }

  private fun extractChildRefs(
    compObj: JsonObject,
    compName: String,
    helper: CatalogSchemaHelper,
  ): List<String> {
    val meta = helper.components[compName] ?: return emptyList()
    val refs = ArrayList<String>()
    for ((propName, propVal) in compObj) {
      if (propName in meta.childProperties) {
        (propVal as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { refs.add(it) }
      } else if (propName in meta.childListProperties) {
        extractChildListRefs(propVal, refs)
      } else {
        val propSchema = meta.propertySchemas[propName]
        if (propSchema != null) {
          extractNestedChildRefs(propVal, propSchema, helper, refs)
        }
      }
    }
    return refs
  }

  private fun extractChildListRefs(propVal: JsonElement, out: MutableList<String>) {
    when (propVal) {
      is JsonArray ->
        propVal.forEach { item ->
          (item as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { out.add(it) }
        }
      is JsonObject -> {
        val cid = (propVal["componentId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (cid != null && propVal.containsKey("path")) {
          out.add(cid)
        }
      }
      else -> {}
    }
  }

  private fun extractNestedChildRefs(
    el: JsonElement,
    schema: JsonObject,
    helper: CatalogSchemaHelper,
    out: MutableList<String>,
  ) {
    if (helper.isComponentIdSchema(schema)) {
      (el as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { out.add(it) }
      return
    }
    if (helper.isChildListSchema(schema)) {
      extractChildListRefs(el, out)
      return
    }
    when (el) {
      is JsonArray -> {
        val itemSchema = helper.resolveItemSchema(schema) ?: return
        el.forEach { extractNestedChildRefs(it, itemSchema, helper, out) }
      }
      is JsonObject -> {
        for ((k, v) in el) {
          val subSchema = helper.resolvePropertySchema(schema, k) ?: continue
          extractNestedChildRefs(v, subSchema, helper, out)
        }
      }
      else -> {}
    }
  }

  private fun validateMetadataObject(el: JsonElement?, contextLabel: String) {
    val metaObj =
      el as? JsonObject ?: throw A2uiValidationException("$contextLabel must be an object.")
    for ((k, v) in metaObj) {
      if (k != "extensions") {
        throw A2uiValidationException("$contextLabel has unrecognized field '$k'.")
      }
      val extObj =
        v as? JsonObject
          ?: throw A2uiValidationException("$contextLabel.extensions must be an object.")
      for (extKey in extObj.keys) {
        if (!isValidUax31Identifier(extKey)) {
          throw A2uiValidationException(
            "Extension key '$extKey' in $contextLabel is not a valid UAX #31 identifier."
          )
        }
      }
    }
  }

  private fun requireNonEmptyString(el: JsonElement?, fieldName: String): String {
    val prim = el as? JsonPrimitive
    if (prim == null || !prim.isString || prim.content.isEmpty()) {
      throw A2uiValidationException("'$fieldName' must be a non-empty string.")
    }
    return prim.content
  }

  companion object {
    private const val MAX_COMPONENT_DEPTH = 50
    private const val MAX_JSON_DEPTH = 50
    private val ALLOWED_AT_DIRECTIVES =
      setOf("@path", "@call", "@catalogId", "@metadata", "@accessibility", "@checks")

    /**
     * Validates a standalone batch of compiled messages (assuming pre-existing updated surfaces).
     */
    fun validatePayload(catalogs: List<A2uiCatalog>, messages: List<JsonObject>) {
      validatePayload(catalogs, messages, null, null)
    }

    internal fun validatePayload(
      catalogs: List<A2uiCatalog>,
      messages: List<JsonObject>,
      prebuiltHelpers: Map<String, CatalogSchemaHelper>?,
      prebuiltValidators: Map<String, CatalogJsonSchemaValidator>?,
    ) {
      val state =
        ExpressRendererState(
          catalogs = catalogs,
          assumesUnknownSurfaces = true,
          prebuiltHelpers = prebuiltHelpers,
          prebuiltValidators = prebuiltValidators,
        )
      val touched = state.apply(messages)
      state.checkTopology(touched)
    }
  }
}

/**
 * Per-catalog JSON Schema validator backed by `com.networknt:json-schema-validator` (Draft 2020-12)
 * for validating compiled components and function argument values against catalog schemas.
 */
internal class CatalogJsonSchemaValidator(
  private val catalogId: String,
  private val isV1OrLater: Boolean,
  private val componentEnvelopeSchema: Schema?,
  private val messageEnvelopeSchema: Schema?,
  private val registry: SchemaRegistry,
  private val catalogDocId: String,
  private val basePrefix: String,
) {
  fun validateComponent(compObj: JsonObject) {
    val schema = componentEnvelopeSchema ?: return
    val errors = schema.validate(compObj.toString(), InputFormat.JSON)
    if (errors.isNotEmpty()) {
      throw A2uiValidationException(
        "Component '${compObj["id"]?.jsonPrimitive?.contentOrNull}' failed schema validation in '$catalogId': " +
          errors.joinToString("; ") { it.message }
      )
    }
  }

  fun validateNonComponentEnvelope(msg: JsonObject) {
    val schema = messageEnvelopeSchema ?: return
    val errors = schema.validate(msg.toString(), InputFormat.JSON)
    if (errors.isNotEmpty()) {
      throw A2uiValidationException(
        "Message failed schema validation: ${errors.joinToString("; ") { it.message }}"
      )
    }
  }

  fun validateValueAgainstSchema(
    value: JsonElement,
    subSchema: JsonObject,
    contextLabel: String,
    useCommonTypesAsBase: Boolean = false,
  ) {
    val ownerDocId = if (useCommonTypesAsBase) "$basePrefix/common_types.json" else catalogDocId
    val rewritten = rewriteLocalRefs(subSchema, ownerDocId) as JsonObject
    val wrapperMap = LinkedHashMap<String, JsonElement>()
    wrapperMap["\$schema"] = JsonPrimitive("https://json-schema.org/draft/2020-12/schema")
    wrapperMap["\$id"] = JsonPrimitive("$basePrefix/__arg_check__.json")
    for ((k, v) in rewritten) {
      if (k != "\$schema" && k != "\$id") {
        wrapperMap[k] = v
      }
    }
    val schemaObj =
      registry.getSchema(
        neutralizeUax31RegexForJava(JsonObject(wrapperMap).toString()),
        InputFormat.JSON,
      )
    val errors = schemaObj.validate(value.toString(), InputFormat.JSON)
    if (errors.isNotEmpty()) {
      throw A2uiValidationException(
        "$contextLabel failed schema validation: ${errors.joinToString("; ") { it.message }}"
      )
    }
  }

  private fun rewriteLocalRefs(el: JsonElement, docId: String): JsonElement =
    when (el) {
      is JsonObject -> {
        val m = LinkedHashMap<String, JsonElement>(el.size)
        for ((k, v) in el) {
          if (k == "\$ref" && v is JsonPrimitive && v.isString && v.content.startsWith("#/")) {
            m[k] = JsonPrimitive("$docId${v.content}")
          } else {
            m[k] = rewriteLocalRefs(v, docId)
          }
        }
        JsonObject(m)
      }
      is JsonArray -> JsonArray(el.map { rewriteLocalRefs(it, docId) })
      else -> el
    }

  companion object {
    private val v10AgentToRenderer: JsonObject by lazy {
      SchemaResourceLoader.loadFromBundledResource("1.0", "agent_to_renderer.json")
        ?: JsonObject(emptyMap())
    }
    private val v10CommonTypes: JsonObject by lazy {
      SchemaResourceLoader.loadFromBundledResource("1.0", "common_types.json")
        ?: JsonObject(emptyMap())
    }
    private val v09ServerToClient: JsonObject by lazy {
      SchemaResourceLoader.loadFromBundledResource("0.9", "server_to_client.json")
        ?: JsonObject(emptyMap())
    }
    private val v09CommonTypes: JsonObject by lazy {
      SchemaResourceLoader.loadFromBundledResource("0.9", "common_types.json")
        ?: JsonObject(emptyMap())
    }

    fun build(catalog: A2uiCatalog, isV1OrLater: Boolean): CatalogJsonSchemaValidator {
      val basePrefix =
        if (isV1OrLater) "https://a2ui.org/specification/v1_0"
        else "https://a2ui.org/specification/v0_9"
      val envelopeFile = if (isV1OrLater) "agent_to_renderer.json" else "server_to_client.json"
      val rawEnvelopeDoc =
        if (isV1OrLater) v10AgentToRenderer
        else catalog.serverToClientSchema.ifEmpty { v09ServerToClient }
      val rawCommonDoc =
        if (isV1OrLater) v10CommonTypes else catalog.commonTypesSchema.ifEmpty { v09CommonTypes }
      val envelopeDoc = withCanonicalId(rawEnvelopeDoc, "$basePrefix/$envelopeFile")
      val commonDoc = withCanonicalId(rawCommonDoc, "$basePrefix/common_types.json")

      val normalizedCatalog =
        ensureCatalogAnyComponentAndId(
          catalog.catalogSchema,
          "$basePrefix/catalog.json",
          isV1OrLater,
        )
      val catalogIdUri = normalizedCatalog["\$id"]!!.jsonPrimitive.content

      val schemasByUri =
        mapOf(
          "$basePrefix/$envelopeFile" to neutralizeUax31RegexForJava(envelopeDoc.toString()),
          "$basePrefix/common_types.json" to neutralizeUax31RegexForJava(commonDoc.toString()),
          "$basePrefix/catalog.json" to neutralizeUax31RegexForJava(normalizedCatalog.toString()),
          catalogIdUri to neutralizeUax31RegexForJava(normalizedCatalog.toString()),
        )

      val registry =
        SchemaRegistry.withDialect(Dialects.getDraft202012()) { builder ->
          builder.schemas(schemasByUri)
        }

      val msgSchema =
        if (envelopeDoc.isNotEmpty()) {
          registry.getSchema(SchemaLocation.of("$basePrefix/$envelopeFile"))
        } else {
          null
        }
      val compSchema =
        if (isV1OrLater && envelopeDoc.isNotEmpty()) {
          registry.getSchema(SchemaLocation.of("$basePrefix/$envelopeFile#/\$defs/Component"))
        } else {
          registry.getSchema(SchemaLocation.of("$catalogIdUri#/\$defs/anyComponent"))
        }

      return CatalogJsonSchemaValidator(
        catalogId = catalog.catalogId,
        isV1OrLater = isV1OrLater,
        componentEnvelopeSchema = compSchema,
        messageEnvelopeSchema = msgSchema,
        registry = registry,
        catalogDocId = catalogIdUri,
        basePrefix = basePrefix,
      )
    }

    private fun withCanonicalId(rawDoc: JsonObject, canonicalId: String): JsonObject {
      if (rawDoc.isEmpty()) return rawDoc
      val copy = LinkedHashMap<String, JsonElement>(rawDoc)
      copy["\$id"] = JsonPrimitive(canonicalId)
      return JsonObject(copy)
    }

    /**
     * Synthesizes `$defs.anyComponent` and `$defs.anyFunction` if an inline test catalog omits
     * them, and ensures `$id` is a valid URI for SchemaRegistry resolution.
     */
    private fun ensureCatalogAnyComponentAndId(
      rawSchema: JsonObject,
      canonicalCatalogUri: String,
      isV1OrLater: Boolean,
    ): JsonObject {
      val copy = LinkedHashMap<String, JsonElement>(rawSchema)
      copy["\$schema"] = JsonPrimitive("https://json-schema.org/draft/2020-12/schema")
      copy["\$id"] = JsonPrimitive(canonicalCatalogUri)

      val defs = LinkedHashMap<String, JsonElement>()
      (copy["\$defs"] as? JsonObject)?.let { defs.putAll(it) }
      if (!defs.containsKey("anyComponent")) {
        val comps = (copy["components"] as? JsonObject) ?: JsonObject(emptyMap())
        val oneOfList =
          comps.keys.map { name ->
            val encoded = name.replace("~", "~0").replace("/", "~1")
            JsonObject(mapOf("\$ref" to JsonPrimitive("#/components/$encoded")))
          }
        defs["anyComponent"] =
          if (oneOfList.isNotEmpty()) JsonObject(mapOf("oneOf" to JsonArray(oneOfList)))
          else JsonObject(mapOf("not" to JsonObject(emptyMap())))
      }
      // Allow cross-catalog function calls inside component properties at the JSON Schema layer;
      // ExpressRendererState.validateFunctionCallObject validates every call against its resolved
      // target catalog (including multi-catalog catalogId overrides, callers, activation, and
      // args).
      val callKey = if (isV1OrLater) "@call" else "call"
      defs["anyFunction"] =
        JsonObject(
          mapOf(
            "type" to JsonPrimitive("object"),
            "properties" to
              JsonObject(
                mapOf(
                  callKey to
                    JsonObject(
                      mapOf(
                        "type" to JsonPrimitive("string"),
                        "not" to JsonObject(mapOf("pattern" to JsonPrimitive("^@"))),
                      )
                    ),
                  "catalogId" to JsonObject(mapOf("type" to JsonPrimitive("string"))),
                  "args" to JsonObject(mapOf("type" to JsonPrimitive("object"))),
                  "returnType" to JsonObject(mapOf("type" to JsonPrimitive("string"))),
                )
              ),
            "required" to JsonArray(listOf(JsonPrimitive(callKey))),
          )
        )
      copy["\$defs"] = JsonObject(defs)
      return JsonObject(copy)
    }

    /**
     * Replaces ECMAScript UAX #31 Unicode property escapes (`\p{XID_Start}`, `\p{XID_Continue}`) in
     * `v1_0/common_types.json` (`$defs.Extensions.patternProperties`) with `^.+$` so `networknt`'s
     * `java.util.regex.Pattern` does not fail to compile the schema; exact UAX #31 validation on
     * `id` and `extensions` keys is enforced directly by [isValidUax31Identifier].
     */
    private fun neutralizeUax31RegexForJava(schemaJson: String): String =
      schemaJson.replace("""^[\\p{XID_Start}_][\\p{XID_Continue}]*$""", "^.+$")
  }
}
