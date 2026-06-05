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

import java.io.File
import java.io.IOException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/** Abstract base interface for providing A2UI schemas and catalogs. */
interface A2uiCatalogProvider {
  /**
   * Loads a catalog definition.
   *
   * @return The loaded catalog as a JsonObject.
   */
  fun load(): JsonObject
}

/** Loads catalog definition from the local filesystem. */
class FileSystemCatalogProvider(val path: String) : A2uiCatalogProvider {
  override fun load(): JsonObject {
    try {
      val file = File(path)
      val content = file.readText(Charsets.UTF_8)
      return Json.parseToJsonElement(content) as JsonObject
    } catch (e: Exception) {
      throw IOException("Could not load schema from ${path}: ${e.message}", e)
    }
  }
}
