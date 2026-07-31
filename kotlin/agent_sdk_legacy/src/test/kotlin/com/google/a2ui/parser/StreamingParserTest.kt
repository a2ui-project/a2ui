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

import com.google.a2ui.schema.A2uiConstants
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

class StreamingParserTest {

  @Test
  fun deduplicatesMessageTypesCorrectly() {
    val parser = StreamingParser.create(null)
    parser.addMsgType("surfaceUpdate")
    parser.addMsgType("surfaceUpdate")
    assertEquals(listOf("surfaceUpdate"), parser.msgTypes)

    parser.addMsgType("beginRendering")
    assertEquals(listOf("surfaceUpdate", "beginRendering"), parser.msgTypes)
    parser.addMsgType("surfaceUpdate")
    assertEquals(listOf("surfaceUpdate", "beginRendering"), parser.msgTypes)
  }

  @Test
  fun sniffsAndDeduplicatesV08SurfaceUpdateMessageTypes() {
    val parser = StreamingParser.create(null)
    val chunk1 =
      "${A2uiConstants.A2UI_OPEN_TAG}[{\"surfaceUpdate\": {\"surfaceId\": \"s1\", \"components\": ["
    parser.processChunk(chunk1)

    assertTrue(parser.msgTypes.contains("surfaceUpdate"))
    assertEquals(1, parser.msgTypes.count { it == "surfaceUpdate" })

    val chunk2 =
      "{\"id\": \"root\", \"component\": {\"Text\": {\"text\": \"hi\"}}}]}] ${A2uiConstants.A2UI_CLOSE_TAG}"
    parser.processChunk(chunk2)

    assertTrue(parser.msgTypes.isEmpty())
  }

  @Test
  fun sniffsAndDeduplicatesV09UpdateComponentsMessageTypes() {
    // Force v0.9 parser via StreamingParserV09 directly since null catalog defaults to v0.8 in
    // create()
    val parser = StreamingParserV09(null)
    val chunk1 =
      "${A2uiConstants.A2UI_OPEN_TAG}[{\"version\": \"v0.9\", \"updateComponents\": {\"surfaceId\": \"s1\", \"root\": \"root\", \"components\": [{\"id\": \"root\", \"component\": \"Text\", \"text\": \"Hello\"}"
    parser.processChunk(chunk1)

    assertTrue(parser.msgTypes.contains("updateComponents"))
    assertEquals(1, parser.msgTypes.count { it == "updateComponents" })

    val chunk2 =
      ", {\"id\": \"c1\", \"component\": \"Text\", \"text\": \"hi\"}]}}] ${A2uiConstants.A2UI_CLOSE_TAG}"
    parser.processChunk(chunk2)

    assertTrue(parser.msgTypes.isEmpty())
  }

  @Test
  fun addsLeadingSlashToRelativePathsInV08() {
    val parser = StreamingParserV08(null)

    val chunkBr =
      "${A2uiConstants.A2UI_OPEN_TAG}[{\"beginRendering\": {\"surfaceId\": \"s1\", \"root\": \"root\"}}]${A2uiConstants.A2UI_CLOSE_TAG}"
    parser.processChunk(chunkBr)

    val chunkSu =
      "${A2uiConstants.A2UI_OPEN_TAG}[{\"surfaceUpdate\": {\"surfaceId\": \"s1\", \"components\": [{\"id\": \"root\", \"component\": {\"Text\": {\"text\": {\"path\": \"some/relative/path\"}}}}]}}]${A2uiConstants.A2UI_CLOSE_TAG}"
    val parts = parser.processChunk(chunkSu)

    val messages = parts.flatMap { it.a2uiJson ?: emptyList() }
    assertTrue(messages.isNotEmpty())

    val suObj = messages[0] as? JsonObject
    assertNotNull(suObj)
    val comps = (suObj["surfaceUpdate"] as? JsonObject)?.get("components") as? JsonArray
    assertNotNull(comps)

    val comp = comps[0] as? JsonObject
    assertNotNull(comp)
    val compObj = comp["component"] as? JsonObject
    val textObj = compObj?.get("Text") as? JsonObject
    val textInner = textObj?.get("text") as? JsonObject
    val pathStr = textInner?.get("path")?.jsonPrimitive?.content

    assertEquals("/some/relative/path", pathStr)
  }

  @Test
  fun preservesRelativePathsInV09() {
    val parser = StreamingParserV09(null)

    val chunkCs =
      "${A2uiConstants.A2UI_OPEN_TAG}[{\"version\": \"v0.9\", \"createSurface\": {\"surfaceId\": \"s1\", \"catalogId\": \"c1\"}}]${A2uiConstants.A2UI_CLOSE_TAG}"
    parser.processChunk(chunkCs)

    val chunkUc =
      "${A2uiConstants.A2UI_OPEN_TAG}[{\"version\": \"v0.9\", \"updateComponents\": {\"surfaceId\": \"s1\", \"components\": [{\"id\": \"root\", \"component\": \"Text\", \"text\": {\"path\": \"some/relative/path\"}}]}}]${A2uiConstants.A2UI_CLOSE_TAG}"
    val parts = parser.processChunk(chunkUc)

    val messages = parts.flatMap { it.a2uiJson ?: emptyList() }
    assertTrue(messages.isNotEmpty())

    val ucObj = messages[0] as? JsonObject
    assertNotNull(ucObj)
    val comps = (ucObj["updateComponents"] as? JsonObject)?.get("components") as? JsonArray
    assertNotNull(comps)

    val comp = comps[0] as? JsonObject
    assertNotNull(comp)
    val pathStr = (comp["text"] as? JsonObject)?.get("path")?.jsonPrimitive?.content

    assertEquals("some/relative/path", pathStr)
  }

  @Test
  fun preservesAbsolutePathsInV09() {
    val parser = StreamingParserV09(null)

    val chunkCs =
      "${A2uiConstants.A2UI_OPEN_TAG}[{\"version\": \"v0.9\", \"createSurface\": {\"surfaceId\": \"s1\", \"catalogId\": \"c1\"}}]${A2uiConstants.A2UI_CLOSE_TAG}"
    parser.processChunk(chunkCs)

    val chunkUc =
      "${A2uiConstants.A2UI_OPEN_TAG}[{\"version\": \"v0.9\", \"updateComponents\": {\"surfaceId\": \"s1\", \"components\": [{\"id\": \"root\", \"component\": \"Text\", \"text\": {\"path\": \"/absolute/path\"}}]}}]${A2uiConstants.A2UI_CLOSE_TAG}"
    val parts = parser.processChunk(chunkUc)

    val messages = parts.flatMap { it.a2uiJson ?: emptyList() }
    assertTrue(messages.isNotEmpty())

    val ucObj = messages[0] as? JsonObject
    assertNotNull(ucObj)
    val comps = (ucObj["updateComponents"] as? JsonObject)?.get("components") as? JsonArray
    assertNotNull(comps)

    val comp = comps[0] as? JsonObject
    assertNotNull(comp)
    val pathStr = (comp["text"] as? JsonObject)?.get("path")?.jsonPrimitive?.content

    assertEquals("/absolute/path", pathStr)
  }

  @Test
  fun throwsExceptionWhenJsonBufferExceedsMaxSizeLimit() {
    val parser = StreamingParser.create(null)
    parser.processChunk(A2uiConstants.A2UI_OPEN_TAG)
    val hugeChunk = String(CharArray(5 * 1024 * 1024 + 1) { ' ' })
    assertFailsWith<IllegalArgumentException> { parser.processChunk(hugeChunk) }
  }
}
