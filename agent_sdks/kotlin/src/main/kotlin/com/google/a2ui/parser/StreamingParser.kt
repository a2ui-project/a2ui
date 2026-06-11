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
import com.google.a2ui.schema.A2uiConstants
import com.google.a2ui.schema.A2uiValidator
import com.google.a2ui.schema.A2uiVersion
import com.google.a2ui.schema.TopologyAnalyzer
import java.util.logging.Logger
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Abstract base class for streaming A2UI parsing. */
abstract class StreamingParser(
  protected val catalog: A2uiCatalog?,
  protected val schemaMappings: Map<String, String> = emptyMap(),
) {

  protected open val version: A2uiVersion? = catalog?.version
  protected val refFieldsMap: Map<String, Pair<Set<String>, Set<String>>> =
    catalog?.let { TopologyAnalyzer.extractComponentRefFields(it) } ?: emptyMap()
  protected val requiredFieldsMap: Map<String, Set<String>> =
    catalog?.let { TopologyAnalyzer.extractComponentRequiredFields(it) } ?: emptyMap()
  protected val cuttableKeys: Set<String> = catalog?.cuttableKeys ?: emptySet()
  internal var validator: A2uiValidator? = catalog?.let { A2uiValidator(it, schemaMappings) }

  protected var foundDelimiter = false
  protected val buffer = StringBuilder()
  protected val jsonBuffer = StringBuilder()
  protected val braceStack = mutableListOf<Pair<String, Int>>()
  protected var braceCount = 0
  protected var inTopLevelList = false
  protected var inString = false
  protected var stringEscaped = false

  protected val seenComponents = mutableMapOf<String, JsonObject>()
  protected val yieldedDataModel = mutableMapOf<String, JsonElement>()
  protected val deletedSurfaces = mutableSetOf<String>()

  protected val yieldedIds = mutableMapOf<String, MutableSet<String>>()
  protected val yieldedContents = mutableMapOf<Pair<String, String>, JsonObject>()

  protected val rootIds = mutableMapOf<String, String>()
  protected var defaultRootId: String? = null
  protected var unboundRootId: String? = null

  private var _surfaceId: String? = null
  var surfaceId: String?
    get() = _surfaceId
    set(value) {
      _surfaceId = value
      if (value != null && unboundRootId != null) {
        rootIds[value] = unboundRootId!!
        unboundRootId = null
      }
    }

  var rootId: String?
    get() {
      val sid = surfaceId
      if (sid != null) {
        return rootIds[sid] ?: defaultRootId
      }
      return unboundRootId ?: defaultRootId
    }
    set(value) {
      val sid = surfaceId
      if (sid != null) {
        if (value != null) {
          rootIds[sid] = value
        } else {
          rootIds.remove(sid)
        }
      } else {
        unboundRootId = value
      }
    }

  protected val _msgTypes = mutableListOf<String>()
  val msgTypes: List<String>
    get() = _msgTypes

  fun addMsgType(msgType: String) {
    if (msgType !in _msgTypes) {
      _msgTypes.add(msgType)
    }
    if (msgType in listOf("surfaceUpdate", "updateComponents", "createSurface")) {
      activeMsgType = msgType
    }
  }

  protected val yieldedStartMessages = mutableSetOf<String>()
  protected var activeMsgType: String? = null
  protected val pendingMessages = mutableMapOf<String, MutableList<JsonObject>>()
  protected var bufferedStartMessage: JsonObject? = null
  protected var topologyDirty = false
  protected var foundValidJsonInBlock = false

  protected abstract val placeholderComponent: JsonObject
  protected abstract val yieldedSurfacesSet: MutableSet<String>
  protected abstract val dataModelMsgType: String

  abstract fun isProtocolMsg(obj: JsonObject): Boolean

  protected abstract fun getActiveMsgTypeForComponents(): String?

  protected abstract fun handleCompleteObject(
    obj: JsonObject,
    sid: String?,
    messages: MutableList<ResponsePart>,
  ): Boolean

  protected abstract fun constructPartialMessage(
    processedComponents: List<JsonObject>,
    activeMsgType: String,
  ): JsonObject

  protected open fun deduplicateDataModel(m: JsonObject, strictIntegrity: Boolean): Boolean = true

  protected open fun constructSniffedDataModelMessage(
    activeMsgType: String,
    deltaMsgPayload: JsonObject,
  ): JsonObject {
    return JsonObject(mapOf(activeMsgType to deltaMsgPayload))
  }

  protected fun fixJson(fragment: String): String {
    var fixed = fragment.trimEnd()
    if (fixed.isEmpty()) return ""

    val stack = mutableListOf<Char>()
    var inStr = false
    var escaped = false
    var lastQuoteIdx = -1

    for (i in fixed.indices) {
      val char = fixed[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (char == '\\') {
        escaped = true
        continue
      }
      if (char == '"') {
        inStr = !inStr
        if (inStr) {
          lastQuoteIdx = i
        }
      } else if (!inStr) {
        if (char == '{' || char == '[') {
          stack.add(char)
        } else if (char == '}' || char == ']') {
          if (stack.isNotEmpty()) {
            stack.removeAt(stack.lastIndex)
          }
        }
      }
    }

    if (inStr) {
      val prefix = fixed.substring(0, lastQuoteIdx).trimEnd()
      if (prefix.endsWith(":")) {
        val keyMatch = KEY_MATCH_REGEX.find(prefix)
        if (keyMatch != null) {
          val key = keyMatch.groupValues[1]
          if (key !in cuttableKeys) {
            return ""
          }

          if (key == "valueString") {
            val stringVal = fixed.substring(lastQuoteIdx + 1)
            if (
              stringVal.startsWith("http://") ||
                stringVal.startsWith("https://") ||
                stringVal.startsWith("data:") ||
                stringVal.startsWith("/")
            ) {
              return ""
            }

            val searchPrefix =
              if (prefix.length > 200) prefix.substring(prefix.length - 200) else prefix
            val prevKeyMatches = PREV_KEY_MATCHES_REGEX.findAll(searchPrefix).toList()
            if (prevKeyMatches.isNotEmpty()) {
              val dataKey = prevKeyMatches.last().groupValues[1].lowercase()
              if (listOf("url", "link", "src", "href", "image").any { it in dataKey }) {
                return ""
              }
            }
          }
        }
      }
      fixed += '"'
    }

    fixed = fixed.trimEnd()
    if (fixed.endsWith(",")) {
      fixed = fixed.substring(0, fixed.length - 1).trimEnd()
    }

    while (stack.isNotEmpty()) {
      val opening = stack.removeAt(stack.lastIndex)
      fixed += if (opening == '{') "}" else "]"
    }

    return fixed
  }

  protected fun resetJsonState() {
    jsonBuffer.clear()
    braceStack.clear()
    braceCount = 0
    inTopLevelList = false
    inString = false
    stringEscaped = false
    _msgTypes.clear()
    foundValidJsonInBlock = false
  }

  protected fun deleteSurface(sid: String) {
    pendingMessages.remove(sid)
    yieldedIds.remove(sid)

    val keysToRemove = yieldedContents.keys.filter { it.first == sid }
    keysToRemove.forEach { yieldedContents.remove(it) }

    yieldedSurfacesSet.remove(sid)
    yieldedStartMessages.remove(sid)
    deletedSurfaces.add(sid)
  }

  protected fun yieldMessages(
    messagesToYield: List<JsonObject>,
    messages: MutableList<ResponsePart>,
    strictIntegrity: Boolean = true,
  ) {
    for (m in messagesToYield) {
      if (!deduplicateDataModel(m, strictIntegrity)) {
        continue
      }

      val currentValidator = validator
      if (currentValidator != null) {
        try {
          currentValidator.validate(m, strictIntegrity = strictIntegrity)
        } catch (e: Exception) {
          if (strictIntegrity) {
            throw e
          } else {
            var partialValid = false
            if ("updateComponents" in m) {
              val comps = m["updateComponents"]?.jsonObject?.get("components")?.jsonArray
              if (comps != null) {
                var allCompsValid = true
                for (i in 0 until comps.size) {
                  val cElem = comps[i]
                  val cObj = cElem.jsonObject
                  val cType = cObj["component"]?.jsonPrimitive?.content ?: continue
                  val catalogComps = catalog?.catalogSchema?.get("components")?.jsonObject
                  if (catalogComps != null && !catalogComps.containsKey(cType)) {
                    allCompsValid = false
                    break
                  }
                  val requiredKeys = requiredFieldsMap[cType] ?: emptySet()
                  for (reqKey in requiredKeys) {
                    if (reqKey !in cObj) {
                      allCompsValid = false
                      break
                    }
                  }
                  if (!allCompsValid) break
                }
                partialValid = allCompsValid
              }
            }
            if (!partialValid) {
              continue
            }
          }
        }
      }

      if (messages.isNotEmpty() && messages.last().a2uiJson == null) {
        val last = messages.last()
        messages[messages.lastIndex] = last.copy(a2uiJson = listOf(m))
      } else if (messages.isNotEmpty() && messages.last().a2uiJson != null) {
        val last = messages.last()
        val updated = last.a2uiJson!! + m
        messages[messages.lastIndex] = last.copy(a2uiJson = updated)
      } else {
        messages.add(ResponsePart(text = "", a2uiJson = listOf(m)))
      }
    }
  }

  fun processChunk(chunk: String): List<ResponsePart> {
    val messages = mutableListOf<ResponsePart>()
    buffer.append(chunk)

    while (true) {
      if (!foundDelimiter) {
        val openTag = A2uiConstants.A2UI_OPEN_TAG
        val idx = buffer.indexOf(openTag)
        if (idx != -1) {
          val textBefore = buffer.substring(0, idx)
          if (textBefore.isNotEmpty()) {
            messages.add(ResponsePart(text = textBefore))
          }
          foundDelimiter = true
          buffer.delete(0, idx + openTag.length)
        } else {
          var keepLen = 0
          for (i in openTag.length - 1 downTo 1) {
            if (buffer.endsWith(openTag.substring(0, i))) {
              keepLen = i
              break
            }
          }
          if (buffer.length > keepLen) {
            val safeToYield = buffer.length - keepLen
            val textToYield = buffer.substring(0, safeToYield)
            messages.add(ResponsePart(text = textToYield))
            buffer.delete(0, safeToYield)
          }
          break
        }
      }

      if (foundDelimiter) {
        val closeTag = A2uiConstants.A2UI_CLOSE_TAG
        val idx = buffer.indexOf(closeTag)
        if (idx != -1) {
          val jsonFragment = buffer.substring(0, idx)
          processJsonChunk(jsonFragment, messages)
          if (!foundValidJsonInBlock) {
            throw IllegalArgumentException(
              "Failed to parse JSON: No valid JSON object found in A2UI block."
            )
          }

          foundDelimiter = false
          resetJsonState()
          buffer.delete(0, idx + closeTag.length)
        } else {
          var keepLen = 0
          for (i in 1 until closeTag.length) {
            if (buffer.endsWith(closeTag.substring(0, i))) {
              keepLen = i
            }
          }
          if (keepLen < buffer.length) {
            val toProcess = buffer.substring(0, buffer.length - keepLen)
            buffer.delete(0, buffer.length - keepLen)
            processJsonChunk(toProcess, messages)
          }
          break
        }
      }
    }

    // Deduplicate surfaceUpdate messages
    for (i in messages.indices) {
      val part = messages[i]
      val a2uiJson = part.a2uiJson ?: continue

      val dedupedMsgs = mutableListOf<JsonElement>()
      val seenSu = mutableSetOf<String>()

      for (j in a2uiJson.indices.reversed()) {
        val m = a2uiJson[j]
        var isSu = false
        var sid: String? = null

        if (m is JsonObject) {
          val suObj = m["surfaceUpdate"] as? JsonObject
          if (suObj != null) {
            isSu = true
            sid = suObj["surfaceId"]?.jsonPrimitive?.content
          }
        }

        if (isSu && sid != null) {
          if (!seenSu.contains(sid)) {
            dedupedMsgs.add(m)
            seenSu.add(sid)
          }
        } else {
          dedupedMsgs.add(m)
        }
      }
      dedupedMsgs.reverse()
      messages[i] = part.copy(a2uiJson = dedupedMsgs)
    }

    if (chunk.contains("s.png")) {
      System.err.println(
        "DEBUG RETURN step 3: chunk=$chunk, size=${messages.size}, msgs=$messages, jsonBuffer=$jsonBuffer, braceCount=$braceCount, braceStack=$braceStack"
      )
    }

    return messages
  }

  protected fun processJsonChunk(chunk: String, messages: MutableList<ResponsePart>) {
    if (jsonBuffer.length + chunk.length > MAX_JSON_BUFFER_SIZE) {
      throw IllegalArgumentException("A2UI JSON buffer exceeded maximum size limit.")
    }
    for (i in chunk.indices) {
      val char = chunk[i]
      var charHandled = false

      if (!inTopLevelList) {
        if (char == '[') {
          if (braceCount == 0) {
            inTopLevelList = true
          }
          braceStack.add("[" to jsonBuffer.length)
          jsonBuffer.append("[")
          braceCount++
          charHandled = true
        } else {
          continue
        }
      }

      if (!charHandled && inString) {
        if (stringEscaped) {
          stringEscaped = false
          if (braceCount > 0) jsonBuffer.append(char)
        } else if (char == '\\') {
          stringEscaped = true
          if (braceCount > 0) jsonBuffer.append(char)
        } else if (char == '"') {
          inString = false
          if (braceCount > 0) jsonBuffer.append(char)
        } else {
          if (braceCount > 0) jsonBuffer.append(char)
        }
        charHandled = true
      }

      if (!charHandled) {
        if (char == '"') {
          inString = true
          stringEscaped = false
          if (braceCount > 0) jsonBuffer.append(char)
        } else if (char == '{') {
          if (braceCount == 0) {
            _msgTypes.clear()
          }
          braceStack.add("{" to jsonBuffer.length)
          jsonBuffer.append("{")
          braceCount++
        } else if (char == '}') {
          if (braceStack.isNotEmpty()) {
            val (_, startIdx) = braceStack.removeAt(braceStack.lastIndex)
            jsonBuffer.append("}")
            braceCount--

            if (braceCount >= 0) {
              val objBuffer = jsonBuffer.substring(startIdx)
              if (objBuffer.startsWith("{") && objBuffer.endsWith("}")) {
                val isTopLevel =
                  braceStack.isEmpty() ||
                    (inTopLevelList && braceStack.size == 1 && braceStack[0].first == "[")

                try {
                  val obj = Json.parseToJsonElement(objBuffer) as? JsonObject
                  if (obj != null) {
                    foundValidJsonInBlock = true

                    val isProtocol = inTopLevelList && isProtocolMsg(obj)
                    val isComp = obj.containsKey("id") && obj.containsKey("component")

                    if (isComp) {
                      handlePartialComponent(obj, messages)
                    } else if (isTopLevel || isProtocol) {
                      if (!handleCompleteObject(obj, surfaceId, messages)) {
                        yieldMessages(listOf(obj), messages, strictIntegrity = false)
                      }
                    }

                    if (braceCount == 0 || (inTopLevelList && braceStack.size == 1)) {
                      if (braceStack.size == 1 && braceStack[0].first == "[") {
                        jsonBuffer.delete(startIdx, startIdx + objBuffer.length)
                      } else {
                        jsonBuffer.delete(0, objBuffer.length)
                        if (braceStack.isNotEmpty()) {
                          val shift = objBuffer.length
                          for (j in braceStack.indices) {
                            val p = braceStack[j]
                            braceStack[j] = p.first to (p.second - shift)
                          }
                        }
                      }
                    }
                  }
                } catch (e: Exception) {
                  if (e is IllegalArgumentException && e !is SerializationException) {
                    throw e
                  }
                  logger.severe { "Parsing error: ${e.message}" }
                }
              }
            }
          }
        } else if (char == '[') {
          braceStack.add("[" to jsonBuffer.length)
          jsonBuffer.append("[")
          braceCount++
        } else if (char == ']') {
          if (braceStack.isNotEmpty() && braceStack.last().first == "[") {
            braceStack.removeAt(braceStack.lastIndex)
            jsonBuffer.append("]")
            braceCount--
            if (braceCount == 0) {
              inTopLevelList = false
            }
          }
        } else {
          if (braceCount > 0) jsonBuffer.append(char)
        }
      }

      if (
        braceCount > 0 && (char == '"' || char == ':' || char == ',' || char == '}' || char == ']')
      ) {
        sniffMetadata()
      }
    }

    if (foundDelimiter) {
      sniffMetadata()
      sniffPartialDataModel(messages)
      sniffPartialComponent(messages)
      yieldReachable(messages, checkRoot = false, raiseOnOrphans = false)
      topologyDirty = false
    } else {
      if (braceCount >= 1 && jsonBuffer.isNotEmpty()) {
        sniffPartialComponent(messages)
        sniffPartialDataModel(messages)
      }

      if (topologyDirty) {
        yieldReachable(messages, checkRoot = false, raiseOnOrphans = false)
        topologyDirty = false
      }
    }
  }

  protected abstract fun sniffMetadata()

  protected fun getLatestValue(key: String): String? {
    var idx = jsonBuffer.length
    val searchStr = "\"$key\""
    while (true) {
      idx = jsonBuffer.lastIndexOf(searchStr, idx - 1)
      if (idx == -1) return null

      val match =
        when (key) {
          "surfaceId" -> SURFACE_ID_REGEX.find(jsonBuffer, idx)
          "root" -> ROOT_ID_REGEX.find(jsonBuffer, idx)
          else -> {
            val fragment = jsonBuffer.substring(idx)
            val regex =
              LATEST_VALUE_REGEX_CACHE.getOrPut(key) { Regex("\"$key\"\\s*:\\s*\"([^\"]+)\"") }
            regex.find(fragment)
          }
        }
      if (match != null) {
        val isAtStart =
          if (key in listOf("surfaceId", "root")) match.range.first == idx
          else match.range.first == 0
        if (isAtStart) {
          return match.groupValues[1]
        }
      }
    }
  }

  protected fun sniffPartialComponent(messages: MutableList<ResponsePart>) {
    if (jsonBuffer.indexOf("\"components\"") == -1) return

    for (i in braceStack.indices.reversed()) {
      val (bType, startIdx) = braceStack[i]
      if (bType != "{") continue

      val rawFragment = jsonBuffer.substring(startIdx)
      if (rawFragment.isEmpty()) continue

      val fixedFragment = fixJson(rawFragment)
      try {
        val obj = Json.parseToJsonElement(fixedFragment) as? JsonObject
        if (
          obj != null && obj["id"]?.jsonPrimitive?.content != null && obj.containsKey("component")
        ) {
          handlePartialComponent(obj, messages)
          break
        }
      } catch (e: Exception) {
        logger.warning { e.message }
        continue
      }
    }
  }

  protected fun sniffPartialDataModel(messages: MutableList<ResponsePart>) {
    val msgType = dataModelMsgType

    if (jsonBuffer.indexOf("\"$msgType\"") == -1) return

    for (i in braceStack.indices.reversed()) {
      val (bType, startIdx) = braceStack[i]
      if (bType != "{") continue

      val rawFragment = jsonBuffer.substring(startIdx)
      if (rawFragment.isEmpty()) continue

      val fixedFragment = fixJson(rawFragment)
      var obj: JsonObject? = null

      try {
        obj = Json.parseToJsonElement(fixedFragment) as? JsonObject
      } catch (_: Exception) {
        var commaIdx = rawFragment.lastIndexOf(',')
        while (commaIdx != -1) {
          val trimmed = rawFragment.substring(0, commaIdx)
          try {
            val fixedTrimmed = fixJson(trimmed)
            if (fixedTrimmed.isNotEmpty()) {
              obj = Json.parseToJsonElement(fixedTrimmed) as? JsonObject
              break
            }
          } catch (ex: Exception) {
            logger.warning { ex.message }
          }
          commaIdx = rawFragment.lastIndexOf(',', commaIdx - 1)
        }
      }

      if (obj != null && obj.containsKey(msgType)) {
        val dmObj = obj[msgType] as? JsonObject
        if (dmObj != null) {
          val contentsElem = dmObj["contents"]
          val valueElem = dmObj["value"]

          var deltaContents: JsonElement? = null
          val contentsDict = mutableMapOf<String, JsonElement>()

          if (contentsElem != null) {
            contentsDict.putAll(parseContentsToDict(contentsElem))
            val delta = mutableMapOf<String, JsonElement>()
            for ((k, v) in contentsDict) {
              if (yieldedDataModel[k] != v) {
                delta[k] = v
              }
            }

            if (delta.isNotEmpty()) {
              if (contentsElem is JsonArray) {
                val arr = mutableListOf<JsonElement>()
                val seenKeys = mutableSetOf<String>()
                for (j in contentsElem.indices.reversed()) {
                  val entry = contentsElem[j] as? JsonObject ?: continue
                  val k = entry["key"]?.jsonPrimitive?.content
                  if (k != null && contentsDict.containsKey(k) && !seenKeys.contains(k)) {
                    arr.add(0, entry)
                    seenKeys.add(k)
                  }
                }
                deltaContents = pruneIncompleteDatamodelEntries(JsonArray(arr))
              } else {
                deltaContents = JsonObject(delta)
              }
            }
          } else if (valueElem is JsonObject) {
            val delta = mutableMapOf<String, JsonElement>()
            for ((k, v) in valueElem) {
              if (yieldedDataModel[k] != v) {
                delta[k] = v
              }
            }
            if (delta.isNotEmpty()) {
              deltaContents = JsonObject(delta)
              contentsDict.putAll(delta)
            }
          }

          if (deltaContents != null) {
            val sid = dmObj["surfaceId"]?.jsonPrimitive?.content ?: surfaceId ?: "default"
            val payloadMap = mutableMapOf<String, JsonElement>()
            payloadMap["surfaceId"] = JsonPrimitive(sid)

            if (contentsElem != null) {
              payloadMap["contents"] = deltaContents
            } else {
              payloadMap["value"] = deltaContents
            }

            dmObj["path"]?.let { payloadMap["path"] = it }

            val deltaMsg = constructSniffedDataModelMessage(msgType, JsonObject(payloadMap))
            yieldMessages(listOf(deltaMsg), messages, strictIntegrity = false)

            yieldedDataModel.putAll(contentsDict)
            updateDataModel(dmObj, messages)
          }
        }
      }
    }
  }

  protected fun pruneIncompleteDatamodelEntries(entries: JsonElement): JsonElement {
    if (entries !is JsonArray) return entries

    val pruned = mutableListOf<JsonElement>()
    for (entry in entries) {
      if (entry !is JsonObject) {
        pruned.add(entry)
        continue
      }

      val map = entry.toMutableMap()
      var hasVal = false
      for (vkey in listOf("value", "valueString", "valueNumber", "valueBoolean")) {
        if (map.containsKey(vkey)) {
          hasVal = true
          break
        }
      }

      val valMapElem = map["valueMap"]
      if (valMapElem != null) {
        val prunedMap = pruneIncompleteDatamodelEntries(valMapElem)
        if (prunedMap is JsonArray) {
          if (prunedMap.isEmpty() && (valMapElem as? JsonArray)?.isNotEmpty() == true) {
            map.remove("valueMap")
          } else {
            map["valueMap"] = prunedMap
            hasVal = true
          }
        }
      }

      if (hasVal && map.containsKey("key")) {
        pruned.add(JsonObject(map))
      }
    }
    return JsonArray(pruned)
  }

  protected fun parseContentsToDict(rawContents: JsonElement): Map<String, JsonElement> {
    if (rawContents is JsonObject) return rawContents
    if (rawContents !is JsonArray) return emptyMap()

    val res = mutableMapOf<String, JsonElement>()
    for (entry in rawContents) {
      if (entry !is JsonObject) continue
      val key = entry["key"]?.jsonPrimitive?.content
      var valElem: JsonElement? = null

      for (vkey in listOf("value", "valueString", "valueNumber", "valueBoolean")) {
        if (entry.containsKey(vkey)) {
          valElem = entry[vkey]
          break
        }
      }

      if (valElem == null && entry.containsKey("valueMap")) {
        valElem = JsonObject(parseContentsToDict(entry["valueMap"]!!))
      }

      if (key != null && valElem != null) {
        res[key] = valElem
      }
    }
    return res
  }

  protected fun updateDataModel(update: JsonObject, messages: MutableList<ResponsePart>) {
    val rawContents = update["contents"]
    val contents =
      if (rawContents != null) {
        parseContentsToDict(rawContents)
      } else {
        val map = mutableMapOf<String, JsonElement>()
        for ((k, v) in update) {
          if (k !in listOf("surfaceId", "root", "contents")) {
            map[k] = v
          }
        }
        map
      }
    // Currently no extra marking logic needed
  }

  protected fun handlePartialComponent(comp: JsonObject, messages: MutableList<ResponsePart>) {
    val compId = comp["id"]?.jsonPrimitive?.content ?: return

    fun hasEmptyDict(elem: JsonElement): Boolean {
      when (elem) {
        is JsonObject -> {
          if (elem.isEmpty()) return true
          return elem.values.any { hasEmptyDict(it) }
        }
        is JsonArray -> {
          return elem.any { hasEmptyDict(it) }
        }
        else -> return false
      }
    }

    val compDefVal = comp["component"]
    if (compDefVal is JsonPrimitive && compDefVal.isString) {
      if (hasEmptyDict(comp)) return
    } else if (compDefVal is JsonObject) {
      if (hasEmptyDict(compDefVal)) return
    }

    if (compDefVal is JsonObject && requiredFieldsMap.isNotEmpty()) {
      val compType = compDefVal.keys.firstOrNull()
      if (compType != null) {
        val props = compDefVal[compType] as? JsonObject
        if (props != null) {
          val reqs = requiredFieldsMap[compType] ?: emptySet()
          for (req in reqs) {
            if (!props.containsKey(req)) return
          }
        }
      }
    }

    seenComponents[compId] = comp
    topologyDirty = true
  }

  protected fun yieldReachable(
    messages: MutableList<ResponsePart>,
    checkRoot: Boolean = false,
    raiseOnOrphans: Boolean = false,
  ) {
    val activeMsgType = getActiveMsgTypeForComponents()
    val currentRootId = rootId
    if (currentRootId == null || activeMsgType == null) return

    val sid = surfaceId ?: return
    if (!yieldedSurfacesSet.contains(sid) && bufferedStartMessage == null) return

    try {
      val componentsToAnalyze = seenComponents.values.toList()

      if (checkRoot && !seenComponents.containsKey(currentRootId)) {
        throw IllegalArgumentException(
          "No root component (id='$currentRootId') found in $activeMsgType"
        )
      }

      val reachableIds =
        TopologyAnalyzer.analyzeTopology(
          currentRootId,
          componentsToAnalyze,
          refFieldsMap,
          raiseOnOrphans = raiseOnOrphans,
        )

      val availableReachable = reachableIds.intersect(seenComponents.keys)

      if (checkRoot && availableReachable.isEmpty()) {
        throw IllegalArgumentException(
          "No root component (id='$currentRootId') found in $activeMsgType"
        )
      }

      val processedComponents = mutableListOf<JsonObject>()
      val extraComponents = mutableListOf<JsonObject>()
      val yieldedForSurface = yieldedIds[sid] ?: emptySet()

      for (rid in availableReachable.sorted()) {
        val comp = seenComponents[rid]!!
        val reYielding = yieldedForSurface.contains(rid)
        val processed = processComponentTopology(comp, extraComponents, inlineResolved = reYielding)
        processedComponents.add(processed)
      }

      processedComponents.addAll(extraComponents)

      if (deletedSurfaces.contains(sid)) return

      var shouldYield = false
      if ((availableReachable - yieldedForSurface).isNotEmpty()) {
        shouldYield = true
      } else {
        for (comp in processedComponents) {
          val cid = comp["id"]!!.jsonPrimitive.content
          if (yieldedContents[sid to cid] != comp) {
            shouldYield = true
            break
          }
        }
      }

      if (shouldYield) {
        if (bufferedStartMessage != null && !yieldedStartMessages.contains(sid)) {
          yieldMessages(listOf(bufferedStartMessage!!), messages, strictIntegrity = true)
          yieldedStartMessages.add(sid)
          yieldedSurfacesSet.add(sid)
        }

        val partialMsg = constructPartialMessage(processedComponents, activeMsgType)
        yieldMessages(listOf(partialMsg), messages, strictIntegrity = false)

        val set = yieldedIds.getOrPut(sid) { mutableSetOf() }
        set.addAll(availableReachable)

        for (comp in processedComponents) {
          val cid = comp["id"]!!.jsonPrimitive.content
          yieldedContents[sid to cid] = comp
        }
      }
    } catch (e: Exception) {
      val msg = e.message ?: ""
      if (
        raiseOnOrphans ||
          "Circular" in msg ||
          "Self-reference" in msg ||
          "recursion" in msg.lowercase() ||
          checkRoot
      ) {
        throw e
      }
    }
  }

  protected fun getPlaceholderId(childId: String): String = "loading_$childId"

  private fun addPlaceholderComponent(
    placeholderId: String,
    extraComponents: MutableList<JsonObject>,
    addedPlaceholderIds: MutableSet<String>,
  ) {
    if (addedPlaceholderIds.add(placeholderId)) {
      val placeholderCompMap = placeholderComponent.toMutableMap()
      placeholderCompMap["id"] = JsonPrimitive(placeholderId)
      extraComponents.add(JsonObject(placeholderCompMap))
    }
  }

  protected fun processComponentTopology(
    comp: JsonObject,
    extraComponents: MutableList<JsonObject>,
    inlineResolved: Boolean = false,
  ): JsonObject {
    val compId = comp["id"]?.jsonPrimitive?.content ?: "unknown"
    val addedPlaceholderIds = mutableSetOf<String>()
    extraComponents.forEach {
      it["id"]?.jsonPrimitive?.content?.let { id -> addedPlaceholderIds.add(id) }
    }

    fun transform(elem: JsonElement, parentKey: String? = null): JsonElement {
      when (elem) {
        is JsonObject -> {
          val map = elem.toMutableMap()

          val pathElem = map["path"]
          if (pathElem is JsonPrimitive && pathElem.isString && pathElem.content.startsWith("/")) {
            if (version != A2uiVersion.VERSION_0_9) {
              if (!map.containsKey("componentId")) {
                map.clear()
                map["path"] = pathElem
              }
            }
          } else if (version != A2uiVersion.VERSION_0_9) {
            if (pathElem != null) {
              val currentPath = pathElem.jsonPrimitive.content
              if (!currentPath.startsWith("/")) {
                if (!map.containsKey("componentId")) {
                  map.clear()
                }
                map["path"] = JsonPrimitive("/$currentPath")
              }
            }
          }

          val compDefElem = comp["component"]
          val compType =
            if (compDefElem is JsonObject) {
              compDefElem.keys.firstOrNull() ?: ""
            } else {
              compDefElem?.jsonPrimitive?.content ?: ""
            }
          val dynamicRefs = refFieldsMap[compType]?.let { it.first + it.second } ?: emptySet()
          val fieldsToInspect =
            setOf(
              "children",
              "explicitList",
              "child",
              "contentChild",
              "entryPointChild",
              "componentId",
            ) + dynamicRefs

          fieldsToInspect.forEach { field ->
            val fieldVal = map[field]
            if (fieldVal is JsonArray) {
              val validChildren = mutableListOf<JsonElement>()
              for (childElem in fieldVal) {
                if (childElem is JsonPrimitive && childElem.isString) {
                  val childId = childElem.content
                  if (seenComponents.containsKey(childId)) {
                    validChildren.add(childElem)
                  } else {
                    val placeholderId = getPlaceholderId(childId)
                    validChildren.add(JsonPrimitive(placeholderId))
                    addPlaceholderComponent(placeholderId, extraComponents, addedPlaceholderIds)
                  }
                } else {
                  validChildren.add(childElem)
                }
              }

              if (validChildren.isEmpty() && field in listOf("children", "explicitList")) {
                val term = "\"$field\""
                val termIdx = jsonBuffer.lastIndexOf(term)
                if (termIdx != -1) {
                  val afterField = jsonBuffer.substring(termIdx + term.length)
                  if ("[" in afterField && "]" !in afterField.substringBefore("[")) {
                    val placeholderId = "loading_children_$compId"
                    validChildren.add(JsonPrimitive(placeholderId))
                    addPlaceholderComponent(placeholderId, extraComponents, addedPlaceholderIds)
                  }
                }
              }
              map[field] = JsonArray(validChildren)
            } else if (fieldVal is JsonPrimitive && fieldVal.isString) {
              val childId = fieldVal.content
              if (!seenComponents.containsKey(childId)) {
                val placeholderId = getPlaceholderId(childId)
                map[field] = JsonPrimitive(placeholderId)
                addPlaceholderComponent(placeholderId, extraComponents, addedPlaceholderIds)
              }
            }
          }

          for ((k, v) in map.entries.toList()) {
            map[k] = transform(v, k)
          }
          return JsonObject(map)
        }
        is JsonArray -> {
          return JsonArray(elem.map { transform(it, parentKey) })
        }
        else -> return elem
      }
    }

    val compDefVal = comp["component"]
    return if (compDefVal is JsonObject) {
      val resMap = comp.toMutableMap()
      resMap["component"] = transform(compDefVal)
      JsonObject(resMap)
    } else {
      transform(comp) as JsonObject
    }
  }

  companion object {
    @JvmStatic internal val logger: Logger = Logger.getLogger(StreamingParser::class.java.name)

    private val KEY_MATCH_REGEX = Regex("\"([^\"]+)\"\\s*:\\s*$")
    private val PREV_KEY_MATCHES_REGEX = Regex("\"key\"\\s*:\\s*\"([^\"]+)\"")
    private val SURFACE_ID_REGEX = Regex("\"surfaceId\"\\s*:\\s*\"([^\"]+)\"")
    private val ROOT_ID_REGEX = Regex("\"root\"\\s*:\\s*\"([^\"]+)\"")
    private val LATEST_VALUE_REGEX_CACHE = mutableMapOf<String, Regex>()
    private const val MAX_JSON_BUFFER_SIZE = 5 * 1024 * 1024

    /** Factory method returning a version-specific parser instance. */
    fun create(
      catalog: A2uiCatalog? = null,
      schemaMappings: Map<String, String> = emptyMap(),
    ): StreamingParser {
      return if (catalog?.version == A2uiVersion.VERSION_0_9) {
        StreamingParserV09(catalog, schemaMappings)
      } else {
        StreamingParserV08(catalog, schemaMappings)
      }
    }
  }
}
