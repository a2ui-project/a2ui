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

@file:JvmName("BasicCatalogApi")

package com.google.a2ui.basic_catalog

import com.google.a2ui.schema.A2uiCatalogProvider
import com.google.a2ui.schema.A2uiConstants
import com.google.a2ui.schema.A2uiVersion
import com.google.a2ui.schema.CatalogConfig
import com.google.a2ui.schema.SchemaResourceLoader
import com.google.a2ui.schema.resolveExamplesPath
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A provider that loads A2UI JSON schemas and specifications from bundled package resources or
 * local paths with established fallbacks.
 *
 * @param version The A2UI conceptual version, e.g., "0.9".
 */
class BundledCatalogProvider(private val version: A2uiVersion) : A2uiCatalogProvider {

  override fun load(): JsonObject {
    val specMap = BasicCatalog.BASIC_CATALOG_PATHS[version] ?: emptyMap()
    val relPath = specMap[A2uiConstants.CATALOG_SCHEMA_KEY] ?: ""
    val filename =
      if (version == A2uiVersion.VERSION_0_9) {
        relPath.substringAfter("specification/v0_9/")
      } else if (version == A2uiVersion.VERSION_0_9_1) {
        relPath.substringAfter("specification/v0_9_1/")
      } else {
        relPath.substringAfterLast('/')
      }

    val resource =
      SchemaResourceLoader.loadFromBundledResource(version.value, filename)?.toMutableMap()
        ?: mutableMapOf()

    if (A2uiConstants.CATALOG_ID_KEY !in resource) {
      specMap[A2uiConstants.CATALOG_SCHEMA_KEY]?.let { path ->
        val catalogFile = path.replace("/json/", "/")
        resource[A2uiConstants.CATALOG_ID_KEY] =
          JsonPrimitive(A2uiConstants.BASE_SCHEMA_URL + catalogFile)
      }
    }

    if ("\$schema" !in resource) {
      resource["\$schema"] = JsonPrimitive("https://json-schema.org/draft/2020-12/schema")
    }

    return JsonObject(resource)
  }
}

/** Accessor for the built-in basic A2UI Catalog. */
object BasicCatalog {
  /** The standard identifier for the basic catalog. */
  const val BASIC_CATALOG_NAME = "basic"

  /** Paths to bundled standard catalogs for each spec version. */
  @JvmField
  val BASIC_CATALOG_PATHS =
    mapOf(
      A2uiVersion.VERSION_0_8 to
        mapOf(
          A2uiConstants.CATALOG_SCHEMA_KEY to
            "specification/v0_8/json/standard_catalog_definition.json"
        ),
      A2uiVersion.VERSION_0_9 to
        mapOf(A2uiConstants.CATALOG_SCHEMA_KEY to "specification/v0_9/catalogs/basic/catalog.json"),
      A2uiVersion.VERSION_0_9_1 to
        mapOf(
          A2uiConstants.CATALOG_SCHEMA_KEY to "specification/v0_9_1/catalogs/basic/catalog.json"
        ),
    )

  /**
   * Builds and returns a [CatalogConfig] customized for the basic A2UI catalog. Use this method
   * from Java to easily instantiate catalog configurations.
   *
   * @param version The A2UI schema version.
   * @param examplesPath An optional path string to load UI examples.
   * @return A catalog configuration object defining how to load the basic schema.
   */
  @JvmStatic
  @JvmOverloads
  fun getConfig(version: A2uiVersion, examplesPath: String? = null): CatalogConfig =
    CatalogConfig(
      name = BASIC_CATALOG_NAME,
      provider = BundledCatalogProvider(version),
      examplesPath = resolveExamplesPath(examplesPath),
    )
}
