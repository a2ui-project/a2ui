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

import com.google.a2ui.exceptions.A2uiCatalogException
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiConstants
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/**
 * Effective protocol version declared in [A2uiCatalog.catalogSchema], falling back to
 * [A2uiCatalog.version].
 */
internal val A2uiCatalog.protocolVersion: String
  get() {
    val protoElement = catalogSchema["protocolVersion"]
    if (protoElement is JsonPrimitive && protoElement.isString) {
      return protoElement.content
    }
    return version.value
  }

/**
 * Returns a copy of this catalog keeping only the specified components and/or functions. Unlike
 * [A2uiCatalog.withPruning], an empty set keeps nothing rather than acting as a no-op.
 */
internal fun A2uiCatalog.prune(
  allowedComponents: Set<String>? = null,
  allowedFunctions: Set<String>? = null,
): A2uiCatalog {
  if (allowedComponents == null && allowedFunctions == null) return this
  val schemaCopy = catalogSchema.toMutableMap()

  if (allowedComponents != null) {
    (schemaCopy[A2uiConstants.CATALOG_COMPONENTS_KEY] as? JsonObject)?.let { components ->
      schemaCopy[A2uiConstants.CATALOG_COMPONENTS_KEY] =
        JsonObject(components.filterKeys { it in allowedComponents })
    }
  }

  if (allowedFunctions != null) {
    when (val functionsEl = schemaCopy[A2uiConstants.CATALOG_FUNCTIONS_KEY]) {
      is JsonObject -> {
        schemaCopy[A2uiConstants.CATALOG_FUNCTIONS_KEY] =
          JsonObject(functionsEl.filterKeys { it in allowedFunctions })
      }
      is JsonArray -> {
        schemaCopy[A2uiConstants.CATALOG_FUNCTIONS_KEY] =
          JsonArray(
            functionsEl.filter { fn ->
              val name = (fn as? JsonObject)?.get("name")?.jsonPrimitive?.content
              name != null && name in allowedFunctions
            }
          )
      }
      else -> {}
    }
  }

  (schemaCopy["\$defs"] as? JsonObject)?.let { defsElement ->
    val newDefs = defsElement.toMutableMap()
    if (allowedComponents != null) {
      (newDefs["anyComponent"] as? JsonObject)?.let { anyCompElement ->
        newDefs["anyComponent"] =
          pruneAnyEntryOneOf(anyCompElement, allowedComponents, "#/components/")
      }
    }
    if (allowedFunctions != null) {
      (newDefs["anyFunction"] as? JsonObject)?.let { anyFnElement ->
        newDefs["anyFunction"] = pruneAnyEntryOneOf(anyFnElement, allowedFunctions, "#/functions/")
      }
    }
    schemaCopy["\$defs"] = JsonObject(newDefs)
  }

  return copy(catalogSchema = JsonObject(schemaCopy))
}

private fun pruneAnyEntryOneOf(
  anyEntrySchema: JsonObject,
  allowedNames: Set<String>,
  refPrefix: String,
): JsonObject {
  val oneOfArray = anyEntrySchema["oneOf"] as? JsonArray ?: return anyEntrySchema
  val filteredOneOf =
    oneOfArray.filter { item ->
      val itemObj = item as? JsonObject ?: return@filter false
      val ref = itemObj["\$ref"]?.jsonPrimitive?.content
      if (ref != null && ref.startsWith(refPrefix)) {
        return@filter ref.removePrefix(refPrefix) in allowedNames
      }
      val nameConst =
        ((itemObj["properties"] as? JsonObject)?.get("name") as? JsonObject)
          ?.get("const")
          ?.jsonPrimitive
          ?.content
      nameConst != null && nameConst in allowedNames
    }
  return JsonObject(anyEntrySchema.toMutableMap().apply { put("oneOf", JsonArray(filteredOneOf)) })
}

/** Normalizes protocol version strings (e.g. `"1.0"`, `"v1.0"` -> `"1.0"`, `"0.9"` -> `"v0.9"`). */
internal fun normalizeExpressTargetVersion(version: String): String {
  val stripped = version.trim().removePrefix("v")
  val parts = stripped.split(".")
  val major = parts.firstOrNull()?.toIntOrNull()
  return if (major != null && major >= 1) {
    stripped
  } else {
    "v$stripped"
  }
}

/** Returns true when [version] denotes A2UI v1.0 or later. */
internal fun isExpressV1OrLater(version: String): Boolean {
  val stripped = version.trim().removePrefix("v")
  val major = stripped.split(".").firstOrNull()?.toIntOrNull()
  return major == null || major >= 1
}

private fun protocolReleaseLine(version: String): String {
  val stripped = version.trim().removePrefix("v")
  val parts = stripped.split(".")
  return if (parts.size >= 2) "${parts[0]}.${parts[1]}" else stripped
}

/**
 * Validates that [catalogs] is non-empty, contains unique `catalogId`s, does not mix incompatible
 * protocol release lines, and only activates multiple catalogs from v1.0 onward.
 */
internal fun validateExpressCatalogs(catalogs: List<A2uiCatalog>) {
  if (catalogs.isEmpty()) {
    throw A2uiCatalogException("At least one catalog must be provided.")
  }

  val seenIds = mutableSetOf<String>()
  val releaseLines = mutableSetOf<String>()
  for (catalog in catalogs) {
    val cid =
      try {
        catalog.catalogId
      } catch (e: IllegalArgumentException) {
        throw A2uiCatalogException(e.message ?: "Catalog missing catalogId", e)
      }
    if (!seenIds.add(cid)) {
      throw A2uiCatalogException("Duplicate catalog ID '$cid' in active catalogs.")
    }
    releaseLines.add(protocolReleaseLine(catalog.protocolVersion))
  }

  if (releaseLines.size > 1) {
    val versions = catalogs.map { it.protocolVersion }.distinct().sorted()
    throw A2uiCatalogException(
      "Active catalogs mix incompatible protocol versions: ${versions.joinToString(", ")}"
    )
  }

  if (catalogs.size > 1 && !isExpressV1OrLater(catalogs.first().protocolVersion)) {
    throw A2uiCatalogException(
      "Multiple active catalogs require protocol version 1.0 or later " +
        "(got '${catalogs.first().protocolVersion}')."
    )
  }
}

/** Resolves the effective Express target version (`"1.0"`, `"v0.9"`, `"v0.9.1"`, etc.). */
internal fun resolveExpressVersion(
  catalogs: List<A2uiCatalog>,
  explicitVersion: String? = null,
): String {
  validateExpressCatalogs(catalogs)
  return normalizeExpressTargetVersion(explicitVersion ?: catalogs.first().protocolVersion)
}
