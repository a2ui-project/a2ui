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

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

internal const val KEY_DOLLAR_REF = "\$ref"
internal const val PROP_PROPERTIES = "properties"
internal const val PROP_TYPE = "type"
internal const val PROP_TITLE = "title"
internal const val PROP_ITEMS = "items"
internal const val COMBINATOR_ONE_OF = "oneOf"
internal const val COMBINATOR_ANY_OF = "anyOf"
internal const val COMBINATOR_ALL_OF = "allOf"
internal const val TYPE_STRING = "string"
internal const val TYPE_OBJECT = "object"
internal const val TYPE_ARRAY = "array"
internal const val MAX_GLOBAL_DEPTH = 50

internal const val PROP_COMPONENT = "component"
internal const val PROP_CHILD = "child"
internal const val PROP_CHILDREN = "children"
internal const val PROP_CONTENT_CHILD = "contentChild"
internal const val PROP_ENTRY_POINT_CHILD = "entryPointChild"
internal const val PROP_COMPONENT_ID = "componentId"
internal const val PROP_EXPLICIT_LIST = "explicitList"
internal const val PROP_TEMPLATE = "template"
internal const val TITLE_COMPONENT_ID = "ComponentId"
internal const val TITLE_CHILD_LIST = "ChildList"

internal object SchemaInspector {
  private val HEURISTIC_SINGLE_REFS =
    setOf("child", "contentChild", "entryPointChild", "detail", "summary", "root")
  private val HEURISTIC_LIST_REFS = setOf("children", "explicitList", "template")

  /** Heuristically determines if a schema property represents a single ComponentId reference. */
  fun isComponentIdRef(propSchema: JsonElement): Boolean {
    if (propSchema !is JsonObject) return false
    val ref = propSchema[KEY_DOLLAR_REF]?.jsonPrimitive?.content ?: ""
    if (ref.endsWith(TITLE_COMPONENT_ID) || ref.endsWith(PROP_CHILD) || "/${PROP_CHILD}" in ref) {
      return true
    }

    if (
      propSchema[PROP_TYPE]?.jsonPrimitive?.content == TYPE_STRING &&
        propSchema[PROP_TITLE]?.jsonPrimitive?.content == TITLE_COMPONENT_ID
    ) {
      return true
    }

    return listOf(COMBINATOR_ONE_OF, COMBINATOR_ANY_OF, COMBINATOR_ALL_OF).any { key ->
      (propSchema[key] as? JsonArray)?.any { isComponentIdRef(it) } == true
    }
  }

  /** Heuristically determines if a schema property represents a collection of ComponentIds. */
  fun isChildListRef(propSchema: JsonElement): Boolean {
    if (propSchema !is JsonObject) return false
    val ref = propSchema[KEY_DOLLAR_REF]?.jsonPrimitive?.content ?: ""
    if (
      ref.endsWith(TITLE_CHILD_LIST) || ref.endsWith(PROP_CHILDREN) || "/${PROP_CHILDREN}" in ref
    ) {
      return true
    }

    if (propSchema[PROP_TYPE]?.jsonPrimitive?.content == TYPE_OBJECT) {
      val props = propSchema[PROP_PROPERTIES] as? JsonObject
      if (
        props != null &&
          (PROP_EXPLICIT_LIST in props || PROP_TEMPLATE in props || PROP_COMPONENT_ID in props)
      ) {
        return true
      }
    }

    if (propSchema[PROP_TYPE]?.jsonPrimitive?.content == TYPE_ARRAY) {
      val items = propSchema[PROP_ITEMS]
      if (items != null && isComponentIdRef(items)) return true
    }

    return listOf(COMBINATOR_ONE_OF, COMBINATOR_ANY_OF, COMBINATOR_ALL_OF).any { key ->
      (propSchema[key] as? JsonArray)?.any { isChildListRef(it) } == true
    }
  }

  /** Iterate over all components defined in the catalog to extract their reference fields. */
  fun extractReferenceFields(
    allComponents: JsonObject
  ): MutableMap<String, Pair<Set<String>, Set<String>>> {
    val refMap = mutableMapOf<String, Pair<Set<String>, Set<String>>>()

    for ((compName, compSchemaElem) in allComponents) {
      val singleRefs = mutableSetOf<String>()
      val listRefs = mutableSetOf<String>()

      // Recursively inspects properties and combinators to find reference fields.
      fun extractFromProps(cs: JsonElement) {
        if (cs !is JsonObject) return
        val props = cs[PROP_PROPERTIES] as? JsonObject
        if (props != null) {
          for ((propName, propSchema) in props) {
            if (
              isComponentIdRef(propSchema) ||
                propName in listOf(PROP_CHILD, PROP_CONTENT_CHILD, PROP_ENTRY_POINT_CHILD)
            ) {
              singleRefs.add(propName)
            } else if (isChildListRef(propSchema) || propName == PROP_CHILDREN) {
              listRefs.add(propName)
            }
          }
        }

        listOf(COMBINATOR_ALL_OF, COMBINATOR_ONE_OF, COMBINATOR_ANY_OF).forEach { key ->
          (cs[key] as? JsonArray)?.forEach { extractFromProps(it) }
        }
      }

      extractFromProps(compSchemaElem)
      if (singleRefs.isNotEmpty() || listRefs.isNotEmpty()) {
        refMap[compName] = singleRefs to listRefs
      }
    }

    return refMap
  }

  fun getComponentReferences(
    component: JsonObject,
    refFieldsMap: Map<String, Pair<Set<String>, Set<String>>>,
  ): Sequence<Pair<String, String>> = sequence {
    when (val compVal = component[PROP_COMPONENT]) {
      is JsonPrimitive -> {
        if (compVal.isString) {
          yieldAll(getRefsRecursively(compVal.content, component, refFieldsMap))
        }
      }
      is JsonObject -> {
        for ((cType, cProps) in compVal) {
          if (cProps is JsonObject) {
            yieldAll(getRefsRecursively(cType, cProps, refFieldsMap))
          }
        }
      }
      else -> {}
    }
  }

  private fun getRefsRecursively(
    compType: String,
    props: JsonObject,
    refFieldsMap: Map<String, Pair<Set<String>, Set<String>>>,
  ): Sequence<Pair<String, String>> = sequence {
    val (singleRefs, listRefs) = refFieldsMap[compType] ?: (emptySet<String>() to emptySet())
    for ((key, value) in props) {
      val isSingle = key in singleRefs || key in HEURISTIC_SINGLE_REFS
      val isList = key in listRefs || key in HEURISTIC_LIST_REFS
      when {
        isSingle -> {
          when {
            value is JsonPrimitive && value.isString -> yield(value.content to key)
            value is JsonObject && PROP_COMPONENT_ID in value -> {
              value[PROP_COMPONENT_ID]?.jsonPrimitive?.content?.let {
                yield(it to "$key.$PROP_COMPONENT_ID")
              }
            }
          }
        }
        isList -> {
          when (value) {
            is JsonArray -> {
              for (item in value) {
                if (item is JsonPrimitive && item.isString) yield(item.content to key)
              }
            }
            is JsonObject -> {
              when {
                PROP_EXPLICIT_LIST in value -> {
                  (value[PROP_EXPLICIT_LIST] as? JsonArray)?.forEach { item ->
                    if (item is JsonPrimitive && item.isString) {
                      yield(item.content to "$key.$PROP_EXPLICIT_LIST")
                    }
                  }
                }
                PROP_TEMPLATE in value -> {
                  val template = value[PROP_TEMPLATE] as? JsonObject
                  template?.get(PROP_COMPONENT_ID)?.jsonPrimitive?.content?.let {
                    yield(it to "$key.$PROP_TEMPLATE.$PROP_COMPONENT_ID")
                  }
                }
                PROP_COMPONENT_ID in value -> {
                  value[PROP_COMPONENT_ID]?.jsonPrimitive?.content?.let {
                    yield(it to "$key.$PROP_COMPONENT_ID")
                  }
                }
              }
            }
            else -> {}
          }
        }
        value is JsonArray -> {
          for ((idx, item) in value.withIndex()) {
            if (item is JsonObject) {
              item[PROP_CHILD]?.jsonPrimitive?.content?.let {
                yield(it to "$key[$idx].$PROP_CHILD")
              }
            }
          }
        }
      }
    }
  }

  fun updateAdjacencyList(
    allIds: MutableSet<String>,
    adjList: MutableMap<String, MutableList<String>>,
    refFieldsMap: Map<String, Pair<Set<String>, Set<String>>>,
    comp: JsonObject,
  ) {
    val compId = comp["id"]?.jsonPrimitive?.content ?: return
    allIds.add(compId)
    val neighbors = adjList.getOrPut(compId) { mutableListOf() }

    for ((refId, fieldName) in getComponentReferences(comp, refFieldsMap)) {
      if (refId == compId) {
        throw IllegalArgumentException(
          "Self-reference detected: Component '$compId' references itself in field '$fieldName'"
        )
      }
      neighbors.add(refId)
    }
  }

  fun visit(nodeId: String, adjList: MutableMap<String, MutableList<String>>): Set<String> {
    val visited = mutableSetOf<String>()
    val recursionStack = mutableSetOf<String>()

    dfs(nodeId, visited, adjList, recursionStack, 0)

    return visited
  }

  private fun dfs(
    nodeId: String,
    visited: MutableSet<String>,
    adjList: MutableMap<String, MutableList<String>>,
    recursionStack: MutableSet<String>,
    depth: Int,
  ) {
    if (depth > MAX_GLOBAL_DEPTH) {
      throw IllegalArgumentException(
        "Global recursion limit exceeded: logical depth > $MAX_GLOBAL_DEPTH"
      )
    }

    visited.add(nodeId)
    recursionStack.add(nodeId)

    for (neighbor in adjList[nodeId] ?: emptyList()) {
      if (neighbor !in visited) {
        dfs(neighbor, visited, adjList, recursionStack, depth + 1)
      } else if (neighbor in recursionStack) {
        throw IllegalArgumentException(
          "Circular reference detected involving component '$neighbor'"
        )
      }
    }

    recursionStack.remove(nodeId)
  }
}

@Deprecated(
  "Use SchemaInspector directly",
  ReplaceWith("SchemaInspector.isComponentIdRef(propSchema)"),
)
internal fun isComponentIdRef(propSchema: JsonElement): Boolean =
  SchemaInspector.isComponentIdRef(propSchema)

@Deprecated(
  "Use SchemaInspector directly",
  ReplaceWith("SchemaInspector.isChildListRef(propSchema)"),
)
internal fun isChildListRef(propSchema: JsonElement): Boolean =
  SchemaInspector.isChildListRef(propSchema)

@Deprecated(
  "Use SchemaInspector directly",
  ReplaceWith("SchemaInspector.extractReferenceFields(allComponents)"),
)
internal fun extractReferenceFields(
  allComponents: JsonObject
): MutableMap<String, Pair<Set<String>, Set<String>>> =
  SchemaInspector.extractReferenceFields(allComponents)

@Deprecated(
  "Use SchemaInspector directly",
  ReplaceWith("SchemaInspector.getComponentReferences(component, refFieldsMap)"),
)
internal fun getComponentReferences(
  component: JsonObject,
  refFieldsMap: Map<String, Pair<Set<String>, Set<String>>>,
): Sequence<Pair<String, String>> = SchemaInspector.getComponentReferences(component, refFieldsMap)

@Deprecated(
  "Use SchemaInspector directly",
  ReplaceWith("SchemaInspector.updateAdjacencyList(allIds, adjList, refFieldsMap, comp)"),
)
internal fun updateAdjacencyList(
  allIds: MutableSet<String>,
  adjList: MutableMap<String, MutableList<String>>,
  refFieldsMap: Map<String, Pair<Set<String>, Set<String>>>,
  comp: JsonObject,
) = SchemaInspector.updateAdjacencyList(allIds, adjList, refFieldsMap, comp)

@Deprecated("Use SchemaInspector directly", ReplaceWith("SchemaInspector.visit(nodeId, adjList)"))
internal fun visit(nodeId: String, adjList: MutableMap<String, MutableList<String>>): Set<String> =
  SchemaInspector.visit(nodeId, adjList)
