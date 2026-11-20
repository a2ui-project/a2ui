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

package com.google.a2ui.core.common

import com.google.a2ui.core.exceptions.A2uiValidationError
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Matches `metadata` containers in v1.0 wire schemas (`{ extensions?: Extensions }`).
 *
 * Every key in [extensions] is validated as a UAX #31 identifier upon construction
 * (`a2ui_core.blueprint.md` §3.A, §3.E).
 */
data class A2uiMetadata(val extensions: Map<String, JsonElement> = emptyMap()) {
  init {
    for (key in extensions.keys) {
      if (!Uax31Identifier.isValid(key)) {
        throw A2uiValidationError("Invalid UAX #31 extension metadata key: '$key'")
      }
    }
  }

  fun toJsonObject(): JsonObject = JsonObject(mapOf("extensions" to JsonObject(extensions)))

  companion object {
    fun fromJsonObject(json: JsonObject): A2uiMetadata {
      for (key in json.keys) {
        if (key != "extensions") {
          throw A2uiValidationError(
            "Unexpected metadata property '$key'; only 'extensions' is allowed"
          )
        }
      }
      val extObj =
        when (val raw = json["extensions"]) {
          null -> emptyMap()
          is JsonObject -> raw.toMap()
          else -> throw A2uiValidationError("Metadata 'extensions' must be a JSON object")
        }
      return A2uiMetadata(extObj)
    }
  }
}
