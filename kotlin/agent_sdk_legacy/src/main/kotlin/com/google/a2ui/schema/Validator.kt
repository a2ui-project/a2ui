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
  private val validationCatalogSchema: JsonObject by lazy {
    buildValidationCatalogSchema(catalog.catalogSchema)
  }
  private val validationCatalogSchemaString: String by lazy {
    jsonFmt.encodeToString(JsonElement.serializer(), validationCatalogSchema)
  }
  private val validationCommonTypesSchemaString: String? by lazy {
    loadValidationCommonTypesSchemaString()
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
    val functionsObj = catalogSchema[A2uiConstants.CATALOG_FUNCTIONS_KEY] as? JsonObject
    val anyFunction = defs[DEF_ANY_FUNCTION] as? JsonObject
    val branches = anyFunction?.get("oneOf") as? JsonArray

    val rewrittenAnyFunction =
      when {
        branches != null ->
          JsonObject(
            anyFunction.toMutableMap().apply {
              put(
                "oneOf",
                JsonArray(
                  branches.map { branch ->
                    withoutArgumentSchema(resolveLocalRef(branch, catalogSchema)) ?: branch
                  }
                ),
              )
            }
          )
        !functionsObj.isNullOrEmpty() ->
          JsonObject(
            mapOf(
              "oneOf" to
                JsonArray(
                  functionsObj.values.map { fnDef -> withoutArgumentSchema(fnDef) ?: fnDef }
                )
            )
          )
        else -> JsonObject(mapOf("not" to JsonObject(emptyMap())))
      }

    defs[DEF_ANY_FUNCTION] = rewrittenAnyFunction
    return JsonObject(catalogSchema.toMutableMap().apply { put(KEY_DOLLAR_DEFS, JsonObject(defs)) })
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

  private fun loadValidationCommonTypesSchemaString(): String? {
    val inMemoryDefs = catalog.commonTypesSchema[KEY_DOLLAR_DEFS] as? JsonObject
    val rawCommonTypes: JsonObject? =
      if (!inMemoryDefs.isNullOrEmpty()) {
        catalog.commonTypesSchema
      } else {
        val mappedUri =
          schemaMappings[FILE_COMMON_TYPES]
            ?: schemaMappings.entries.firstOrNull { it.key.endsWith("/$FILE_COMMON_TYPES") }?.value
        val fromMapped =
          mappedUri?.let { uri ->
            runCatching {
                IriResourceLoader.getInstance()
                  .getResource(AbsoluteIri.of(uri))
                  ?.inputStream
                  ?.bufferedReader(Charsets.UTF_8)
                  ?.use { Json.parseToJsonElement(it.readText()) as? JsonObject }
              }
              .getOrNull()
          }
        fromMapped
          ?: runCatching {
              SchemaResourceLoader.loadFromBundledResource(catalog.version.value, FILE_COMMON_TYPES)
            }
            .getOrNull()
      }
    return rawCommonTypes?.let {
      jsonFmt.encodeToString(JsonElement.serializer(), buildValidationCommonTypesSchema(it))
    }
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
          val themeObj = (messageElem["createSurface"] as? JsonObject)?.get("theme") as? JsonObject
          if (themeObj != null) {
            allErrors.addAll(
              getNestedFunctionCallErrors(themeObj, "$basePath.createSurface.theme", emptySet())
            )
          }
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
    errors.addAll(getNestedFunctionCallErrors(comp, path))
    return errors
  }

  private fun getFunctionSubValidator(fnName: String): Schema {
    return subValidators.getOrPut("func_$fnName") {
      val escapedFnName = fnName.replace("~", "~0").replace("/", "~1")
      val tempSchema =
        JsonObject(
          validationCatalogSchema.toMutableMap() +
            mapOf(
              KEY_DOLLAR_SCHEMA to JsonPrimitive(SCHEMA_DRAFT_2020_12),
              KEY_DOLLAR_REF to
                JsonPrimitive("#/${A2uiConstants.CATALOG_FUNCTIONS_KEY}/$escapedFnName"),
            )
        )
      val schemaString = jsonFmt.encodeToString(JsonElement.serializer(), tempSchema)
      shared0_9Registry.getSchema(schemaString, InputFormat.JSON)
    }
  }

  /**
   * Walks [rootObj] once in a single linear pass, validating every function call against its full
   * schema in `catalogSchema["functions"]` (whose nested `anyFunction` references are stubbed to
   * non-recursive envelopes).
   */
  private fun getNestedFunctionCallErrors(
    rootObj: JsonObject,
    basePath: String,
    skipRootKeys: Set<String> = setOf("id", "component"),
  ): List<A2uiErrorDetail> {
    val errors = mutableListOf<A2uiErrorDetail>()
    val functionsObj = catalog.catalogSchema[A2uiConstants.CATALOG_FUNCTIONS_KEY] as? JsonObject
    val stack = ArrayDeque<Pair<JsonElement, String>>()

    for ((propKey, propVal) in rootObj.entries.toList().asReversed()) {
      if (propKey !in skipRootKeys) {
        stack.addLast(propVal to "$basePath.$propKey")
      }
    }

    while (stack.isNotEmpty()) {
      val (elem, currentPath) = stack.removeLast()
      when (elem) {
        is JsonArray -> {
          for (idx in elem.indices.reversed()) {
            stack.addLast(elem[idx] to "$currentPath.$idx")
          }
        }
        is JsonObject -> {
          val callName =
            (elem[PROP_CALL] as? JsonPrimitive)
              ?.takeIf { it.isString }
              ?.content
              ?.takeIf { it.isNotEmpty() }
          if (callName != null) {
            if (functionsObj == null || callName !in functionsObj) {
              errors.add(
                A2uiErrorDetail(
                  path = currentPath,
                  code = "invalid_value",
                  message = "Unknown function: $callName",
                )
              )
            } else {
              val funcValidator = getFunctionSubValidator(callName)
              errors.addAll(getFormattedErrors(funcValidator, elem, currentPath))
            }
            val argsObj = elem[PROP_ARGS] as? JsonObject
            if (argsObj != null) {
              for ((argKey, argVal) in argsObj.entries.toList().asReversed()) {
                stack.addLast(argVal to "$currentPath.$PROP_ARGS.$argKey")
              }
            }
          } else {
            for ((k, v) in elem.entries.toList().asReversed()) {
              stack.addLast(v to "$currentPath.$k")
            }
          }
        }
        else -> {}
      }
    }

    return errors
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

    // Types & Drafts
    private const val SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"
    private const val FILE_COMMON_TYPES = "common_types.json"
    private const val FILE_CATALOG = "catalog.json"
  }
}
