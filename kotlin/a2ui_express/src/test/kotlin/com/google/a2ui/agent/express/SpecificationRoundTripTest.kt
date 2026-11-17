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

package com.google.a2ui.agent.express

import com.google.a2ui.agent.RendererState
import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.Catalog
import com.google.a2ui.core.CreateSurfaceMessage
import com.google.a2ui.core.DeleteSurfaceMessage
import com.google.a2ui.core.Uax31Identifier
import com.google.a2ui.core.UpdateComponentsMessage
import com.google.a2ui.core.UpdateDataModelMessage
import com.google.a2ui.core.jsonValuesEqual
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

/**
 * Round-trip verification across all 43 `catalogs/basic/v1/examples/` golden JSON specification
 * examples.
 */
class SpecificationRoundTripTest {

  private fun findRepoRoot(): File {
    var cur: File? = File(System.getProperty("user.dir"))
    while (cur != null) {
      if (File(cur, "catalogs/basic/v1/examples").isDirectory) return cur
      cur = cur.parentFile
    }
    error("Could not locate repository root containing catalogs/basic/v1/examples.")
  }

  @TestFactory
  fun basicV1ExamplesRoundTrip(): List<DynamicTest> {
    val examplesDir = File(findRepoRoot(), "catalogs/basic/v1/examples")
    val files =
      examplesDir.listFiles { f -> f.isFile && f.name.endsWith(".json") }?.sortedBy { it.name }
        ?: emptyList()
    assertEquals(43, files.size, "Expected 43 basic v1 golden JSON examples.")

    val basicCatalog = Catalog.basicV1()
    val parser = ExpressParser(listOf(basicCatalog))

    return files.map { file ->
      DynamicTest.dynamicTest("basic/v1/examples/${file.name}") {
        val rawText = file.readText(Charsets.UTF_8)
        val parsed = Json.parseToJsonElement(rawText)
        val rawMessages =
          when (parsed) {
            is JsonArray -> parsed.map { it.jsonObject }
            is JsonObject -> {
              val inner = parsed["messages"] as? JsonArray
              inner?.map { it.jsonObject } ?: listOf(parsed)
            }
            else -> emptyList()
          }
        assertTrue(rawMessages.isNotEmpty(), "Example ${file.name} had no messages.")

        val normalizedJson = normalizeHyphenatedIds(rawMessages, basicCatalog.id)
        val originalModels =
          normalizedJson.map { AgentToRendererMessage.fromJsonObject(it, strict = false) }

        val expressDsl = parser.decompile(originalModels)
        assertTrue(expressDsl.isNotBlank(), "Decompiled Express DSL for ${file.name} was empty.")

        val recompiledModels = parser.compile(expressDsl)
        val turnState = RendererState(listOf(basicCatalog))
        for (msg in recompiledModels) {
          // Multi-turn examples replace placeholder components; check prior turn topology first.
          if (msg is UpdateComponentsMessage) {
            val existing = turnState.surfaceComponents(msg.surfaceId)
            if (
              existing != null &&
                msg.components.any { (it["id"] as? JsonPrimitive)?.contentOrNull in existing }
            ) {
              turnState.checkTopology(listOf(msg.surfaceId))
            }
          }
          turnState.apply(listOf(msg))
        }
        turnState.checkTopology(turnState.surfaceIds)

        val origState = applySurfaceSnapshot(basicCatalog, originalModels)
        val recompState = applySurfaceSnapshot(basicCatalog, recompiledModels)
        assertEquals(
          origState.keys,
          recompState.keys,
          "Active surface IDs mismatch in ${file.name}",
        )
        for ((sid, origSurf) in origState) {
          val recompSurf = recompState.getValue(sid)
          assertTrue(
            jsonValuesEqual(origSurf.first, recompSurf.first),
            "Component state mismatch on surface '$sid' in ${file.name}:\nExpected: ${origSurf.first}\nActual:   ${recompSurf.first}",
          )
          assertTrue(
            jsonValuesEqual(origSurf.second, recompSurf.second),
            "DataModel mismatch on surface '$sid' in ${file.name}:\nExpected: ${origSurf.second}\nActual:   ${recompSurf.second}",
          )
        }
      }
    }
  }

  private fun normalizeHyphenatedIds(
    messages: List<JsonObject>,
    defaultCatalogId: String,
  ): List<JsonObject> {
    val idMap = HashMap<String, String>()
    for (msg in messages) {
      for (op in listOf("createSurface", "updateComponents")) {
        val comps = (msg[op] as? JsonObject)?.get("components") as? JsonArray ?: continue
        for (c in comps) {
          val id = ((c as? JsonObject)?.get("id") as? JsonPrimitive)?.contentOrNull ?: continue
          if (!Uax31Identifier.isValidIdentifier(id)) {
            idMap[id] =
              id.replace(Regex("[^a-zA-Z0-9_]"), "_").let {
                if (Uax31Identifier.isValidIdentifier(it)) it else "_$it"
              }
          }
        }
      }
    }

    fun rewriteRefs(el: JsonElement): JsonElement =
      when (el) {
        is JsonPrimitive ->
          if (el.isString && el.content in idMap) JsonPrimitive(idMap.getValue(el.content)) else el
        is JsonArray -> JsonArray(el.map { rewriteRefs(it) })
        is JsonObject -> JsonObject(el.mapValues { (_, v) -> rewriteRefs(v) })
      }

    return messages.map { msg ->
      val rewritten = rewriteRefs(msg).jsonObject
      if ("createSurface" in rewritten) {
        val cs = LinkedHashMap<String, JsonElement>(rewritten["createSurface"]!!.jsonObject)
        if ("catalogId" !in cs) {
          cs["catalogId"] = JsonPrimitive(defaultCatalogId)
        }
        val top = LinkedHashMap<String, JsonElement>(rewritten)
        if ("version" !in top) top["version"] = JsonPrimitive("1.0")
        top["createSurface"] = JsonObject(cs)
        JsonObject(top)
      } else {
        rewritten
      }
    }
  }

  private fun applySurfaceSnapshot(
    catalog: Catalog,
    messages: List<AgentToRendererMessage>,
  ): Map<String, Pair<JsonObject, JsonObject>> {
    val state = RendererState(listOf(catalog))
    state.apply(messages)
    val dataBySurface = LinkedHashMap<String, MutableMap<String, Any?>>()
    val compiler = ExpressCompiler(listOf(catalog))

    for (msg in messages) {
      when (msg) {
        is CreateSurfaceMessage -> {
          val map = LinkedHashMap<String, Any?>()
          msg.dataModel?.let { dm -> compiler.setNestedPath(map, "$/", dm) }
          dataBySurface[msg.surfaceId] = map
        }
        is UpdateComponentsMessage -> {
          dataBySurface.putIfAbsent(msg.surfaceId, LinkedHashMap())
        }
        is UpdateDataModelMessage -> {
          val map = dataBySurface.getOrPut(msg.surfaceId) { LinkedHashMap() }
          val p = msg.path ?: "/"
          if (msg.value is JsonNull && p != "/" && p.isNotEmpty()) {
            val segments = p.trimStart('/').split('/')
            var cur: Any? = map
            for (s in segments.dropLast(1)) {
              cur = (cur as? Map<*, *>)?.get(s)
            }
            @Suppress("UNCHECKED_CAST") (cur as? MutableMap<String, Any?>)?.remove(segments.last())
          } else {
            compiler.setNestedPath(map, "$$p", msg.value)
          }
        }
        is DeleteSurfaceMessage -> dataBySurface.remove(msg.surfaceId)
        else -> {}
      }
    }

    val out = LinkedHashMap<String, Pair<JsonObject, JsonObject>>()
    for (sid in state.surfaceIds) {
      val comps = JsonObject(state.surfaceComponents(sid).orEmpty())
      val dm = compiler.toJsonObjectTree(dataBySurface[sid].orEmpty())
      out[sid] = comps to dm
    }
    return out
  }
}
