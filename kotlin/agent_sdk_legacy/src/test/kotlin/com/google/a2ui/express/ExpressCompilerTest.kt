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

import com.google.a2ui.inference_formats.experimental.express.CatalogSchemaHelper
import com.google.a2ui.inference_formats.experimental.express.ExpressCompiler
import com.google.a2ui.inference_formats.experimental.express.ExpressFormat
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiSchemaManager
import com.google.a2ui.schema.A2uiVersion
import com.google.a2ui.schema.CatalogConfig
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

class ExpressCompilerTest {

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
  fun testSchemaHelper() {
    val helper = CatalogSchemaHelper(catalog)
    assertTrue(helper.components.containsKey("Text"))
    assertTrue(helper.components.containsKey("Column"))
    assertTrue(helper.functions.containsKey("required"))
  }

  @Test
  fun testPromptGenerator() {
    val fmt = ExpressFormat(catalog = catalog)
    val prompt = fmt.promptGenerator.generate(roleDescription = "Test Role", includeSchema = true)
    assertTrue(prompt.contains("Text("))
    assertTrue(prompt.contains("Column("))
    assertTrue(prompt.contains("required("))
  }

  @Test
  fun testCompilationBasic() {
    val compiler = ExpressCompiler(catalog)
    val dsl =
      """
      root = Column([repField, valueField])
      repField = TextField("Representative", $/form/rep, "Enter name")
      valueField = TextField("Deal Value", $/form/value, "0.00", "number", ?required)
    """
        .trimIndent()

    val envelope = compiler.compile(dsl, surfaceId = "test_surf") as JsonObject
    assertEquals("v1.0", (envelope["version"] as JsonPrimitive).content)

    val createSurf = envelope["createSurface"] as JsonObject
    assertEquals("test_surf", (createSurf["surfaceId"] as JsonPrimitive).content)

    val components = createSurf["components"] as JsonArray
    assertEquals(3, components.size)

    val rootComp =
      components.first { ((it as JsonObject)["id"] as JsonPrimitive).content == "root" }
        as JsonObject
    assertEquals("Column", (rootComp["component"] as JsonPrimitive).content)

    val repComp =
      components.first { ((it as JsonObject)["id"] as JsonPrimitive).content == "repField" }
        as JsonObject
    assertEquals("TextField", (repComp["component"] as JsonPrimitive).content)
    assertEquals("Representative", (repComp["label"] as JsonPrimitive).content)

    val repVal = repComp["value"] as JsonObject
    assertEquals("/form/rep", (repVal["path"] as JsonPrimitive).content)

    val valComp =
      components.first { ((it as JsonObject)["id"] as JsonPrimitive).content == "valueField" }
        as JsonObject
    assertNotNull(valComp["checks"])
  }

  @Test
  fun testDeleteSurfaceCompilation() {
    val compiler = ExpressCompiler(catalog)
    val dsl = "deleteSurface(\"test-surface-123\")"
    val envelope = compiler.compile(dsl) as JsonObject

    val deleteSurf = envelope["deleteSurface"] as JsonObject
    assertEquals("test-surface-123", (deleteSurf["surfaceId"] as JsonPrimitive).content)
  }

  @Test
  fun testCompilationV09MultiMessage() {
    val compiler = ExpressCompiler(catalog, version = "v0.9")
    val dsl =
      """
      root = Column([txt])
      txt = Text("Hello World")
      $/user/name = "Alice"
      """
        .trimIndent()

    val array = compiler.compile(dsl, surfaceId = "surf_v09") as JsonArray
    assertEquals(3, array.size)

    val msg0 = array[0] as JsonObject
    assertEquals("v0.9", (msg0["version"] as JsonPrimitive).content)
    val createSurf = msg0["createSurface"] as JsonObject
    assertEquals("surf_v09", (createSurf["surfaceId"] as JsonPrimitive).content)
    assertTrue(!createSurf.containsKey("components"))

    val msg1 = array[1] as JsonObject
    assertEquals("v0.9", (msg1["version"] as JsonPrimitive).content)
    val updateComps = msg1["updateComponents"] as JsonObject
    assertEquals("surf_v09", (updateComps["surfaceId"] as JsonPrimitive).content)
    assertTrue(updateComps.containsKey("components"))

    val msg2 = array[2] as JsonObject
    assertEquals("v0.9", (msg2["version"] as JsonPrimitive).content)
    val updateData = msg2["updateDataModel"] as JsonObject
    assertEquals("surf_v09", (updateData["surfaceId"] as JsonPrimitive).content)
  }

  @Test
  fun testCompilationV091Target() {
    val compiler = ExpressCompiler(catalog, version = "v0.9.1")
    val dsl = "root = Text(\"Hi\")"
    val array = compiler.compile(dsl, surfaceId = "surf_v091") as JsonArray
    assertEquals(2, array.size)
    assertEquals("v0.9.1", ((array[0] as JsonObject)["version"] as JsonPrimitive).content)
    assertEquals("v0.9.1", ((array[1] as JsonObject)["version"] as JsonPrimitive).content)
  }
}
