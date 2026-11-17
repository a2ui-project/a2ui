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

package com.google.a2ui.core

/** Supported A2UI protocol versions for the Kotlin SDK. */
enum class ProtocolVersion(val value: String) {
  V1_0("1.0");

  val wireTag: String
    get() = value

  val isV1OrLater: Boolean
    get() = true

  companion object {
    fun parse(raw: String): ProtocolVersion = fromString(raw)

    /**
     * Parses a protocol version string (`"1.0"`, `"v1.0"`, `"1.0.0"`, `"v1.0.0"`), rejecting
     * unsupported or pre-1.0 versions with [A2uiCatalogError].
     */
    fun fromString(raw: String): ProtocolVersion {
      val trimmed = raw.trim().removePrefix("v").removePrefix("V")
      return when (trimmed) {
        "1.0",
        "1.0.0" -> V1_0
        else ->
          throw A2uiCatalogError(
            "Unsupported A2UI protocol version '$raw'. Supported versions: [1.0]."
          )
      }
    }
  }
}
