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

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Pure-Kotlin A2UI v1.0 JSON Schema and dynamic directive validator.
 *
 * Validates component envelopes, custom component properties, nested `@call` / `@path` directives,
 * `@index` system function calls, `callRendererFunction` permissions, and nesting limits without
 * pulling external JSON Schema runtime libraries.
 */
internal class SchemaValidator(private val catalogs: List<Catalog>) {
  private val catalogsById: Map<String, Catalog> = catalogs.associateBy { it.id }
  private val commonTypes: JsonObject =
    catalogs.firstOrNull()?.commonTypesSchema ?: Catalog.v1CommonTypes()
  private val commonDefs: JsonObject =
    (commonTypes["\$defs"] as? JsonObject) ?: JsonObject(emptyMap())

  companion object {
    const val MAX_JSON_DEPTH = 50
    const val MAX_FUNCTION_CALL_DEPTH = 5
    const val MAX_FUNCTION_CALL_ARGS = 1000

    private val V1_MIXIN_PAIRS =
      listOf(
        "@catalogId" to "catalogId",
        "@metadata" to "metadata",
        "@accessibility" to "accessibility",
        "@checks" to "checks",
      )
    private val RESERVED_DIRECTIVES = setOf("@path", "@call")
    private val FUNCTION_CALL_KEYS = setOf("@call", "catalogId", "args")
  }

  fun checkCatalogExists(catalogId: String, context: String) {
    if (catalogId !in catalogsById) {
      throw A2uiValidationError(
        "$context references unknown catalog '$catalogId'. Available: ${catalogsById.keys}."
      )
    }
  }

  fun checkNestingDepth(element: JsonElement, depth: Int = 0) {
    if (depth > MAX_JSON_DEPTH) {
      throw A2uiRecursionError("Maximum JSON nesting depth ($MAX_JSON_DEPTH) exceeded.")
    }
    when (element) {
      is JsonObject -> {
        for (v in element.values) checkNestingDepth(v, depth + 1)
      }
      is JsonArray -> {
        for (item in element) checkNestingDepth(item, depth + 1)
      }
      else -> {}
    }
  }

  fun validateSurfaceMetadata(metadata: JsonObject?, surfaceId: String) {
    if (metadata == null) return
    checkNestingDepth(metadata)
    val unknown = metadata.keys - setOf("extensions")
    if (unknown.isNotEmpty()) {
      throw A2uiValidationError("Surface '$surfaceId' metadata contains unknown key(s): $unknown.")
    }
    val extensions = metadata["extensions"] ?: return
    val extObj =
      extensions as? JsonObject
        ?: throw A2uiValidationError("Surface '$surfaceId' metadata.extensions must be an object.")
    for (key in extObj.keys) {
      if (!Uax31Identifier.isValidIdentifier(key)) {
        throw A2uiValidationError(
          "Surface '$surfaceId' metadata extension key '$key' is not a valid UAX #31 identifier."
        )
      }
    }
  }

  fun validateDataModelUpdate(path: String?, value: JsonElement) {
    checkNestingDepth(value)
    if (path != null && path.isNotEmpty()) {
      if (!isValidJsonPointerOrRelativePath(path, requireLeadingSlash = true)) {
        throw A2uiValidationError("Invalid JSON Pointer path '$path' in updateDataModel.")
      }
    }
    if ((path == null || path == "" || path == "/") && value !is JsonObject) {
      throw A2uiValidationError(
        "Root dataModel update ('${path ?: "/"}') requires a JSON object value."
      )
    }
  }

  fun validateCallRendererFunction(msg: CallRendererFunctionMessage, surfaceCatalogId: String?) {
    checkNestingDepth(msg.callFunction)
    checkFunctionCallDepth(msg.callFunction, 0)
    if (msg.functionCallId.isEmpty()) {
      throw A2uiValidationError("Invalid empty functionCallId.")
    }
    val callName =
      (msg.callFunction["@call"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw A2uiValidationError(
          "callRendererFunction.callFunction must declare string '@call'."
        )
    if (callName.startsWith("@")) {
      throw A2uiValidationError(
        "System function '$callName' cannot be invoked via callRendererFunction."
      )
    }
    val catalogId =
      (msg.callFunction["catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw A2uiValidationError(
          "callRendererFunction.callFunction must declare string 'catalogId'."
        )
    val catalog =
      catalogsById[catalogId]
        ?: throw A2uiValidationError(
          "callRendererFunction references unknown catalog '$catalogId'."
        )
    val unknownFields = msg.callFunction.keys - FUNCTION_CALL_KEYS
    if (unknownFields.isNotEmpty()) {
      throw A2uiValidationError(
        "Function call '$callName' has unexpected field(s): $unknownFields."
      )
    }
    val fnApi =
      catalog.functions[callName]
        ?: throw A2uiValidationError("Catalog '$catalogId' declares no function named '$callName'.")
    if (fnApi.allowedCallers == AllowedCallers.RENDERER_ONLY) {
      throw A2uiValidationError(
        "Function '$callName' in catalog '$catalogId' has allowedCallers='rendererOnly' and may not be called by the agent."
      )
    }
    if (fnApi.requiresUserActivation) {
      throw A2uiValidationError(
        "Function '$callName' in catalog '$catalogId' sets requiresUserActivation=true and may not be called by the agent."
      )
    }
    val rawArgs = msg.callFunction["args"]
    val argsObj =
      when (rawArgs) {
        null -> JsonObject(emptyMap())
        is JsonObject -> rawArgs
        else -> throw A2uiValidationError("Function call '$callName' 'args' must be a JSON object.")
      }
    validateFunctionCall(
      name = callName,
      args = argsObj,
      catalog = catalog,
      defaultSurfaceCatalogId = surfaceCatalogId,
      rendererCall = false,
      path = "/callRendererFunction/callFunction",
    )
  }

  fun validateComponent(component: JsonObject, surfaceCatalogId: String?) {
    checkNestingDepth(component)
    val idPrim = component["id"] as? JsonPrimitive
    if (idPrim == null || !idPrim.isString || idPrim.content.isEmpty()) {
      throw A2uiValidationError("Component is missing a non-empty string 'id'.")
    }
    val compId = idPrim.content
    if (!Uax31Identifier.isValidIdentifier(compId)) {
      throw A2uiValidationError(
        "Component id '$compId' must be a valid UAX #31 identifier.",
        path = "/id",
      )
    }

    val typePrim = component["component"] as? JsonPrimitive
    if (typePrim == null || !typePrim.isString || typePrim.content.isEmpty()) {
      throw A2uiValidationError("Component '$compId' is missing a string 'component' type.")
    }
    val compType = typePrim.content
    if (compType == "Surface") {
      throw A2uiValidationError("Component '$compId' cannot use reserved type 'Surface'.")
    }
    if (!Uax31Identifier.isValidIdentifier(compType)) {
      throw A2uiValidationError(
        "Component type '$compType' must be a valid UAX #31 identifier.",
        path = "/component",
      )
    }

    val explicitAtCatalog =
      if ("@catalogId" in component) {
        val p = component["@catalogId"] as? JsonPrimitive
        if (p == null || !p.isString || p.content.isEmpty()) {
          throw A2uiValidationError("Component '$compId' has an invalid '@catalogId'.")
        }
        p.content
      } else {
        null
      }

    // Resolve the catalog this component belongs to.
    val resolvedCatalogId =
      explicitAtCatalog
        ?: surfaceCatalogId
        ?: throw A2uiValidationError(
          "Component '$compId' ($compType) must specify '@catalogId' when its surface has no default catalog."
        )
    val catalog =
      catalogsById[resolvedCatalogId]
        ?: throw A2uiValidationError(
          "Component '$compId' ($compType) references unknown catalog '$resolvedCatalogId'."
        )
    val compApi =
      catalog.components[compType]
        ?: throw A2uiValidationError(
          "Catalog '${catalog.id}' declares no component named '$compType'."
        )

    val customProps = extractCustomComponentProperties(compApi.schema)
    val isCheckable = isSchemaCheckable(compApi.schema)

    for ((atKey, bareKey) in V1_MIXIN_PAIRS) {
      if (bareKey !in customProps && atKey in component && bareKey in component) {
        throw A2uiValidationError(
          "Component '$compId' cannot specify both '$atKey' and legacy '$bareKey'."
        )
      }
      // In strict v1.0 wire validation, bare envelope mixins (not declared as custom properties)
      // are disallowed by agent_to_renderer.json (`unevaluatedProperties: false`).
      if (bareKey !in customProps && bareKey in component) {
        throw A2uiValidationError(
          "Component '$compId' ($compType) uses unprefixed '$bareKey' instead of '$atKey' in v1.0."
        )
      }
    }

    if (!isCheckable && "@checks" in component) {
      throw A2uiValidationError(
        "Component '$compId' ($compType) does not support '@checks' in catalog '${catalog.id}'."
      )
    }

    for (key in component.keys) {
      if (
        isUnescapedAtDirective(key) &&
          key !in setOf("@catalogId", "@metadata", "@accessibility", "@checks")
      ) {
        throw A2uiValidationError(
          "Component '$compId' ($compType) contains unrecognized directive '$key'."
        )
      }
    }

    // Check function call depth and nested directives across non-metadata fields.
    val defaultCallCatalogId = surfaceCatalogId ?: resolvedCatalogId
    for ((key, value) in component) {
      if (key == "@metadata") continue
      checkFunctionCallDepth(value, 0)
      validateNestedDirectivesAndCalls(
        value = value,
        path = "/$key",
        componentId = compId,
        defaultCatalogId = defaultCallCatalogId,
        rendererCall = true,
      )
    }

    // Validate envelope fields when present.
    component["@metadata"]?.let { meta ->
      val metaObj =
        meta as? JsonObject
          ?: throw A2uiValidationError("Component '$compId' '@metadata' must be an object.")
      validateSurfaceMetadata(metaObj, compId)
    }
    component["@accessibility"]?.let { acc ->
      val accSchema = commonDefs["AccessibilityAttributes"] as? JsonObject
      if (accSchema != null) {
        validateAgainstSchema(acc, accSchema, catalog, "/@accessibility")
      }
    }
    component["@checks"]?.let { checks ->
      val checksArr =
        checks as? JsonArray
          ?: throw A2uiValidationError("Component '$compId' '@checks' must be an array.")
      val checkRuleSchema = commonDefs["CheckRule"] as? JsonObject
      for ((idx, item) in checksArr.withIndex()) {
        if (checkRuleSchema != null) {
          validateAgainstSchema(item, checkRuleSchema, catalog, "/@checks/$idx")
        }
      }
    }

    // Build custom-property view of the component and validate against component schema.
    val envelopeKeys =
      setOf("id", "component", "@catalogId", "@metadata", "@accessibility", "@checks")
    val targetProps =
      JsonObject(
        buildMap {
          put("component", JsonPrimitive(compType))
          for ((k, v) in component) {
            if (k !in envelopeKeys) put(k, v)
          }
        }
      )
    validateComponentTargetAgainstSchema(
      targetProps,
      compApi.schema,
      customProps,
      catalog,
      compId,
      compType,
    )
  }

  private fun validateComponentTargetAgainstSchema(
    target: JsonObject,
    schema: JsonObject,
    declaredCustomProps: Set<String>,
    catalog: Catalog,
    compId: String,
    compType: String,
  ) {
    validateAgainstSchema(target, schema, catalog, "")
    val allowsAdditional = (schema["additionalProperties"] as? JsonPrimitive)?.booleanOrNull == true
    if (!allowsAdditional && declaredCustomProps.isNotEmpty()) {
      for (key in target.keys) {
        if (key != "component" && key != "id" && key !in declaredCustomProps) {
          throw A2uiValidationError(
            "Component '$compId' ($compType) has unknown property '$key' in catalog '${catalog.id}'."
          )
        }
      }
    }
  }

  private fun checkFunctionCallDepth(element: JsonElement, currentCallDepth: Int) {
    when (element) {
      is JsonObject -> {
        val isCall = (element["@call"] as? JsonPrimitive)?.isString == true
        val nextDepth = if (isCall) currentCallDepth + 1 else currentCallDepth
        if (nextDepth > MAX_FUNCTION_CALL_DEPTH) {
          throw A2uiRecursionError(
            "Maximum function call nesting depth ($MAX_FUNCTION_CALL_DEPTH) exceeded."
          )
        }
        for (v in element.values) checkFunctionCallDepth(v, nextDepth)
      }
      is JsonArray -> {
        for (item in element) checkFunctionCallDepth(item, currentCallDepth)
      }
      else -> {}
    }
  }

  private fun validateNestedDirectivesAndCalls(
    value: JsonElement,
    path: String,
    componentId: String?,
    defaultCatalogId: String?,
    rendererCall: Boolean,
  ) {
    when (value) {
      is JsonArray -> {
        for ((i, item) in value.withIndex()) {
          validateNestedDirectivesAndCalls(
            item,
            "$path/$i",
            componentId,
            defaultCatalogId,
            rendererCall,
          )
        }
      }
      is JsonObject -> {
        for (key in value.keys) {
          if (isUnescapedAtDirective(key) && key !in RESERVED_DIRECTIVES) {
            throw A2uiValidationError(
              "Unrecognized reserved protocol directive '$key' at '$path/$key'.",
              code = "INVALID_RESERVED_KEY",
              path = "$path/$key",
            )
          }
        }

        if ("@path" in value && value.size == 1) {
          val pathVal = value["@path"] as? JsonPrimitive
          if (pathVal == null || !pathVal.isString) {
            throw A2uiValidationError("Invalid '@path' data binding at '$path'.")
          }
          if (!isValidJsonPointerOrRelativePath(pathVal.content, requireLeadingSlash = false)) {
            throw A2uiValidationError(
              "Invalid JSON Pointer '${pathVal.content}' in '@path' at '$path'."
            )
          }
          return
        }

        if ("@call" in value) {
          val callPrim = value["@call"] as? JsonPrimitive
          if (callPrim == null || !callPrim.isString || callPrim.content.isEmpty()) {
            throw A2uiValidationError(
              "Function call at '$path' must declare non-empty string '@call'."
            )
          }
          val fnName = callPrim.content
          val unknownKeys = value.keys - FUNCTION_CALL_KEYS
          if (unknownKeys.isNotEmpty()) {
            throw A2uiValidationError(
              "Function call '$fnName' at '$path' has unexpected field(s): $unknownKeys."
            )
          }
          val rawArgs = value["args"]
          val argsObj =
            when (rawArgs) {
              null -> JsonObject(emptyMap())
              is JsonObject -> rawArgs
              else ->
                throw A2uiValidationError(
                  "Function call '$fnName' at '$path' has non-object 'args'."
                )
            }
          if (fnName.startsWith("@")) {
            validateSystemFunctionCall(
              value,
              fnName,
              argsObj,
              path,
              defaultCatalogId,
              componentId,
              rendererCall,
            )
            return
          }
          val explicitCatElement = value["catalogId"]
          val callCatId =
            if (explicitCatElement != null) {
              val p = explicitCatElement as? JsonPrimitive
              if (p == null || !p.isString || p.content.isEmpty()) {
                throw A2uiValidationError(
                  "Function call '$fnName' at '$path' has invalid 'catalogId'."
                )
              }
              p.content
            } else {
              defaultCatalogId
                ?: throw A2uiValidationError(
                  "Function call '$fnName' at '$path' must specify 'catalogId' when its surface has no default catalog."
                )
            }
          val callCatalog =
            catalogsById[callCatId]
              ?: throw A2uiValidationError(
                "Function call '$fnName' at '$path' references unknown catalog '$callCatId'."
              )
          validateFunctionCall(
            name = fnName,
            args = argsObj,
            catalog = callCatalog,
            defaultSurfaceCatalogId = defaultCatalogId,
            rendererCall = rendererCall,
            componentId = componentId,
            path = path,
          )
          return
        }

        for ((k, v) in value) {
          validateNestedDirectivesAndCalls(
            v,
            "$path/$k",
            componentId,
            defaultCatalogId,
            rendererCall,
          )
        }
      }
      else -> {}
    }
  }

  private fun validateSystemFunctionCall(
    callObj: JsonObject,
    fnName: String,
    argsObj: JsonObject,
    path: String,
    defaultCatalogId: String?,
    componentId: String?,
    rendererCall: Boolean,
  ) {
    if ("catalogId" in callObj) {
      throw A2uiValidationError(
        "System function '$fnName' at '$path' must not specify 'catalogId'."
      )
    }
    if (fnName != "@index") {
      throw A2uiValidationError("Unknown system function '$fnName' at '$path'.")
    }
    for ((k, v) in argsObj) {
      if (k != "offset") {
        throw A2uiValidationError(
          "System function '@index' at '$path' accepts only 'offset', got '$k'."
        )
      }
      validateNestedDirectivesAndCalls(
        v,
        "$path/args/$k",
        componentId,
        defaultCatalogId,
        rendererCall,
      )
      val offsetPrim = v as? JsonPrimitive
      if (offsetPrim != null && (offsetPrim.isString || offsetPrim.doubleOrNull == null)) {
        throw A2uiValidationError(
          "System function '@index' argument 'offset' must be a DynamicNumber at '$path/args/offset'."
        )
      }
      if (v is JsonArray || v is JsonNull) {
        throw A2uiValidationError(
          "System function '@index' argument 'offset' must be a DynamicNumber at '$path/args/offset'."
        )
      }
      if (v is JsonObject && "@path" !in v && "@call" !in v) {
        throw A2uiValidationError(
          "System function '@index' argument 'offset' must be a DynamicNumber at '$path/args/offset'."
        )
      }
    }
  }

  private fun validateFunctionCall(
    name: String,
    args: JsonObject,
    catalog: Catalog,
    defaultSurfaceCatalogId: String?,
    rendererCall: Boolean,
    componentId: String? = null,
    path: String = "",
  ) {
    if (args.size > MAX_FUNCTION_CALL_ARGS) {
      throw A2uiValidationError(
        "Function call '$name' exceeds maximum allowed argument count ($MAX_FUNCTION_CALL_ARGS)."
      )
    }
    if (!Uax31Identifier.isValidIdentifier(name)) {
      throw A2uiValidationError("Function name '$name' must be a valid UAX #31 identifier.")
    }
    for ((argName, argVal) in args) {
      if (!Uax31Identifier.isValidIdentifier(argName)) {
        throw A2uiValidationError(
          "Function argument '$argName' in '$name' must be a valid UAX #31 identifier."
        )
      }
      validateNestedDirectivesAndCalls(
        argVal,
        "$path/args/$argName",
        componentId,
        defaultSurfaceCatalogId ?: catalog.id,
        rendererCall,
      )
    }
    val fnApi =
      catalog.functions[name]
        ?: throw A2uiValidationError(
          "Unrecognized function '$name': Catalog '${catalog.id}' declares no function named '$name'."
        )
    if (rendererCall && fnApi.allowedCallers == AllowedCallers.AGENT_ONLY) {
      throw A2uiValidationError(
        "Function '$name' in catalog '${catalog.id}' has allowedCallers='agentOnly' and may not be called by a component."
      )
    }
    validateAgainstSchema(args, fnApi.argsSchema, catalog, "$path/args")
  }

  private fun validateAgainstSchema(
    value: JsonElement,
    rawSchema: JsonObject,
    catalog: Catalog,
    path: String,
    visitingRefs: Set<String> = emptySet(),
  ) {
    val schema = resolveRef(rawSchema, catalog, visitingRefs) ?: return

    // Combinators
    (schema["allOf"] as? JsonArray)?.let { subs ->
      for (sub in subs) {
        val subObj = sub as? JsonObject ?: continue
        if (isComponentEnvelopeMixinRef(subObj)) continue
        validateAgainstSchema(value, subObj, catalog, path, visitingRefs)
      }
    }
    (schema["anyOf"] as? JsonArray)?.let { subs ->
      val matched =
        subs.any { sub ->
          val subObj = sub as? JsonObject ?: return@any true
          runCatching { validateAgainstSchema(value, subObj, catalog, path, visitingRefs) }
            .isSuccess
        }
      if (!matched) {
        throw A2uiValidationError("Value at '$path' did not match anyOf schema constraints.")
      }
    }
    (schema["oneOf"] as? JsonArray)?.let { subs ->
      var matches = 0
      val subReasons = ArrayList<String>()
      for (sub in subs) {
        val subObj = sub as? JsonObject ?: continue
        val res = runCatching { validateAgainstSchema(value, subObj, catalog, path, visitingRefs) }
        if (res.isSuccess) {
          matches++
        } else {
          subReasons.add(res.exceptionOrNull()?.message.orEmpty())
        }
      }
      if (matches != 1) {
        throw A2uiValidationError(
          "Value at '$path' matched $matches schemas in oneOf (expected 1): ${subReasons.joinToString(" | ")}"
        )
      }
    }
    (schema["not"] as? JsonObject)?.let { notSchema ->
      val matched =
        runCatching { validateAgainstSchema(value, notSchema, catalog, path, visitingRefs) }
          .isSuccess
      if (matched) {
        throw A2uiValidationError("Value at '$path' matched forbidden 'not' schema.")
      }
    }
    (schema["if"] as? JsonObject)?.let { ifSchema ->
      val condMatched =
        runCatching { validateAgainstSchema(value, ifSchema, catalog, path, visitingRefs) }
          .isSuccess
      if (condMatched) {
        (schema["then"] as? JsonObject)?.let { thenSchema ->
          validateAgainstSchema(value, thenSchema, catalog, path, visitingRefs)
        }
      } else {
        (schema["else"] as? JsonObject)?.let { elseSchema ->
          validateAgainstSchema(value, elseSchema, catalog, path, visitingRefs)
        }
      }
    }

    // Const & enum
    schema["const"]?.let { constVal ->
      if (!jsonValuesEqual(value, constVal)) {
        throw A2uiValidationError("Expected const $constVal at '$path', got $value.")
      }
    }
    (schema["enum"] as? JsonArray)?.let { enumArr ->
      if (enumArr.none { jsonValuesEqual(value, it) }) {
        throw A2uiValidationError("Value $value at '$path' is not in enum $enumArr.")
      }
    }

    // Type check
    val expectedTypes = extractTypes(schema["type"])
    if (expectedTypes.isNotEmpty() && !matchesAnyType(value, expectedTypes)) {
      throw A2uiValidationError(
        "Value $value at '$path' does not match expected JSON type(s) $expectedTypes."
      )
    }

    // Type-specific validations
    when (value) {
      is JsonPrimitive -> {
        if (value.isString) {
          (schema["minLength"] as? JsonPrimitive)?.longOrNull?.let { minLen ->
            if (value.content.codePointCount(0, value.content.length) < minLen) {
              throw A2uiValidationError(
                "String '${value.content}' at '$path' is shorter than minLength $minLen."
              )
            }
          }
          (schema["pattern"] as? JsonPrimitive)?.contentOrNull?.let { pat ->
            if (!matchesSchemaPattern(value.content, pat)) {
              throw A2uiValidationError(
                "String '${value.content}' at '$path' does not match pattern '$pat'."
              )
            }
          }
        } else {
          val numVal = value.doubleOrNull
          if (numVal != null) {
            (schema["minimum"] as? JsonPrimitive)?.doubleOrNull?.let { min ->
              if (numVal < min) {
                throw A2uiValidationError("Number $numVal at '$path' is less than minimum $min.")
              }
            }
            (schema["maximum"] as? JsonPrimitive)?.doubleOrNull?.let { max ->
              if (numVal > max) {
                throw A2uiValidationError("Number $numVal at '$path' exceeds maximum $max.")
              }
            }
          }
        }
      }
      is JsonArray -> {
        (schema["minItems"] as? JsonPrimitive)?.longOrNull?.let { minItems ->
          if (value.size < minItems) {
            throw A2uiValidationError("Array at '$path' has fewer than $minItems items.")
          }
        }
        if ((schema["uniqueItems"] as? JsonPrimitive)?.booleanOrNull == true) {
          for (i in value.indices) {
            for (j in i + 1 until value.size) {
              if (jsonValuesEqual(value[i], value[j])) {
                throw A2uiValidationError("Array at '$path' contains duplicate items.")
              }
            }
          }
        }
        (schema["items"] as? JsonObject)?.let { itemSchema ->
          for ((idx, item) in value.withIndex()) {
            validateAgainstSchema(item, itemSchema, catalog, "$path/$idx", visitingRefs)
          }
        }
      }
      is JsonObject -> {
        (schema["required"] as? JsonArray)?.let { reqArr ->
          for (reqItem in reqArr) {
            val reqKey = (reqItem as? JsonPrimitive)?.contentOrNull ?: continue
            if (reqKey == "id") continue
            if (reqKey !in value) {
              throw A2uiValidationError("Missing required property '$reqKey' at '$path'.")
            }
          }
        }
        (schema["propertyNames"] as? JsonObject)?.let { propNamesSchema ->
          for (k in value.keys) {
            validateAgainstSchema(
              JsonPrimitive(k),
              propNamesSchema,
              catalog,
              "$path/$k",
              visitingRefs,
            )
          }
        }
        val propsObj = schema["properties"] as? JsonObject
        if (propsObj != null) {
          for ((propName, propSchemaEl) in propsObj) {
            val propVal = value[propName] ?: continue
            val propSchema = propSchemaEl as? JsonObject ?: continue
            validateAgainstSchema(propVal, propSchema, catalog, "$path/$propName", visitingRefs)
          }
        }
        val patternPropsObj = schema["patternProperties"] as? JsonObject
        val matchedKeys = HashSet<String>()
        if (propsObj != null) {
          matchedKeys.addAll(propsObj.keys.intersect(value.keys))
        }
        if (patternPropsObj != null) {
          for ((pat, patSchemaEl) in patternPropsObj) {
            val patSchema = patSchemaEl as? JsonObject ?: continue
            for ((k, v) in value) {
              if (matchesSchemaPattern(k, pat)) {
                matchedKeys.add(k)
                validateAgainstSchema(v, patSchema, catalog, "$path/$k", visitingRefs)
              }
            }
          }
        }
        val addProps = schema["additionalProperties"]
        if (addProps != null) {
          when (addProps) {
            is JsonPrimitive -> {
              if (addProps.booleanOrNull == false) {
                val extras = value.keys - matchedKeys
                if (extras.isNotEmpty()) {
                  throw A2uiValidationError(
                    "Unexpected property(s) $extras at '$path' (additionalProperties=false)."
                  )
                }
              }
            }
            is JsonObject -> {
              for ((k, v) in value) {
                if (k !in matchedKeys) {
                  validateAgainstSchema(v, addProps, catalog, "$path/$k", visitingRefs)
                }
              }
            }
            else -> {}
          }
        }
        val unevaluated = (schema["unevaluatedProperties"] as? JsonPrimitive)?.booleanOrNull
        if (
          unevaluated == false &&
            addProps == null &&
            "allOf" !in schema &&
            "oneOf" !in schema &&
            "anyOf" !in schema
        ) {
          val extras = value.keys - matchedKeys
          if (extras.isNotEmpty()) {
            throw A2uiValidationError(
              "Unexpected property(s) $extras at '$path' (unevaluatedProperties=false)."
            )
          }
        }
      }
      is JsonNull -> {}
    }
  }

  private fun resolveRef(
    schema: JsonObject,
    catalog: Catalog,
    visitingRefs: Set<String>,
  ): JsonObject? {
    val ref = (schema["\$ref"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return schema
    if (ref in visitingRefs) return null
    val target: JsonObject? =
      when {
        ref == "catalog.json#/\$defs/anyFunction" ->
          JsonObject(
            mapOf(
              "type" to JsonPrimitive("object"),
              "properties" to
                JsonObject(
                  mapOf(
                    "@call" to
                      JsonObject(
                        mapOf(
                          "type" to JsonPrimitive("string"),
                          "not" to JsonObject(mapOf("pattern" to JsonPrimitive("^@"))),
                        )
                      )
                  )
                ),
              "required" to JsonArray(listOf(JsonPrimitive("@call"))),
            )
          )
        ref.contains("common_types.json#/\$defs/") -> {
          val defName = ref.substringAfter("common_types.json#/\$defs/")
          resolveNestedPointer(commonDefs, defName)
        }
        ref.startsWith("#/\$defs/") -> {
          val defName = ref.removePrefix("#/\$defs/")
          val localDefs = (catalog.rawSchema["\$defs"] as? JsonObject) ?: JsonObject(emptyMap())
          resolveNestedPointer(localDefs, defName) ?: resolveNestedPointer(commonDefs, defName)
        }
        else -> null
      }
    if (target == null) return null
    val resolvedTarget = resolveRef(target, catalog, visitingRefs + ref) ?: return null
    if (schema.size == 1) return resolvedTarget
    val merged = LinkedHashMap<String, JsonElement>(resolvedTarget)
    for ((k, v) in schema) {
      if (k != "\$ref") merged[k] = v
    }
    return JsonObject(merged)
  }

  private fun resolveNestedPointer(defs: JsonObject, pathAfterDefs: String): JsonObject? {
    var cur: JsonElement = defs
    for (part in pathAfterDefs.split('/')) {
      val key = unescapeJsonPointerSegment(part)
      cur = (cur as? JsonObject)?.get(key) ?: return null
    }
    return cur as? JsonObject
  }

  private fun matchesSchemaPattern(value: String, pattern: String): Boolean {
    if (pattern.contains("\\p{XID_Start}")) {
      return if (pattern.startsWith("^@?")) {
        val stripped = if (value.startsWith("@")) value.substring(1) else value
        Uax31Identifier.isValidIdentifier(stripped)
      } else {
        Uax31Identifier.isValidIdentifier(value)
      }
    }
    return Regex(pattern).containsMatchIn(value)
  }

  private fun extractTypes(typeElement: JsonElement?): List<String> =
    when (typeElement) {
      is JsonPrimitive -> if (typeElement.isString) listOf(typeElement.content) else emptyList()
      is JsonArray ->
        typeElement.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
      else -> emptyList()
    }

  private fun matchesAnyType(value: JsonElement, types: List<String>): Boolean =
    types.any { t ->
      when (t) {
        "null" -> value is JsonNull
        "object" -> value is JsonObject
        "array" -> value is JsonArray
        "string" -> value is JsonPrimitive && value.isString
        "boolean" -> value is JsonPrimitive && !value.isString && value.booleanOrNull != null
        "integer" ->
          value is JsonPrimitive &&
            !value.isString &&
            value.booleanOrNull == null &&
            (value.longOrNull != null ||
              (value.doubleOrNull != null &&
                value.doubleOrNull!!.isFinite() &&
                value.doubleOrNull!! % 1.0 == 0.0))
        "number" -> value is JsonPrimitive && !value.isString && value.doubleOrNull != null
        else -> true
      }
    }

  private fun isComponentEnvelopeMixinRef(sub: JsonObject): Boolean {
    val ref = (sub["\$ref"] as? JsonPrimitive)?.contentOrNull ?: return false
    return ref.endsWith("/ComponentCommon") || ref.endsWith("/Checkable")
  }

  private fun isSchemaCheckable(schema: JsonObject): Boolean {
    val ref = (schema["\$ref"] as? JsonPrimitive)?.contentOrNull
    if (ref != null && ref.endsWith("/Checkable")) return true
    for (key in listOf("allOf", "anyOf", "oneOf")) {
      val arr = schema[key] as? JsonArray ?: continue
      if (arr.any { it is JsonObject && isSchemaCheckable(it) }) return true
    }
    return false
  }

  private fun extractCustomComponentProperties(schema: JsonObject): Set<String> {
    val props = LinkedHashSet<String>()
    fun walk(node: JsonObject) {
      if (isComponentEnvelopeMixinRef(node)) return
      (node["properties"] as? JsonObject)?.keys?.let { keys ->
        for (k in keys) {
          if (k != "id" && k != "component") props.add(k)
        }
      }
      for (comb in listOf("allOf", "anyOf", "oneOf")) {
        val arr = node[comb] as? JsonArray ?: continue
        for (sub in arr) {
          if (sub is JsonObject) walk(sub)
        }
      }
    }
    walk(schema)
    return props
  }

  private fun isUnescapedAtDirective(key: String): Boolean =
    key.startsWith("@") && !key.startsWith("@@")
}
