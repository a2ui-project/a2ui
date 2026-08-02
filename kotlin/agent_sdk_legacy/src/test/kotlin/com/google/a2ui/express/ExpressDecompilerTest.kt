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

import com.google.a2ui.inference_formats.experimental.express.ExpressCompiler
import com.google.a2ui.inference_formats.experimental.express.ExpressDecompiler
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiSchemaManager
import com.google.a2ui.schema.A2uiVersion
import com.google.a2ui.schema.CatalogConfig
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

class ExpressDecompilerTest {

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
  fun testDecompileDeleteSurface() {
    val decompiler = ExpressDecompiler(catalog)
    val envelope =
      JsonObject(
        mapOf(
          "version" to JsonPrimitive("v1.0"),
          "deleteSurface" to JsonObject(mapOf("surfaceId" to JsonPrimitive("surf_123"))),
        )
      )
    val dsl = decompiler.decompile(envelope)
    assertEquals("deleteSurface(\"surf_123\")", dsl)
  }

  @Test
  fun testRoundTripCompilationDecompilation() {
    val compiler = ExpressCompiler(catalog)
    val decompiler = ExpressDecompiler(catalog)

    val dsl =
      """
      root = Column([txt])
      txt = Text("Hello World")
    """
        .trimIndent()

    val compiled = compiler.compile(dsl, surfaceId = "main") as JsonObject
    val decompiled = decompiler.decompile(compiled)

    assertTrue(decompiled.contains("root = Column"))
    assertTrue(decompiled.contains("txt = Text(\"Hello World\")"))
  }
}
