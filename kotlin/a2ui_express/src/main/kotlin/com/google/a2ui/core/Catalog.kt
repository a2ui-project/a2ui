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

package com.google.a2ui.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/** Caller permission policy declared on a catalog function in A2UI v1.0. */
enum class AllowedCallers(val wireValue: String) {
  RENDERER_ONLY("rendererOnly"),
  AGENT_ONLY("agentOnly"),
  RENDERER_OR_AGENT("rendererOrAgent");

  companion object {
    fun fromString(raw: String?): AllowedCallers =
      when (raw) {
        null,
        "rendererOnly" -> RENDERER_ONLY
        "agentOnly" -> AGENT_ONLY
        "rendererOrAgent" -> RENDERER_OR_AGENT
        else ->
          throw A2uiCatalogError(
            "Invalid allowedCallers value '$raw'. Expected rendererOnly, agentOnly, or rendererOrAgent."
          )
      }
  }
}

/** Component schema definition within an A2UI [Catalog]. */
data class ComponentApi(val name: String, val schema: JsonObject)

/** Function schema definition within an A2UI [Catalog]. */
data class FunctionApi(
  val name: String,
  val returnType: String,
  val argsSchema: JsonObject,
  val schema: JsonObject = JsonObject(emptyMap()),
  val allowedCallers: AllowedCallers = AllowedCallers.RENDERER_ONLY,
  val requiresUserActivation: Boolean = false,
)

/** Alias matching the cross-language blueprint naming for [Catalog]. */
typealias CatalogApi = Catalog

/**
 * Validated A2UI v1.0 component and function catalog.
 *
 * Wraps the JSON Schema definition of a catalog alongside bundled v1.0 `common_types.json`
 * definitions, optional prompt instructions, and example payloads.
 */
class Catalog(
  val id: String,
  val protocolVersion: ProtocolVersion,
  val components: Map<String, ComponentApi>,
  val functions: Map<String, FunctionApi>,
  val rawSchema: JsonObject,
  val commonTypesSchema: JsonObject = v1CommonTypes(),
  val instructions: String? = null,
  val examples: List<JsonElement> = emptyList(),
) {
  /** Returns a copy of this catalog with updated metadata, components, or functions. */
  fun copy(
    id: String = this.id,
    protocolVersion: ProtocolVersion = this.protocolVersion,
    components: Map<String, ComponentApi> = this.components,
    functions: Map<String, FunctionApi> = this.functions,
    rawSchema: JsonObject = this.rawSchema,
    commonTypesSchema: JsonObject = this.commonTypesSchema,
    instructions: String? = this.instructions,
    examples: List<JsonElement> = this.examples,
  ): Catalog =
    Catalog(
      id = id,
      protocolVersion = protocolVersion,
      components = components,
      functions = functions,
      rawSchema = rawSchema,
      commonTypesSchema = commonTypesSchema,
      instructions = instructions,
      examples = examples,
    )

  companion object {
    private const val COMMON_TYPES_RESOURCE = "/com/google/a2ui/assets/1.0/common_types.json"
    private const val BASIC_CATALOG_RESOURCE =
      "/com/google/a2ui/assets/1.0/catalogs/basic/catalog.json"

    private val cachedCommonTypes: JsonObject by lazy { loadResourceJson(COMMON_TYPES_RESOURCE) }
    private val cachedBasicCatalogJson: JsonObject by lazy {
      loadResourceJson(BASIC_CATALOG_RESOURCE)
    }

    /** Returns the bundled v1.0 `common_types.json` schema object. */
    fun v1CommonTypes(): JsonObject = cachedCommonTypes

    /** Loads the canonical A2UI Basic Catalog v1 (`catalogs/basic/v1/catalog.json`). */
    fun basicV1(instructions: String? = null, examples: List<JsonElement> = emptyList()): Catalog =
      fromJson(cachedBasicCatalogJson, instructions = instructions, examples = examples)

    /** Builds and validates a [Catalog] from its parsed [JsonObject] schema. */
    fun fromJson(
      rawSchema: JsonObject,
      instructions: String? = null,
      examples: List<JsonElement> = emptyList(),
    ): Catalog {
      val id =
        (rawSchema["catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
          ?: (rawSchema["\$id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
          ?: throw A2uiCatalogError("Catalog schema must declare a string 'catalogId'.")
      if (id.isBlank()) {
        throw A2uiCatalogError("Catalog 'catalogId' must not be empty.")
      }

      val rawVersion =
        (rawSchema["protocolVersion"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "1.0"
      val protocolVersion = ProtocolVersion.fromString(rawVersion)

      val commonTypes = v1CommonTypes()
      val commonDefs = (commonTypes["\$defs"] as? JsonObject) ?: JsonObject(emptyMap())
      val localDefs = (rawSchema["\$defs"] as? JsonObject) ?: JsonObject(emptyMap())

      val rawComponents = (rawSchema["components"] as? JsonObject) ?: JsonObject(emptyMap())
      val components = LinkedHashMap<String, ComponentApi>()
      for ((compName, compElement) in rawComponents) {
        if (compName == "Surface") {
          throw A2uiCatalogError("Catalog '$id' cannot declare reserved component name 'Surface'.")
        }
        if (!Uax31Identifier.isValidIdentifier(compName)) {
          throw A2uiCatalogError(
            "Component name '$compName' in catalog '$id' is not a valid UAX #31 identifier."
          )
        }
        val compObj =
          compElement as? JsonObject
            ?: throw A2uiCatalogError("Component '$compName' in catalog '$id' must be an object.")
        val resolvedCompObj = inlineLocalRefs(compObj, localDefs, commonDefs, mutableSetOf())
        components[compName] = ComponentApi(name = compName, schema = resolvedCompObj)
      }

      val functions = parseFunctions(rawSchema["functions"], id, localDefs, commonDefs)
      val normalizedRawSchema =
        JsonObject(
          buildMap {
            putAll(rawSchema)
            put("components", JsonObject(components.mapValues { (_, api) -> api.schema }))
          }
        )

      return Catalog(
        id = id,
        protocolVersion = protocolVersion,
        components = components,
        functions = functions,
        rawSchema = normalizedRawSchema,
        commonTypesSchema = commonTypes,
        instructions = instructions,
        examples = examples,
      )
    }

    private fun parseFunctions(
      rawFunctions: JsonElement?,
      catalogId: String,
      localDefs: JsonObject,
      commonDefs: JsonObject,
    ): Map<String, FunctionApi> {
      if (rawFunctions == null) return emptyMap()
      val result = LinkedHashMap<String, FunctionApi>()
      when (rawFunctions) {
        is JsonArray -> {
          for (entry in rawFunctions) {
            val fnObj =
              entry as? JsonObject
                ?: throw A2uiCatalogError(
                  "Function entry in catalog '$catalogId' must be an object."
                )
            val name =
              (fnObj["name"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: throw A2uiCatalogError("Function in catalog '$catalogId' is missing 'name'.")
            result[name] = buildFunctionApi(name, fnObj, catalogId, localDefs, commonDefs)
          }
        }
        is JsonObject -> {
          for ((name, entry) in rawFunctions) {
            val fnObj =
              entry as? JsonObject
                ?: throw A2uiCatalogError(
                  "Function '$name' in catalog '$catalogId' must be an object."
                )
            result[name] = buildFunctionApi(name, fnObj, catalogId, localDefs, commonDefs)
          }
        }
        else ->
          throw A2uiCatalogError(
            "Catalog '$catalogId' 'functions' field must be an array or object."
          )
      }
      return result
    }

    private fun buildFunctionApi(
      name: String,
      fnObj: JsonObject,
      catalogId: String,
      localDefs: JsonObject,
      commonDefs: JsonObject,
    ): FunctionApi {
      if (name.startsWith("@")) {
        throw A2uiCatalogError(
          "Catalog '$catalogId' cannot declare reserved system function name '$name'."
        )
      }
      if (!Uax31Identifier.isValidIdentifier(name)) {
        throw A2uiCatalogError(
          "Function name '$name' in catalog '$catalogId' is not a valid UAX #31 identifier."
        )
      }
      val resolvedFnObj = inlineLocalRefs(fnObj, localDefs, commonDefs, mutableSetOf())
      val returnType = (resolvedFnObj["returnType"] as? JsonPrimitive)?.contentOrNull ?: "any"
      val propsArgs =
        ((resolvedFnObj["properties"] as? JsonObject)?.get("args") as? JsonObject)
          ?: JsonObject(
            mapOf("type" to JsonPrimitive("object"), "additionalProperties" to JsonPrimitive(false))
          )
      val allowedCallers =
        AllowedCallers.fromString(
          (resolvedFnObj["allowedCallers"] as? JsonPrimitive)?.contentOrNull
        )
      val requiresUserActivation =
        (resolvedFnObj["requiresUserActivation"] as? JsonPrimitive)?.booleanOrNull ?: false
      return FunctionApi(
        name = name,
        returnType = returnType,
        argsSchema = propsArgs,
        schema = resolvedFnObj,
        allowedCallers = allowedCallers,
        requiresUserActivation = requiresUserActivation,
      )
    }

    private fun inlineLocalRefs(
      node: JsonObject,
      localDefs: JsonObject,
      commonDefs: JsonObject,
      visiting: MutableSet<String>,
    ): JsonObject {
      val ref = (node["\$ref"] as? JsonPrimitive)?.takeIf { it.isString }?.content
      if (ref != null && ref.startsWith("#/\$defs/")) {
        val defName = ref.removePrefix("#/\$defs/")
        if (!commonDefs.containsKey(defName) && localDefs.containsKey(defName)) {
          if (!visiting.add(defName)) return node
          val target = localDefs[defName] as? JsonObject ?: return node
          val resolvedTarget = inlineLocalRefs(target, localDefs, commonDefs, visiting)
          visiting.remove(defName)
          if (node.size == 1) return resolvedTarget
          val merged = LinkedHashMap<String, JsonElement>(resolvedTarget)
          for ((k, v) in node) {
            if (k != "\$ref") merged[k] = inlineElementLocalRefs(v, localDefs, commonDefs, visiting)
          }
          return JsonObject(merged)
        }
      }
      val out = LinkedHashMap<String, JsonElement>(node.size)
      for ((k, v) in node) {
        out[k] = inlineElementLocalRefs(v, localDefs, commonDefs, visiting)
      }
      return JsonObject(out)
    }

    private fun inlineElementLocalRefs(
      element: JsonElement,
      localDefs: JsonObject,
      commonDefs: JsonObject,
      visiting: MutableSet<String>,
    ): JsonElement =
      when (element) {
        is JsonObject -> inlineLocalRefs(element, localDefs, commonDefs, visiting)
        is JsonArray ->
          JsonArray(element.map { inlineElementLocalRefs(it, localDefs, commonDefs, visiting) })
        else -> element
      }

    private fun loadResourceJson(resourcePath: String): JsonObject {
      val stream =
        Catalog::class.java.getResourceAsStream(resourcePath)
          ?: throw IllegalStateException("Bundled A2UI resource not found: $resourcePath")
      val content = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
      return Json.parseToJsonElement(content).jsonObject
    }
  }
}
