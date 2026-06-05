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

package com.google.a2ui.a2a

import com.google.a2ui.schema.A2uiConstants
import io.a2a.spec.AgentExtension
import io.a2a.spec.DataPart
import io.a2a.spec.Part
import kotlinx.serialization.json.JsonElement

/** A2A protocol helpers for A2UI integration. */
object A2uiA2a {
  const val A2UI_EXTENSION_BASE_URI = "https://a2ui.org/a2a-extension/a2ui/v"
  const val MIME_TYPE_KEY = "mimeType"
  const val A2UI_MIME_TYPE = "application/a2ui+json"
  const val DEPRECATED_A2UI_MIME_TYPE = "application/json+a2ui"

  /** Creates an A2A Part containing A2UI data. */
  @JvmOverloads
  fun createA2uiPart(a2uiData: JsonElement, version: String? = null): Part<*> {
    val mimeType =
      if (
        version == null ||
          version == "0.8" ||
          version == "0.9" ||
          version == "v0.8" ||
          version == "v0.9"
      )
        DEPRECATED_A2UI_MIME_TYPE
      else A2UI_MIME_TYPE
    return DataPart(a2uiData, mapOf(MIME_TYPE_KEY to mimeType))
  }

  /** Checks if an A2A Part contains A2UI data. */
  fun isA2uiPart(part: Part<*>): Boolean =
    part is DataPart &&
      (part.metadata?.get(MIME_TYPE_KEY) == A2UI_MIME_TYPE ||
        part.metadata?.get(MIME_TYPE_KEY) == DEPRECATED_A2UI_MIME_TYPE)

  /** Extracts the A2UI data from an A2A Part if present. */
  fun getA2uiData(part: Part<*>): JsonElement? =
    if (isA2uiPart(part)) (part as DataPart).data as? JsonElement else null

  /** Creates the A2UI AgentExtension configuration. */
  fun getA2uiAgentExtension(
    version: String,
    acceptsInlineCatalogs: Boolean = false,
    supportedCatalogIds: List<String> = emptyList(),
  ): AgentExtension {
    val params = mutableMapOf<String, Any>()
    if (acceptsInlineCatalogs) {
      params[A2uiConstants.ACCEPTS_INLINE_CATALOGS_KEY] = true
    }
    if (supportedCatalogIds.isNotEmpty()) {
      params[A2uiConstants.SUPPORTED_CATALOG_IDS_KEY] = supportedCatalogIds
    }

    val isSupportRequired = false
    return AgentExtension(
      "Provides agent driven UI using the A2UI JSON format.",
      if (params.isEmpty()) null else params,
      isSupportRequired,
      "$A2UI_EXTENSION_BASE_URI$version",
    )
  }

  /**
   * Selects the newest A2UI extension URI from the matched extensions.
   *
   * @param requestedExtensions List of extension URIs requested by the client.
   * @param advertisedExtensions List of extension URIs advertised by the agent.
   * @return The newest overlapping A2UI extension URI, or null if none match.
   */
  fun selectNewestA2uiExtension(
    requestedExtensions: List<String>,
    advertisedExtensions: List<String>,
  ): String? {
    val baseUri = A2UI_EXTENSION_BASE_URI
    val matched =
      requestedExtensions.intersect(advertisedExtensions.toSet()).filter { it.startsWith(baseUri) }

    if (matched.isEmpty()) return null

    return matched.maxWithOrNull(
      Comparator { uri1, uri2 ->
        val v1 = uri1.removePrefix(baseUri)
        val v2 = uri2.removePrefix(baseUri)
        compareVersions(v1, v2)
      }
    )
  }

  private fun compareVersions(v1: String, v2: String): Int {
    val parts1 = v1.split('.').map { it.toIntOrNull() ?: 0 }
    val parts2 = v2.split('.').map { it.toIntOrNull() ?: 0 }
    val length = maxOf(parts1.size, parts2.size)
    for (i in 0 until length) {
      val p1 = parts1.getOrElse(i) { 0 }
      val p2 = parts2.getOrElse(i) { 0 }
      if (p1 != p2) {
        return p1.compareTo(p2)
      }
    }
    return 0
  }

  /**
   * Activates the A2UI extension if requested in the context.
   *
   * @param requestedExtensions List of extension URIs requested by the client.
   * @param advertisedExtensions List of extension URIs advertised by the agent.
   * @param addActivatedExtension Callback to register an activated extension.
   * @return The version string of the activated A2UI extension, or null if not activated.
   */
  fun tryActivateA2uiExtension(
    requestedExtensions: List<String>,
    advertisedExtensions: List<String>,
    addActivatedExtension: (String) -> Unit,
  ): String? {
    val selectedUri = selectNewestA2uiExtension(requestedExtensions, advertisedExtensions)
    if (selectedUri != null) {
      addActivatedExtension(selectedUri)
      return selectedUri.removePrefix(A2UI_EXTENSION_BASE_URI)
    }
    return null
  }
}
