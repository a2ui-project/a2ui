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

package com.google.a2ui.express

import com.google.a2ui.inference_formats.experimental.express.ExpressFormat
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiSchemaManager
import com.google.a2ui.schema.A2uiVersion
import com.google.a2ui.schema.CatalogConfig
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject

class ExpressFormatTest {

  private val catalogPath = findSpecCatalogPath()

  private fun findSpecCatalogPath(): String {
    var dir: File? = File(".").canonicalFile
    while (dir != null) {
      val specFile = File(dir, "specification/v0_9/catalogs/basic/catalog.json")
      if (specFile.exists()) return specFile.absolutePath
      dir = dir.parentFile
    }
    throw IllegalStateException("Catalog file not found")
  }

  private val catalog: A2uiCatalog by lazy {
    val config = CatalogConfig.fromPath("basic", catalogPath)
    val manager = A2uiSchemaManager(version = A2uiVersion.VERSION_0_9, catalogs = listOf(config))
    manager.getSelectedCatalog()
  }

  @Test
  fun testExpressFormatIntegration() {
    val format = ExpressFormat(catalog = catalog, surfaceId = "test_surface")
    assertFalse(format.supportsStreaming)

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
    assertEquals(2, responseParts.size)

    val textPart = responseParts.first { it.a2uiRaw == null }
    assertTrue(textPart.text.contains("Here is the requested interface:"))

    val expressPart = responseParts.first { it.a2uiRaw != null }
    assertNotNull(expressPart.a2uiJson)
    assertEquals(1, expressPart.a2uiJson!!.size)

    val jsonMessage = expressPart.a2uiJson!![0] as JsonObject
    assertTrue(jsonMessage.containsKey("createSurface"))
  }
}
