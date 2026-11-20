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

import java.util.concurrent.CopyOnWriteArrayList

/** Disposable listener handle (`a2ui_core.blueprint.md` §3.E). */
fun interface Subscription {
  fun unsubscribe()
}

/** Stateful subscription exposing the latest evaluated value alongside [unsubscribe]. */
interface ValueSubscription<out T> : Subscription {
  val value: T
}

/** Read-only discrete multicast event stream (`onSurfaceCreated`, `onAction`, etc.). */
interface EventSource<out T> {
  fun subscribe(listener: (T) -> Unit): Subscription
}

/** Thread-safe multicast publisher backing an [EventSource]. */
class EventNotifier<T> : EventSource<T> {
  private val listeners = CopyOnWriteArrayList<(T) -> Unit>()

  override fun subscribe(listener: (T) -> Unit): Subscription {
    listeners.add(listener)
    return Subscription { listeners.remove(listener) }
  }

  fun emit(event: T) {
    for (listener in listeners) {
      listener(event)
    }
  }

  fun clear() {
    listeners.clear()
  }
}

/**
 * Synchronous stateful reactive value (`a2ui_core.blueprint.md` §3.E, `node_resolution`
 * §Interfaces).
 *
 * Kept intentionally free of `kotlinx.coroutines.flow.StateFlow` in the base `a2ui_core` artifact
 * so synchronous notification counts (e.g. per-key `createSurface` data-model cascades) are never
 * dropped by `StateFlow` conflation and `a2ui_core` carries zero coroutines runtime baggage.
 */
interface ReadonlySignal<out T> {
  val value: T

  fun subscribe(listener: (T) -> Unit): ValueSubscription<T>
}

/** Mutable reactive [ReadonlySignal] supporting synchronous [reactiveBatch] coalescing. */
class Signal<T>(initialValue: T) : ReadonlySignal<T> {
  @Volatile private var current: T = initialValue
  private val listeners = CopyOnWriteArrayList<(T) -> Unit>()
  private var dirtyInBatch = false

  override var value: T
    get() = current
    set(next) {
      if (current == next) return
      current = next
      if (BatchCoordinator.isBatching()) {
        dirtyInBatch = true
        BatchCoordinator.enqueue(this)
      } else {
        notifyListeners(next)
      }
    }

  override fun subscribe(listener: (T) -> Unit): ValueSubscription<T> {
    listeners.add(listener)
    return object : ValueSubscription<T> {
      override val value: T
        get() = current

      override fun unsubscribe() {
        listeners.remove(listener)
      }
    }
  }

  internal fun flushFromBatch() {
    if (!dirtyInBatch) return
    dirtyInBatch = false
    val snapshot = current
    notifyListeners(snapshot)
  }

  private fun notifyListeners(snapshot: T) {
    for (listener in listeners) {
      listener(snapshot)
    }
  }
}

private object BatchCoordinator {
  private val depth = ThreadLocal.withInitial { 0 }
  private val pending = ThreadLocal.withInitial { LinkedHashSet<Signal<*>>() }

  fun isBatching(): Boolean = depth.get() > 0

  fun enqueue(signal: Signal<*>) {
    pending.get().add(signal)
  }

  fun <R> runBatch(block: () -> R): R {
    val nextDepth = depth.get() + 1
    depth.set(nextDepth)
    try {
      return block()
    } finally {
      val remaining = nextDepth - 1
      depth.set(remaining)
      if (remaining == 0) {
        val toFlush = pending.get().toList()
        pending.get().clear()
        for (signal in toFlush) {
          signal.flushFromBatch()
        }
      }
    }
  }
}

/** Coalesces multiple [Signal] writes on the current thread into a single notification pass. */
fun <R> reactiveBatch(block: () -> R): R = BatchCoordinator.runBatch(block)
