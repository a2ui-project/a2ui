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

package com.google.a2ui.agent

import com.google.a2ui.core.Catalog
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Pure transformation over a [Catalog] applied before prompt generation or parsing. */
fun interface CatalogTransformer {
  fun transform(catalog: Catalog): Catalog
}

/** Retains only the component names in [allowedComponents] within a [Catalog]. */
class ComponentPruningTransformer(private val allowedComponents: Set<String>) : CatalogTransformer {
  override fun transform(catalog: Catalog): Catalog {
    val prunedComponents = catalog.components.filterKeys { it in allowedComponents }
    val newRaw =
      JsonObject(
        buildMap {
          putAll(catalog.rawSchema)
          put("components", JsonObject(prunedComponents.mapValues { (_, api) -> api.schema }))
        }
      )
    return catalog.copy(components = prunedComponents, rawSchema = newRaw)
  }
}

/** Retains only the function names in [allowedFunctions] within a [Catalog]. */
class FunctionPruningTransformer(private val allowedFunctions: Set<String>) : CatalogTransformer {
  override fun transform(catalog: Catalog): Catalog {
    val prunedFunctions = catalog.functions.filterKeys { it in allowedFunctions }
    val newRaw =
      JsonObject(
        buildMap {
          putAll(catalog.rawSchema)
          when (val rawFn = catalog.rawSchema["functions"]) {
            is JsonArray -> {
              val filtered =
                rawFn.filter { el ->
                  val name = ((el as? JsonObject)?.get("name") as? JsonPrimitive)?.contentOrNull
                  name in allowedFunctions
                }
              put("functions", JsonArray(filtered))
            }
            is JsonObject -> {
              put("functions", JsonObject(rawFn.filterKeys { it in allowedFunctions }))
            }
            else -> {}
          }
        }
      )
    return catalog.copy(functions = prunedFunctions, rawSchema = newRaw)
  }
}
