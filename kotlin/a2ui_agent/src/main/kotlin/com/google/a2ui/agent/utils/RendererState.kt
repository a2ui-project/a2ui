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
import com.google.a2ui.core.catalog.ComponentApi
import com.google.a2ui.core.exceptions.A2uiCatalogError
import com.google.a2ui.core.processing.ExecutionContext
import com.google.a2ui.core.processing.MessageProcessor
import com.google.a2ui.core.schema.AgentToRendererMessage
import com.google.a2ui.core.schema.AgentToRendererMessagePayload
import com.google.a2ui.core.schema.CallRendererFunctionMessage
import com.google.a2ui.core.schema.CreateSurfaceMessage
import com.google.a2ui.core.schema.DeleteSurfaceMessage
import com.google.a2ui.core.schema.UpdateComponentsMessage
import com.google.a2ui.core.schema.UpdateDataModelMessage
import com.google.a2ui.core.validation.RELAXED_VALIDATION
import com.google.a2ui.core.validation.STRICT_VALIDATION
import com.google.a2ui.core.validation.ValidationConfig
import kotlinx.serialization.json.JsonObject

/**
 * Stateful mirror of renderer surfaces supporting multi-turn validation, streaming provisional-ID
 * superseding, and transactional rollback (`a2ui_agent.blueprint.md` §3.C, §3.D).
 *
 * Defined as an interface so inference-format parsers (`ExpressParser`, `ExpressResponseStream`)
 * depend only on this contract: a standalone Express package can supply a lightweight topology
 * checker while `a2ui_agent` backs it with Core's [MessageProcessor].
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
    val IN_PROGRESS_VALIDATION =
      ValidationConfig(
        allowOrphanComponents = true,
        allowDanglingReferences = true,
        allowMissingRoot = true,
        allowUnknownElements = false,
      )

    /** Creates an agent-side [RendererState] backed by a fresh Core [MessageProcessor]. */
    operator fun invoke(catalogs: List<CatalogApi>): RendererState = CoreRendererState(catalogs)

    /** Binds a [RendererState] directly onto an existing renderer [MessageProcessor]. */
    fun of(processor: MessageProcessor<ComponentApi>): RendererState =
      CoreRendererState(processor.catalogs, processor)
  }
}

internal class CoreRendererState(
  catalogs: List<CatalogApi>,
  val processor: MessageProcessor<ComponentApi> = MessageProcessor(checkCatalogList(catalogs)),
) : RendererState {
  override val catalogs: List<CatalogApi> = checkCatalogList(catalogs)
  private val appliedHistory = mutableListOf<AgentToRendererMessage>()
  private val deferredFunctionCalls = mutableListOf<CallRendererFunctionMessage>()
  private val preTurnBaselines = linkedMapOf<String, MutableMap<String, JsonObject?>>()
  private var transactionDepth = 0

  override val surfaceIds: List<String>
    get() = processor.model.surfaces.keys.toList()

  override fun hasSurface(surfaceId: String): Boolean =
    processor.model.getSurface(surfaceId) != null

  override fun surfaceComponents(surfaceId: String): Map<String, JsonObject>? =
    processor.model.getSurface(surfaceId)?.componentsModel?.components?.mapValues { (_, comp) ->
      comp.properties
    }

  override fun apply(messages: List<AgentToRendererMessage>, inProgress: Boolean): List<String> =
    transaction {
      val config = if (inProgress) RendererState.IN_PROGRESS_VALIDATION else STRICT_VALIDATION
      val touched = LinkedHashSet<String>()
      for (message in messages) {
        if (message is CallRendererFunctionMessage && transactionDepth > 1) {
          deferredFunctionCalls.add(message)
          continue
        }
        when (message) {
          is CreateSurfaceMessage -> {
            recordBaseline(message.surfaceId, message.components.orEmpty())
            touched.add(message.surfaceId)
          }
          is UpdateComponentsMessage -> {
            recordBaseline(message.surfaceId, message.components)
            touched.add(message.surfaceId)
          }
          is UpdateDataModelMessage -> touched.add(message.surfaceId)
          is DeleteSurfaceMessage -> {
            preTurnBaselines.remove(message.surfaceId)
            touched.remove(message.surfaceId)
          }
          else -> {}
        }
        processor.processMessages(
          AgentToRendererMessagePayload.Single(message),
          ExecutionContext(validationConfig = config),
        )
        appliedHistory.add(message)
      }
      touched.toList()
    }

  override fun checkTopology(surfaceIds: Iterable<String>) {
    for (sid in surfaceIds) {
      val surface = processor.model.getSurface(sid) ?: continue
      surface.componentsModel.validateTopology(surface.rootId, STRICT_VALIDATION)
      preTurnBaselines.remove(sid)
    }
  }

  override fun markChecked(surfaceIds: Iterable<String>) {
    for (sid in surfaceIds) {
      preTurnBaselines.remove(sid)
    }
  }

  override fun dropProvisionalComponent(surfaceId: String, componentId: String) = transaction {
    val surface = processor.model.getSurface(surfaceId) ?: return@transaction
    val baseline = preTurnBaselines[surfaceId] ?: return@transaction
    if (!baseline.containsKey(componentId)) return@transaction
    val previous = baseline.remove(componentId)
    if (previous == null) {
      surface.componentsModel.removeComponent(componentId)
    } else {
      surface.componentsModel.get(componentId)?.properties = previous
    }
  }

  override fun reset() {
    appliedHistory.clear()
    deferredFunctionCalls.clear()
    preTurnBaselines.clear()
    processor.model.dispose()
  }

  override fun <T> transaction(block: () -> T): T {
    val historyMark = appliedHistory.size
    val deferredMark = deferredFunctionCalls.size
    transactionDepth += 1
    return try {
      val result = block()
      transactionDepth -= 1
      if (transactionDepth == 0 && deferredFunctionCalls.isNotEmpty()) {
        val pending = deferredFunctionCalls.toList()
        deferredFunctionCalls.clear()
        apply(pending, inProgress = false)
      }
      result
    } catch (t: Throwable) {
      transactionDepth -= 1
      while (deferredFunctionCalls.size > deferredMark) {
        deferredFunctionCalls.removeAt(deferredFunctionCalls.lastIndex)
      }
      rollbackTo(historyMark)
      throw t
    }
  }

  private fun recordBaseline(surfaceId: String, batch: List<JsonObject>) {
    val existing = processor.model.getSurface(surfaceId)?.componentsModel
    val map = preTurnBaselines.getOrPut(surfaceId) { linkedMapOf() }
    for (comp in batch) {
      val id = (comp["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: continue
      if (!map.containsKey(id)) {
        map[id] = existing?.get(id)?.properties
      }
    }
  }

  private fun rollbackTo(mark: Int) {
    if (appliedHistory.size == mark) return
    val retained = appliedHistory.subList(0, mark).toList()
    appliedHistory.clear()
    preTurnBaselines.clear()
    processor.model.dispose()
    for (msg in retained) {
      processor.processMessages(
        AgentToRendererMessagePayload.Single(msg),
        ExecutionContext(validationConfig = RELAXED_VALIDATION),
      )
      appliedHistory.add(msg)
    }
  }

  companion object {
    internal fun checkCatalogList(catalogs: List<CatalogApi>): List<CatalogApi> {
      if (catalogs.isEmpty()) {
        throw A2uiCatalogError("At least one catalog must be provided.")
      }
      val seen = HashSet<String>()
      val versions = HashSet<com.google.a2ui.core.common.ProtocolVersion>()
      for (cat in catalogs) {
        if (!seen.add(cat.id)) {
          throw A2uiCatalogError("Duplicate catalog ID: '${cat.id}'.")
        }
        cat.protocolVersion?.let { versions.add(it) }
      }
      if (versions.size > 1) {
        throw A2uiCatalogError(
          "Catalogs target incompatible protocol versions: ${versions.map { it.wireTag }.sorted()}."
        )
      }
      return catalogs.toList()
    }
  }
}

/** Statelessly validates [payload] against [catalogs] (`a2ui_agent.blueprint.md` §3.D). */
fun validatePayload(catalogs: List<CatalogApi>, payload: List<AgentToRendererMessage>) {
  val state = RendererState(catalogs)
  val touched = state.apply(payload)
  state.checkTopology(touched)
}
