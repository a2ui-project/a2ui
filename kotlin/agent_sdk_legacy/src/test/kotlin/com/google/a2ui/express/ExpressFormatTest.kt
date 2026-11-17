/*
 * Copyright 2024 Google LLC
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

package com.google.a2ui.express

import com.google.a2ui.basic_catalog.BasicCatalog
import com.google.a2ui.inference_formats.experimental.express.ExpressFormat
import com.google.a2ui.inference_formats.experimental.express.ExpressStreamPart
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiSchemaManager
import com.google.a2ui.schema.A2uiVersion
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject

class ExpressFormatTest {

  private val catalog: A2uiCatalog by lazy {
    val config = BasicCatalog.getConfig(A2uiVersion.VERSION_1_0)
    val manager = A2uiSchemaManager(version = A2uiVersion.VERSION_1_0, catalogs = listOf(config))
    manager.getSelectedCatalog()
  }

  @Test
  fun testExpressFormatIntegration() {
    val format = ExpressFormat(catalog = catalog, surfaceId = "test_surface")
    assertTrue(format.supportsStreaming)

    val prompt = format.promptGenerator.generate("Agent Role", includeSchema = true)
    assertTrue(prompt.contains("Agent Role"))
    assertTrue(prompt.contains("<a2ui>"))

    val responseText =
      """
      Here is the requested interface:
      <a2ui>
      root = Text("Welcome")
      </a2ui>
    """
        .trimIndent()

    assertTrue(format.parser.hasFormatContent(responseText, complete = true))

    val responseParts = format.parser.parseResponse(responseText)
    assertEquals(1, responseParts.size)

    val expressPart = responseParts[0]
    assertTrue(expressPart.text.contains("Here is the requested interface:"))
    assertNotNull(expressPart.a2uiJson)
    assertEquals(1, expressPart.a2uiJson!!.size)

    val jsonMessage = expressPart.a2uiJson!![0] as JsonObject
    assertTrue(jsonMessage.containsKey("createSurface"))

    // Verify incremental streaming support
    val stream = format.parser.openStream()
    val p1 = stream.feed("Here is the requested interface:\n<a2ui>\n")
    assertEquals(listOf(ExpressStreamPart.Text("Here is the requested interface:")), p1)
    val p2 = stream.feed("root = Text(\"Welcome\")\n</a2ui>")
    assertEquals(1, p2.size)
    assertTrue(p2[0] is ExpressStreamPart.A2ui)
    assertTrue(stream.close().isEmpty())
  }
}
