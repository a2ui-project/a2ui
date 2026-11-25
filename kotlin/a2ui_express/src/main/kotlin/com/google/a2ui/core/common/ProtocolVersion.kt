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

import com.google.a2ui.core.exceptions.A2uiCatalogError

/** Supported A2UI specification versions (`a2ui_core.blueprint.md` §3.A). */
enum class ProtocolVersion(
  val wireTag: String,
  val major: Int,
  val minor: Int,
  val patch: Int = 0,
) {
  V0_8("v0.8", 0, 8, 0),
  V0_9("v0.9", 0, 9, 0),
  V0_9_1("v0.9.1", 0, 9, 1),
  V1_0("1.0", 1, 0, 0);

  val isV1OrLater: Boolean
    get() = major >= 1

  companion object {
    private val SEMVER_PATTERN = Regex("""^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$""")

    /** Parses a version string such as `"1.0"`, `"v1.0"`, `"1.0.0"`, `"v0.9"`, or `"0.9.1"`. */
    fun parse(raw: String): ProtocolVersion {
      val match =
        SEMVER_PATTERN.matchEntire(raw.trim())
          ?: throw A2uiCatalogError("Unsupported A2UI protocol version: '$raw'")
      val major = match.groupValues[1].toInt()
      val minor = match.groupValues[2].toInt()
      val patch = match.groupValues[3].takeIf { it.isNotEmpty() }?.toInt() ?: 0
      return when {
        major == 0 && minor == 8 && patch == 0 -> V0_8
        major == 0 && minor == 9 && patch == 0 -> V0_9
        major == 0 && minor == 9 && patch == 1 -> V0_9_1
        major == 1 && minor == 0 && patch == 0 -> V1_0
        else -> throw A2uiCatalogError("Unsupported A2UI protocol version: '$raw'")
      }
    }

    fun parseOrNull(raw: String?): ProtocolVersion? =
      raw?.let {
        try {
          parse(it)
        } catch (_: A2uiCatalogError) {
          null
        }
      }
  }
}
