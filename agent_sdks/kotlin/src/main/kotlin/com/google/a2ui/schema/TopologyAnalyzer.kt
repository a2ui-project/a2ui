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

package com.google.a2ui.schema

import java.util.logging.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal object TopologyAnalyzer {
  private val logger: Logger = Logger.getLogger(TopologyAnalyzer::class.java.name)

  fun extractComponentRequiredFields(catalog: A2uiCatalog): Map<String, Set<String>> {
    val reqMap = mutableMapOf<String, Set<String>>()
    val allComponents = extractComponents(catalog) ?: return reqMap

    for ((compName, compSchemaElem) in allComponents) {
      val requiredFields = mutableSetOf<String>()

      fun extractFromProps(cs: JsonElement) {
        if (cs !is JsonObject) return

        val reqArr = cs["required"] as? JsonArray
        if (reqArr != null) {
          for (item in reqArr) {
            if (item is JsonPrimitive && item.isString) {
              val content = item.content
              if (content != PROP_COMPONENT) {
                requiredFields.add(content)
              }
            }
          }
        }

        listOf(COMBINATOR_ALL_OF, COMBINATOR_ONE_OF, COMBINATOR_ANY_OF).forEach { key ->
          (cs[key] as? JsonArray)?.forEach { extractFromProps(it) }
        }
      }

      extractFromProps(compSchemaElem)
      if (requiredFields.isNotEmpty()) {
        reqMap[compName] = requiredFields
      }
    }

    return reqMap
  }

  private fun extractComponents(catalog: A2uiCatalog): JsonObject? {
    if (catalog.version == A2uiVersion.VERSION_0_8) {
      try {
        val s2c = catalog.serverToClientSchema
        val props = s2c[PROP_PROPERTIES] as? JsonObject
        if (props != null && "surfaceUpdate" in props) {
          val su = (props["surfaceUpdate"] as? JsonObject)?.get(PROP_PROPERTIES) as? JsonObject
          if (su != null && "components" in su) {
            val items = (su["components"] as? JsonObject)?.get(PROP_ITEMS) as? JsonObject
            if (items != null && PROP_PROPERTIES in items) {
              val compWrapper =
                (items[PROP_PROPERTIES] as? JsonObject)?.get(PROP_COMPONENT) as? JsonObject
              val allComponents = compWrapper?.get(PROP_PROPERTIES) as? JsonObject
              if (allComponents != null) {
                return allComponents
              }
            }
          }
        }
      } catch (e: Exception) {
        logger.severe { "Unable to extract components from serverToClientSchema: ${e.message}" }
      }
    }
    return catalog.catalogSchema[A2uiConstants.CATALOG_COMPONENTS_KEY] as? JsonObject
  }

  fun extractComponentRefFields(catalog: A2uiCatalog): Map<String, Pair<Set<String>, Set<String>>> {
    val allComponents = extractComponents(catalog) ?: return emptyMap()
    return SchemaInspector.extractReferenceFields(allComponents)
  }

  fun analyzeTopology(
    rootId: String,
    components: List<JsonObject>,
    refFieldsMap: Map<String, Pair<Set<String>, Set<String>>>,
    raiseOnOrphans: Boolean = false,
  ): Set<String> {
    val adjList = mutableMapOf<String, MutableList<String>>()
    val allIds = mutableSetOf<String>()

    for (comp in components) {
      SchemaInspector.updateAdjacencyList(allIds, adjList, refFieldsMap, comp)
    }

    val visited =
      if (rootId in allIds) {
        SchemaInspector.visit(rootId, adjList)
      } else {
        emptySet()
      }

    if (raiseOnOrphans) {
      val orphans = allIds - visited
      if (orphans.isNotEmpty()) {
        val firstOrphan = orphans.minOf { it }
        throw IllegalArgumentException("Component '$firstOrphan' is not reachable from '$rootId'")
      }
    }

    return visited
  }
}
