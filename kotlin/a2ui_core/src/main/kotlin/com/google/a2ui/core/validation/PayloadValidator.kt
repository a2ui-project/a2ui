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

package com.google.a2ui.core.validation

import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.common.Uax31Identifier
import com.google.a2ui.core.exceptions.A2uiValidationError
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Validation strictness controls (`a2ui_core.blueprint.md` §3.C). */
data class ValidationConfig(
  val targetVersion: String? = null,
  val allowOrphanComponents: Boolean = false,
  val allowDanglingReferences: Boolean = false,
  val allowMissingRoot: Boolean = false,
  val allowUnknownElements: Boolean = false,
  val allowedMessages: Set<String>? = null,
)

val STRICT_VALIDATION = ValidationConfig()

val RELAXED_VALIDATION =
  ValidationConfig(
    allowOrphanComponents = true,
    allowDanglingReferences = true,
    allowMissingRoot = true,
    allowUnknownElements = true,
  )

/**
 * Single-catalog item validator (`a2ui_core.blueprint.md` §3.C `PayloadValidator`).
 *
 * Scoped strictly to one [catalog]; multi-catalog routing belongs to `MessageProcessor`.
 */
class PayloadValidator(
  val catalog: Catalog<*, *>,
  val validationConfig: ValidationConfig = STRICT_VALIDATION,
) {
  fun validateComponent(component: JsonObject) {
    val id =
      (component["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw A2uiValidationError("Component missing required string 'id'")
    val typeName =
      (component["component"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw A2uiValidationError("Component '$id' missing required string 'component'")

    if (catalog.protocolVersion?.isV1OrLater == true) {
      if (!Uax31Identifier.isValid(id)) {
        throw A2uiValidationError("Component id '$id' is not a valid UAX #31 identifier")
      }
      if (typeName == "Surface") {
        throw A2uiValidationError("Component type 'Surface' is reserved")
      }
    }

    val compApi = catalog.components[typeName]
    if (compApi == null) {
      if (!validationConfig.allowUnknownElements) {
        throw A2uiValidationError("Unknown component '$typeName' in catalog '${catalog.id}'")
      }
      return
    }

    val requiredProps = extractRequiredProperties(compApi.schema)
    for (req in requiredProps) {
      if (req != "component" && req !in component) {
        throw A2uiValidationError("Component '$id' ($typeName) missing required property '$req'")
      }
    }
  }

  fun validateFunction(name: String, args: JsonObject) {
    if (name.startsWith("@")) return
    if (!Uax31Identifier.isValid(name)) {
      throw A2uiValidationError("Function name '$name' is not a valid UAX #31 identifier")
    }
    val fnApi = catalog.functions[name]
    if (fnApi == null && !validationConfig.allowUnknownElements) {
      throw A2uiValidationError("Unknown function '$name' in catalog '${catalog.id}'")
    }
    for (argKey in args.keys) {
      if (!Uax31Identifier.isValid(argKey)) {
        throw A2uiValidationError("Function '$name' argument '$argKey' violates UAX #31")
      }
    }
  }

  fun validateTheme(surfaceProperties: JsonObject?) {
    if (surfaceProperties != null && catalog.protocolVersion?.isV1OrLater == true) {
      throw A2uiValidationError("Protocol v1.0 removed 'theme' from createSurface")
    }
  }

  private fun extractRequiredProperties(schema: JsonObject): Set<String> {
    val result = linkedSetOf<String>()
    (schema["required"] as? JsonArray)?.forEach { elem ->
      (elem as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { result.add(it) }
    }
    (schema["allOf"] as? JsonArray)?.forEach { branch ->
      if (branch is JsonObject) result.addAll(extractRequiredProperties(branch))
    }
    return result
  }
}
