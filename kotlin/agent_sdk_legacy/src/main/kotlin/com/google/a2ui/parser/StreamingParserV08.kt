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

/** Streaming parser implementation for A2UI v0.8 specification. */
class StreamingParserV08(
  catalog: A2uiCatalog? = null,
  schemaMappings: Map<String, String> = emptyMap(),
) : StreamingParser(catalog, schemaMappings) {

  override val version: A2uiVersion = catalog?.version ?: A2uiVersion.VERSION_0_8

  private val yieldedBeginRenderingSurfaces = mutableSetOf<String>()

  override val placeholderComponent: JsonObject
    get() {
      return JsonObject(
        mapOf(
          "component" to
            JsonObject(
              mapOf(
                "Row" to
                  JsonObject(
                    mapOf("children" to JsonObject(mapOf("explicitList" to JsonArray(emptyList()))))
                  )
              )
            )
        )
      )
    }

  override val yieldedSurfacesSet: MutableSet<String>
    get() = yieldedBeginRenderingSurfaces

  override val dataModelMsgType: String
    get() = "dataModelUpdate"

  override fun isProtocolMsg(obj: JsonObject): Boolean {
    return listOf("beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface").any {
      it in obj
    }
  }

  override fun sniffMetadata() {
    getLatestValue("surfaceId")?.let { surfaceId = it }
    getLatestValue("root")?.let { rootId = it }

    if ("\"beginRendering\":" in jsonBuffer) addMsgType("beginRendering")
    if ("\"surfaceUpdate\":" in jsonBuffer) addMsgType("surfaceUpdate")
    if ("\"dataModelUpdate\":" in jsonBuffer) addMsgType("dataModelUpdate")
    if ("\"deleteSurface\":" in jsonBuffer) addMsgType("deleteSurface")
  }

  override fun handleCompleteObject(
    obj: JsonObject,
    sid: String?,
    messages: MutableList<ResponsePart>,
  ): Boolean {
    validator?.validate(obj, strictIntegrity = false)

    var currentSid = obj["surfaceId"]?.jsonPrimitive?.content ?: surfaceId
    when {
      "surfaceUpdate" in obj -> {
        val valObj = obj["surfaceUpdate"] as? JsonObject
        if (valObj != null) {
          currentSid = valObj["surfaceId"]?.jsonPrimitive?.content ?: currentSid
        }
      }
      "beginRendering" in obj -> {
        val valObj = obj["beginRendering"] as? JsonObject
        if (valObj != null) {
          currentSid = valObj["surfaceId"]?.jsonPrimitive?.content ?: currentSid
        }
      }
      "deleteSurface" in obj -> {
        val valElem = obj["deleteSurface"]
        if (valElem is JsonPrimitive && valElem.isString) {
          currentSid = valElem.content
        } else if (valElem is JsonObject) {
          currentSid = valElem["surfaceId"]?.jsonPrimitive?.content ?: currentSid
        }
      }
    }

    surfaceId = currentSid
    val effectiveSid = surfaceId ?: "unknown"

    if ("deleteSurface" in obj) {
      if (yieldedSurfacesSet.contains(effectiveSid) || bufferedStartMessage != null) {
        deleteSurface(effectiveSid)
      }
    }

    if (deletedSurfaces.contains(effectiveSid)) {
      return true
    }

    if (
      ("surfaceUpdate" in obj || "deleteSurface" in obj) &&
        !yieldedSurfacesSet.contains(effectiveSid) &&
        bufferedStartMessage == null
    ) {
      val list = pendingMessages.getOrPut(effectiveSid) { mutableListOf() }
      list.add(obj)
      return true
    }

    if ("beginRendering" in obj) {
      val brVal = obj["beginRendering"] as? JsonObject
      if (brVal != null) {
        surfaceId = brVal["surfaceId"]?.jsonPrimitive?.content ?: surfaceId
      }
      rootId = brVal?.get("root")?.jsonPrimitive?.content ?: rootId ?: "root"
      bufferedStartMessage = obj

      if (!yieldedStartMessages.contains(effectiveSid)) {
        yieldMessages(listOf(obj), messages)
        yieldedStartMessages.add(effectiveSid)
        yieldedSurfacesSet.add(effectiveSid)
        bufferedStartMessage = null
      }

      val pendingList = pendingMessages.remove(effectiveSid)
      if (pendingList != null) {
        for (pendingMsg in pendingList) {
          handleCompleteObject(pendingMsg, effectiveSid, messages)
        }
      }

      yieldReachable(messages)
      return true
    }

    if ("surfaceUpdate" in obj) {
      addMsgType("surfaceUpdate")
      val comps = (obj["surfaceUpdate"] as? JsonObject)?.get("components") as? JsonArray
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

    if ("dataModelUpdate" in obj) {
      addMsgType("dataModelUpdate")
      val dmVal = obj["dataModelUpdate"] as? JsonObject
      if (dmVal != null) {
        updateDataModel(dmVal, messages)
      }
      yieldMessages(listOf(obj), messages)
      yieldReachable(messages, checkRoot = false, raiseOnOrphans = false)
      return true
    }

    if ("deleteSurface" in obj) {
      yieldMessages(listOf(obj), messages)
      return true
    }

    yieldMessages(listOf(obj), messages)
    return true
  }

  override fun constructPartialMessage(
    processedComponents: List<JsonObject>,
    activeMsgType: String,
  ): JsonObject {
    val payloadMap = mutableMapOf<String, JsonElement>()
    surfaceId?.let { payloadMap["surfaceId"] = JsonPrimitive(it) }
    payloadMap["components"] = JsonArray(processedComponents)
    return JsonObject(mapOf("surfaceUpdate" to JsonObject(payloadMap)))
  }

  override fun getActiveMsgTypeForComponents(): String? {
    if (activeMsgType != null) return activeMsgType
    for (mt in _msgTypes) {
      if (mt in listOf("surfaceUpdate", "beginRendering")) {
        activeMsgType = mt
        return mt
      }
    }
    return _msgTypes.firstOrNull()
  }

  override fun deduplicateDataModel(m: JsonObject, strictIntegrity: Boolean): Boolean {
    if ("dataModelUpdate" in m) {
      val dm = m["dataModelUpdate"] as? JsonObject ?: return true
      val rawContents = dm["contents"]
      val contentsDict = mutableMapOf<String, JsonElement>()

      if (rawContents is JsonArray) {
        for (entry in rawContents) {
          if (entry is JsonObject) {
            val key = entry["key"]?.jsonPrimitive?.content
            val valElem =
              entry["valueString"]
                ?: entry["valueNumber"]
                ?: entry["valueBoolean"]
                ?: entry["valueMap"]
            if (key != null && valElem != null) {
              contentsDict[key] = valElem
            }
          }
        }
      } else if (rawContents is JsonObject) {
        contentsDict.putAll(rawContents)
      }

      if (contentsDict.isNotEmpty()) {
        var isNew = false
        for ((k, v) in contentsDict) {
          if (yieldedDataModel[k] != v) {
            isNew = true
            break
          }
        }
        if (!isNew && strictIntegrity) {
          return false
        }
        yieldedDataModel.putAll(contentsDict)
      }
    }
    return true
  }
}
