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

import com.google.a2ui.agent.RendererState
import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.Catalog
import com.google.a2ui.core.unescapeJsonPointerSegment
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Dynamic, catalog-agnostic schema crawler for A2UI Express compilation, decompilation, and prompt
 * generation.
 */
internal class CatalogSchemaHelper(val catalogModel: Catalog) {
  val catalogSchema: JsonObject = catalogModel.rawSchema
  val commonTypes: JsonObject = catalogModel.commonTypesSchema
  val systemFunctions: Map<String, JsonObject> = extractSystemFunctionSchemas(commonTypes)

  val components: Map<String, JsonObject> =
    catalogModel.components.mapValues { (_, api) -> api.schema }
  val functions: Map<String, JsonObject> =
    catalogModel.functions.mapValues { (_, api) -> api.schema }

  private val componentProperties = LinkedHashMap<String, List<String>>()
  private val componentRequired = LinkedHashMap<String, List<String>>()
  val componentIsCheckable = LinkedHashMap<String, Boolean>()
  private val componentCustomEnvelope = LinkedHashMap<String, Set<String>>()
  private val componentPropertyEnums = HashMap<Pair<String, String>, List<JsonElement>>()
  private val functionProperties = LinkedHashMap<String, List<String>>()
  private val functionRequired = LinkedHashMap<String, List<String>>()
  private val systemFunctionProperties = LinkedHashMap<String, List<String>>()
  private val systemFunctionRequired = LinkedHashMap<String, List<String>>()

  companion object {
    private val COMMON_DEF_RE =
      Regex("""(?:^|/)common_types\.json#/(?:\${'$'}defs|definitions)/(\w+)$""")
    private const val STANDARD_CATALOG_ID_DESCRIPTION =
      "The catalog ID for this component, overriding any surface-level default catalogId."
    private val ENVELOPE_MIXIN_NAMES = setOf("catalogId", "metadata", "accessibility", "checks")
    private val AT_ENVELOPE_MIXIN_KEYS =
      setOf("@catalogId", "@metadata", "@accessibility", "@checks")

    fun commonDefName(ref: String?): String? {
      if (ref == null) return null
      return COMMON_DEF_RE.find(ref)?.groupValues?.get(1)
    }

    fun isActionSlot(schema: JsonObject?): Boolean {
      if (schema == null) return false
      if (commonDefName((schema["\$ref"] as? JsonPrimitive)?.contentOrNull) == "Action") {
        return true
      }
      for (key in listOf("allOf", "oneOf", "anyOf")) {
        val subs = schema[key] as? JsonArray ?: continue
        if (subs.any { it is JsonObject && isActionSlot(it) }) return true
      }
      return false
    }

    fun schemaRefType(schema: JsonObject?): String? {
      if (schema == null) return null
      val ref = (schema["\$ref"] as? JsonPrimitive)?.contentOrNull
      if (ref != null) {
        if (ref.contains("ChildList")) return "ChildList"
        if (ref.contains("Child") || ref.contains("ComponentId")) return "Child"
        if (ref.contains("Action")) return "Action"
      }
      for (key in listOf("oneOf", "anyOf", "allOf")) {
        val subs = schema[key] as? JsonArray ?: continue
        for (sub in subs) {
          if (sub is JsonObject) {
            schemaRefType(sub)?.let {
              return it
            }
          }
        }
      }
      return null
    }

    fun schemaAllowsDatabinding(schema: JsonObject?): Boolean {
      if (schema == null) return false
      val ref = (schema["\$ref"] as? JsonPrimitive)?.contentOrNull
      if (ref != null && (ref.contains("DataBinding") || ref.contains("Dynamic"))) {
        return true
      }
      val props = schema["properties"] as? JsonObject
      if (props != null && ("path" in props || "@path" in props) && "componentId" !in props) {
        return true
      }
      (schema["items"] as? JsonObject)?.let { if (schemaAllowsDatabinding(it)) return true }
      for (key in listOf("allOf", "oneOf", "anyOf")) {
        val subs = schema[key] as? JsonArray ?: continue
        if (subs.any { it is JsonObject && schemaAllowsDatabinding(it) }) return true
      }
      return false
    }

    fun schemaExpectsOptionObjects(schema: JsonObject?): Boolean {
      if (schema == null) return false
      fun hasLabelValue(sub: JsonObject): Boolean {
        val p = sub["properties"] as? JsonObject
        if (p != null && "label" in p && "value" in p) return true
        for (k in listOf("allOf", "oneOf", "anyOf")) {
          val subs = sub[k] as? JsonArray ?: continue
          if (subs.any { it is JsonObject && hasLabelValue(it) }) return true
        }
        return false
      }
      (schema["items"] as? JsonObject)?.let {
        return hasLabelValue(it)
      }
      for (key in listOf("allOf", "oneOf", "anyOf")) {
        val subs = schema[key] as? JsonArray ?: continue
        if (subs.any { it is JsonObject && schemaExpectsOptionObjects(it) }) return true
      }
      return false
    }

    fun checkMixedCatalogs(catalogs: List<Catalog>): List<Catalog> =
      RendererState.checkCatalogList(catalogs)

    fun surfaceCatalogId(catalogs: List<Catalog>): String? =
      if (catalogs.size == 1) catalogs[0].id else null

    fun buildCatalogHelpers(catalogs: List<Catalog>): Map<String, CatalogSchemaHelper> {
      val checked = checkMixedCatalogs(catalogs)
      val out = LinkedHashMap<String, CatalogSchemaHelper>(checked.size)
      for (c in checked) {
        out[c.id] = CatalogSchemaHelper(c)
      }
      return out
    }

    fun catalogsDefining(
      helpers: Map<String, CatalogSchemaHelper>,
      kind: String,
      name: String,
    ): List<String> =
      helpers.entries
        .filter { (_, h) -> if (kind == "component") name in h.components else name in h.functions }
        .map { it.key }
  }

  init {
    loadMappings()
  }

  private fun loadMappings() {
    for ((name, schema) in components) {
      val props = LinkedHashMap<String, JsonElement>()
      val reqs = ArrayList<String>()
      var isCheckable = false

      for (sub in orderedComponentSubSchemas(schema)) {
        val ref = (sub["\$ref"] as? JsonPrimitive)?.contentOrNull
        if (ref != null && ref.contains("Checkable")) {
          isCheckable = true
        }
        (sub["properties"] as? JsonObject)?.forEach { (pk, pv) -> if (pk !in props) props[pk] = pv }
        (sub["required"] as? JsonArray)?.forEach { rEl ->
          val r = (rEl as? JsonPrimitive)?.contentOrNull
          if (r != null && r !in reqs) reqs.add(r)
        }
      }

      if ("@checks" in props || isStandardChecksSchema(props["checks"])) {
        isCheckable = true
      }

      val customEnvelope = ENVELOPE_MIXIN_NAMES.filterTo(LinkedHashSet()) { it in props }
      if ("checks" in customEnvelope && isStandardChecksSchema(props["checks"])) {
        customEnvelope.remove("checks")
      }
      if ("catalogId" in customEnvelope && isStandardCatalogIdSchema(props["catalogId"])) {
        customEnvelope.remove("catalogId")
      }
      val metaSchema = props["metadata"] as? JsonObject
      if (
        metaSchema != null &&
          (metaSchema["properties"] as? JsonObject)?.keys == setOf("extensions") &&
          (metaSchema["additionalProperties"] as? JsonPrimitive)?.booleanOrNull == false
      ) {
        customEnvelope.remove("metadata")
      }
      val a11ySchema = props["accessibility"] as? JsonObject
      if (
        a11ySchema != null &&
          (((a11ySchema["\$ref"] as? JsonPrimitive)?.contentOrNull ?: "").endsWith(
            "/AccessibilityAttributes"
          ) ||
            (((a11ySchema["properties"] as? JsonObject)
              ?.keys
              ?.containsAll(listOf("label", "description")) == true) &&
              (a11ySchema["additionalProperties"] as? JsonPrimitive)?.booleanOrNull == false))
      ) {
        customEnvelope.remove("accessibility")
      }

      val excluded = HashSet<String>()
      excluded.add("component")
      excluded.add("id")
      excluded.addAll(AT_ENVELOPE_MIXIN_KEYS)
      for (envKey in listOf("catalogId", "metadata", "accessibility")) {
        if (envKey !in customEnvelope) excluded.add(envKey)
      }
      if (isCheckable && "checks" !in customEnvelope) {
        excluded.add("checks")
      }
      val orderedKeys = props.keys.filterTo(ArrayList()) { it !in excluded }

      for (k in orderedKeys) {
        val enumVal = findEnum(getPropertySchema(name, k))
        if (enumVal != null) {
          componentPropertyEnums[name to k] = enumVal
        }
      }

      if (isCheckable && "checks" !in customEnvelope) {
        orderedKeys.add("checks")
      }

      componentProperties[name] = orderedKeys
      componentRequired[name] = reqs
      componentIsCheckable[name] = isCheckable
      componentCustomEnvelope[name] = customEnvelope
    }

    for ((name, schema) in functions) {
      val (pList, rList) = extractFunctionSignature(schema)
      functionProperties[name] = pList
      functionRequired[name] = rList
    }
    for ((name, schema) in systemFunctions) {
      val (pList, rList) = extractFunctionSignature(schema)
      systemFunctionProperties[name] = pList
      systemFunctionRequired[name] = rList
    }
  }

  fun getComponentProperties(name: String): List<String> = componentProperties[name] ?: emptyList()

  fun getComponentRequired(name: String): List<String> = componentRequired[name] ?: emptyList()

  fun isCheckable(name: String): Boolean = componentIsCheckable[name] ?: false

  fun getCustomEnvelopeProperties(name: String): Set<String> =
    componentCustomEnvelope[name] ?: emptySet()

  fun getFunctionProperties(name: String): List<String> =
    functionProperties[name] ?: systemFunctionProperties[name] ?: emptyList()

  fun getFunctionRequired(name: String): List<String> =
    functionRequired[name] ?: systemFunctionRequired[name] ?: emptyList()

  fun getPropertyEnum(componentName: String, propertyName: String): List<JsonElement>? =
    componentPropertyEnums[componentName to propertyName]

  fun getComponentDescription(name: String): String? {
    val schema = components[name] ?: return null
    (schema["description"] as? JsonPrimitive)?.contentOrNull?.let {
      return it
    }
    (schema["allOf"] as? JsonArray)?.forEach { sub ->
      ((sub as? JsonObject)?.get("description") as? JsonPrimitive)?.contentOrNull?.let {
        return it
      }
    }
    return null
  }

  fun getFunctionDescription(name: String): String? {
    val schema = functionSchema(name) ?: return null
    return (schema["description"] as? JsonPrimitive)?.contentOrNull
  }

  fun getPropertySchema(componentName: String, propertyName: String): JsonObject? {
    val schema = components[componentName] ?: return null
    val ownProps = schema["properties"] as? JsonObject
    if (ownProps != null && propertyName in ownProps) {
      return ownProps[propertyName] as? JsonObject
    }
    for (sub in orderedComponentSubSchemas(schema)) {
      val subProps = sub["properties"] as? JsonObject ?: continue
      if (propertyName in subProps) {
        return subProps[propertyName] as? JsonObject
      }
    }
    return null
  }

  fun getPropertyType(componentName: String, propertyName: String): String? =
    schemaRefType(getPropertySchema(componentName, propertyName))

  fun getFunctionPropertySchema(fnName: String, propName: String): JsonObject? {
    val fnSchema = functionSchema(fnName) ?: return null
    val subs = ArrayList<JsonObject>()
    subs.add(fnSchema)
    (fnSchema["allOf"] as? JsonArray)?.forEach { if (it is JsonObject) subs.add(it) }
    for (sub in subs) {
      val argsObj = (sub["properties"] as? JsonObject)?.get("args") as? JsonObject ?: continue
      val argsProps = argsObj["properties"] as? JsonObject ?: continue
      if (propName in argsProps) {
        return argsProps[propName] as? JsonObject
      }
    }
    return null
  }

  fun acceptsNumber(schema: JsonObject?): Boolean {
    if (schema == null) return false
    val visited = HashSet<Int>()

    fun check(s: JsonObject?, inCommonTypes: Boolean): Boolean {
      if (s == null) return false
      val id = System.identityHashCode(s)
      if (!visited.add(id)) return false

      when (val sType = s["type"]) {
        is JsonPrimitive -> if (sType.content in setOf("number", "integer")) return true
        is JsonArray ->
          if (sType.any { (it as? JsonPrimitive)?.contentOrNull in setOf("number", "integer") })
            return true
        else -> {}
      }
      val constVal = s["const"] as? JsonPrimitive
      if (
        constVal != null &&
          !constVal.isString &&
          constVal.booleanOrNull == null &&
          constVal.doubleOrNull != null
      ) {
        return true
      }
      val enumVal = s["enum"] as? JsonArray
      if (
        enumVal != null &&
          enumVal.any {
            it is JsonPrimitive &&
              !it.isString &&
              it.booleanOrNull == null &&
              it.doubleOrNull != null
          }
      ) {
        return true
      }

      val ref = (s["\$ref"] as? JsonPrimitive)?.contentOrNull
      if (ref != null) {
        val cDef = commonDefName(ref)
        when {
          cDef != null -> {
            val resolved = lookupCommonDef(cDef) ?: return true
            if (check(resolved, true)) return true
          }
          inCommonTypes && (ref.startsWith("#/\$defs/") || ref.startsWith("#/definitions/")) -> {
            val name = if (ref.startsWith("#/\$defs/")) ref.substring(8) else ref.substring(14)
            val resolved = lookupCommonDef(name) ?: return true
            if (check(resolved, true)) return true
          }
          ref.startsWith("#/") -> {
            val resolved = resolveJsonPointer(catalogSchema, ref) ?: return true
            if (check(resolved, false)) return true
          }
          ref.startsWith("catalog.json#/") -> {
            val resolved = resolveJsonPointer(catalogSchema, ref.substring(12)) ?: return true
            if (check(resolved, false)) return true
          }
          else -> return true
        }
      }

      for (key in listOf("allOf", "oneOf", "anyOf")) {
        val subs = s[key] as? JsonArray ?: continue
        if (subs.any { it is JsonObject && check(it, inCommonTypes) }) return true
      }

      val typeKeys =
        setOf(
          "type",
          "const",
          "enum",
          "\$ref",
          "allOf",
          "oneOf",
          "anyOf",
          "properties",
          "items",
          "prefixItems",
          "not",
        )
      if (typeKeys.none { it in s }) return true

      return false
    }

    return check(schema, false)
  }

  fun resolveItemSchema(schema: JsonObject?): JsonObject? = resolveAt(schema, null)

  fun resolvePropertySchema(schema: JsonObject?, name: String): JsonObject? =
    resolveAt(schema, name)

  private fun resolveAt(schema: JsonObject?, prop: String?): JsonObject? {
    if (schema == null) return null
    val visited = HashSet<Int>()

    fun resolve(s: JsonObject?, inCommonTypes: Boolean): JsonObject? {
      if (s == null || !visited.add(System.identityHashCode(s))) return null
      if (prop == null) {
        (s["items"] as? JsonObject)?.let {
          return it
        }
      } else {
        val props = s["properties"] as? JsonObject
        (props?.get(prop) as? JsonObject)?.let {
          return it
        }
        (s["additionalProperties"] as? JsonObject)?.let {
          return it
        }
      }

      val ref = (s["\$ref"] as? JsonPrimitive)?.contentOrNull
      if (ref != null) {
        val defName = commonDefName(ref)
        val found =
          when {
            defName != null -> resolve(lookupCommonDef(defName), true)
            inCommonTypes && (ref.startsWith("#/\$defs/") || ref.startsWith("#/definitions/")) -> {
              val name = if (ref.startsWith("#/\$defs/")) ref.substring(8) else ref.substring(14)
              resolve(lookupCommonDef(name), true)
            }
            ref.startsWith("#/") -> resolve(resolveJsonPointer(catalogSchema, ref), false)
            else -> null
          }
        if (found != null) return found
      }

      for (comb in listOf("allOf", "oneOf", "anyOf")) {
        val subs = s[comb] as? JsonArray ?: continue
        for (sub in subs) {
          if (sub is JsonObject) {
            resolve(sub, inCommonTypes)?.let {
              return it
            }
          }
        }
      }
      return null
    }

    return resolve(schema, false)
  }

  private fun functionSchema(name: String): JsonObject? = functions[name] ?: systemFunctions[name]

  private fun lookupCommonDef(defName: String): JsonObject? {
    val defs = (commonTypes["\$defs"] as? JsonObject) ?: (commonTypes["definitions"] as? JsonObject)
    return defs?.get(defName) as? JsonObject
  }

  private fun resolveJsonPointer(root: JsonObject, pointer: String): JsonObject? {
    if (!pointer.startsWith("#/")) return null
    var cur: JsonElement = root
    for (part in pointer.substring(2).split('/')) {
      val obj = cur as? JsonObject ?: return null
      cur = obj[unescapeJsonPointerSegment(part)] ?: return null
    }
    return cur as? JsonObject
  }

  private fun orderedComponentSubSchemas(schema: JsonObject): List<JsonObject> {
    val specific = ArrayList<JsonObject>()
    val common = ArrayList<JsonObject>()

    fun visit(node: JsonObject, isRoot: Boolean) {
      val props = node["properties"] as? JsonObject
      val isSpecific = props != null && "component" in props
      if (isSpecific) {
        specific.add(node)
      } else if (!isRoot || props != null || "required" in node || "\$ref" in node) {
        common.add(node)
      }
      (node["allOf"] as? JsonArray)?.forEach { sub ->
        if (sub is JsonObject) visit(sub, isRoot = false)
      }
    }

    visit(schema, isRoot = true)
    return specific + common
  }

  private fun extractSystemFunctionSchemas(common: JsonObject): Map<String, JsonObject> {
    val defs =
      (common["\$defs"] as? JsonObject)
        ?: (common["definitions"] as? JsonObject)
        ?: return emptyMap()
    val found = LinkedHashMap<String, JsonObject>()
    for (entry in defs.values) {
      val obj = entry as? JsonObject ?: continue
      val callObj = (obj["properties"] as? JsonObject)?.get("@call") as? JsonObject ?: continue
      val name = (callObj["const"] as? JsonPrimitive)?.contentOrNull ?: continue
      if (name.startsWith("@")) {
        found[name] = obj
      }
    }
    return found
  }

  private fun extractFunctionSignature(schema: JsonObject): Pair<List<String>, List<String>> {
    val subs = ArrayList<JsonObject>()
    subs.add(schema)
    (schema["allOf"] as? JsonArray)?.forEach { if (it is JsonObject) subs.add(it) }
    val props = LinkedHashSet<String>()
    val reqs = ArrayList<String>()
    for (sub in subs) {
      val argsObj = ((sub["properties"] as? JsonObject)?.get("args") as? JsonObject) ?: continue
      (argsObj["properties"] as? JsonObject)?.keys?.let { props.addAll(it) }
      (argsObj["required"] as? JsonArray)?.forEach { rEl ->
        val r = (rEl as? JsonPrimitive)?.contentOrNull
        if (r != null && r !in reqs) reqs.add(r)
      }
    }
    return props.toList() to reqs
  }

  private fun isStandardChecksSchema(schema: JsonElement?): Boolean {
    val obj = schema as? JsonObject ?: return false
    val ref = (obj["\$ref"] as? JsonPrimitive)?.contentOrNull
    if (ref != null && ref.endsWith("/Checkable")) return true
    val items = obj["items"] as? JsonObject ?: return false
    val itemRef = (items["\$ref"] as? JsonPrimitive)?.contentOrNull ?: return false
    return itemRef.endsWith("/CheckRule")
  }

  private fun isStandardCatalogIdSchema(schema: JsonElement?): Boolean {
    val obj = schema as? JsonObject ?: return false
    return (obj["description"] as? JsonPrimitive)?.contentOrNull == STANDARD_CATALOG_ID_DESCRIPTION
  }

  private fun findEnum(schema: JsonObject?): List<JsonElement>? {
    if (schema == null) return null
    (schema["enum"] as? JsonArray)?.let {
      return it.toList()
    }
    for (k in listOf("oneOf", "anyOf", "allOf")) {
      val subs = schema[k] as? JsonArray ?: continue
      for (sub in subs) {
        if (sub is JsonObject) {
          findEnum(sub)?.let {
            return it
          }
        }
      }
    }
    return null
  }
}

/** Coalesced surface unit used by [ExpressDecompiler]. */
internal data class CoalescedMessage(
  val message: JsonObject,
  val surfaceCatalogId: String? = null,
) {
  val operation: String?
    get() =
      listOf("createSurface", "updateComponents", "updateDataModel", "deleteSurface").firstOrNull {
        it in message
      }

  val isUpdate: Boolean
    get() = operation == "updateComponents" || operation == "updateDataModel"
}

/**
 * Folds split `createSurface` + `updateComponents` + root `updateDataModel` sequences into unified
 * creation units while keeping incremental updates intact.
 */
internal fun coalesceSurfaceMessages(
  messages: List<AgentToRendererMessage>
): List<CoalescedMessage> {
  return coalesceJsonMessages(messages.map { it.toJsonObject() })
}

internal fun coalesceJsonMessages(rawMessages: List<JsonObject>): List<CoalescedMessage> {
  val surfaceOps = listOf("createSurface", "updateComponents", "updateDataModel", "deleteSurface")
  val result = ArrayList<MutableMap<String, JsonElement>>()
  val surfaceIds = ArrayList<String?>()
  val openCreates = HashMap<String, Int>()

  for (origMsg in rawMessages) {
    val msg = LinkedHashMap<String, JsonElement>(origMsg)
    val op = surfaceOps.firstOrNull { msg[it] is JsonObject }
    if (op == null) {
      openCreates.clear()
      result.add(msg)
      surfaceIds.add(null)
      continue
    }

    val body = LinkedHashMap<String, JsonElement>(msg[op] as JsonObject)
    msg[op] = JsonObject(body)
    val sid = (body["surfaceId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    val openIdx = if (sid != null) openCreates[sid] else null

    if (op == "createSurface") {
      if (sid != null) openCreates[sid] = result.size
      result.add(msg)
      surfaceIds.add(sid)
      continue
    }

    if (openIdx != null && sid != null) {
      val createBody =
        LinkedHashMap<String, JsonElement>(result[openIdx]["createSurface"] as JsonObject)
      if (op == "updateComponents" && "components" !in createBody) {
        createBody["components"] = body["components"] ?: JsonArray(emptyList())
        result[openIdx]["createSurface"] = JsonObject(createBody)
        continue
      }
      val pathStr = (body["path"] as? JsonPrimitive)?.contentOrNull
      val isRootPath = pathStr == null || pathStr == "" || pathStr == "/"
      if (op == "updateDataModel" && isRootPath && body["value"] is JsonObject) {
        createBody["dataModel"] = body["value"]!!
        result[openIdx]["createSurface"] = JsonObject(createBody)
        continue
      }
      openCreates.remove(sid)
    }

    if (op == "deleteSurface" && sid != null) {
      openCreates.remove(sid)
    }
    result.add(msg)
    surfaceIds.add(sid)
  }

  val coalesced = ArrayList<CoalescedMessage>(result.size)
  val seenCatalogs = HashMap<String, String>()
  for (i in result.indices) {
    val msgObj = JsonObject(result[i])
    val sid = surfaceIds[i]
    if (sid != null && "createSurface" in msgObj) {
      val catId =
        ((msgObj["createSurface"] as? JsonObject)?.get("catalogId") as? JsonPrimitive)
          ?.takeIf { it.isString }
          ?.content
      if (!catId.isNullOrEmpty()) {
        seenCatalogs[sid] = catId
      } else {
        seenCatalogs.remove(sid)
      }
    }
    coalesced.add(
      CoalescedMessage(
        message = msgObj,
        surfaceCatalogId = if (sid != null) seenCatalogs[sid] else null,
      )
    )
  }
  return coalesced
}
