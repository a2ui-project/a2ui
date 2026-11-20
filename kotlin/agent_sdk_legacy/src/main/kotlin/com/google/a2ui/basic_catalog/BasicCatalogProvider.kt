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
 * A provider that loads A2UI JSON schemas and specifications from bundled package resources.
 *
 * @param version The A2UI conceptual version, e.g., "0.9".
 */
class BundledCatalogProvider
internal constructor(
  private val version: A2uiVersion,
  private val resourceLoader: (String, String) -> JsonObject?,
) : A2uiCatalogProvider {

  constructor(version: A2uiVersion) : this(version, SchemaResourceLoader::loadFromBundledResource)

  override fun load(): JsonObject {
    val filename = BasicCatalog.BASIC_CATALOG_RESOURCE_PATHS[version] ?: ""

    val resource = resourceLoader(version.value, filename)?.toMutableMap() ?: mutableMapOf()

    if (A2uiConstants.CATALOG_ID_KEY !in resource) {
      BasicCatalog.BASIC_CATALOG_IDS[version]?.let { catalogId ->
        resource[A2uiConstants.CATALOG_ID_KEY] = JsonPrimitive(catalogId)
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

  /** Canonical catalog IDs for each spec version, independent of repository file paths. */
  @JvmField
  val BASIC_CATALOG_IDS =
    mapOf(
      A2uiVersion.VERSION_0_8 to
        "https://a2ui.org/specification/v0_8/standard_catalog_definition.json",
      A2uiVersion.VERSION_0_9 to "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
      A2uiVersion.VERSION_0_9_1 to "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    )

  /** Bundled classpath resource paths under `com/google/a2ui/assets/<version>/`. */
  internal val BASIC_CATALOG_RESOURCE_PATHS =
    mapOf(
      A2uiVersion.VERSION_0_8 to "standard_catalog_definition.json",
      A2uiVersion.VERSION_0_9 to "catalogs/basic/catalog.json",
      A2uiVersion.VERSION_0_9_1 to "catalogs/basic/catalog.json",
    )

  /** Repository paths to bundled standard catalogs for each spec version. */
  @JvmField
  val BASIC_CATALOG_PATHS =
    mapOf(
      A2uiVersion.VERSION_0_8 to
        mapOf(
          A2uiConstants.CATALOG_SCHEMA_KEY to
            "specification/v0_8/json/standard_catalog_definition.json"
        ),
      A2uiVersion.VERSION_0_9 to
        mapOf(A2uiConstants.CATALOG_SCHEMA_KEY to "catalogs/basic/v0_9/catalog.json"),
      A2uiVersion.VERSION_0_9_1 to
        mapOf(A2uiConstants.CATALOG_SCHEMA_KEY to "catalogs/basic/v0_9_1/catalog.json"),
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
