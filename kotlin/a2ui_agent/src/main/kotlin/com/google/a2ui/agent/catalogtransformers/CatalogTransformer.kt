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

package com.google.a2ui.agent.catalogtransformers

import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.catalog.ComponentApi
import com.google.a2ui.core.catalog.DerivedCatalogEntry
import com.google.a2ui.core.catalog.FunctionApi

/**
 * Generic catalog transformation rule (`a2ui_agent.blueprint.md` §3.A `CatalogTransformer`).
 *
 * Preserves [TComponent] and [TFunction] type arguments across transformations so the same pruning
 * rules operate on both schema-only `CatalogApi` instances and implementation-bearing catalogs.
 */
interface CatalogTransformer {
  fun <TComponent : ComponentApi, TFunction : FunctionApi> transform(
    catalog: Catalog<TComponent, TFunction>
  ): Catalog<TComponent, TFunction>
}

/** Prunes catalog component definitions to an allowlist (`blueprint` §3.A). */
class ComponentPruningTransformer(allowedComponents: Collection<String>) : CatalogTransformer {
  val allowedComponents: Set<String> = allowedComponents.toSet()

  override fun <TComponent : ComponentApi, TFunction : FunctionApi> transform(
    catalog: Catalog<TComponent, TFunction>
  ): Catalog<TComponent, TFunction> {
    val kept =
      catalog.components.keys
        .filter { it in allowedComponents }
        .map { DerivedCatalogEntry.Keep(it) }
    val derived =
      catalog.derive(catalogId = catalog.id, components = kept, instructions = catalog.instructions)
    return Catalog(
      id = catalog.id,
      components = derived.components.values.toList(),
      functions = catalog.functions.values.toList(),
      protocolVersion = catalog.protocolVersion,
      themeSchema = catalog.themeSchema,
      title = catalog.title,
      description = catalog.description,
      instructions = catalog.instructions,
    )
  }
}

/** Prunes catalog function definitions to an allowlist (`blueprint` §3.A). */
class FunctionPruningTransformer(allowedFunctions: Collection<String>) : CatalogTransformer {
  val allowedFunctions: Set<String> = allowedFunctions.toSet()

  override fun <TComponent : ComponentApi, TFunction : FunctionApi> transform(
    catalog: Catalog<TComponent, TFunction>
  ): Catalog<TComponent, TFunction> {
    val keptFunctions = catalog.functions.values.filter { it.name in allowedFunctions }
    return Catalog(
      id = catalog.id,
      components = catalog.components.values.toList(),
      functions = keptFunctions,
      protocolVersion = catalog.protocolVersion,
      themeSchema = catalog.themeSchema,
      title = catalog.title,
      description = catalog.description,
      instructions = catalog.instructions,
    )
  }
}
