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

package com.google.a2ui.schema

import com.google.a2ui.basic_catalog.BasicCatalog
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CatalogTest {

  @Test
  fun resolvesExamplesPathHandling() {
    assertNull(resolveExamplesPath(null))
    assertEquals("/absolute/examples", resolveExamplesPath("/absolute/examples"))
    assertEquals("/absolute/examples", resolveExamplesPath("file:///absolute/examples"))

    val e =
      assertFailsWith<IllegalArgumentException> { resolveExamplesPath("https://a2ui.org/examples") }
    assertTrue(e.message?.contains("Unsupported examples URL scheme") == true)
  }

  @Test
  fun stripsPrefixFromCatalogConfigFromPathSchemes() {
    // Test local path
    var config =
      CatalogConfig.fromPath(name = "test_file", catalogPath = "relative_path/to/catalog.json")
    assertEquals(
      "relative_path/to/catalog.json",
      (config.provider as FileSystemCatalogProvider).path,
    )

    // Test file:// scheme
    config =
      CatalogConfig.fromPath(
        name = "test_file",
        catalogPath = "file:///absolute_path/to/catalog.json",
      )
    assertEquals(
      "/absolute_path/to/catalog.json",
      (config.provider as FileSystemCatalogProvider).path,
    )

    // Test HTTP raises NotImplementedError
    val eHttp =
      assertFailsWith<NotImplementedError> {
        CatalogConfig.fromPath(name = "test_http", catalogPath = "http://a2ui.org/catalog.json")
      }
    assertTrue(eHttp.message?.contains("HTTP support is coming soon.") == true)

    // Test unsupported scheme raises IllegalArgumentException
    val eFtp =
      assertFailsWith<IllegalArgumentException> {
        CatalogConfig.fromPath(name = "test_ftp", catalogPath = "ftp://a2ui.org/catalog.json")
      }
    assertTrue(eFtp.message?.contains("Unsupported catalog URL scheme") == true)
  }

  @Test
  fun resolvesExamplesPathInBasicCatalogGetConfig() {
    val config =
      BasicCatalog.getConfig(
        version = A2uiVersion.VERSION_0_9,
        examplesPath = "file:///absolute/examples",
      )
    assertEquals("/absolute/examples", config.examplesPath)
  }
}
