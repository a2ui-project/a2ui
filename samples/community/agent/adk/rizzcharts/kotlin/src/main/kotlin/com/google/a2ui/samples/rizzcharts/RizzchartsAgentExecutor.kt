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

package com.google.a2ui.samples.rizzcharts

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.a2ui.a2a.A2uiA2a
import com.google.a2ui.schema.A2uiSchemaManager
import com.google.adk.sessions.Session

class RizzchartsAgentExecutor(
  private val baseUrl: String,
  private val schemaManager: A2uiSchemaManager,
) {
  companion object {
    const val A2UI_ENABLED_KEY = "a2ui_enabled"
    const val A2UI_CATALOG_KEY = "a2ui_catalog"
    const val A2UI_EXAMPLES_KEY = "a2ui_examples"

    private val objectMapper = ObjectMapper()
  }

  fun prepareSession(session: Session, rawRequestBody: Map<*, *>) {
    @Suppress("UNCHECKED_CAST")
    val requestBody = objectMapper.convertValue(rawRequestBody, Map::class.java) as Map<String, Any>
    val params = requestBody["params"] as? Map<*, *>
    val messageMap = params?.get("message") as? Map<*, *>
    val messageMetadata = messageMap?.get("metadata") as? Map<*, *>
    val rootMetadata = requestBody["metadata"] as? Map<*, *>
    val metadata = messageMetadata ?: rootMetadata
    val capabilitiesNode = metadata?.get("a2uiClientCapabilities")
    var capabilities = capabilitiesNode as? Map<*, *>

    if (capabilities == null) {
      val history = params?.get("history") as? List<*>
      if (history != null) {
        for (msg in history) {
          val msgMap = msg as? Map<*, *>
          val msgMeta = msgMap?.get("metadata") as? Map<*, *>
          val msgCaps = msgMeta?.get("a2uiClientCapabilities") as? Map<*, *>
          if (msgCaps != null) {
            capabilities = msgCaps
            break
          }
        }
      }
    }

    val requestedExtensions =
      ((params?.get("extensions") ?: requestBody["extensions"]) as? List<*>)?.filterIsInstance<
        String
      >() ?: emptyList()

    var useUi = A2uiA2a.tryActivateA2uiExtension(requestedExtensions) { /* no-op */ }
    if (!useUi) {
      useUi = capabilitiesNode != null || capabilities != null
    }

    if (!session.state().containsKey("base_url")) {
      session.state()["base_url"] = baseUrl
    }

    session.state()[A2UI_ENABLED_KEY] = useUi

    if (useUi) {
      session.state()[A2UI_CATALOG_KEY] = schemaManager.getSelectedCatalog()
      session.state()[A2UI_EXAMPLES_KEY] =
        schemaManager.loadExamples(schemaManager.getSelectedCatalog())
    } else {
      session.state().remove(A2UI_CATALOG_KEY)
      session.state().remove(A2UI_EXAMPLES_KEY)
    }
  }
}
