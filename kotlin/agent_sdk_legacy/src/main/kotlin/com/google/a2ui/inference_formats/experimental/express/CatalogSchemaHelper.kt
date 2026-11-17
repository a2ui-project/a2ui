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

import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.SchemaResourceLoader
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** Reserved wire keys for data bindings and function calls on a given protocol version. */
data class ReservedWireKeys(val path: String, val call: String, val nonCallKeys: Set<String>)

/** Metadata for a component discovered from the catalog JSON Schema. */
data class ComponentMetadata(
  val name: String,
  val properties: List<String>,
  val required: List<String>,
  val childProperties: List<String>,
  val childListProperties: List<String>,
  val hasChecks: Boolean,
  val propertySchemas: Map<String, JsonObject> = emptyMap(),
  val customEnvelopeProperties: Set<String> = emptySet(),
)

/** Metadata for a function discovered from the catalog or protocol `common_types.json`. */
data class FunctionMetadata(
  val name: String,
  val parameters: List<String>,
  val required: List<String>,
  val returnType: String,
  val propertySchemas: Map<String, JsonObject> = emptyMap(),
  val allowedCallers: String = "rendererOnly",
  val requiresUserActivation: Boolean = false,
)

/**
 * Crawls an [A2uiCatalog] schema and protocol `common_types.json` to extract component positional
 * signatures, child references, dynamic binding rules, function signatures, and system functions.
 */
class CatalogSchemaHelper
@JvmOverloads
constructor(val catalog: A2uiCatalog, version: String = catalog.protocolVersion) {
  val catalogId: String = catalog.catalogId
  val targetVersion: String = normalizeExpressTargetVersion(version)
  val isV1OrLater: Boolean = isExpressV1OrLater(targetVersion)

  val reservedKeys: ReservedWireKeys =
    if (isV1OrLater) {
      ReservedWireKeys(
        path = "@path",
        call = "@call",
        nonCallKeys = setOf("path", "event", "functionCall"),
      )
    } else {
      ReservedWireKeys(
        path = "path",
        call = "call",
        nonCallKeys = setOf("path", "event", "functionCall"),
      )
    }

  private val commonTypesSchema: JsonObject = buildEffectiveCommonTypes(catalog, isV1OrLater)
  private val catalogDefs: JsonObject =
    (catalog.catalogSchema["\$defs"] as? JsonObject) ?: JsonObject(emptyMap())

  val components: Map<String, ComponentMetadata>
  val functions: Map<String, FunctionMetadata>
  val systemFunctions: Map<String, FunctionMetadata>

  val agentCallableFunctions: List<FunctionMetadata>
    get() =
      functions.values.filter { it.allowedCallers in AGENT_CALLERS && !it.requiresUserActivation }

  init {
    val parsedComponents = LinkedHashMap<String, ComponentMetadata>()
    val parsedFunctions = LinkedHashMap<String, FunctionMetadata>()

    val compsDict = catalog.catalogSchema["components"] as? JsonObject
    if (compsDict != null) {
      val allowedComps = activeEntryNames("anyComponent", "#/components/")
      for ((compName, compSchemaEl) in compsDict) {
        if (allowedComps != null && compName !in allowedComps) continue
        val compSchema = compSchemaEl as? JsonObject ?: continue
        parsedComponents[compName] = parseComponent(compName, compSchema)
      }
    }

    when (val funcsEl = catalog.catalogSchema["functions"]) {
      is JsonObject -> {
        val allowedFuncs = activeEntryNames("anyFunction", "#/functions/")
        for ((fnKey, fnVal) in funcsEl) {
          if (allowedFuncs != null && fnKey !in allowedFuncs) continue
          val fnObj = fnVal as? JsonObject ?: continue
          val fnMeta = parseCatalogFunction(fnObj, fallbackName = fnKey) ?: continue
          parsedFunctions[fnMeta.name] = fnMeta
        }
      }
      is JsonArray -> {
        val allowedFuncs = activeEntryNames("anyFunction", "#/functions/")
        for (fnVal in funcsEl) {
          val fnObj = fnVal as? JsonObject ?: continue
          val fnMeta = parseCatalogFunction(fnObj) ?: continue
          if (allowedFuncs != null && fnMeta.name !in allowedFuncs) continue
          parsedFunctions[fnMeta.name] = fnMeta
        }
      }
      else -> {}
    }

    components = parsedComponents
    functions = parsedFunctions
    systemFunctions = parseSystemFunctions(commonTypesSchema)
  }

  private fun activeEntryNames(unionDefName: String, refPrefix: String): Set<String>? {
    val unionSchema = catalogDefs[unionDefName] as? JsonObject ?: return null
    val oneOf = unionSchema["oneOf"] as? JsonArray ?: return null
    val names = LinkedHashSet<String>()
    for (entry in oneOf) {
      val obj = entry as? JsonObject ?: continue
      val ref = obj["\$ref"]?.jsonPrimitive?.contentOrNull
      if (ref != null && ref.startsWith(refPrefix)) {
        names.add(URLDecoder.decode(ref.removePrefix(refPrefix), StandardCharsets.UTF_8))
        continue
      }
      val constName =
        ((obj["properties"] as? JsonObject)?.get("name") as? JsonObject)
          ?.get("const")
          ?.jsonPrimitive
          ?.contentOrNull
      if (constName != null) {
        names.add(constName)
      }
    }
    return names
  }

  private fun parseComponent(name: String, compSchema: JsonObject): ComponentMetadata {
    val props = mutableListOf<String>()
    val requiredSet = LinkedHashSet<String>()
    val childProps = mutableListOf<String>()
    val childListProps = mutableListOf<String>()
    val propSchemas = LinkedHashMap<String, JsonObject>()
    val customEnvelope = LinkedHashSet<String>()
    var hasChecks = false

    val subSchemas = orderedComponentSubSchemas(compSchema)
    for (sub in subSchemas) {
      val ref = sub["\$ref"]?.jsonPrimitive?.contentOrNull ?: ""
      if ("Checkable" in ref) {
        hasChecks = true
      }

      val resolvedSub = resolveSubSchema(sub)
      (resolvedSub["required"] as? JsonArray)?.forEach { reqEl ->
        val reqName = reqEl.jsonPrimitive.contentOrNull
        if (reqName != null && reqName !in EXCLUDED_COMPONENT_PROPERTIES) {
          requiredSet.add(reqName)
        }
      }

      val subProps = resolvedSub["properties"] as? JsonObject ?: continue
      for ((propName, rawPropVal) in subProps) {
        val propVal = rawPropVal as? JsonObject ?: continue
        if (propName == "@checks") {
          hasChecks = true
          continue
        }
        if (propName in WIRE_ENVELOPE_KEYS) {
          continue
        }
        if (propName == "checks" && isCheckRuleArraySchema(propVal)) {
          hasChecks = true
          continue
        }
        if (propName in BARE_ENVELOPE_NAMES) {
          customEnvelope.add(propName)
        }
        val prevSchema = propSchemas[propName]
        val mergedSchema = if (prevSchema != null) mergeSchemas(prevSchema, propVal) else propVal
        propSchemas[propName] = mergedSchema
        if (propName !in props) {
          props.add(propName)
        }
      }
    }

    requiredSet.remove("checks")
    for ((propName, propSchema) in propSchemas) {
      if (isComponentIdSchema(propSchema)) {
        childProps.add(propName)
      } else if (isChildListSchema(propSchema)) {
        childListProps.add(propName)
      }
    }

    return ComponentMetadata(
      name = name,
      properties = props,
      required = requiredSet.filter { it in propSchemas || it in props },
      childProperties = childProps,
      childListProperties = childListProps,
      hasChecks = hasChecks,
      propertySchemas = propSchemas,
      customEnvelopeProperties = customEnvelope,
    )
  }

  private fun orderedComponentSubSchemas(compSchema: JsonObject): List<JsonObject> {
    val allOf = compSchema["allOf"] as? JsonArray ?: return listOf(compSchema)
    val inlineSubs = mutableListOf<JsonObject>()
    val refSubs = mutableListOf<JsonObject>()
    if (compSchema.containsKey("properties") || compSchema.containsKey("required")) {
      inlineSubs.add(JsonObject(compSchema.filterKeys { it != "allOf" }))
    }
    for (item in allOf) {
      val obj = item as? JsonObject ?: continue
      if (obj.containsKey("\$ref") && !obj.containsKey("properties")) {
        refSubs.add(obj)
      } else {
        inlineSubs.add(obj)
      }
    }
    return inlineSubs + refSubs
  }

  private fun parseCatalogFunction(
    fnSchema: JsonObject,
    fallbackName: String? = null,
  ): FunctionMetadata? {
    val props = fnSchema["properties"] as? JsonObject
    val name =
      fnSchema["name"]?.jsonPrimitive?.contentOrNull
        ?: (props?.get("name") as? JsonObject)?.get("const")?.jsonPrimitive?.contentOrNull
        ?: (props?.get(reservedKeys.call) as? JsonObject)
          ?.get("const")
          ?.jsonPrimitive
          ?.contentOrNull
        ?: fallbackName
        ?: return null

    val returnType =
      fnSchema["returnType"]?.jsonPrimitive?.contentOrNull
        ?: (props?.get("returnType") as? JsonObject)?.get("const")?.jsonPrimitive?.contentOrNull
        ?: "any"

    val allowedCallers =
      fnSchema["allowedCallers"]?.jsonPrimitive?.contentOrNull
        ?: (props?.get("allowedCallers") as? JsonObject)?.get("const")?.jsonPrimitive?.contentOrNull
        ?: "rendererOnly"

    val requiresUserActivation =
      (fnSchema["requiresUserActivation"] as? JsonPrimitive)?.booleanOrNull
        ?: ((props?.get("requiresUserActivation") as? JsonObject)?.get("const") as? JsonPrimitive)
          ?.booleanOrNull
        ?: false

    val rawParamsSchema =
      (fnSchema["parameters"] as? JsonObject)
        ?: (props?.get("args") as? JsonObject)
        ?: JsonObject(emptyMap())
    val paramsSchema = resolveLocalSchema(rawParamsSchema)
    val paramProps = (paramsSchema["properties"] as? JsonObject) ?: JsonObject(emptyMap())

    val parameters = mutableListOf<String>()
    val propertySchemas = LinkedHashMap<String, JsonObject>()
    for ((pName, pVal) in paramProps) {
      parameters.add(pName)
      (pVal as? JsonObject)?.let { propertySchemas[pName] = it }
    }
    val required =
      (paramsSchema["required"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull }
        ?: emptyList()

    return FunctionMetadata(
      name = name,
      parameters = parameters,
      required = required,
      returnType = returnType,
      propertySchemas = propertySchemas,
      allowedCallers = allowedCallers,
      requiresUserActivation = requiresUserActivation,
    )
  }

  private fun parseSystemFunctions(commonTypes: JsonObject): Map<String, FunctionMetadata> {
    val defs = commonTypes["\$defs"] as? JsonObject ?: return emptyMap()
    val result = LinkedHashMap<String, FunctionMetadata>()
    for ((_, defEl) in defs) {
      val defObj = defEl as? JsonObject ?: continue
      val props = defObj["properties"] as? JsonObject ?: continue
      val callName =
        (props[reservedKeys.call] as? JsonObject)?.get("const")?.jsonPrimitive?.contentOrNull
      if (callName == null || !callName.startsWith("@")) continue
      val argsObj = (props["args"] as? JsonObject)?.let { resolveSchemaWithRoot(it, commonTypes) }
      val argProps = (argsObj?.get("properties") as? JsonObject) ?: JsonObject(emptyMap())
      val parameters = argProps.keys.toList()
      val paramSchemas = LinkedHashMap<String, JsonObject>()
      for ((k, v) in argProps) {
        (v as? JsonObject)?.let { paramSchemas[k] = it }
      }
      val req =
        (argsObj?.get("required") as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull }
          ?: emptyList()
      val returnType = defObj["returnType"]?.jsonPrimitive?.contentOrNull ?: "any"
      result[callName] =
        FunctionMetadata(
          name = callName,
          parameters = parameters,
          required = req,
          returnType = returnType,
          propertySchemas = paramSchemas,
        )
    }
    return result
  }

  /** Resolves `$ref` pointers against both the catalog document and `common_types.json`. */
  fun resolveLocalSchema(schema: JsonObject, seen: Set<String> = emptySet()): JsonObject {
    val ref = schema["\$ref"]?.jsonPrimitive?.contentOrNull ?: return schema
    if (ref in seen) return schema
    val target = resolveRefTarget(ref) ?: return schema
    val nextSeen = seen + ref
    val resolvedTarget = resolveLocalSchema(target, nextSeen)
    if (schema.size == 1) return resolvedTarget
    val merged = resolvedTarget.toMutableMap()
    for ((k, v) in schema) {
      if (k != "\$ref") merged[k] = v
    }
    return JsonObject(merged)
  }

  private fun resolveSubSchema(sub: JsonObject): JsonObject = resolveLocalSchema(sub)

  private fun resolveRefTarget(ref: String): JsonObject? {
    if (ref.startsWith("#/")) {
      return navigatePointer(catalog.catalogSchema, ref.removePrefix("#/"))
        ?: navigatePointer(commonTypesSchema, ref.removePrefix("#/"))
    }
    val hashIdx = ref.indexOf("#/")
    if (hashIdx >= 0) {
      val docPart = ref.substring(0, hashIdx)
      val pointer = ref.substring(hashIdx + 2)
      if (docPart.endsWith("common_types.json")) {
        return navigatePointer(commonTypesSchema, pointer)
      }
      if (docPart.endsWith("catalog.json")) {
        return navigatePointer(catalog.catalogSchema, pointer)
      }
    }
    return null
  }

  private fun resolveSchemaWithRoot(
    schema: JsonObject,
    root: JsonObject,
    seen: Set<String> = emptySet(),
  ): JsonObject {
    val ref = schema["\$ref"]?.jsonPrimitive?.contentOrNull ?: return schema
    if (!ref.startsWith("#/") || ref in seen) return schema
    val target = navigatePointer(root, ref.removePrefix("#/")) ?: return schema
    return resolveSchemaWithRoot(target, root, seen + ref)
  }

  private fun navigatePointer(root: JsonObject, pointer: String): JsonObject? {
    var cur: JsonElement = root
    for (rawPart in pointer.split("/")) {
      if (rawPart.isEmpty()) continue
      val part =
        URLDecoder.decode(rawPart, StandardCharsets.UTF_8).replace("~1", "/").replace("~0", "~")
      cur = (cur as? JsonObject)?.get(part) ?: return null
    }
    return cur as? JsonObject
  }

  private fun mergeSchemas(base: JsonObject, overlay: JsonObject): JsonObject {
    val merged = base.toMutableMap()
    for ((k, v) in overlay) {
      merged[k] = v
    }
    return JsonObject(merged)
  }

  fun isComponentIdSchema(schema: JsonObject?): Boolean {
    if (schema == null) return false
    val directRef = schema["\$ref"]?.jsonPrimitive?.contentOrNull ?: ""
    if (directRef.endsWith("/ComponentId") || directRef.endsWith("/Child")) return true
    for (kw in COMPOSITE_SCHEMA_KEYS) {
      val arr = schema[kw] as? JsonArray ?: continue
      if (arr.any { (it as? JsonObject)?.let(::isComponentIdSchema) == true }) return true
    }
    return false
  }

  fun isChildListSchema(schema: JsonObject?): Boolean {
    if (schema == null) return false
    val directRef = schema["\$ref"]?.jsonPrimitive?.contentOrNull ?: ""
    if (directRef.endsWith("/ChildList")) return true
    for (kw in COMPOSITE_SCHEMA_KEYS) {
      val arr = schema[kw] as? JsonArray ?: continue
      if (arr.any { (it as? JsonObject)?.let(::isChildListSchema) == true }) return true
    }
    return false
  }

  fun isActionSlot(schema: JsonObject?): Boolean {
    if (schema == null) return false
    val directRef = schema["\$ref"]?.jsonPrimitive?.contentOrNull ?: ""
    if (directRef.endsWith("/Action")) return true
    val resolved = resolveLocalSchema(schema)
    val props = resolved["properties"] as? JsonObject
    if (props != null && (props.containsKey("event") || props.containsKey("functionCall"))) {
      return true
    }
    for (kw in COMPOSITE_SCHEMA_KEYS) {
      val arr = resolved[kw] as? JsonArray ?: continue
      if (arr.any { (it as? JsonObject)?.let(::isActionSlot) == true }) return true
    }
    return false
  }

  private fun isCheckRuleArraySchema(schema: JsonObject): Boolean {
    val resolved = resolveLocalSchema(schema)
    if (resolved["type"]?.jsonPrimitive?.contentOrNull != "array") return false
    val items = resolved["items"] as? JsonObject ?: return false
    val itemRef = items["\$ref"]?.jsonPrimitive?.contentOrNull ?: ""
    if ("CheckRule" in itemRef) return true
    val resolvedItems = resolveLocalSchema(items)
    val props = resolvedItems["properties"] as? JsonObject ?: return false
    return props.containsKey("condition") && props.containsKey("message")
  }

  /** Returns true if [schema] admits a `DataBinding` (`{"@path": "..."}` or `{"path": "..."}`). */
  fun admitsPath(schema: JsonObject?, seen: Set<String> = emptySet()): Boolean {
    if (schema == null) return true
    val ref = schema["\$ref"]?.jsonPrimitive?.contentOrNull
    if (ref != null) {
      if (
        ref.endsWith("/DataBinding") ||
          ref.endsWith("/DynamicValue") ||
          ref.endsWith("/DynamicString") ||
          ref.endsWith("/DynamicNumber") ||
          ref.endsWith("/DynamicBoolean") ||
          ref.endsWith("/DynamicStringList")
      ) {
        return true
      }
      if (ref.endsWith("/ComponentId") || ref.endsWith("/ChildList")) {
        return false
      }
      if (ref in seen) return false
      val target = resolveRefTarget(ref) ?: return false
      return admitsPath(target, seen + ref)
    }

    val props = schema["properties"] as? JsonObject
    if (props != null && (props.containsKey(reservedKeys.path) || props.containsKey("path"))) {
      val req =
        (schema["required"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull }
          ?: emptyList()
      if (reservedKeys.path in req || "path" in req) {
        return true
      }
    }

    if (schema["type"]?.jsonPrimitive?.contentOrNull == "object" && props == null) {
      val addl = schema["additionalProperties"]
      if (addl == null || (addl as? JsonPrimitive)?.booleanOrNull == true) {
        return true
      }
      if (addl is JsonObject) {
        return admitsPath(addl, seen)
      }
    }

    for (kw in COMPOSITE_SCHEMA_KEYS) {
      val arr = schema[kw] as? JsonArray ?: continue
      if (arr.any { (it as? JsonObject)?.let { sub -> admitsPath(sub, seen) } == true }) {
        return true
      }
    }
    return false
  }

  /**
   * Returns true if [schema] accepts a numeric value (including `DynamicNumber` / `DynamicValue`).
   */
  fun acceptsNumber(schema: JsonObject?, seen: Set<String> = emptySet()): Boolean {
    if (schema == null) return false
    val ref = schema["\$ref"]?.jsonPrimitive?.contentOrNull
    if (ref != null) {
      if (ref.endsWith("/DynamicNumber") || ref.endsWith("/DynamicValue")) return true
      if (ref in seen) return false
      val target = resolveRefTarget(ref) ?: return false
      return acceptsNumber(target, seen + ref)
    }
    val typeEl = schema["type"]
    if (typeEl is JsonPrimitive) {
      val t = typeEl.contentOrNull
      if (t == "number" || t == "integer") return true
    } else if (typeEl is JsonArray) {
      if (typeEl.any { it.jsonPrimitive.contentOrNull in setOf("number", "integer") }) return true
    }
    for (kw in COMPOSITE_SCHEMA_KEYS) {
      val arr = schema[kw] as? JsonArray ?: continue
      if (arr.any { (it as? JsonObject)?.let { sub -> acceptsNumber(sub, seen) } == true }) {
        return true
      }
    }
    return false
  }

  /**
   * Returns true if [schema] accepts a string literal (used for check rule trailing message
   * detection).
   */
  fun acceptsString(schema: JsonObject?, seen: Set<String> = emptySet()): Boolean {
    if (schema == null) return true
    val ref = schema["\$ref"]?.jsonPrimitive?.contentOrNull
    if (ref != null) {
      if (ref.endsWith("/DynamicString") || ref.endsWith("/DynamicValue")) return true
      if (ref.endsWith("/DynamicNumber") || ref.endsWith("/DynamicBoolean")) return false
      if (ref in seen) return false
      val target = resolveRefTarget(ref) ?: return true
      return acceptsString(target, seen + ref)
    }
    val typeEl = schema["type"]
    if (typeEl is JsonPrimitive) {
      return typeEl.contentOrNull == "string"
    }
    if (typeEl is JsonArray) {
      return typeEl.any { it.jsonPrimitive.contentOrNull == "string" }
    }
    var sawBranch = false
    for (kw in COMPOSITE_SCHEMA_KEYS) {
      val arr = schema[kw] as? JsonArray ?: continue
      sawBranch = true
      if (arr.any { (it as? JsonObject)?.let { sub -> acceptsString(sub, seen) } == true }) {
        return true
      }
    }
    return !sawBranch
  }

  /** Resolves the array `items` sub-schema for [schema], if it accepts an array. */
  fun resolveItemSchema(schema: JsonObject?, seen: Set<String> = emptySet()): JsonObject? {
    if (schema == null) return null
    val ref = schema["\$ref"]?.jsonPrimitive?.contentOrNull
    if (ref != null) {
      if (ref in seen) return null
      val target = resolveRefTarget(ref) ?: return null
      return resolveItemSchema(target, seen + ref)
    }
    (schema["items"] as? JsonObject)?.let {
      return it
    }
    for (kw in COMPOSITE_SCHEMA_KEYS) {
      val arr = schema[kw] as? JsonArray ?: continue
      for (item in arr) {
        val sub = item as? JsonObject ?: continue
        resolveItemSchema(sub, seen)?.let {
          return it
        }
      }
    }
    return null
  }

  /** Resolves the sub-schema for object property [propName] under [schema], if constrained. */
  fun resolvePropertySchema(
    schema: JsonObject?,
    propName: String,
    seen: Set<String> = emptySet(),
  ): JsonObject? {
    if (schema == null) return null
    val ref = schema["\$ref"]?.jsonPrimitive?.contentOrNull
    if (ref != null) {
      if (ref in seen) return null
      val target = resolveRefTarget(ref) ?: return null
      return resolvePropertySchema(target, propName, seen + ref)
    }
    val props = schema["properties"] as? JsonObject
    if (props != null) {
      (props[propName] as? JsonObject)?.let {
        return it
      }
    }
    (schema["additionalProperties"] as? JsonObject)?.let {
      return it
    }
    for (kw in COMPOSITE_SCHEMA_KEYS) {
      val arr = schema[kw] as? JsonArray ?: continue
      for (item in arr) {
        val sub = item as? JsonObject ?: continue
        // Skip DataBinding/FunctionCall branches in Dynamic* unions when looking up map entries
        val subRef = sub["\$ref"]?.jsonPrimitive?.contentOrNull ?: ""
        if (subRef.endsWith("/DataBinding") || subRef.endsWith("/FunctionCall")) continue
        resolvePropertySchema(sub, propName, seen)?.let {
          return it
        }
      }
    }
    return null
  }

  /**
   * Returns true if [schema] describes an array of `{label, value}` option objects (allowing
   * Express shorthand `["Option A", "Option B"]` coercion).
   */
  fun expectsOptionObjects(schema: JsonObject?): Boolean {
    val itemSchema = resolveItemSchema(schema)?.let { resolveLocalSchema(it) } ?: return false
    val props = itemSchema["properties"] as? JsonObject ?: return false
    return props.containsKey("label") && props.containsKey("value")
  }

  /** Extracts string enum values if [schema] restricts static strings to a closed `enum` set. */
  fun extractEnumValues(schema: JsonObject?, seen: Set<String> = emptySet()): List<String>? {
    if (schema == null) return null
    val ref = schema["\$ref"]?.jsonPrimitive?.contentOrNull
    if (ref != null) {
      if (ref in seen) return null
      val target = resolveRefTarget(ref) ?: return null
      return extractEnumValues(target, seen + ref)
    }
    val enumArr = schema["enum"] as? JsonArray
    if (enumArr != null) {
      return enumArr.mapNotNull { it.jsonPrimitive.contentOrNull }
    }
    // Check oneOf/anyOf where static string branch carries enum (e.g. Icon.name: enum |
    // DynamicString)
    val enumCandidates = mutableListOf<String>()
    var hasUnconstrainedStringBranch = false
    for (kw in listOf("oneOf", "anyOf")) {
      val arr = schema[kw] as? JsonArray ?: continue
      for (item in arr) {
        val sub = item as? JsonObject ?: continue
        val subRef = sub["\$ref"]?.jsonPrimitive?.contentOrNull ?: ""
        if (subRef.endsWith("/DataBinding") || subRef.endsWith("/FunctionCall")) continue
        if (subRef.endsWith("/DynamicString") || subRef.endsWith("/DynamicValue")) {
          hasUnconstrainedStringBranch = true
          continue
        }
        val subEnums = extractEnumValues(sub, seen)
        if (subEnums != null) {
          enumCandidates.addAll(subEnums)
        } else {
          val resolvedSub = resolveLocalSchema(sub, seen)
          if (resolvedSub["type"]?.jsonPrimitive?.contentOrNull == "string") {
            hasUnconstrainedStringBranch = true
          }
        }
      }
    }
    return if (!hasUnconstrainedStringBranch && enumCandidates.isNotEmpty()) {
      enumCandidates.distinct()
    } else {
      null
    }
  }

  companion object {
    private val EXCLUDED_COMPONENT_PROPERTIES =
      setOf("component", "id", "@catalogId", "@metadata", "@accessibility", "@checks")
    private val WIRE_ENVELOPE_KEYS =
      setOf("component", "id", "@catalogId", "@metadata", "@accessibility", "@checks")
    private val BARE_ENVELOPE_NAMES = setOf("catalogId", "metadata", "accessibility", "checks")
    private val COMPOSITE_SCHEMA_KEYS = listOf("oneOf", "anyOf", "allOf")
    private val AGENT_CALLERS = setOf("agentOnly", "rendererOrAgent")

    private val bundledCommonTypesV10: JsonObject by lazy {
      SchemaResourceLoader.loadFromBundledResource("1.0", "common_types.json")
        ?: JsonObject(emptyMap())
    }
    private val bundledCommonTypesV09: JsonObject by lazy {
      SchemaResourceLoader.loadFromBundledResource("0.9", "common_types.json")
        ?: JsonObject(emptyMap())
    }

    private fun buildEffectiveCommonTypes(catalog: A2uiCatalog, isV1OrLater: Boolean): JsonObject {
      val bundled = if (isV1OrLater) bundledCommonTypesV10 else bundledCommonTypesV09
      if (catalog.commonTypesSchema.isEmpty()) return bundled
      val mergedDefs = LinkedHashMap<String, JsonElement>()
      (bundled["\$defs"] as? JsonObject)?.let { mergedDefs.putAll(it) }
      (catalog.commonTypesSchema["\$defs"] as? JsonObject)?.let { mergedDefs.putAll(it) }
      val merged = bundled.toMutableMap()
      merged.putAll(catalog.commonTypesSchema)
      if (mergedDefs.isNotEmpty()) {
        merged["\$defs"] = JsonObject(mergedDefs)
      }
      return JsonObject(merged)
    }
  }
}
