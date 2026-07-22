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

@file:JvmName("A2uiUtils")

package com.google.a2ui.schema

import java.io.IOException
import java.io.InputStream
import java.util.logging.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Common utilities for loading schemas and preparing JSON data. */
object SchemaResourceLoader {
  const val A2UI_ASSET_PACKAGE = A2uiConstants.A2UI_ASSET_PACKAGE
  private val logger = Logger.getLogger(SchemaResourceLoader::class.java.name)

  /** Loads a JSON schema from bundled resources or file system. */
  @JvmStatic
  fun loadFromBundledResource(version: String, filename: String): JsonObject? {
    // Try to load from the bundled package resources
    val resourcePath = "/${A2UI_ASSET_PACKAGE.replace('.', '/')}/$version/$filename"
    return try {
      val stream: InputStream? = SchemaResourceLoader::class.java.getResourceAsStream(resourcePath)
      stream?.bufferedReader()?.use { Json.parseToJsonElement(it.readText()) as JsonObject }
        ?: run {
          logger.fine("Could not find system resource $resourcePath")
          throw IOException("Could not load schema $filename for version $version")
        }
    } catch (e: Exception) {
      logger.fine("Could not load '$filename' from package resources: ${e.message}")
      throw IOException("Could not load schema $filename for version $version", e)
    }
  }

  /**
   * LLM is instructed to generate a list of messages, so we wrap the bundled schema in an array.
   */
  @JvmStatic
  fun wrapAsJsonArray(a2uiSchema: JsonObject): JsonObject {
    require(a2uiSchema.isNotEmpty()) { "A2UI schema is empty" }
    return JsonObject(mapOf("type" to JsonPrimitive("array"), "items" to a2uiSchema))
  }
}
