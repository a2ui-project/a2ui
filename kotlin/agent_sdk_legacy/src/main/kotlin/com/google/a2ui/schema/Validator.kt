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

package com.google.a2ui.schema

import com.google.a2ui.exceptions.A2uiErrorDetail
import com.google.a2ui.exceptions.A2uiIntegrityException
import com.google.a2ui.exceptions.A2uiRecursionException
import com.google.a2ui.exceptions.A2uiValidationException
import com.networknt.schema.AbsoluteIri
import com.networknt.schema.InputFormat
import com.networknt.schema.Schema
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SchemaRegistryConfig
import com.networknt.schema.dialect.Dialects
import com.networknt.schema.resource.InputStreamSource
import com.networknt.schema.resource.IriResourceLoader
import com.networknt.schema.resource.ResourceLoader
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Responsible for verifying the structural and topological integrity of an A2UI payload.
 *
 * It utilizes the active [A2uiCatalog] to construct a context-aware JSON schema validator, and
 * performs advanced integrity checks including depth-limits, graph topology validations, and
 * reference resolutions for rendering capabilities.
 *
 * @param catalog The localized contextual A2UI catalog utilized for schema validation.
 */
class A2uiValidator
@JvmOverloads
constructor(
  private val catalog: A2uiCatalog,
  private val schemaMappings: Map<String, String> = emptyMap(),
) {
  private val jsonFmt = Json { prettyPrint = false }
  private val resolvedCatalogFunctionSchemas: Map<String, JsonObject> by lazy {
    collectCatalogFunctionSchemas(catalog.catalogSchema)
  }
  private val validationCatalogSchema: JsonObject by lazy {
    buildValidationCatalogSchema(catalog.catalogSchema)
  }
  private val validationCatalogSchemaString: String by lazy {
    jsonFmt.encodeToString(JsonElement.serializer(), validationCatalogSchema)
  }
  private val rawCommonTypesSchema: JsonObject? by lazy { loadRawCommonTypesSchema() }
  private val validationCommonTypesSchemaString: String? by lazy {
    rawCommonTypesSchema?.let {
      jsonFmt.encodeToString(JsonElement.serializer(), buildValidationCommonTypesSchema(it))
    }
  }
  private val shared0_9Registry: SchemaRegistry by lazy {
    SchemaRegistry.withDialect(Dialects.getDraft202012()) { builder ->
      builder.schemaIdResolvers { schemaIdResolvers ->
        schemaMappings.forEach { (prefix, target) -> schemaIdResolvers.mapPrefix(prefix, target) }
      }
      builder.resourceLoaders { resourceLoaders ->
        resourceLoaders.add(
          ResourceLoader { iri ->
            resolve0_9SchemaResource(iri)?.let { schemaJson ->
              InputStreamSource { schemaJson.byteInputStream(Charsets.UTF_8) }
            }
          }
        )
        resourceLoaders.add(IriResourceLoader.getInstance())
      }
    }
  }
  private val sharedConfig: SchemaRegistryConfig by lazy { SchemaRegistryConfig.builder().build() }
  private val subValidators = mutableMapOf<String, Schema>()
  private val validator: Schema by lazy { buildValidator() }

  private fun buildValidator(): Schema =
    if (catalog.version == A2uiVersion.VERSION_0_8) build0_8Validator() else build0_9Validator()

  private fun injectAdditionalProperties(
    schema: JsonElement,
    sourceProperties: Map<String, JsonElement>,
  ): Pair<JsonElement, Set<String>> {
    val injectedKeys = mutableSetOf<String>()

    fun recursiveInject(obj: JsonElement): JsonElement =
      when (obj) {
        is JsonObject -> {
          val newObj = mutableMapOf<String, JsonElement>()
          for ((k, v) in obj) {
            if (
              v is JsonObject && v[PROP_ADDITIONAL_PROPERTIES]?.jsonPrimitive?.booleanOrNull == true
            ) {
              if (sourceProperties.containsKey(k)) {
                injectedKeys.add(k)
                val newNode = v.toMutableMap()
                newNode[PROP_ADDITIONAL_PROPERTIES] = JsonPrimitive(false)

                val existingProps =
                  newNode[PROP_PROPERTIES] as? JsonObject ?: JsonObject(emptyMap())
                val sourceProps = sourceProperties[k] as? JsonObject ?: JsonObject(emptyMap())

                newNode[PROP_PROPERTIES] = JsonObject(existingProps + sourceProps)
                newObj[k] = JsonObject(newNode)
              } else {
                newObj[k] = recursiveInject(v)
              }
            } else {
              newObj[k] = recursiveInject(v)
            }
          }
          JsonObject(newObj)
        }
        is JsonArray -> JsonArray(obj.map { recursiveInject(it) })
        else -> obj
      }

    return recursiveInject(schema) to injectedKeys
  }

  private fun bundle0_8Schemas(): JsonObject {
    if (catalog.serverToClientSchema.isEmpty()) return JsonObject(emptyMap())

    val sourceProperties = mutableMapOf<String, JsonElement>()
    val catalogSchema = catalog.catalogSchema

    if (catalogSchema.isNotEmpty()) {
      catalogSchema[A2uiConstants.CATALOG_COMPONENTS_KEY]?.let {
        sourceProperties[PROP_COMPONENT] = it
      }
      catalogSchema[A2uiConstants.CATALOG_STYLES_KEY]?.let {
        sourceProperties[A2uiConstants.CATALOG_STYLES_KEY] = it
      }
    }

    val (bundled) = injectAdditionalProperties(catalog.serverToClientSchema, sourceProperties)
    return bundled as JsonObject
  }

  private fun build0_8Validator(): Schema {
    val bundledSchema = bundle0_8Schemas()
    val fullSchema = SchemaResourceLoader.wrapAsJsonArray(bundledSchema).toMutableMap()
    fullSchema[KEY_DOLLAR_SCHEMA] = JsonPrimitive(SCHEMA_DRAFT_2020_12)

    val baseUri =
      catalog.serverToClientSchema[KEY_DOLLAR_ID]?.jsonPrimitive?.content
        ?: A2uiConstants.BASE_SCHEMA_URL
    val baseDirUri = baseUri.substringBeforeLast("/")
    val commonTypesUri = "$baseDirUri/$FILE_COMMON_TYPES"

    val jsonFmt = Json { prettyPrint = false }

    val registry =
      SchemaRegistry.withDialect(Dialects.getDraft202012()) { builder ->
        builder.schemaIdResolvers { schemaIdResolvers ->
          schemaMappings.forEach { (prefix, target) -> schemaIdResolvers.mapPrefix(prefix, target) }
          schemaIdResolvers.mapPrefix(FILE_COMMON_TYPES, commonTypesUri)
        }
        builder.resourceLoaders { resourceLoaders ->
          resourceLoaders.add(com.networknt.schema.resource.IriResourceLoader.getInstance())
        }
        builder.schemaRegistryConfig(sharedConfig)
      }

    val schemaString = jsonFmt.encodeToString(JsonElement.serializer(), JsonObject(fullSchema))
    return registry.getSchema(schemaString, InputFormat.JSON)
  }

  private fun build0_9Validator(): Schema {
    val fullSchema =
      SchemaResourceLoader.wrapAsJsonArray(catalog.serverToClientSchema).toMutableMap()
    fullSchema[KEY_DOLLAR_SCHEMA] = JsonPrimitive(SCHEMA_DRAFT_2020_12)

    val schemaString = jsonFmt.encodeToString(JsonElement.serializer(), JsonObject(fullSchema))
    return shared0_9Registry.getSchema(schemaString, InputFormat.JSON)
  }

  /**
   * Returns [catalogSchema] with each branch of `$defs.anyFunction` allowing any object for `args`.
   *
   * Leaving the full recursive argument schemas in `anyFunction` makes `networknt` re-evaluate
   * nested calls across both `FunctionCall.properties.args` and `anyFunction.oneOf` at every level
   * of nesting. [getNestedFunctionCallErrors] validates each call's arguments in a single linear
   * pass against `#/functions/<name>` instead.
   */
  private fun buildValidationCatalogSchema(catalogSchema: JsonObject): JsonObject {
    if (catalogSchema.isEmpty()) return catalogSchema
    val defs = (catalogSchema[KEY_DOLLAR_DEFS] as? JsonObject)?.toMutableMap() ?: mutableMapOf()
    defs[DEF_ANY_FUNCTION] = buildRewrittenAnyFunction(catalogSchema, defs[DEF_ANY_FUNCTION])
    return JsonObject(catalogSchema.toMutableMap().apply { put(KEY_DOLLAR_DEFS, JsonObject(defs)) })
  }

  private fun buildRewrittenAnyFunction(
    catalogSchema: JsonObject,
    rawAnyFunction: JsonElement?,
  ): JsonObject {
    val anyFunction = rawAnyFunction as? JsonObject
    val functionsObj = catalogSchema[A2uiConstants.CATALOG_FUNCTIONS_KEY] as? JsonObject
    val branches = anyFunction?.get("oneOf") as? JsonArray
    val anyOfBranches = anyFunction?.get("anyOf") as? JsonArray
    return when {
      branches != null -> rewriteUnionBranches(anyFunction, "oneOf", branches, catalogSchema)
      anyOfBranches != null ->
        rewriteUnionBranches(anyFunction, "anyOf", anyOfBranches, catalogSchema)
      anyFunction != null -> withoutArgumentSchema(anyFunction) ?: anyFunction
      !functionsObj.isNullOrEmpty() ->
        JsonObject(
          mapOf(
            "oneOf" to
              JsonArray(functionsObj.values.map { fnDef -> withoutArgumentSchema(fnDef) ?: fnDef })
          )
        )
      else -> JsonObject(mapOf("not" to JsonObject(emptyMap())))
    }
  }

  private fun rewriteUnionBranches(
    anyFunction: JsonObject,
    keyword: String,
    branches: JsonArray,
    catalogSchema: JsonObject,
  ): JsonObject {
    val rewritten =
      branches.map { branch ->
        withoutArgumentSchema(resolveLocalRef(branch, catalogSchema) ?: branch) ?: branch
      }
    return JsonObject(anyFunction.toMutableMap().apply { put(keyword, JsonArray(rewritten)) })
  }

  private fun collectCatalogFunctionSchemas(catalogSchema: JsonObject): Map<String, JsonObject> {
    val result = mutableMapOf<String, JsonObject>()
    val functionsObj = catalogSchema[A2uiConstants.CATALOG_FUNCTIONS_KEY] as? JsonObject
    functionsObj?.forEach { (name, schema) -> if (schema is JsonObject) result[name] = schema }
    val anyFn =
      (catalogSchema[KEY_DOLLAR_DEFS] as? JsonObject)?.get(DEF_ANY_FUNCTION) as? JsonObject
    collectInlineAnyFunctionSchemas(anyFn, catalogSchema, result)
    return result
  }

  private fun collectInlineAnyFunctionSchemas(
    anyFunction: JsonObject?,
    catalogSchema: JsonObject,
    out: MutableMap<String, JsonObject>,
  ) {
    if (anyFunction == null) return
    val candidates =
      (anyFunction["oneOf"] as? JsonArray)
        ?: (anyFunction["anyOf"] as? JsonArray)
        ?: JsonArray(listOf(anyFunction))
    for (candidate in candidates) {
      val resolved = (resolveLocalRef(candidate, catalogSchema) ?: candidate) as? JsonObject
      val constName = extractConstCallName(resolved)
      if (constName != null && resolved != null && constName !in out) {
        out[constName] = resolved
      }
    }
  }

  private fun extractConstCallName(fnSchema: JsonObject?): String? {
    val props = fnSchema?.get(PROP_PROPERTIES) as? JsonObject ?: return null
    val callProp = props[PROP_CALL] as? JsonObject ?: return null
    return (callProp["const"] as? JsonPrimitive)?.takeIf { it.isString }?.content
  }

  private fun withoutArgumentSchema(definition: JsonElement?): JsonObject? {
    val defObj = definition as? JsonObject ?: return null
    val props = defObj[PROP_PROPERTIES] as? JsonObject ?: return null
    if (PROP_ARGS !in props) return null
    val newProps =
      props.toMutableMap().apply {
        put(PROP_ARGS, JsonObject(mapOf("type" to JsonPrimitive("object"))))
      }
    return JsonObject(defObj.toMutableMap().apply { put(PROP_PROPERTIES, JsonObject(newProps)) })
  }

  private fun resolveLocalRef(schema: JsonElement, document: JsonObject): JsonElement? {
    val obj = schema as? JsonObject ?: return null
    if (obj.size != 1) return null
    val ref =
      (obj[KEY_DOLLAR_REF] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
    if (!ref.startsWith("#/")) return null
    var target: JsonElement = document
    for (segment in ref.substring(2).split("/")) {
      val map = target as? JsonObject ?: return null
      val key = segment.replace("~1", "/").replace("~0", "~")
      target = map[key] ?: return null
    }
    return target
  }

  /**
   * Replaces `FunctionCall.properties.args.additionalProperties` (`anyOf[DynamicValue, object]`)
   * with its non-recursive equivalent (`{"not": {"type": "null"}}`), since any non-null JSON value
   * matches either `DynamicValue` or `{"type": "object"}` and [getNestedFunctionCallErrors] checks
   * nested calls in a single linear pass.
   */
  private fun buildValidationCommonTypesSchema(commonTypes: JsonObject): JsonObject {
    val defs = commonTypes[KEY_DOLLAR_DEFS] as? JsonObject ?: return commonTypes
    val fnCall = defs[DEF_FUNCTION_CALL] as? JsonObject ?: return commonTypes
    val props = fnCall[PROP_PROPERTIES] as? JsonObject ?: return commonTypes
    val argsObj = props[PROP_ARGS] as? JsonObject ?: return commonTypes
    val newArgs =
      JsonObject(
        argsObj.toMutableMap().apply {
          put(
            PROP_ADDITIONAL_PROPERTIES,
            JsonObject(mapOf("not" to JsonObject(mapOf("type" to JsonPrimitive("null"))))),
          )
        }
      )
    val newProps = JsonObject(props.toMutableMap().apply { put(PROP_ARGS, newArgs) })
    val newFnCall = JsonObject(fnCall.toMutableMap().apply { put(PROP_PROPERTIES, newProps) })
    val newDefs = JsonObject(defs.toMutableMap().apply { put(DEF_FUNCTION_CALL, newFnCall) })
    return JsonObject(commonTypes.toMutableMap().apply { put(KEY_DOLLAR_DEFS, newDefs) })
  }

  private fun loadRawCommonTypesSchema(): JsonObject? {
    val inMemoryDefs = catalog.commonTypesSchema[KEY_DOLLAR_DEFS] as? JsonObject
    if (!inMemoryDefs.isNullOrEmpty()) return catalog.commonTypesSchema
    return loadMappedCommonTypesSchema()
      ?: runCatching {
          SchemaResourceLoader.loadFromBundledResource(catalog.version.value, FILE_COMMON_TYPES)
        }
        .getOrNull()
  }

  private fun loadMappedCommonTypesSchema(): JsonObject? {
    val mappedUri =
      schemaMappings[FILE_COMMON_TYPES]
        ?: schemaMappings.entries.firstOrNull { it.key.endsWith("/$FILE_COMMON_TYPES") }?.value
        ?: return null
    return runCatching {
        IriResourceLoader.getInstance()
          .getResource(AbsoluteIri.of(mappedUri))
          ?.inputStream
          ?.bufferedReader(Charsets.UTF_8)
          ?.use { Json.parseToJsonElement(it.readText()) as? JsonObject }
      }
      .getOrNull()
  }

  private fun resolve0_9SchemaResource(iri: AbsoluteIri): String? {
    val iriStr = iri.toString()
    val catalogDollarId =
      (catalog.catalogSchema[KEY_DOLLAR_ID] as? JsonPrimitive)?.takeIf { it.isString }?.content
    return when {
      iriStr == FILE_CATALOG ||
        iriStr.endsWith("/$FILE_CATALOG") ||
        iriStr == schemaMappings[FILE_CATALOG] ||
        (catalogDollarId != null && iriStr == catalogDollarId) -> validationCatalogSchemaString
      iriStr == FILE_COMMON_TYPES ||
        iriStr.endsWith("/$FILE_COMMON_TYPES") ||
        iriStr == schemaMappings[FILE_COMMON_TYPES] -> validationCommonTypesSchemaString
      else -> null
    }
  }

  /**
   * Parses and validates raw A2UI JSON payload against the designated schema, throwing an
   * [IllegalArgumentException] describing any constraint or structural invalidity.
   *
   * It asserts fundamental strict JSON schemas, recursive depth boundaries, and component reference
   * integrity.
   *
   * @param a2uiJson Raw parsed A2UI response payload element to inspect.
   * @throws IllegalArgumentException If validation or referential integrity fail.
   */
  fun validate(a2uiJson: JsonElement, strictIntegrity: Boolean = true) {
    val messages = a2uiJson as? JsonArray ?: JsonArray(listOf(a2uiJson))

    // Reject payloads nested past the global depth limit before schema validation, matching the
    // validation order of the other SDKs.
    for (message in messages) {
      A2uiRecursionValidator(strictIntegrity).validateDepth(message)
    }

    if (
      catalog.version == A2uiVersion.VERSION_0_9 || catalog.version == A2uiVersion.VERSION_0_9_1
    ) {
      validate0_9Custom(messages, strictIntegrity)
    } else {
      // Basic schema validation
      val jsonFmt = Json { prettyPrint = false }
      val messagesString = jsonFmt.encodeToString(JsonElement.serializer(), messages)

      val errors = validator.validate(messagesString, InputFormat.JSON)
      if (errors.isNotEmpty()) {
        val details =
          errors.map { err ->
            val path = normalizePath(err.instanceLocation.toString(), "")
            val code = mapNetworkntErrorCode(err.keyword)
            A2uiErrorDetail(path, code, err.message)
          }
        val msg = buildString {
          append("Validation failed:")
          for (err in details) {
            append("\n  - ${err.path}: ${err.message}")
          }
        }
        throw A2uiValidationException(msg, details = details)
      }
    }

    if (strictIntegrity) {
      // Integrity validation
      val surfaceRootIds = calculateSurfaceRootIds(messages)

      for (message in messages) {
        if (message !is JsonObject) continue

        val surfaceId =
          when {
            MSG_SURFACE_UPDATE in message ->
              (message[MSG_SURFACE_UPDATE] as? JsonObject)?.get("surfaceId")?.jsonPrimitive?.content
            MSG_UPDATE_COMPONENTS in message ->
              (message[MSG_UPDATE_COMPONENTS] as? JsonObject)
                ?.get("surfaceId")
                ?.jsonPrimitive
                ?.content
            else -> null
          }

        val components =
          when {
            MSG_SURFACE_UPDATE in message ->
              (message[MSG_SURFACE_UPDATE] as? JsonObject)?.get(
                A2uiConstants.CATALOG_COMPONENTS_KEY
              ) as? JsonArray
            MSG_UPDATE_COMPONENTS in message ->
              (message[MSG_UPDATE_COMPONENTS] as? JsonObject)?.get(
                A2uiConstants.CATALOG_COMPONENTS_KEY
              ) as? JsonArray
            else -> null
          }

        components?.let {
          val rootId = surfaceRootIds[surfaceId]
          val topologyValidator = A2uiTopologyValidator(catalog, rootId)
          topologyValidator.validate(it)
        }
      }
    }

    for (message in messages) {
      if (message !is JsonObject) continue
      val recursionValidator = A2uiRecursionValidator(strictIntegrity)
      recursionValidator.validate(message)
    }
  }

  private fun validate0_9Custom(messages: JsonArray, strictIntegrity: Boolean) {
    val allErrors = mutableListOf<A2uiErrorDetail>()

    for ((idx, messageElem) in messages.withIndex()) {
      val basePath = "messages[$idx]"
      if (messageElem !is JsonObject) {
        allErrors.add(
          A2uiErrorDetail(path = basePath, code = "type_mismatch", message = "Is not an object")
        )
        continue
      }

      when {
        "createSurface" in messageElem -> {
          val valSchema = getSubValidator("CreateSurfaceMessage")
          allErrors.addAll(getFormattedErrors(valSchema, messageElem, basePath))
          allErrors.addAll(getThemeFunctionCallErrors(messageElem, basePath))
        }
        "updateComponents" in messageElem -> {
          allErrors.addAll(getUpdateComponentsErrors(messageElem, basePath))
        }
        "updateDataModel" in messageElem -> {
          val valSchema = getSubValidator("UpdateDataModelMessage")
          allErrors.addAll(getFormattedErrors(valSchema, messageElem, basePath))
        }
        "deleteSurface" in messageElem -> {
          val valSchema = getSubValidator("DeleteSurfaceMessage")
          allErrors.addAll(getFormattedErrors(valSchema, messageElem, basePath))
        }
        else -> {
          val keys = messageElem.keys.toList()
          allErrors.add(
            A2uiErrorDetail(
              path = basePath,
              code = "invalid_value",
              message = "Unknown message type with keys $keys",
            )
          )
        }
      }
    }

    if (allErrors.isNotEmpty()) {
      val msg = buildString {
        append("Validation failed:")
        for (err in allErrors) {
          append("\n  - ${err.path}: ${err.message}")
        }
      }
      throw A2uiValidationException(msg, details = allErrors)
    }
  }

  private fun getSubValidator(defName: String): Schema {
    return subValidators.getOrPut(defName) {
      val defs =
        catalog.serverToClientSchema["\$defs"] as? JsonObject
          ?: throw A2uiValidationException("No \$defs found in schema")
      val subSchema =
        defs[defName] as? JsonObject
          ?: throw A2uiValidationException("Definition $defName not found in schema")

      val tempSchema =
        JsonObject(
          mapOf(
            "\$schema" to JsonPrimitive(SCHEMA_DRAFT_2020_12),
            "\$defs" to defs,
            "\$ref" to JsonPrimitive("#/\$defs/$defName"),
          )
        )

      val jsonFmt = Json { prettyPrint = false }
      val schemaString = jsonFmt.encodeToString(JsonElement.serializer(), tempSchema)
      shared0_9Registry.getSchema(schemaString, InputFormat.JSON)
    }
  }

  private fun getFormattedErrors(
    validator: Schema,
    instance: JsonElement,
    basePath: String,
  ): List<A2uiErrorDetail> {
    val jsonFmt = Json { prettyPrint = false }
    val instanceStr = jsonFmt.encodeToString(JsonElement.serializer(), instance)
    val errors = validator.validate(instanceStr, InputFormat.JSON)

    return errors.map { err ->
      val path = normalizePath(err.instanceLocation.toString(), basePath)
      val code = mapNetworkntErrorCode(err.keyword)
      val msg = err.toString()
      val match = UNEXPECTED_PROPERTY_PATTERN.find(msg)
      val cleanMsg =
        if (match != null) {
          val prop = match.groupValues[1]
          "'$prop' was unexpected"
        } else {
          msg.removePrefix(": ").removePrefix("$.").removePrefix("$")
        }
      A2uiErrorDetail(path, code, cleanMsg)
    }
  }

  private fun getUpdateComponentsErrors(message: JsonObject, path: String): List<A2uiErrorDetail> {
    val errors = mutableListOf<A2uiErrorDetail>()

    val version = message["version"]?.jsonPrimitive?.content
    val validVersions =
      if (catalog.version == A2uiVersion.VERSION_0_9_1) setOf("v0.9", "v0.9.1") else setOf("v0.9")
    if (version !in validVersions) {
      errors.add(
        A2uiErrorDetail(
          path = normalizePath("version", path),
          code = "invalid_value",
          message = "Invalid version, expected 'v0.9'",
        )
      )
    }

    val ucElem = message["updateComponents"]
    if (ucElem !is JsonObject) {
      errors.add(
        A2uiErrorDetail(
          path = normalizePath("updateComponents", path),
          code = "type_mismatch",
          message = "Expected updateComponents to be an object",
        )
      )
      return errors
    }

    val surfaceIdElem = ucElem["surfaceId"]
    if (surfaceIdElem == null || !(surfaceIdElem is JsonPrimitive && surfaceIdElem.isString)) {
      errors.add(
        A2uiErrorDetail(
          path = normalizePath("updateComponents.surfaceId", path),
          code = "missing_field",
          message = "Invalid or missing surfaceId",
        )
      )
    }

    val componentsElem = ucElem["components"]
    if (componentsElem !is JsonArray) {
      errors.add(
        A2uiErrorDetail(
          path = normalizePath("updateComponents.components", path),
          code = "type_mismatch",
          message = "Expected components to be an array",
        )
      )
      return errors
    }

    val componentIds =
      componentsElem.mapNotNull { (it as? JsonObject)?.get("id")?.jsonPrimitive?.content }
    val duplicateIds = componentIds.groupingBy { it }.eachCount().filter { it.value > 1 }.keys
    if (duplicateIds.isNotEmpty()) {
      errors.add(
        A2uiErrorDetail(
          path = normalizePath("updateComponents.components", path),
          code = "invalid_value",
          message = "Duplicate component IDs found: ${duplicateIds.joinToString()}",
        )
      )
    }
    for ((idx, compElem) in componentsElem.withIndex()) {
      if (compElem !is JsonObject) {
        errors.add(
          A2uiErrorDetail(
            path = normalizePath("updateComponents.components[$idx]", path),
            code = "type_mismatch",
            message = "Component is not an object",
          )
        )
        continue
      }
      val compId = (compElem["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
      val compPath =
        if (compId != null) {
          "$path.updateComponents.components[id='$compId']"
        } else {
          "$path.updateComponents.components[$idx]"
        }
      errors.addAll(getSingleComponentErrors(compElem, compPath))
    }

    return errors
  }

  private fun getSingleComponentErrors(comp: JsonObject, path: String): List<A2uiErrorDetail> {
    val compType =
      comp["component"]?.jsonPrimitive?.content
        ?: return listOf(
          A2uiErrorDetail(
            path = path,
            code = "missing_field",
            message = "Missing 'component' field",
          )
        )

    val catalogSchema = catalog.catalogSchema
    val componentsObj =
      catalogSchema[A2uiConstants.CATALOG_COMPONENTS_KEY] as? JsonObject
        ?: return listOf(
          A2uiErrorDetail(
            path = path,
            code = "invalid_value",
            message = "Catalog schema or components missing",
          )
        )

    val compSchema =
      componentsObj[compType]
        ?: return listOf(
          A2uiErrorDetail(
            path = path,
            code = "invalid_value",
            message = "Unknown component: $compType",
          )
        )

    val validator =
      subValidators.getOrPut("comp_$compType") {
        val escapedCompType = compType.replace("~", "~0").replace("/", "~1")
        val tempSchema =
          JsonObject(
            validationCatalogSchema.toMutableMap() +
              mapOf(
                KEY_DOLLAR_SCHEMA to JsonPrimitive(SCHEMA_DRAFT_2020_12),
                KEY_DOLLAR_REF to
                  JsonPrimitive("#/${A2uiConstants.CATALOG_COMPONENTS_KEY}/$escapedCompType"),
              )
          )
        val schemaString = jsonFmt.encodeToString(JsonElement.serializer(), tempSchema)
        shared0_9Registry.getSchema(schemaString, InputFormat.JSON)
      }

    val errors = getFormattedErrors(validator, comp, path).toMutableList()
    if (compSchema is JsonObject) {
      errors.addAll(getNestedFunctionCallErrors(comp, compSchema, path))
    }
    return errors
  }

  private fun getThemeFunctionCallErrors(
    messageElem: JsonObject,
    basePath: String,
  ): List<A2uiErrorDetail> {
    val themeObj = (messageElem["createSurface"] as? JsonObject)?.get("theme") as? JsonObject
    val themeSchema =
      (catalog.catalogSchema[KEY_DOLLAR_DEFS] as? JsonObject)?.get("theme") as? JsonObject
    if (themeObj == null || themeSchema == null || !schemaReferencesFunctionCall(themeSchema)) {
      return emptyList()
    }
    return getNestedFunctionCallErrors(themeObj, themeSchema, "$basePath.createSurface.theme")
  }

  private fun schemaReferencesFunctionCall(rootSchema: JsonObject): Boolean {
    val queue = ArrayDeque<JsonElement>()
    queue.addLast(rootSchema)
    while (queue.isNotEmpty()) {
      val current = queue.removeFirst()
      if (isDirectFunctionRefNode(current, queue)) return true
    }
    return false
  }

  private fun isDirectFunctionRefNode(node: JsonElement, queue: ArrayDeque<JsonElement>): Boolean {
    if (node is JsonArray) {
      node.forEach { queue.addLast(it) }
      return false
    }
    if (node !is JsonObject) return false
    val ref = (node[KEY_DOLLAR_REF] as? JsonPrimitive)?.takeIf { it.isString }?.content
    if (ref != null && isFunctionBearingRef(ref)) return true
    if (ref != null && ref.startsWith("#/")) {
      resolveLocalRef(node, catalog.catalogSchema)?.let { queue.addLast(it) }
    }
    node.values.forEach { queue.addLast(it) }
    return false
  }

  private fun isFunctionBearingRef(ref: String): Boolean =
    FUNCTION_SLOT_REF_SUFFIXES.any { ref.endsWith(it) } ||
      COMPOSITE_FUNCTION_REF_SUFFIXES.any { ref.endsWith(it) } ||
      ref.contains("/${A2uiConstants.CATALOG_FUNCTIONS_KEY}/")

  private fun getFunctionSubValidator(fnName: String, fnSchema: JsonObject): Schema {
    return subValidators.getOrPut("func_$fnName") {
      val functionsObj = catalog.catalogSchema[A2uiConstants.CATALOG_FUNCTIONS_KEY] as? JsonObject
      val tempSchema =
        if (functionsObj != null && fnName in functionsObj) {
          val escapedFnName = fnName.replace("~", "~0").replace("/", "~1")
          JsonObject(
            validationCatalogSchema.toMutableMap() +
              mapOf(
                KEY_DOLLAR_SCHEMA to JsonPrimitive(SCHEMA_DRAFT_2020_12),
                KEY_DOLLAR_REF to
                  JsonPrimitive("#/${A2uiConstants.CATALOG_FUNCTIONS_KEY}/$escapedFnName"),
              )
          )
        } else {
          buildInlineFunctionSubSchema(fnSchema)
        }
      val schemaString = jsonFmt.encodeToString(JsonElement.serializer(), tempSchema)
      shared0_9Registry.getSchema(schemaString, InputFormat.JSON)
    }
  }

  private fun buildInlineFunctionSubSchema(fnSchema: JsonObject): JsonObject {
    val map = fnSchema.toMutableMap()
    map[KEY_DOLLAR_SCHEMA] = JsonPrimitive(SCHEMA_DRAFT_2020_12)
    validationCatalogSchema[KEY_DOLLAR_ID]?.let { map.putIfAbsent(KEY_DOLLAR_ID, it) }
    validationCatalogSchema[KEY_DOLLAR_DEFS]?.let { map.putIfAbsent(KEY_DOLLAR_DEFS, it) }
    return JsonObject(map)
  }

  private data class SchemaWalkItem(
    val elem: JsonElement,
    val schema: JsonObject,
    val doc: JsonObject,
    val path: String,
    val refDepth: Int = 0,
  )

  /**
   * Walks [rootObj] alongside [rootSchema] in a single linear pass, validating only objects at
   * schema positions that admit `FunctionCall` so literal maps carrying a `"call"` key in themes,
   * untyped parameters, or custom object properties are never mistaken for function calls.
   */
  private fun getNestedFunctionCallErrors(
    rootObj: JsonObject,
    rootSchema: JsonObject,
    basePath: String,
  ): List<A2uiErrorDetail> {
    val errors = mutableListOf<A2uiErrorDetail>()
    val validatedPaths = mutableSetOf<String>()
    val stack = ArrayDeque<SchemaWalkItem>()
    stack.addLast(SchemaWalkItem(rootObj, rootSchema, catalog.catalogSchema, basePath))

    while (stack.isNotEmpty()) {
      processSchemaWalkItem(stack.removeLast(), stack, validatedPaths, errors)
    }
    return errors
  }

  private fun processSchemaWalkItem(
    item: SchemaWalkItem,
    stack: ArrayDeque<SchemaWalkItem>,
    validatedPaths: MutableSet<String>,
    errors: MutableList<A2uiErrorDetail>,
  ) {
    if (isFunctionCallSlotSchema(item.schema)) {
      if (item.elem is JsonObject) {
        validateCallAtSlot(item.elem, item.path, stack, validatedPaths, errors)
      }
      return
    }
    if (enqueueDereferencedSchema(item, stack)) return
    enqueueSchemaCombinators(item, stack)
    if (item.elem is JsonObject) enqueueSchemaObjectChildren(item.elem, item, stack)
    if (item.elem is JsonArray) enqueueSchemaArrayChildren(item.elem, item, stack)
  }

  private fun isFunctionCallSlotSchema(schema: JsonObject): Boolean {
    val ref = (schema[KEY_DOLLAR_REF] as? JsonPrimitive)?.takeIf { it.isString }?.content
    if (ref != null) {
      return FUNCTION_SLOT_REF_SUFFIXES.any { ref.endsWith(it) } ||
        ref.contains("/${A2uiConstants.CATALOG_FUNCTIONS_KEY}/")
    }
    val oneOf = schema["oneOf"] as? JsonArray ?: return false
    return oneOf.any { branch ->
      val branchRef =
        ((branch as? JsonObject)?.get(KEY_DOLLAR_REF) as? JsonPrimitive)
          ?.takeIf { it.isString }
          ?.content
      branchRef != null && branchRef.endsWith("/$DEF_ANY_FUNCTION")
    }
  }

  private fun validateCallAtSlot(
    obj: JsonObject,
    path: String,
    stack: ArrayDeque<SchemaWalkItem>,
    validatedPaths: MutableSet<String>,
    errors: MutableList<A2uiErrorDetail>,
  ) {
    val callName = nonEmptyCallName(obj) ?: return
    if (!validatedPaths.add(path)) return
    val fnSchema = resolvedCatalogFunctionSchemas[callName] ?: return
    errors.addAll(getFormattedErrors(getFunctionSubValidator(callName, fnSchema), obj, path))
    val argsObj = obj[PROP_ARGS] as? JsonObject ?: return
    val argsSchema = (fnSchema[PROP_PROPERTIES] as? JsonObject)?.get(PROP_ARGS) as? JsonObject
    if (argsSchema != null) {
      stack.addLast(SchemaWalkItem(argsObj, argsSchema, catalog.catalogSchema, "$path.$PROP_ARGS"))
    }
  }

  private fun nonEmptyCallName(obj: JsonObject): String? {
    val primitive = obj[PROP_CALL] as? JsonPrimitive ?: return null
    if (!primitive.isString || primitive.content.isEmpty()) return null
    return primitive.content
  }

  private fun enqueueDereferencedSchema(
    item: SchemaWalkItem,
    stack: ArrayDeque<SchemaWalkItem>,
  ): Boolean {
    val ref =
      (item.schema[KEY_DOLLAR_REF] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: return false
    if (item.refDepth >= MAX_SCHEMA_REF_HOPS) return true
    val resolved = dereferenceSchemaRef(ref, item.doc) ?: return true
    stack.addLast(
      SchemaWalkItem(item.elem, resolved.first, resolved.second, item.path, item.refDepth + 1)
    )
    return true
  }

  private fun dereferenceSchemaRef(
    ref: String,
    currentDoc: JsonObject,
  ): Pair<JsonObject, JsonObject>? {
    if (ref.startsWith("#/")) {
      val target = resolvePointerInDoc(ref.substring(2), currentDoc) as? JsonObject ?: return null
      return target to currentDoc
    }
    val hashIdx = ref.indexOf("#/")
    if (hashIdx < 0) return null
    val docPart = ref.substring(0, hashIdx)
    val pointer = ref.substring(hashIdx + 2)
    val targetDoc = selectReferencedDoc(docPart) ?: return null
    val target = resolvePointerInDoc(pointer, targetDoc) as? JsonObject ?: return null
    return target to targetDoc
  }

  private fun selectReferencedDoc(docPart: String): JsonObject? =
    when {
      docPart == FILE_COMMON_TYPES || docPart.endsWith("/$FILE_COMMON_TYPES") ->
        rawCommonTypesSchema
      docPart == FILE_CATALOG || docPart.endsWith("/$FILE_CATALOG") -> catalog.catalogSchema
      else -> null
    }

  private fun resolvePointerInDoc(pointer: String, document: JsonObject): JsonElement? {
    var target: JsonElement = document
    for (segment in pointer.split("/")) {
      val map = target as? JsonObject ?: return null
      target = map[segment.replace("~1", "/").replace("~0", "~")] ?: return null
    }
    return target
  }

  private fun enqueueSchemaCombinators(item: SchemaWalkItem, stack: ArrayDeque<SchemaWalkItem>) {
    for (keyword in COMBINATOR_KEYWORDS) {
      val branches = item.schema[keyword] as? JsonArray ?: continue
      for (idx in branches.indices.reversed()) {
        val branchObj = branches[idx] as? JsonObject ?: continue
        stack.addLast(SchemaWalkItem(item.elem, branchObj, item.doc, item.path))
      }
    }
  }

  private fun enqueueSchemaObjectChildren(
    obj: JsonObject,
    item: SchemaWalkItem,
    stack: ArrayDeque<SchemaWalkItem>,
  ) {
    val props = item.schema[PROP_PROPERTIES] as? JsonObject
    val additionalSchema = item.schema[PROP_ADDITIONAL_PROPERTIES] as? JsonObject
    for ((key, value) in obj.entries.toList().asReversed()) {
      val childSchema = (props?.get(key) as? JsonObject) ?: additionalSchema ?: continue
      stack.addLast(SchemaWalkItem(value, childSchema, item.doc, "${item.path}.$key"))
    }
  }

  private fun enqueueSchemaArrayChildren(
    arr: JsonArray,
    item: SchemaWalkItem,
    stack: ArrayDeque<SchemaWalkItem>,
  ) {
    val itemsSchema = item.schema["items"] as? JsonObject ?: return
    for (idx in arr.indices.reversed()) {
      stack.addLast(SchemaWalkItem(arr[idx], itemsSchema, item.doc, "${item.path}.$idx"))
    }
  }

  private fun calculateSurfaceRootIds(messages: JsonArray): Map<String, String> {
    val surfaceRootIds = mutableMapOf<String, String>()
    for (message in messages) {
      if (message !is JsonObject) continue

      if (MSG_BEGIN_RENDERING in message) {
        val beginRendering = message[MSG_BEGIN_RENDERING] as? JsonObject
        val msgSurfaceId =
          requireNotNull(beginRendering?.get("surfaceId")?.jsonPrimitive?.content) {
            "surfaceId is required in beginRendering"
          }
        if (!surfaceRootIds.containsKey(msgSurfaceId)) {
          val rootId =
            when (val rootElem = beginRendering[ROOT]) {
              is JsonPrimitive -> rootElem.content
              is JsonObject -> rootElem[ID]?.jsonPrimitive?.content ?: ROOT
              else -> ROOT
            }
          surfaceRootIds[msgSurfaceId] = rootId
        }
      }

      if (MSG_CREATE_SURFACE in message) {
        val createSurface = message[MSG_CREATE_SURFACE] as? JsonObject
        val msgSurfaceId =
          requireNotNull(createSurface?.get("surfaceId")?.jsonPrimitive?.content) {
            "surfaceId is required in createSurface"
          }
        surfaceRootIds.putIfAbsent(msgSurfaceId, ROOT)
      }
    }
    return surfaceRootIds
  }

  /** Validates component graph topology, including cycles, orphans, and missing references. */
  private class A2uiTopologyValidator(
    private val catalog: A2uiCatalog,
    private val rootId: String?,
  ) {

    fun validate(components: JsonArray) {
      val refFieldsMap = extractComponentRefFields()
      validateComponentIntegrity(components, refFieldsMap)
      validateTopology(components, refFieldsMap)
    }

    /**
     * Analyzes the catalog schema to identify which fields in each component type act as references
     * to other components (either single IDs or lists of IDs).
     *
     * @return A map where the key is the component type name, and the value is a Pair of:
     *     - Set of property names that are single component references.
     *     - Set of property names that are list/collection component references.
     */
    private fun extractComponentRefFields(): Map<String, Pair<Set<String>, Set<String>>> {
      return TopologyAnalyzer.extractComponentRefFields(catalog)
    }

    private fun validateComponentIntegrity(
      components: JsonArray,
      refFieldsMap: Map<String, Pair<Set<String>, Set<String>>>,
    ) {
      val ids = mutableSetOf<String>()

      for (compElem in components) {
        val comp = compElem as? JsonObject ?: continue
        val compId = comp[ID]?.jsonPrimitive?.content ?: continue

        if (!ids.add(compId)) {
          throw A2uiIntegrityException("Duplicate component ID: $compId")
        }
      }

      if (rootId != null && rootId !in ids) {
        throw A2uiIntegrityException("Missing root component: No component has id='$rootId'")
      }

      for (compElem in components) {
        val comp = compElem as? JsonObject ?: continue
        for ((refId, fieldName) in SchemaInspector.getComponentReferences(comp, refFieldsMap)) {
          if (refId !in ids) {
            val cId = comp[ID]?.jsonPrimitive?.content
            throw A2uiIntegrityException(
              "Component '$cId' references non-existent component '$refId' in field '$fieldName'"
            )
          }
        }
      }
    }

    private fun validateTopology(
      components: JsonArray,
      refFieldsMap: Map<String, Pair<Set<String>, Set<String>>>,
    ) {
      val adjList = mutableMapOf<String, MutableList<String>>()
      val allIds = mutableSetOf<String>()

      for (compElem in components) {
        val comp = compElem as? JsonObject ?: continue
        SchemaInspector.updateAdjacencyList(allIds, adjList, refFieldsMap, comp)
      }

      if (rootId != null) {
        val visited = if (rootId in allIds) SchemaInspector.visit(rootId, adjList) else emptySet()

        val orphans = allIds - visited
        if (orphans.isNotEmpty()) {
          val firstOrphan = orphans.minOf { it }
          throw A2uiIntegrityException("Component '$firstOrphan' is not reachable from '$rootId'")
        }
      } else {
        // No root provided: traverse everything to check for cycles
        val visited = mutableSetOf<String>()
        for (nodeId in allIds.sorted()) {
          if (nodeId !in visited) {
            visited += SchemaInspector.visit(nodeId, adjList)
          }
        }
      }
    }
  }

  /** Validates JSON payload recursion depth and path syntax. */
  private class A2uiRecursionValidator(private val strictIntegrity: Boolean = true) {
    fun validate(data: JsonElement) = traverse(data, 0, checkPaths = true)

    /** Checks the nesting depth alone, leaving path syntax to [validate]. */
    fun validateDepth(data: JsonElement) = traverse(data, 0, checkPaths = false)

    private fun traverse(item: JsonElement, globalDepth: Int, checkPaths: Boolean) {
      if (globalDepth > MAX_GLOBAL_DEPTH) {
        throw A2uiRecursionException("Global recursion limit exceeded: Depth > $MAX_GLOBAL_DEPTH")
      }

      when (item) {
        is JsonArray -> item.forEach { traverse(it, globalDepth + 1, checkPaths) }
        is JsonObject -> {
          (item[PATH] as? JsonPrimitive)
            ?.takeIf { checkPaths && it.isString }
            ?.let { pathElem ->
              if (!pathElem.content.matches(JSON_POINTER_PATTERN)) {
                val details =
                  listOf(
                    A2uiErrorDetail(
                      path = "path",
                      code = "invalid_pointer",
                      message = "Invalid path syntax: '${pathElem.content}'",
                    )
                  )
                throw A2uiValidationException(
                  "Invalid path syntax: '${pathElem.content}'",
                  details = details,
                )
              }
            }

          item.values.forEach { traverse(it, globalDepth + 1, checkPaths) }
        }
        else -> {}
      }
    }
  }

  private fun normalizePath(path: String, basePath: String): String {
    var clean = path.trim().removePrefix("$").removePrefix(".").removePrefix("/")
    clean = clean.replace("/", ".")
    val full = if (basePath.isEmpty()) clean else "$basePath.$clean"
    val normalized = full.replace(INDEX_PATH_PATTERN, ".$1").replace("..", ".")
    return normalized.trim().removePrefix(".").removeSuffix(".")
  }

  private fun mapNetworkntErrorCode(type: String): String {
    return when (type) {
      "required" -> "missing_field"
      "type" -> "type_mismatch"
      "additionalProperties" -> "extra_field"
      "const",
      "enum" -> "invalid_value"
      else -> "invalid_value"
    }
  }

  private companion object {
    private val INDEX_PATH_PATTERN = Regex("\\[(\\d+)\\]")
    private val UNEXPECTED_PROPERTY_PATTERN =
      Regex(
        "property '(.*?)' is not defined in the schema and the schema does not allow additional properties"
      )
    private val JSON_POINTER_PATTERN =
      Regex("^(?:(?:/(?:[^~/]|~[01])*)*|(?:[^~/]|~[01])+(?:/(?:[^~/]|~[01])*)*)$")
    private const val ROOT = "root"
    private const val ID = "id"
    private const val PATH = "path"

    private const val MSG_SURFACE_UPDATE = "surfaceUpdate"
    private const val MSG_UPDATE_COMPONENTS = "updateComponents"
    private const val MSG_BEGIN_RENDERING = "beginRendering"
    private const val MSG_CREATE_SURFACE = "createSurface"

    // JSON Schema standard keys
    private const val KEY_DOLLAR_SCHEMA = "\$schema"
    private const val KEY_DOLLAR_ID = "\$id"
    private const val KEY_DOLLAR_DEFS = "\$defs"
    private const val KEY_DOLLAR_REF = "\$ref"
    private const val PROP_PROPERTIES = "properties"
    private const val PROP_ADDITIONAL_PROPERTIES = "additionalProperties"
    private const val PROP_CALL = "call"
    private const val PROP_ARGS = "args"
    private const val DEF_ANY_FUNCTION = "anyFunction"
    private const val DEF_FUNCTION_CALL = "FunctionCall"

    private const val MAX_SCHEMA_REF_HOPS = 16
    private val COMBINATOR_KEYWORDS = listOf("allOf", "anyOf", "oneOf")
    private val FUNCTION_SLOT_REF_SUFFIXES =
      listOf(
        "/FunctionCall",
        "/DynamicString",
        "/DynamicNumber",
        "/DynamicBoolean",
        "/DynamicStringList",
        "/DynamicValue",
        "/anyFunction",
      )
    private val COMPOSITE_FUNCTION_REF_SUFFIXES =
      listOf("/Action", "/Checkable", "/CheckRule", "/AccessibilityAttributes", "/ComponentCommon")

    // Types & Drafts
    private const val SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"
    private const val FILE_COMMON_TYPES = "common_types.json"
    private const val FILE_CATALOG = "catalog.json"
  }
}
