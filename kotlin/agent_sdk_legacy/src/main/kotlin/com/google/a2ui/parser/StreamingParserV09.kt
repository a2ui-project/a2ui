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

package com.google.a2ui.parser

import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiVersion
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/** Streaming parser implementation for A2UI v0.9 specification. */
class StreamingParserV09(
  catalog: A2uiCatalog? = null,
  schemaMappings: Map<String, String> = emptyMap(),
) : StreamingParser(catalog, schemaMappings) {

  override val version: A2uiVersion = catalog?.version ?: A2uiVersion.VERSION_0_9

  init {
    defaultRootId = "root"
  }

  private val yieldedCreateSurfaces = mutableSetOf<String>()

  override val placeholderComponent: JsonObject
    get() {
      return JsonObject(
        mapOf("component" to JsonPrimitive("Row"), "children" to JsonArray(emptyList()))
      )
    }

  override val yieldedSurfacesSet: MutableSet<String>
    get() = yieldedCreateSurfaces

  override val dataModelMsgType: String
    get() = "updateDataModel"

  override fun isProtocolMsg(obj: JsonObject): Boolean {
    return listOf("createSurface", "updateComponents", "updateDataModel").any { it in obj }
  }

  override fun sniffMetadata() {
    getLatestValue("surfaceId")?.let { surfaceId = it }
    getLatestValue("root")?.let { rootId = it }

    if ("\"createSurface\":" in jsonBuffer) addMsgType("createSurface")
    if ("\"updateComponents\":" in jsonBuffer) addMsgType("updateComponents")
    if ("\"updateDataModel\":" in jsonBuffer) addMsgType("updateDataModel")
  }

  override fun handleCompleteObject(
    obj: JsonObject,
    sid: String?,
    messages: MutableList<ResponsePart>,
  ): Boolean {
    validator?.validate(obj, strictIntegrity = false)

    var currentSid = obj["surfaceId"]?.jsonPrimitive?.content ?: surfaceId
    when {
      "updateComponents" in obj -> {
        val valObj = obj["updateComponents"] as? JsonObject
        if (valObj != null) {
          currentSid = valObj["surfaceId"]?.jsonPrimitive?.content ?: currentSid
        }
      }
      "createSurface" in obj -> {
        val valObj = obj["createSurface"] as? JsonObject
        if (valObj != null) {
          currentSid = valObj["surfaceId"]?.jsonPrimitive?.content ?: currentSid
        }
      }
    }

    surfaceId = currentSid
    val effectiveSid = surfaceId ?: "unknown"

    if (
      "deleteSurface" in obj &&
        !yieldedSurfacesSet.contains(effectiveSid) &&
        bufferedStartMessage == null
    ) {
      val list = pendingMessages.getOrPut(effectiveSid) { mutableListOf() }
      list.add(obj)
      return true
    }

    if ("createSurface" in obj) {
      val valObj = obj["createSurface"] as? JsonObject
      if (valObj != null) {
        rootId = valObj["root"]?.jsonPrimitive?.content ?: rootId ?: "root"
      }
      bufferedStartMessage = obj

      if (!yieldedStartMessages.contains(effectiveSid)) {
        yieldMessages(listOf(obj), messages)
        yieldedStartMessages.add(effectiveSid)
        yieldedSurfacesSet.add(effectiveSid)
        bufferedStartMessage = null
      }

      pendingMessages.remove(effectiveSid)
      yieldReachable(messages)
      return true
    }

    if ("updateComponents" in obj) {
      addMsgType("updateComponents")
      val ucObj = obj["updateComponents"] as? JsonObject
      rootId = ucObj?.get("root")?.jsonPrimitive?.content ?: rootId ?: "root"
      val comps = ucObj?.get("components") as? JsonArray
      if (comps != null) {
        for (compElem in comps) {
          if (compElem is JsonObject) {
            compElem["id"]?.jsonPrimitive?.content?.let { id -> seenComponents[id] = compElem }
          }
        }
      }
      yieldReachable(messages, checkRoot = true, raiseOnOrphans = false)
      return true
    }

    if ("deleteSurface" in obj) {
      addMsgType("deleteSurface")
      yieldMessages(listOf(obj), messages)
      return true
    }

    if ("updateDataModel" in obj) {
      addMsgType("updateDataModel")
      val udmObj = obj["updateDataModel"] as? JsonObject
      if (udmObj != null) {
        updateDataModel(udmObj, messages)
      }
      yieldMessages(listOf(obj), messages)
      return true
    }

    yieldMessages(listOf(obj), messages)
    return true
  }

  override fun constructSniffedDataModelMessage(
    activeMsgType: String,
    deltaMsgPayload: JsonObject,
  ): JsonObject {
    return JsonObject(mapOf("version" to JsonPrimitive("v0.9"), activeMsgType to deltaMsgPayload))
  }

  override fun constructPartialMessage(
    processedComponents: List<JsonObject>,
    activeMsgType: String,
  ): JsonObject {
    val payloadMap = mutableMapOf<String, JsonElement>()
    payloadMap["components"] = JsonArray(processedComponents)
    surfaceId?.let { payloadMap["surfaceId"] = JsonPrimitive(it) }
    return JsonObject(
      mapOf("version" to JsonPrimitive("v0.9"), "updateComponents" to JsonObject(payloadMap))
    )
  }

  override fun getActiveMsgTypeForComponents(): String? {
    if (activeMsgType != null) return activeMsgType
    for (mt in _msgTypes) {
      if (mt in listOf("updateComponents", "createSurface")) {
        activeMsgType = mt
        return mt
      }
    }
    return _msgTypes.firstOrNull()
  }

  override fun deduplicateDataModel(m: JsonObject, strictIntegrity: Boolean): Boolean {
    if ("updateDataModel" in m) {
      val udm = m["updateDataModel"] as? JsonObject ?: return true
      val valObj = udm["value"] as? JsonObject ?: return true
      var isNew = false
      for ((k, v) in valObj) {
        if (yieldedDataModel[k] != v) {
          isNew = true
          break
        }
      }
      if (!isNew && strictIntegrity) {
        return false
      }
      for ((k, v) in valObj) {
        yieldedDataModel[k] = v
      }
    }
    return true
  }
}
