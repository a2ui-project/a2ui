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

package com.google.a2ui.core.state

import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.catalog.ComponentApi
import com.google.a2ui.core.catalog.FunctionApi
import com.google.a2ui.core.common.A2uiMetadata
import com.google.a2ui.core.common.EventNotifier
import com.google.a2ui.core.common.EventSource
import com.google.a2ui.core.common.MetadataHolder
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.common.ReadonlySignal
import com.google.a2ui.core.common.Signal
import com.google.a2ui.core.common.ValueSubscription
import com.google.a2ui.core.exceptions.A2uiCatalogError
import com.google.a2ui.core.exceptions.A2uiDataError
import com.google.a2ui.core.exceptions.A2uiIntegrityError
import com.google.a2ui.core.exceptions.A2uiRecursionError
import com.google.a2ui.core.exceptions.A2uiStateError
import com.google.a2ui.core.exceptions.A2uiValidationError
import com.google.a2ui.core.schema.A2uiRendererAction
import com.google.a2ui.core.validation.STRICT_VALIDATION
import com.google.a2ui.core.validation.ValidationConfig
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Reactive JSON Pointer store (`a2ui_core.blueprint.md` §3.E `DataModel`).
 *
 * Enforces forbidden-key guards (`__proto__`, `constructor`, `prototype`), primitive-parent
 * traversal rejection (`A2uiDataError`), null-write no-op on absent paths, root `null` reset to
 * `{}`, and bubble-and-cascade path notifications.
 */
class DataModel(initial: JsonObject = JsonObject(emptyMap())) {
  private var root: JsonObject = initial

  private data class PathSubscriber(val path: String, val listener: (JsonElement?) -> Unit)

  private val subscribers = CopyOnWriteArrayList<PathSubscriber>()

  fun snapshot(): JsonObject = root

  fun get(path: String): JsonElement? {
    val normalized = normalizePointer(path)
    if (normalized == "/") return root
    val segments = parseSegments(normalized)
    var cursor: JsonElement = root
    for (seg in segments) {
      cursor =
        when (cursor) {
          is JsonObject -> cursor[seg] ?: return null
          is JsonArray -> {
            val idx = seg.toIntOrNull() ?: return null
            if (idx !in cursor.indices) return null
            cursor[idx]
          }
          else -> return null
        }
    }
    return cursor
  }

  fun set(path: String, value: JsonElement?) {
    val normalized = normalizePointer(path)
    val segments = parseSegments(normalized)
    for (seg in segments) {
      if (seg in FORBIDDEN_KEYS) {
        throw A2uiDataError("Forbidden JSON Pointer segment '$seg' in path '$path'")
      }
    }
    if (normalized == "/") {
      root =
        when (value) {
          null,
          is JsonNull -> JsonObject(emptyMap())
          is JsonObject -> value
          else -> throw A2uiDataError("Root data model '/' must be a JSON object or null")
        }
      notifyCascade("/")
      return
    }
    val isDeletion = value == null || value is JsonNull
    if (isDeletion && get(normalized) == null) {
      return
    }
    root = writeRecursive(root, segments, 0, value, normalized) as JsonObject
    notifyCascade(normalized)
  }

  fun subscribe(path: String, onChange: (JsonElement?) -> Unit): ValueSubscription<JsonElement?> {
    val normalized = normalizePointer(path)
    val entry = PathSubscriber(normalized, onChange)
    subscribers.add(entry)
    return object : ValueSubscription<JsonElement?> {
      override val value: JsonElement?
        get() = get(normalized)

      override fun unsubscribe() {
        subscribers.remove(entry)
      }
    }
  }

  fun dispose() {
    subscribers.clear()
  }

  private fun writeRecursive(
    current: JsonElement?,
    segments: List<String>,
    index: Int,
    value: JsonElement?,
    fullPath: String,
  ): JsonElement {
    if (index == segments.size) {
      return value ?: JsonNull
    }
    val seg = segments[index]
    val isLast = index == segments.lastIndex
    val isDeletion = value == null || value is JsonNull
    return when (current) {
      is JsonPrimitive ->
        throw A2uiDataError("Cannot traverse primitive value while setting '$fullPath'")
      null -> {
        val nextIdx = seg.toIntOrNull()
        if (nextIdx != null && nextIdx >= 0) {
          val list = MutableList<JsonElement>(nextIdx + 1) { JsonNull }
          list[nextIdx] = writeRecursive(null, segments, index + 1, value, fullPath)
          JsonArray(list)
        } else {
          JsonObject(mapOf(seg to writeRecursive(null, segments, index + 1, value, fullPath)))
        }
      }
      is JsonObject -> {
        val map = current.toMutableMap()
        if (isLast && isDeletion) {
          map.remove(seg)
        } else {
          map[seg] = writeRecursive(map[seg], segments, index + 1, value, fullPath)
        }
        JsonObject(map)
      }
      is JsonArray -> {
        val idx =
          seg.toIntOrNull()?.takeIf { it >= 0 }
            ?: throw A2uiDataError("Invalid array index '$seg' in path '$fullPath'")
        val list = current.toMutableList()
        while (list.size <= idx) list.add(JsonNull)
        list[idx] =
          if (isLast && isDeletion) JsonNull
          else
            writeRecursive(
              list[idx].takeUnless { it is JsonNull },
              segments,
              index + 1,
              value,
              fullPath,
            )
        JsonArray(list)
      }
    }
  }

  private fun notifyCascade(changedPath: String) {
    for (sub in subscribers) {
      val matches =
        sub.path == "/" ||
          changedPath == "/" ||
          sub.path == changedPath ||
          sub.path.startsWith("$changedPath/") ||
          changedPath.startsWith("${sub.path}/")
      if (matches) {
        sub.listener(get(sub.path))
      }
    }
  }

  companion object {
    private val FORBIDDEN_KEYS = setOf("__proto__", "constructor", "prototype")

    private fun normalizePointer(path: String): String =
      if (path.isEmpty() || path == "/") "/" else if (path.startsWith("/")) path else "/$path"

    private fun parseSegments(normalized: String): List<String> =
      if (normalized == "/") emptyList()
      else normalized.substring(1).split("/").map { it.replace("~1", "/").replace("~0", "~") }
  }
}

/** Component definition model (`a2ui_core.blueprint.md` §3.E `ComponentModel`). */
class ComponentModel(
  val id: String,
  val type: String,
  val catalog: Catalog<*, *>,
  initialProperties: JsonObject,
  initialMetadata: A2uiMetadata? = null,
) : MetadataHolder {
  private val updatedNotifier = EventNotifier<ComponentModel>()
  private val metadataNotifier = EventNotifier<A2uiMetadata?>()

  var properties: JsonObject = initialProperties
    set(value) {
      if (field == value) return
      field = value
      updatedNotifier.emit(this)
    }

  override var metadata: A2uiMetadata? = initialMetadata
    set(value) {
      if (field == value) return
      field = value
      metadataNotifier.emit(value)
    }

  val onUpdated: EventSource<ComponentModel>
    get() = updatedNotifier

  override val onMetadataChanged: EventSource<A2uiMetadata?>
    get() = metadataNotifier

  override fun setExtension(key: String, value: JsonElement) {
    val updated = (metadata?.extensions ?: emptyMap()) + (key to value)
    metadata = A2uiMetadata(updated)
  }

  override fun removeExtension(key: String) {
    val current = metadata?.extensions ?: return
    if (key !in current) return
    val next = current - key
    metadata = if (next.isEmpty()) null else A2uiMetadata(next)
  }
}

/** Flat component map and topological integrity validator (`SurfaceComponentsModel`). */
class SurfaceComponentsModel(private val maxRecursionDepth: Int = 50) {
  private val items = linkedMapOf<String, ComponentModel>()
  private val createdNotifier = EventNotifier<ComponentModel>()
  private val deletedNotifier = EventNotifier<String>()

  val components: Map<String, ComponentModel>
    get() = items.toMap()

  val onCreated: EventSource<ComponentModel>
    get() = createdNotifier

  val onDeleted: EventSource<String>
    get() = deletedNotifier

  fun get(componentId: String): ComponentModel? = items[componentId]

  fun addComponent(component: ComponentModel) {
    if (component.id in items) {
      throw A2uiStateError("Component '${component.id}' already exists on surface")
    }
    items[component.id] = component
    createdNotifier.emit(component)
  }

  fun removeComponent(componentId: String) {
    if (items.remove(componentId) != null) {
      deletedNotifier.emit(componentId)
    }
  }

  fun getChildIds(componentId: String): List<String> {
    val comp = items[componentId] ?: return emptyList()
    return extractReferencedChildIds(comp.properties)
  }

  /** Validates an inbound batch prospectively before mutating surface state (`blueprint` §3.C). */
  fun validateComponentsUpdate(
    newComponents: List<ComponentModel>,
    rootId: String = "root",
    config: ValidationConfig = STRICT_VALIDATION,
  ) {
    val batchIds = HashSet<String>()
    for (comp in newComponents) {
      if (!batchIds.add(comp.id)) {
        throw A2uiIntegrityError("Duplicate component ID '${comp.id}' in update batch")
      }
    }
    val candidate = linkedMapOf<String, ComponentModel>()
    candidate.putAll(items)
    for (comp in newComponents) {
      candidate[comp.id] = comp
    }
    validateCandidateTopology(candidate, rootId, config)
  }

  fun validateTopology(rootId: String = "root", options: ValidationConfig = STRICT_VALIDATION) {
    validateCandidateTopology(items, rootId, options)
  }

  fun detectCycles(
    rootId: String = "root",
    options: ValidationConfig = STRICT_VALIDATION,
  ): Set<String> = detectCyclesInGraph(items, rootId, options)

  fun validateReferences(
    rootId: String = "root",
    options: ValidationConfig = STRICT_VALIDATION,
  ): List<A2uiValidationError> =
    try {
      validateTopology(rootId, options)
      emptyList()
    } catch (e: A2uiValidationError) {
      listOf(e)
    }

  fun dispose() {
    items.clear()
    createdNotifier.clear()
    deletedNotifier.clear()
  }

  private fun validateCandidateTopology(
    graph: Map<String, ComponentModel>,
    rootId: String,
    config: ValidationConfig,
  ) {
    if (!config.allowMissingRoot && rootId !in graph) {
      throw A2uiIntegrityError("Missing root component '$rootId'")
    }
    if (!config.allowDanglingReferences) {
      for ((id, comp) in graph) {
        for (refId in extractReferencedChildIds(comp.properties)) {
          if (refId == id) {
            throw A2uiIntegrityError("Component '$id' cannot reference itself")
          }
          if (refId !in graph) {
            throw A2uiIntegrityError("Component '$id' references missing component '$refId'")
          }
        }
      }
    }
    val reachable = detectCyclesInGraph(graph, rootId, config)
    if (!config.allowOrphanComponents && rootId in graph) {
      val orphans = graph.keys - reachable
      if (orphans.isNotEmpty()) {
        throw A2uiIntegrityError(
          "Orphan components unreachable from '$rootId': ${orphans.sorted().joinToString()}"
        )
      }
    }
  }

  private fun detectCyclesInGraph(
    graph: Map<String, ComponentModel>,
    rootId: String,
    config: ValidationConfig,
  ): Set<String> {
    val visited = linkedSetOf<String>()
    val stack = linkedSetOf<String>()

    fun dfs(nodeId: String, depth: Int) {
      if (depth > maxRecursionDepth) {
        throw A2uiRecursionError("Component tree depth exceeds limit ($maxRecursionDepth)")
      }
      if (!stack.add(nodeId)) {
        throw A2uiIntegrityError("Cycle detected in component graph at '$nodeId'")
      }
      visited.add(nodeId)
      val model = graph[nodeId]
      if (model != null) {
        for (childId in extractReferencedChildIds(model.properties)) {
          if (childId in graph) {
            dfs(childId, depth + 1)
          }
        }
      }
      stack.remove(nodeId)
    }

    if (rootId in graph) {
      dfs(rootId, 0)
    } else if (config.allowMissingRoot) {
      for (nodeId in graph.keys) {
        if (nodeId !in visited) dfs(nodeId, 0)
      }
    }
    return visited
  }

  companion object {
    internal fun extractReferencedChildIds(properties: JsonObject): List<String> {
      val refs = mutableListOf<String>()
      for ((key, value) in properties) {
        when {
          key == "child" && value is JsonPrimitive && value.isString -> refs.add(value.content)
          key == "children" && value is JsonArray -> {
            for (elem in value) {
              if (elem is JsonPrimitive && elem.isString) refs.add(elem.content)
            }
          }
          key == "children" && value is JsonObject -> {
            val compId = (value["componentId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (compId != null) refs.add(compId)
          }
          value is JsonArray -> {
            for (elem in value) {
              if (elem is JsonObject) {
                val nested = (elem["child"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                if (nested != null) refs.add(nested)
              }
            }
          }
        }
      }
      return refs
    }
  }
}

/** Single UI surface container (`a2ui_core.blueprint.md` §3.E `SurfaceModel`). */
class SurfaceModel<T : ComponentApi>(
  val id: String,
  val protocolVersion: ProtocolVersion = ProtocolVersion.V1_0,
  val defaultCatalog: Catalog<T, FunctionApi>? = null,
  val availableCatalogs: Map<String, Catalog<T, FunctionApi>> = emptyMap(),
  val rootId: String = "root",
  val sendDataModel: Boolean = false,
  val dataModel: DataModel = DataModel(),
  val componentsModel: SurfaceComponentsModel = SurfaceComponentsModel(),
  initialMetadata: A2uiMetadata? = null,
) : MetadataHolder {
  private val metadataSignalInternal = Signal(initialMetadata)
  private val metadataNotifier = EventNotifier<A2uiMetadata?>()
  private val actionNotifier = EventNotifier<A2uiRendererAction>()

  val metadataSignal: ReadonlySignal<A2uiMetadata?>
    get() = metadataSignalInternal

  override var metadata: A2uiMetadata?
    get() = metadataSignalInternal.value
    set(value) {
      if (metadataSignalInternal.value == value) return
      metadataSignalInternal.value = value
      metadataNotifier.emit(value)
    }

  override val onMetadataChanged: EventSource<A2uiMetadata?>
    get() = metadataNotifier

  val onAction: EventSource<A2uiRendererAction>
    get() = actionNotifier

  /**
   * Resolves explicit [catalogId] or falls back strictly to [defaultCatalog] (`blueprint` §3.E).
   */
  fun resolveCatalog(catalogId: String?, subject: String = "Item"): Catalog<T, FunctionApi> {
    if (catalogId != null) {
      return availableCatalogs[catalogId]
        ?: throw A2uiCatalogError("$subject references unavailable catalog '$catalogId'")
    }
    return defaultCatalog
      ?: throw A2uiCatalogError(
        "$subject omits 'catalogId' on surface '$id', which has no default catalog"
      )
  }

  override fun setExtension(key: String, value: JsonElement) {
    val next = (metadata?.extensions ?: emptyMap()) + (key to value)
    metadata = A2uiMetadata(next)
  }

  override fun removeExtension(key: String) {
    val current = metadata?.extensions ?: return
    if (key !in current) return
    val next = current - key
    metadata = if (next.isEmpty()) null else A2uiMetadata(next)
  }

  fun dispatchAction(action: A2uiRendererAction) {
    actionNotifier.emit(action)
  }

  fun dispose() {
    dataModel.dispose()
    componentsModel.dispose()
    metadataNotifier.clear()
    actionNotifier.clear()
  }
}

/** Root container of active surfaces (`a2ui_core.blueprint.md` §3.E `SurfaceGroupModel`). */
class SurfaceGroupModel<T : ComponentApi> {
  private val activeSurfaces = linkedMapOf<String, SurfaceModel<T>>()
  private val actionForwarders = linkedMapOf<String, com.google.a2ui.core.common.Subscription>()
  private val createdNotifier = EventNotifier<SurfaceModel<T>>()
  private val deletedNotifier = EventNotifier<String>()
  private val actionNotifier = EventNotifier<A2uiRendererAction>()

  val surfaces: Map<String, SurfaceModel<T>>
    get() = activeSurfaces.toMap()

  val onSurfaceCreated: EventSource<SurfaceModel<T>>
    get() = createdNotifier

  val onSurfaceDeleted: EventSource<String>
    get() = deletedNotifier

  val onAction: EventSource<A2uiRendererAction>
    get() = actionNotifier

  fun addSurface(surface: SurfaceModel<T>) {
    if (surface.id in activeSurfaces) {
      throw A2uiIntegrityError("Surface '${surface.id}' already exists")
    }
    activeSurfaces[surface.id] = surface
    actionForwarders[surface.id] = surface.onAction.subscribe { actionNotifier.emit(it) }
    createdNotifier.emit(surface)
  }

  fun deleteSurface(id: String) {
    actionForwarders.remove(id)?.unsubscribe()
    val removed = activeSurfaces.remove(id) ?: return
    removed.dispose()
    deletedNotifier.emit(id)
  }

  fun getSurface(id: String): SurfaceModel<T>? = activeSurfaces[id]

  fun dispose() {
    for (id in activeSurfaces.keys.toList()) {
      deleteSurface(id)
    }
    createdNotifier.clear()
    deletedNotifier.clear()
    actionNotifier.clear()
  }
}
