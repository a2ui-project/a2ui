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

import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.exceptions.A2uiCatalogError
import com.google.a2ui.core.exceptions.A2uiValidationError
import com.google.a2ui.core.schema.AgentFunctionResponseMessage
import com.google.a2ui.core.schema.AgentToRendererMessage
import com.google.a2ui.core.schema.CallRendererFunctionMessage
import com.google.a2ui.core.schema.CreateSurfaceMessage
import com.google.a2ui.core.schema.DeleteSurfaceMessage
import com.google.a2ui.core.schema.UpdateComponentsMessage
import com.google.a2ui.core.schema.UpdateDataModelMessage
import com.google.a2ui.core.validation.SchemaValidator
import com.google.a2ui.core.validation.SurfaceTopologyValidator
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Stateful mirror of renderer surfaces supporting multi-turn validation, streaming provisional-ID
 * superseding, and transactional rollback (`a2ui_agent.blueprint.md` §3.C, §3.D).
 */
interface RendererState {
  val catalogs: List<CatalogApi>
  val surfaceIds: List<String>

  fun hasSurface(surfaceId: String): Boolean

  fun surfaceComponents(surfaceId: String): Map<String, JsonObject>?

  fun apply(messages: List<AgentToRendererMessage>, inProgress: Boolean = false): List<String>

  fun checkTopology(surfaceIds: Iterable<String>)

  fun markChecked(surfaceIds: Iterable<String>)

  fun dropProvisionalComponent(surfaceId: String, componentId: String)

  fun reset()

  fun <T> transaction(block: () -> T): T

  companion object {
    /** Creates an agent-side [RendererState] configured with [catalogs]. */
    operator fun invoke(catalogs: List<CatalogApi>): RendererState =
      DefaultRendererState(catalogs, assumesUnknownSurfaces = false)
  }
}

/**
 * Default standalone [RendererState] implementation backed by pure-Kotlin schema and graph checks.
 */
internal class DefaultRendererState(
  catalogs: List<CatalogApi>,
  private val assumesUnknownSurfaces: Boolean,
) : RendererState {
  override val catalogs: List<CatalogApi> = checkCatalogList(catalogs)
  private val schemaValidator = SchemaValidator(this.catalogs)
  private val topologyValidator = SurfaceTopologyValidator(this.catalogs)

  private data class SurfaceRecord(
    val id: String,
    val defaultCatalogId: String?,
    val assumed: Boolean,
    val components: LinkedHashMap<String, JsonObject> = LinkedHashMap(),
    val changedIds: LinkedHashSet<String> = LinkedHashSet(),
    val preTurnBaseline: LinkedHashMap<String, JsonObject?> = LinkedHashMap(),
  ) {
    fun deepCopy(): SurfaceRecord =
      SurfaceRecord(
        id = id,
        defaultCatalogId = defaultCatalogId,
        assumed = assumed,
        components = LinkedHashMap(components),
        changedIds = LinkedHashSet(changedIds),
        preTurnBaseline = LinkedHashMap(preTurnBaseline),
      )
  }

  private data class Snapshot(
    val surfaces: LinkedHashMap<String, SurfaceRecord>,
    val seenFunctionCallIds: LinkedHashSet<String>,
  )

  private var surfaces = LinkedHashMap<String, SurfaceRecord>()
  private var seenFunctionCallIds = LinkedHashSet<String>()

  override val surfaceIds: List<String>
    get() = surfaces.keys.toList()

  override fun hasSurface(surfaceId: String): Boolean = surfaceId in surfaces

  override fun surfaceComponents(surfaceId: String): Map<String, JsonObject>? =
    surfaces[surfaceId]?.components?.toMap()

  private fun takeSnapshot(): Snapshot {
    val copiedSurfaces = LinkedHashMap<String, SurfaceRecord>(surfaces.size)
    for ((k, v) in surfaces) {
      copiedSurfaces[k] = v.deepCopy()
    }
    return Snapshot(copiedSurfaces, LinkedHashSet(seenFunctionCallIds))
  }

  private fun restoreSnapshot(snapshot: Snapshot) {
    surfaces = snapshot.surfaces
    seenFunctionCallIds = snapshot.seenFunctionCallIds
  }

  override fun <T> transaction(block: () -> T): T {
    val snap = takeSnapshot()
    try {
      return block()
    } catch (t: Throwable) {
      restoreSnapshot(snap)
      throw t
    }
  }

  override fun reset() {
    surfaces.clear()
    seenFunctionCallIds.clear()
  }

  override fun apply(messages: List<AgentToRendererMessage>, inProgress: Boolean): List<String> =
    transaction {
      val touched = LinkedHashSet<String>()
      for ((idx, message) in messages.withIndex()) {
        if (message.version != ProtocolVersion.V1_0) {
          throw A2uiValidationError(
            "Expected message protocol version '1.0', got '${message.version.wireTag}'."
          )
        }
        when (message) {
          is CreateSurfaceMessage -> {
            val sid = message.surfaceId
            if (sid.isEmpty()) {
              throw A2uiValidationError("createSurface.surfaceId must be non-empty.")
            }
            if (sid in surfaces) {
              throw A2uiValidationError(
                "Surface '$sid' already exists and cannot be created again without deleting it first."
              )
            }
            if (message.catalogId != null) {
              schemaValidator.checkCatalogExists(message.catalogId, "Surface '$sid'")
            }
            schemaValidator.validateSurfaceMetadata(message.metadata?.toJsonObject(), sid)
            if (message.dataModel != null) {
              schemaValidator.checkNestingDepth(message.dataModel)
            }
            val record =
              SurfaceRecord(id = sid, defaultCatalogId = message.catalogId, assumed = false)
            surfaces[sid] = record
            if (message.components != null) {
              if (message.components.isEmpty()) {
                throw A2uiValidationError("createSurface.components must be non-empty.")
              }
              applyComponentsToSurface(record, message.components)
            }
            touched.add(sid)
          }
          is UpdateComponentsMessage -> {
            val sid = message.surfaceId
            if (sid.isEmpty()) {
              throw A2uiValidationError("updateComponents.surfaceId must be non-empty.")
            }
            if (message.components.isEmpty()) {
              throw A2uiValidationError("updateComponents.components must be non-empty.")
            }
            val record = resolveOrAssumeSurface(sid, messages, idx)
            applyComponentsToSurface(record, message.components)
            touched.add(sid)
          }
          is UpdateDataModelMessage -> {
            val sid = message.surfaceId
            if (sid.isEmpty()) {
              throw A2uiValidationError("updateDataModel.surfaceId must be non-empty.")
            }
            val record = resolveOrAssumeSurface(sid, messages, idx)
            schemaValidator.validateDataModelUpdate(message.path, message.value)
            touched.add(record.id)
          }
          is DeleteSurfaceMessage -> {
            val sid = message.surfaceId
            if (sid.isEmpty()) {
              throw A2uiValidationError("deleteSurface.surfaceId must be non-empty.")
            }
            resolveOrAssumeSurface(sid, messages, idx)
            surfaces.remove(sid)
            touched.remove(sid)
          }
          is CallRendererFunctionMessage -> {
            if (!seenFunctionCallIds.add(message.functionCallId)) {
              throw A2uiValidationError(
                "Duplicate functionCallId '${message.functionCallId}' in callRendererFunction."
              )
            }
            val surfaceDefaultCatalog =
              if (message.surfaceId != null) {
                val surf = resolveOrAssumeSurface(message.surfaceId, messages, idx)
                if (surf.assumed) null else surf.defaultCatalogId
              } else {
                null
              }
            schemaValidator.validateCallRendererFunction(message, surfaceDefaultCatalog)
          }
          is AgentFunctionResponseMessage -> {
            if (message.response.functionCallId.isEmpty()) {
              throw A2uiValidationError("agentFunctionResponse.functionCallId must be non-empty.")
            }
            message.response.value?.let { schemaValidator.checkNestingDepth(it) }
          }
        }
      }
      touched.toList()
    }

  override fun checkTopology(surfaceIds: Iterable<String>) {
    for (sid in surfaceIds) {
      val record = surfaces[sid] ?: continue
      if (record.assumed && record.components.isEmpty()) continue
      topologyValidator.validateSurface(
        surfaceId = sid,
        defaultCatalogId =
          record.defaultCatalogId ?: inferAssumedCatalogId(record.components.values.toList()),
        componentsById = record.components,
        changedIds = record.changedIds,
        allowPartialSurface = record.assumed,
      )
      record.changedIds.clear()
      record.preTurnBaseline.clear()
    }
  }

  override fun markChecked(surfaceIds: Iterable<String>) {
    for (sid in surfaceIds) {
      val record = surfaces[sid] ?: continue
      record.changedIds.clear()
      record.preTurnBaseline.clear()
    }
  }

  override fun dropProvisionalComponent(surfaceId: String, componentId: String) = transaction {
    val record = surfaces[surfaceId] ?: return@transaction
    if (!record.preTurnBaseline.containsKey(componentId)) return@transaction
    val previous = record.preTurnBaseline.remove(componentId)
    record.changedIds.remove(componentId)
    if (previous == null) {
      record.components.remove(componentId)
    } else {
      record.components[componentId] = previous
    }
  }

  private fun applyComponentsToSurface(record: SurfaceRecord, batch: List<JsonObject>) {
    topologyValidator.checkBatchNoDuplicateIds(batch, record.id)
    val effectiveDefaultCatalogId =
      if (record.assumed) inferAssumedCatalogId(batch) else record.defaultCatalogId
    for (comp in batch) {
      schemaValidator.validateComponent(comp, effectiveDefaultCatalogId)
    }
    for (comp in batch) {
      val id = (comp["id"] as JsonPrimitive).content
      if (!record.preTurnBaseline.containsKey(id)) {
        record.preTurnBaseline[id] = record.components[id]
      }
      record.components[id] = comp
      record.changedIds.add(id)
    }
  }

  private fun inferAssumedCatalogId(batch: List<JsonObject>): String? {
    if (catalogs.size == 1) return catalogs[0].id
    val unannotatedTypes =
      batch
        .filter { "@catalogId" !in it }
        .mapNotNull { (it["component"] as? JsonPrimitive)?.contentOrNull }
    if (unannotatedTypes.isEmpty()) return null
    val matching = catalogs.filter { cat -> unannotatedTypes.all { t -> t in cat.components } }
    return matching.firstOrNull()?.id
  }

  private fun resolveOrAssumeSurface(
    surfaceId: String,
    payload: List<AgentToRendererMessage>,
    currentIndex: Int,
  ): SurfaceRecord {
    surfaces[surfaceId]?.let {
      return it
    }
    if (!assumesUnknownSurfaces) {
      throw A2uiValidationError(
        "Surface '$surfaceId' does not exist (no prior createSurface message)."
      )
    }
    val namedEarlier =
      payload.subList(0, currentIndex).any { msg ->
        when (msg) {
          is CreateSurfaceMessage -> msg.surfaceId == surfaceId
          is DeleteSurfaceMessage -> msg.surfaceId == surfaceId
          else -> false
        }
      }
    val createdLater =
      payload.subList(currentIndex + 1, payload.size).any { msg ->
        msg is CreateSurfaceMessage && msg.surfaceId == surfaceId
      }
    if (namedEarlier || createdLater) {
      throw A2uiValidationError(
        "Surface '$surfaceId' does not exist when referenced at message index $currentIndex."
      )
    }
    val placeholder =
      SurfaceRecord(
        id = surfaceId,
        defaultCatalogId = if (catalogs.size == 1) catalogs[0].id else null,
        assumed = true,
      )
    surfaces[surfaceId] = placeholder
    return placeholder
  }

  companion object {
    fun checkCatalogList(catalogs: List<CatalogApi>): List<CatalogApi> {
      if (catalogs.isEmpty()) {
        throw A2uiCatalogError("At least one catalog must be provided.")
      }
      val seen = HashSet<String>()
      val versions = HashSet<ProtocolVersion>()
      for (cat in catalogs) {
        if (!seen.add(cat.id)) {
          throw A2uiCatalogError("Duplicate catalog ID: '${cat.id}'.")
        }
        val ver =
          cat.protocolVersion
            ?: throw A2uiCatalogError("Catalog '${cat.id}' must declare protocolVersion '1.0'.")
        if (ver != ProtocolVersion.V1_0) {
          throw A2uiCatalogError(
            "Standalone Kotlin Express supports protocolVersion '1.0' only, got '${ver.wireTag}' on catalog '${cat.id}'."
          )
        }
        versions.add(ver)
      }
      if (versions.size > 1) {
        throw A2uiCatalogError(
          "The catalogs target incompatible protocol versions: ${versions.map { it.wireTag }.sorted()}."
        )
      }
      return catalogs.toList()
    }
  }
}

/** Statelessly validates [payload] against [catalogs] (`a2ui_agent.blueprint.md` §3.D). */
fun validatePayload(catalogs: List<CatalogApi>, payload: List<AgentToRendererMessage>) {
  val state = DefaultRendererState(catalogs, assumesUnknownSurfaces = true)
  val touched = state.apply(payload)
  state.checkTopology(touched)
}
