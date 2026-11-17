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

package com.google.a2ui.agent

import com.google.a2ui.core.A2uiCatalogError
import com.google.a2ui.core.A2uiValidationError
import com.google.a2ui.core.AgentFunctionResponseMessage
import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.AllowedCallers
import com.google.a2ui.core.CallRendererFunctionMessage
import com.google.a2ui.core.Catalog
import com.google.a2ui.core.CreateSurfaceMessage
import com.google.a2ui.core.DeleteSurfaceMessage
import com.google.a2ui.core.ProtocolVersion
import com.google.a2ui.core.SchemaValidator
import com.google.a2ui.core.SurfaceTopologyValidator
import com.google.a2ui.core.UpdateComponentsMessage
import com.google.a2ui.core.UpdateDataModelMessage
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Contract for the agent's mirror of the surfaces a renderer holds, supporting multi-turn state
 * validation, incremental streaming reconciliation, and transactional rollback.
 *
 * Defined as an interface so a full Kotlin Core `MessageProcessor` can back it directly without
 * changing [Parser] or Express streaming implementations.
 */
interface RendererState {
  val catalogs: List<Catalog>
  val surfaceIds: List<String>

  fun hasSurface(surfaceId: String): Boolean = surfaceId in surfaceIds

  /** Returns a read-only map of components (`id -> JsonObject`) on [surfaceId], or `null`. */
  fun surfaceComponents(surfaceId: String): Map<String, JsonObject>?

  /**
   * Executes [block] atomically against this state, rolling back all mutations if [block] throws.
   */
  fun <T> transaction(block: () -> T): T

  /**
   * Validates and applies [messages] atomically, returning the IDs of surfaces touched (excluding
   * surfaces whose final state in this batch is deleted). Leaves full tree topology checks for
   * [checkTopology].
   */
  fun apply(messages: List<AgentToRendererMessage>, inProgress: Boolean = false): List<String>

  /** Checks the component tree topology of each surface in [surfaceIds]. */
  fun checkTopology(surfaceIds: Iterable<String>)

  /** Marks [surfaceIds] as checked for truncated incomplete blocks without running tree checks. */
  fun markChecked(surfaceIds: Iterable<String>)

  /**
   * Removes or restores a provisional component on [surfaceId] when a later statement in the same
   * streaming scope supersedes its component ID via `id="..."`.
   */
  fun dropProvisionalComponent(surfaceId: String, componentId: String)

  /** Clears all active surfaces and seen function call IDs. */
  fun reset()

  companion object {
    /** Creates an empty [RendererState] configured with [catalogs]. */
    operator fun invoke(catalogs: List<Catalog>): RendererState =
      DefaultRendererState(catalogs, assumesUnknownSurfaces = false)

    internal fun checkCatalogList(catalogs: List<Catalog>): List<Catalog> {
      if (catalogs.isEmpty()) {
        throw A2uiCatalogError("At least one catalog must be provided.")
      }
      val seen = HashSet<String>()
      val versions = HashSet<ProtocolVersion>()
      for (cat in catalogs) {
        if (!seen.add(cat.id)) {
          throw A2uiCatalogError("Duplicate catalog ID: '${cat.id}'.")
        }
        versions.add(cat.protocolVersion)
      }
      if (versions.size > 1) {
        throw A2uiCatalogError(
          "The catalogs target incompatible protocol versions: ${versions.map { it.value }.sorted()}."
        )
      }
      return catalogs.toList()
    }
  }
}

/**
 * Default standalone [RendererState] implementation backed by pure-Kotlin schema and graph checks.
 */
internal class DefaultRendererState(
  catalogs: List<Catalog>,
  private val assumesUnknownSurfaces: Boolean,
) : RendererState {
  override val catalogs: List<Catalog> = RendererState.checkCatalogList(catalogs)
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
        if (message.version != ProtocolVersion.V1_0.value) {
          throw A2uiValidationError(
            "Expected message protocol version '1.0', got '${message.version}'."
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
            schemaValidator.validateSurfaceMetadata(message.metadata, sid)
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
            if (message.functionCallId.isEmpty()) {
              throw A2uiValidationError("agentFunctionResponse.functionCallId must be non-empty.")
            }
            message.value?.let { schemaValidator.checkNestingDepth(it) }
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
}

/**
 * Statelessly validates a sequence of A2UI wire messages against [catalogs], assuming surfaces that
 * are only updated (not created or deleted in [payload]) already existed on the renderer.
 */
fun validatePayload(catalogs: List<Catalog>, payload: List<AgentToRendererMessage>) {
  val state = DefaultRendererState(catalogs, assumesUnknownSurfaces = true)
  val touched = state.apply(payload)
  state.checkTopology(touched)
}

/**
 * Returns the unique names of catalog functions callable by the agent via `callRendererFunction`
 * across [catalogs] (`allowedCallers` in `{agentOnly, rendererOrAgent}` and `requiresUserActivation
 * == false`), in catalog and declaration order.
 */
fun agentCallableFunctions(catalogs: List<Catalog>): List<String> {
  val checked = RendererState.checkCatalogList(catalogs)
  val seen = LinkedHashSet<String>()
  for (cat in checked) {
    for (fn in cat.functions.values) {
      if (fn.allowedCallers != AllowedCallers.RENDERER_ONLY && !fn.requiresUserActivation) {
        seen.add(fn.name)
      }
    }
  }
  return seen.toList()
}
