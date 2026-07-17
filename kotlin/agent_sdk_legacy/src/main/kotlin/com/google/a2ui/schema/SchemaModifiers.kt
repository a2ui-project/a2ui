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

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** Standard transformations for A2UI schemas. */
object SchemaModifiers {
  /**
   * Recursively removes "additionalProperties: false" constraints from a JSON schema.
   *
   * This is useful when the agent might generate slightly different properties than defined in a
   * strict schema, allowing for more flexible LLM output.
   */
  fun removeStrictValidation(schema: JsonObject): JsonObject =
    recursiveRemoveStrict(schema) as JsonObject

  private fun recursiveRemoveStrict(element: JsonElement): JsonElement =
    when (element) {
      is JsonObject -> {
        val filtered =
          element.filter { (key, value) ->
            key != "additionalProperties" || (value as? JsonPrimitive)?.booleanOrNull != false
          }
        JsonObject(filtered.mapValues { recursiveRemoveStrict(it.value) })
      }
      is JsonArray -> JsonArray(element.map { recursiveRemoveStrict(it) })
      else -> element
    }
}
