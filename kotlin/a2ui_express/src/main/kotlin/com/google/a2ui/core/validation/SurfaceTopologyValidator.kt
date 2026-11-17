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

import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.exceptions.A2uiIntegrityError
import com.google.a2ui.core.exceptions.A2uiRecursionError
import com.google.a2ui.core.exceptions.A2uiValidationError
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Validates the component adjacency list topology and composition rules of an A2UI surface:
 * duplicate IDs in a batch, self-references, cycles, depth <= 50, presence of `root`, dangling
 * references, unreachable changed components, and `allowedParents` / `allowedChildren`.
 */
internal class SurfaceTopologyValidator(catalogs: List<CatalogApi>) {
  private data class RefFieldSpec(
    val singleChildProps: Set<String>,
    val childListProps: Set<String>,
    val arrayObjectChildProps: Map<String, Set<String>>,
  )

  private data class CompositionRule(
    val allowedParents: Set<String>?,
    val allowedChildren: Set<String>?,
  )

  private val catalogsById: Map<String, CatalogApi> = catalogs.associateBy { it.id }
  private val refSpecsCache = HashMap<Pair<String, String>, RefFieldSpec>()
  private val compositionCache = HashMap<Pair<String, String>, CompositionRule>()

  init {
    for (catalog in catalogs) {
      for ((compName, compApi) in catalog.components) {
        val key = catalog.id to compName
        refSpecsCache[key] = extractRefFieldSpec(compApi.schema)
        compositionCache[key] = extractCompositionRule(compApi.schema)
      }
    }
  }

  /** Checks that a single batch of components contains no duplicate `id` values. */
  fun checkBatchNoDuplicateIds(components: List<JsonObject>, surfaceId: String) {
    val seen = HashSet<String>(components.size)
    for (comp in components) {
      val id = (comp["id"] as? JsonPrimitive)?.contentOrNull ?: continue
      if (!seen.add(id)) {
        throw A2uiIntegrityError("Duplicate component id '$id' in surface '$surfaceId'.")
      }
    }
  }

  /**
   * Validates full surface topology (root presence, dangling refs, cycles, depth limit,
   * reachability of [changedIds], and composition rules).
   */
  fun validateSurface(
    surfaceId: String,
    defaultCatalogId: String?,
    componentsById: Map<String, JsonObject>,
    changedIds: Set<String> = componentsById.keys,
    rootId: String = "root",
    allowPartialSurface: Boolean = false,
  ) {
    if (!allowPartialSurface && rootId !in componentsById) {
      throw A2uiIntegrityError("Surface '$surfaceId' has no '$rootId' component.")
    }

    val edges = LinkedHashMap<String, List<String>>(componentsById.size)
    for ((id, comp) in componentsById) {
      val refs = extractComponentReferences(comp, defaultCatalogId)
      val resolvedRefs = ArrayList<String>(refs.size)
      for (childId in refs) {
        if (childId == id) {
          throw A2uiIntegrityError("Component '$id' in surface '$surfaceId' references itself.")
        }
        if (childId !in componentsById) {
          if (!allowPartialSurface) {
            throw A2uiIntegrityError(
              "Component '$id' in surface '$surfaceId' references missing component '$childId'."
            )
          }
        } else {
          resolvedRefs.add(childId)
        }
      }
      edges[id] = resolvedRefs
    }

    // Check composition constraints (allowedParents / allowedChildren).
    for ((id, comp) in componentsById) {
      val parentCatalogId = resolveCatalogId(comp, defaultCatalogId)
      val parentType = (comp["component"] as? JsonPrimitive)?.contentOrNull ?: continue
      val parentRule =
        if (parentCatalogId != null) compositionCache[parentCatalogId to parentType] else null
      if (id == rootId && parentRule?.allowedParents != null) {
        if ("Surface" !in parentRule.allowedParents) {
          throw A2uiValidationError(
            "Component '$id' ($parentType) cannot be placed directly under 'Surface'. Allowed parents: ${parentRule.allowedParents}.",
            code = "UNALLOWED_PARENT",
          )
        }
      }
      for (childId in edges[id].orEmpty()) {
        val childComp = componentsById[childId] ?: continue
        val childCatalogId = resolveCatalogId(childComp, defaultCatalogId)
        val childType = (childComp["component"] as? JsonPrimitive)?.contentOrNull ?: continue
        if (parentRule?.allowedChildren != null && childType !in parentRule.allowedChildren) {
          throw A2uiValidationError(
            "Component '$id' ($parentType) cannot hold child '$childId' ($childType). Allowed children: ${parentRule.allowedChildren}.",
            code = "UNALLOWED_CHILD",
          )
        }
        val childRule =
          if (childCatalogId != null) compositionCache[childCatalogId to childType] else null
        if (childRule?.allowedParents != null && parentType !in childRule.allowedParents) {
          throw A2uiValidationError(
            "Component '$childId' ($childType) cannot be placed under parent '$id' ($parentType). Allowed parents: ${childRule.allowedParents}.",
            code = "UNALLOWED_PARENT",
          )
        }
      }
    }

    // Detect cycles across all components and compute max depth & reachability from root.
    // State: 0 = unvisited, 1 = visiting (on active stack), 2 = visited
    val state = HashMap<String, Int>(componentsById.size)
    val maxSubtreeHeight = HashMap<String, Int>(componentsById.size)

    fun dfsCycle(nodeId: String): Int {
      when (state[nodeId]) {
        1 ->
          throw A2uiRecursionError(
            "Circular component reference detected at '$nodeId' in surface '$surfaceId'."
          )
        2 -> return maxSubtreeHeight[nodeId] ?: 0
      }
      state[nodeId] = 1
      var tallestChild = 0
      for (childId in edges[nodeId].orEmpty()) {
        val h = 1 + dfsCycle(childId)
        if (h > tallestChild) tallestChild = h
      }
      if (tallestChild > SchemaValidator.MAX_JSON_DEPTH) {
        throw A2uiRecursionError(
          "Component hierarchy in surface '$surfaceId' exceeds maximum depth (${SchemaValidator.MAX_JSON_DEPTH})."
        )
      }
      state[nodeId] = 2
      maxSubtreeHeight[nodeId] = tallestChild
      return tallestChild
    }

    for (nodeId in componentsById.keys) {
      if (state[nodeId] == null) {
        dfsCycle(nodeId)
      }
    }

    if (!allowPartialSurface) {
      // Reachability from root: every changed component must be reachable from root.
      val reachable = HashSet<String>()
      val queue = ArrayDeque<String>()
      reachable.add(rootId)
      queue.addLast(rootId)
      while (queue.isNotEmpty()) {
        val cur = queue.removeFirst()
        for (childId in edges[cur].orEmpty()) {
          if (reachable.add(childId)) {
            queue.addLast(childId)
          }
        }
      }
      for (changedId in changedIds) {
        if (changedId in componentsById && changedId !in reachable) {
          throw A2uiIntegrityError(
            "Orphaned component '$changedId' in surface '$surfaceId' is not reachable from '$rootId'."
          )
        }
      }
    }
  }

  private fun resolveCatalogId(comp: JsonObject, defaultCatalogId: String?): String? {
    val atCat = (comp["@catalogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    if (atCat != null) return atCat
    if (defaultCatalogId != null) return defaultCatalogId
    return catalogsById.keys.firstOrNull()
  }

  private fun extractComponentReferences(
    comp: JsonObject,
    defaultCatalogId: String?,
  ): List<String> {
    val compType = (comp["component"] as? JsonPrimitive)?.contentOrNull ?: return emptyList()
    val catId = resolveCatalogId(comp, defaultCatalogId)
    val spec =
      if (catId != null) {
        refSpecsCache[catId to compType]
          ?: catalogsById.keys.firstNotNullOfOrNull { refSpecsCache[it to compType] }
      } else {
        catalogsById.keys.firstNotNullOfOrNull { refSpecsCache[it to compType] }
      } ?: return emptyList()

    val refs = ArrayList<String>()
    for (prop in spec.singleChildProps) {
      val id = (comp[prop] as? JsonPrimitive)?.takeIf { it.isString }?.content
      if (id != null) refs.add(id)
    }
    for (prop in spec.childListProps) {
      when (val raw = comp[prop]) {
        is JsonArray -> {
          for (item in raw) {
            val id = (item as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (id != null) refs.add(id)
          }
        }
        is JsonObject -> {
          val tplId = (raw["componentId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
          if (tplId != null) refs.add(tplId)
        }
        else -> {}
      }
    }
    for ((arrayProp, nestedProps) in spec.arrayObjectChildProps) {
      val arr = comp[arrayProp] as? JsonArray ?: continue
      for (entry in arr) {
        val obj = entry as? JsonObject ?: continue
        for (nestedProp in nestedProps) {
          when (val nestedVal = obj[nestedProp]) {
            is JsonPrimitive -> if (nestedVal.isString) refs.add(nestedVal.content)
            is JsonArray -> {
              for (sub in nestedVal) {
                if (sub is JsonPrimitive && sub.isString) refs.add(sub.content)
              }
            }
            is JsonObject -> {
              val tplId =
                (nestedVal["componentId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
              if (tplId != null) refs.add(tplId)
            }
            else -> {}
          }
        }
      }
    }
    return refs
  }

  private fun extractRefFieldSpec(schema: JsonObject): RefFieldSpec {
    val singleChild = LinkedHashSet<String>()
    val childList = LinkedHashSet<String>()
    val arrayObjChild = LinkedHashMap<String, MutableSet<String>>()

    fun classifyProp(propName: String, propSchema: JsonObject) {
      when (classifySchemaRefKind(propSchema)) {
        "Child" -> singleChild.add(propName)
        "ChildList" -> childList.add(propName)
        else -> {
          val itemObj = extractArrayItemSchema(propSchema)
          if (itemObj != null) {
            if (classifySchemaRefKind(itemObj) == "Child") {
              childList.add(propName)
            } else {
              val itemProps = collectObjectProperties(itemObj)
              for ((subName, subSchema) in itemProps) {
                if (classifySchemaRefKind(subSchema) != null) {
                  arrayObjChild.getOrPut(propName) { LinkedHashSet() }.add(subName)
                }
              }
            }
          }
        }
      }
    }

    for ((propName, propSchema) in collectObjectProperties(schema)) {
      classifyProp(propName, propSchema)
    }
    return RefFieldSpec(singleChild, childList, arrayObjChild)
  }

  private fun collectObjectProperties(schema: JsonObject): Map<String, JsonObject> {
    val out = LinkedHashMap<String, JsonObject>()
    (schema["properties"] as? JsonObject)?.forEach { (k, v) -> if (v is JsonObject) out[k] = v }
    for (comb in listOf("allOf", "anyOf", "oneOf")) {
      (schema[comb] as? JsonArray)?.forEach { sub ->
        if (sub is JsonObject) out.putAll(collectObjectProperties(sub))
      }
    }
    return out
  }

  private fun extractArrayItemSchema(schema: JsonObject): JsonObject? {
    (schema["items"] as? JsonObject)?.let {
      return it
    }
    for (comb in listOf("allOf", "anyOf", "oneOf")) {
      (schema[comb] as? JsonArray)?.forEach { sub ->
        if (sub is JsonObject) {
          extractArrayItemSchema(sub)?.let {
            return it
          }
        }
      }
    }
    return null
  }

  private fun classifySchemaRefKind(schema: JsonObject): String? {
    val ref = (schema["\$ref"] as? JsonPrimitive)?.contentOrNull
    if (ref != null) {
      if (ref.contains("ChildList")) return "ChildList"
      if (ref.contains("ComponentId") || ref.endsWith("/Child")) return "Child"
    }
    for (comb in listOf("allOf", "anyOf", "oneOf")) {
      val arr = schema[comb] as? JsonArray ?: continue
      for (sub in arr) {
        if (sub is JsonObject) {
          classifySchemaRefKind(sub)?.let {
            return it
          }
        }
      }
    }
    return null
  }

  private fun extractCompositionRule(schema: JsonObject): CompositionRule {
    fun stringSet(el: JsonElement?): Set<String>? {
      val arr = el as? JsonArray ?: return null
      return arr.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.toSet()
    }
    var parents = stringSet(schema["allowedParents"])
    var children = stringSet(schema["allowedChildren"])
    (schema["allOf"] as? JsonArray)?.forEach { sub ->
      if (sub is JsonObject) {
        if (parents == null) parents = stringSet(sub["allowedParents"])
        if (children == null) children = stringSet(sub["allowedChildren"])
      }
    }
    return CompositionRule(parents, children)
  }
}
