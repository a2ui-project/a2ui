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

package com.google.a2ui.core.resolution

import com.google.a2ui.core.catalog.ComponentApi
import com.google.a2ui.core.common.A2uiMetadata
import com.google.a2ui.core.common.EventSource
import com.google.a2ui.core.common.ReadonlySignal
import com.google.a2ui.core.common.Signal
import com.google.a2ui.core.common.ValueSubscription
import com.google.a2ui.core.exceptions.A2uiValidationError
import com.google.a2ui.core.state.DataModel
import com.google.a2ui.core.state.SurfaceModel
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Scoped binding and function resolution context (`a2ui_core.blueprint.md` §3.F `DataContext`). */
class DataContext(
  val dataModel: DataModel,
  val path: String,
  val surface: SurfaceModel<*>,
  val collectionIndex: Int? = null,
) {
  fun set(relativeOrAbsolutePath: String, value: JsonElement?) {
    dataModel.set(resolvePath(relativeOrAbsolutePath), value)
  }

  fun resolveDynamicValue(value: JsonElement): JsonElement =
    when (value) {
      is JsonObject ->
        when {
          "@path" in value && value.size == 1 -> {
            val rawPath =
              (value["@path"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: throw A2uiValidationError("DataBinding '@path' must be a string")
            dataModel.get(resolvePath(rawPath)) ?: JsonNull
          }
          "@call" in value -> {
            val fnName =
              (value["@call"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: throw A2uiValidationError("FunctionCall '@call' must be a string")
            if (fnName == "@index") {
              val idx =
                collectionIndex
                  ?: throw A2uiValidationError("'@index' is only valid inside a collection scope")
              JsonPrimitive(idx)
            } else {
              JsonNull
            }
          }
          else -> JsonObject(value.mapValues { (_, child) -> resolveDynamicValue(child) })
        }
      is JsonArray -> JsonArray(value.map { resolveDynamicValue(it) })
      else -> value
    }

  fun subscribeDynamicValue(
    value: JsonElement,
    onChange: (JsonElement?) -> Unit,
  ): ValueSubscription<JsonElement?> {
    if (value is JsonObject && "@path" in value && value.size == 1) {
      val rawPath = (value["@path"] as? JsonPrimitive)?.content ?: ""
      return dataModel.subscribe(resolvePath(rawPath), onChange)
    }
    return object : ValueSubscription<JsonElement?> {
      override val value: JsonElement
        get() = resolveDynamicValue(value)

      override fun unsubscribe() {}
    }
  }

  fun nested(relativePath: String, itemIndex: Int? = collectionIndex): DataContext =
    DataContext(
      dataModel = dataModel,
      path = resolvePath(relativePath),
      surface = surface,
      collectionIndex = itemIndex,
    )

  private fun resolvePath(target: String): String =
    when {
      target.startsWith("/") -> target
      path == "/" || path.isEmpty() -> "/$target"
      target.isEmpty() -> path
      else -> "$path/$target"
    }
}

/** Read-only resolved dynamic property (`node_resolution.blueprint.md` §3). */
interface ResolvedBinding<out T> {
  val value: T
}

/** Two-way data-path-bound property (`node_resolution.blueprint.md` §3). */
interface WritableBinding<T> : ResolvedBinding<T> {
  fun set(value: T)
}

enum class NodeState(val wireValue: String) {
  RESOLVED("resolved"),
  PENDING("pending"),
  UNKNOWN_TYPE("unknown-type"),
  CYCLIC("cyclic"),
}

data class ActionDispatchOptions(val metadata: A2uiMetadata? = null)

fun interface NodeAction {
  fun invoke(options: ActionDispatchOptions)
}

/**
 * Living resolved component instance in a surface view hierarchy (`node_resolution` §Interfaces).
 */
interface ComponentNode<out C : ComponentApi> {
  val instanceId: String
  val id: String
  val componentId: String
  val type: String
  val dataPath: String
  val state: NodeState
  val isPlaceholder: Boolean
    get() = state != NodeState.RESOLVED

  val disposed: Boolean
  val impl: C?
  val props: ReadonlySignal<Map<String, Any?>>
  val metadata: ReadonlySignal<A2uiMetadata?>
  val onDestroyed: EventSource<Unit>

  fun addCleanup(cleanup: () -> Unit)
}

/**
 * Reactive view-tree resolver over a [SurfaceModel] (`node_resolution.blueprint.md` §Interfaces).
 */
class NodeResolver<C : ComponentApi>(val surface: SurfaceModel<C>) {
  private val rootSignal = Signal<ComponentNode<C>?>(null)

  val rootNode: ReadonlySignal<ComponentNode<C>?>
    get() = rootSignal

  fun dispose() {
    rootSignal.value = null
  }
}

/** Schema-driven binder classifying dynamic, structural, checkable, and action properties. */
class GenericBinder {
  fun bindProperties(
    schema: JsonObject,
    rawProperties: JsonObject,
    context: DataContext,
  ): Map<String, Any?> = rawProperties.mapValues { (_, v) -> context.resolveDynamicValue(v) }
}
