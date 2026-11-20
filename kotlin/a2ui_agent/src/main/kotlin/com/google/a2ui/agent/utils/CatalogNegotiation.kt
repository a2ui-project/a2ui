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

package com.google.a2ui.agent.utils

import com.google.a2ui.agent.processor.CatalogConfig
import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.catalog.FunctionApi
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.exceptions.A2uiCatalogError
import com.google.a2ui.core.schema.A2uiRendererCapabilities
import com.google.a2ui.core.schema.RendererVersionCapabilities
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

const val A2UI_CLIENT_CAPABILITIES_KEY: String = "a2uiClientCapabilities"
const val A2UI_RENDERER_CAPABILITIES_KEY: String = "a2uiRendererCapabilities"

/** Returns functions in [catalog] authorized for agent-initiated `callRendererFunction` calls. */
fun agentCallableFunctions(catalog: CatalogApi): Map<String, FunctionApi> =
  catalog.rendererFunctions.filterValues { fn ->
    fn.allowedCallers.isAgentCallable && !fn.requiresUserActivation
  }

/** Extracts and validates renderer capabilities from transport metadata (`blueprint` §3.G). */
fun readRendererCapabilities(
  metadata: Map<String, JsonElement>?,
  version: ProtocolVersion = ProtocolVersion.V1_0,
): A2uiRendererCapabilities? {
  if (metadata == null) return null
  val metaKey =
    if (version.isV1OrLater) A2UI_RENDERER_CAPABILITIES_KEY else A2UI_CLIENT_CAPABILITIES_KEY
  val containerElem = metadata[metaKey] ?: return null
  if (containerElem is JsonNull) return null
  val container =
    containerElem as? JsonObject
      ?: throw A2uiCatalogError("Metadata '$metaKey' must be a JSON object")

  val versionKey =
    when (version) {
      ProtocolVersion.V1_0 -> "1.0"
      ProtocolVersion.V0_9,
      ProtocolVersion.V0_9_1 -> "v0.9"
      ProtocolVersion.V0_8 -> "v0.8"
    }
  val entryElem = container[versionKey] ?: return null
  if (entryElem is JsonNull) return null
  val entry =
    entryElem as? JsonObject
      ?: throw A2uiCatalogError("Capabilities entry '$versionKey' must be a JSON object")

  val allowedKeys = setOf("supportedCatalogIds", "inlineCatalogs")
  for (key in entry.keys) {
    if (key !in allowedKeys) {
      throw A2uiCatalogError("Unrecognized capabilities field '$key' under '$versionKey'")
    }
  }
  val idsArr =
    entry["supportedCatalogIds"] as? JsonArray
      ?: throw A2uiCatalogError("Capabilities '$versionKey.supportedCatalogIds' must be an array")
  val supportedIds =
    idsArr.map { elem ->
      (elem as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?: throw A2uiCatalogError("Each entry in 'supportedCatalogIds' must be a string")
    }

  val inlineCatalogs =
    entry["inlineCatalogs"]?.let { rawInline ->
      val inlineArr =
        rawInline as? JsonArray
          ?: throw A2uiCatalogError("Capabilities '$versionKey.inlineCatalogs' must be an array")
      inlineArr.map { doc ->
        val obj =
          doc as? JsonObject ?: throw A2uiCatalogError("Each inline catalog must be a JSON object")
        Catalog.fromJson(obj, expectedVersion = version)
        obj
      }
    }

  return A2uiRendererCapabilities(
    mapOf(versionKey to RendererVersionCapabilities(supportedIds, inlineCatalogs))
  )
}

/**
 * Negotiates [rendererCapabilities] against registered [catalogs] in renderer preference order
 * (`a2ui_agent.blueprint.md` §3.G `resolve_catalogs`).
 */
fun resolveCatalogs(
  catalogs: List<CatalogConfig>,
  rendererCapabilities: A2uiRendererCapabilities?,
  acceptsInlineCatalogs: Boolean = false,
): List<CatalogApi> {
  if (rendererCapabilities == null) {
    return catalogs.map { it.transformedCatalog }
  }
  val registeredById = catalogs.associate { it.transformedCatalog.id to it.transformedCatalog }
  val resolved = linkedMapOf<String, CatalogApi>()
  var sawSupportedIds = false
  var totalAdvertised = 0

  for ((verKey, verCap) in rendererCapabilities.versions) {
    sawSupportedIds = true
    totalAdvertised += verCap.supportedCatalogIds.size + (verCap.inlineCatalogs?.size ?: 0)
    for (id in verCap.supportedCatalogIds) {
      registeredById[id]?.let { resolved.putIfAbsent(id, it) }
    }
    if (acceptsInlineCatalogs && verCap.inlineCatalogs != null) {
      val expectedVer = ProtocolVersion.parse(verKey)
      for (inlineDoc in verCap.inlineCatalogs) {
        val inlineCat = Catalog.fromJson(inlineDoc, expectedVersion = expectedVer)
        resolved.putIfAbsent(inlineCat.id, inlineCat)
      }
    }
  }

  if (sawSupportedIds && totalAdvertised == 0) {
    throw A2uiCatalogError("Renderer advertised empty supportedCatalogIds and no inlineCatalogs")
  }
  if (resolved.isEmpty()) {
    throw A2uiCatalogError("No mutually supported catalogs between agent and renderer")
  }
  return resolved.values.toList()
}
