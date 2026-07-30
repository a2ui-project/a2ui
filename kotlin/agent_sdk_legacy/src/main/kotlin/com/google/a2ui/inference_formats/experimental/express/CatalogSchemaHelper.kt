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

import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiConstants
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Dynamic schema crawler for A2UI catalogs.
 *
 * Resolves component and function properties in schema definition order to support positional
 * parameter mapping for compact generative notations.
 */
class CatalogSchemaHelper(val catalog: A2uiCatalog) {

  val components: Map<String, JsonObject> by lazy {
    val compObj = catalog.catalogSchema[A2uiConstants.CATALOG_COMPONENTS_KEY] as? JsonObject
    compObj?.mapValues { (_, v) -> v as JsonObject } ?: emptyMap()
  }

  val functions: Map<String, JsonObject> by lazy {
    val fnObj = catalog.catalogSchema[A2uiConstants.CATALOG_FUNCTIONS_KEY] as? JsonObject
    fnObj?.mapValues { (_, v) -> v as JsonObject } ?: emptyMap()
  }

  val componentProperties = mutableMapOf<String, List<String>>()
  val componentRequired = mutableMapOf<String, List<String>>()
  val componentIsCheckable = mutableMapOf<String, Boolean>()
  val componentPropertyEnums = mutableMapOf<Pair<String, String>, List<String>>()

  val functionProperties = mutableMapOf<String, List<String>>()
  val functionRequired = mutableMapOf<String, List<String>>()

  init {
    loadMappings()
  }

  private fun loadMappings() {
    for ((name, schema) in components) {
      val props = mutableMapOf<String, JsonElement>()
      val reqs = mutableListOf<String>()
      var isCheckable = false

      val subSchemas = mutableListOf<JsonObject>(schema)
      (schema["allOf"] as? JsonArray)?.forEach { item ->
        (item as? JsonObject)?.let { subSchemas.add(it) }
      }

      for (sub in subSchemas) {
        val ref = (sub["\$ref"] as? JsonPrimitive)?.content
        if (ref != null && ref.contains("Checkable")) {
          isCheckable = true
        }

        (sub["properties"] as? JsonObject)?.let { pObj ->
          for ((pk, pv) in pObj) {
            props[pk] = pv
            val enumVals = findEnum(pv)
            if (enumVals != null) {
              componentPropertyEnums[Pair(name, pk)] = enumVals
            }
          }
        }

        (sub["required"] as? JsonArray)?.let { rArr ->
          rArr.forEach { item -> (item as? JsonPrimitive)?.content?.let { reqs.add(it) } }
        }
      }

      val orderedKeys = mutableListOf<String>()
      for (k in props.keys) {
        if (k != "component" && k != "id") {
          orderedKeys.add(k)
        }
      }

      if (isCheckable && !orderedKeys.contains("checks")) {
        orderedKeys.add("checks")
      }

      componentProperties[name] = orderedKeys
      componentRequired[name] = reqs
      componentIsCheckable[name] = isCheckable
    }

    for ((name, schema) in functions) {
      val subSchemas = mutableListOf<JsonObject>(schema)
      (schema["allOf"] as? JsonArray)?.forEach { item ->
        (item as? JsonObject)?.let { subSchemas.add(it) }
      }

      val props = mutableMapOf<String, JsonElement>()
      val reqs = mutableListOf<String>()

      for (sub in subSchemas) {
        (sub["properties"] as? JsonObject)?.let { pObj ->
          val argsObj = pObj["args"] as? JsonObject
          if (argsObj != null) {
            (argsObj["properties"] as? JsonObject)?.let { props.putAll(it) }
            (argsObj["required"] as? JsonArray)?.forEach { item ->
              (item as? JsonPrimitive)?.content?.let { reqs.add(it) }
            }
          }
        }
      }

      functionProperties[name] = props.keys.toList()
      functionRequired[name] = reqs
    }
  }

  private fun findEnum(element: JsonElement): List<String>? {
    if (element is JsonObject) {
      (element["enum"] as? JsonArray)?.let { arr ->
        return arr.mapNotNull { (it as? JsonPrimitive)?.content }
      }
      for (k in listOf("oneOf", "anyOf", "allOf")) {
        (element[k] as? JsonArray)?.let { arr ->
          for (sub in arr) {
            val res = findEnum(sub)
            if (res != null) return res
          }
        }
      }
    }
    return null
  }

  fun getComponentProperties(name: String): List<String> = componentProperties[name] ?: emptyList()

  fun getComponentRequired(name: String): List<String> = componentRequired[name] ?: emptyList()

  fun isCheckable(name: String): Boolean = componentIsCheckable[name] ?: false

  fun getFunctionProperties(name: String): List<String> = functionProperties[name] ?: emptyList()

  fun getFunctionRequired(name: String): List<String> = functionRequired[name] ?: emptyList()

  fun getFunctionPropertySchema(fnName: String, propName: String): JsonObject? {
    val fnSchema = functions[fnName] ?: return null
    val subSchemas = mutableListOf<JsonObject>(fnSchema)
    (fnSchema["allOf"] as? JsonArray)?.forEach { item ->
      (item as? JsonObject)?.let { subSchemas.add(it) }
    }

    for (sub in subSchemas) {
      (sub["properties"] as? JsonObject)?.let { pObj ->
        val argsObj = pObj["args"] as? JsonObject
        (argsObj?.get("properties") as? JsonObject)?.let { props ->
          (props[propName] as? JsonObject)?.let {
            return it
          }
        }
      }
    }
    return null
  }

  fun getPropertyEnum(componentName: String, propertyName: String): List<String>? =
    componentPropertyEnums[Pair(componentName, propertyName)]

  fun getComponentDescription(name: String): String? {
    val schema = components[name] ?: return null
    (schema["description"] as? JsonPrimitive)?.content?.let {
      return it
    }
    (schema["allOf"] as? JsonArray)?.forEach { item ->
      ((item as? JsonObject)?.get("description") as? JsonPrimitive)?.content?.let {
        return it
      }
    }
    return null
  }

  fun getFunctionDescription(name: String): String? {
    val schema = functions[name] ?: return null
    return (schema["description"] as? JsonPrimitive)?.content
  }

  fun getPropertySchema(componentName: String, propertyName: String): JsonObject? {
    val schema = components[componentName] ?: return null
    val subSchemas = mutableListOf<JsonObject>(schema)
    (schema["allOf"] as? JsonArray)?.forEach { item ->
      (item as? JsonObject)?.let { subSchemas.add(it) }
    }

    for (sub in subSchemas) {
      (sub["properties"] as? JsonObject)?.get(propertyName)?.let { if (it is JsonObject) return it }
    }
    return null
  }

  fun getPropertyType(componentName: String, propertyName: String): String? {
    val pSchema = getPropertySchema(componentName, propertyName) ?: return null
    return crawlRef(pSchema)
  }

  private fun crawlRef(element: JsonElement): String? {
    if (element is JsonObject) {
      (element["\$ref"] as? JsonPrimitive)?.content?.let { ref ->
        if (ref.contains("ChildList")) return "ChildList"
        if (ref.contains("Child") || ref.contains("ComponentId")) return "Child"
        if (ref.contains("Action")) return "Action"
      }
      for (k in listOf("oneOf", "anyOf", "allOf")) {
        (element[k] as? JsonArray)?.let { arr ->
          for (sub in arr) {
            val res = crawlRef(sub)
            if (res != null) return res
          }
        }
      }
    }
    return null
  }
}
