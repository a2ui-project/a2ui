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

package com.google.a2ui.core.rpc

import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.catalog.FunctionImplementation
import com.google.a2ui.core.common.Subscription
import com.google.a2ui.core.exceptions.A2uiRpcError
import com.google.a2ui.core.exceptions.RpcErrorCode
import com.google.a2ui.core.resolution.DataContext
import com.google.a2ui.core.schema.AgentFunctionResponseMessage
import com.google.a2ui.core.schema.CallAgentFunctionMessage
import com.google.a2ui.core.schema.CallRendererFunctionMessage
import com.google.a2ui.core.schema.FunctionCall
import com.google.a2ui.core.schema.FunctionResponse
import com.google.a2ui.core.schema.RendererFunctionResponseMessage
import com.google.a2ui.core.schema.RendererToAgentMessage
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.serialization.json.JsonElement

enum class CallPriority {
  URGENT,
  NORMAL,
  BACKGROUND,
}

/** Cooperative cancellation token for outbound RPC calls (`a2ui_core.blueprint.md` §3.D). */
class CancellationToken {
  private val listeners = CopyOnWriteArrayList<() -> Unit>()
  @Volatile
  var isCancelled: Boolean = false
    private set

  fun cancel() {
    if (isCancelled) return
    isCancelled = true
    val snapshot = listeners.toList()
    listeners.clear()
    for (listener in snapshot) {
      listener()
    }
  }

  fun onCancel(listener: () -> Unit): Subscription {
    if (isCancelled) {
      listener()
      return Subscription {}
    }
    listeners.add(listener)
    return Subscription { listeners.remove(listener) }
  }
}

data class CallOptions(
  val timeout: Duration? = null,
  val priority: CallPriority = CallPriority.NORMAL,
  val cancellationToken: CancellationToken? = null,
)

/** Transport callback receiving outbound RPC messages (`a2ui_core.blueprint.md` §3.D). */
fun interface OutboundMessageListener {
  fun onOutboundMessage(message: RendererToAgentMessage)
}

/**
 * Bidirectional RPC lifecycle manager (`a2ui_core.blueprint.md` §3.D `RpcHandler`).
 *
 * Uses `kotlin.coroutines` from `kotlin-stdlib` (`suspendCoroutine`) so asynchronous `suspend`
 * calls work idiomatically without forcing `kotlinx-coroutines-core` onto the base classpath.
 */
class RpcHandler(
  private val catalogs: List<Catalog<*, *>>,
  private val outboundListener: OutboundMessageListener? = null,
  val defaultTimeout: Duration = 30.seconds,
) {
  private data class PendingCall(
    val surfaceId: String,
    val continuation: Continuation<JsonElement?>,
  )

  private val pendingCalls = ConcurrentHashMap<String, PendingCall>()
  @Volatile private var isDisposed = false

  suspend fun callAgentFunction(
    surfaceId: String,
    call: FunctionCall,
    options: CallOptions = CallOptions(),
  ): JsonElement? {
    if (isDisposed) {
      throw A2uiRpcError("RpcHandler has been disposed", RpcErrorCode.DISPOSED)
    }
    val listener =
      outboundListener
        ?: throw A2uiRpcError(
          "OutboundMessageListener required before calling callAgentFunction",
          RpcErrorCode.NO_LISTENER,
        )
    if (options.cancellationToken?.isCancelled == true) {
      throw A2uiRpcError("Outbound call cancelled before dispatch", RpcErrorCode.CANCELLED)
    }
    val callId = UUID.randomUUID().toString()
    return suspendCoroutine { cont ->
      pendingCalls[callId] = PendingCall(surfaceId = surfaceId, continuation = cont)
      options.cancellationToken?.onCancel {
        pendingCalls
          .remove(callId)
          ?.continuation
          ?.resumeWithException(A2uiRpcError("Outbound call cancelled", RpcErrorCode.CANCELLED))
      }
      try {
        listener.onOutboundMessage(
          CallAgentFunctionMessage(
            surfaceId = surfaceId,
            functionCallId = callId,
            callFunction = call,
          )
        )
      } catch (t: Throwable) {
        pendingCalls.remove(callId)
        cont.resumeWithException(
          A2uiRpcError("Outbound listener failed: ${t.message}", RpcErrorCode.EXECUTION_ERROR, t)
        )
      }
    }
  }

  fun handleCallRendererFunction(
    message: CallRendererFunctionMessage,
    context: DataContext,
    isUserActivated: Boolean = false,
  ): RendererFunctionResponseMessage {
    val catId = message.callFunction.catalogId
    val catalog =
      catalogs.firstOrNull { it.id == catId }
        ?: return invalidCall(message.functionCallId, "Unregistered catalog '$catId'")
    val fn =
      catalog.functions[message.callFunction.call]
        ?: return invalidCall(
          message.functionCallId,
          "Function '${message.callFunction.call}' not found in catalog '$catId'",
        )
    if (!fn.allowedCallers.isAgentCallable) {
      return invalidCall(
        message.functionCallId,
        "Function '${fn.name}' is not agent-callable (${fn.allowedCallers.wireValue})",
      )
    }
    if (fn.requiresUserActivation && !isUserActivated) {
      return invalidCall(
        message.functionCallId,
        "Function '${fn.name}' requires an active user gesture",
      )
    }
    val impl =
      fn as? FunctionImplementation
        ?: return invalidCall(
          message.functionCallId,
          "Function '${fn.name}' has no renderer implementation",
        )
    return try {
      val argsMap = message.callFunction.args?.toMap() ?: emptyMap()
      val result =
        when (val exec = impl.execute(argsMap, context)) {
          is com.google.a2ui.core.catalog.FunctionExecutionResult.Immediate -> exec.value
          is com.google.a2ui.core.catalog.FunctionExecutionResult.Reactive -> exec.signal.value
        }
      RendererFunctionResponseMessage(FunctionResponse.success(message.functionCallId, result))
    } catch (t: Throwable) {
      RendererFunctionResponseMessage(
        FunctionResponse.failure(
          message.functionCallId,
          RpcErrorCode.EXECUTION_ERROR.name,
          t.message ?: "Function execution failed",
        )
      )
    }
  }

  fun handleAgentFunctionResponse(message: AgentFunctionResponseMessage) {
    val pending = pendingCalls.remove(message.response.functionCallId) ?: return
    val err = message.response.error
    if (err != null) {
      val code =
        RpcErrorCode.entries.firstOrNull { it.name == err.code } ?: RpcErrorCode.EXECUTION_ERROR
      pending.continuation.resumeWithException(A2uiRpcError(err.message, code))
    } else {
      pending.continuation.resume(message.response.value)
    }
  }

  fun cancelSurfaceCalls(surfaceId: String) {
    val matching = pendingCalls.entries.filter { it.value.surfaceId == surfaceId }.map { it.key }
    for (callId in matching) {
      pendingCalls
        .remove(callId)
        ?.continuation
        ?.resumeWithException(A2uiRpcError("Surface '$surfaceId' deleted", RpcErrorCode.CANCELLED))
    }
  }

  fun dispose(reason: String = "RpcHandler disposed") {
    isDisposed = true
    for (callId in pendingCalls.keys.toList()) {
      pendingCalls
        .remove(callId)
        ?.continuation
        ?.resumeWithException(A2uiRpcError(reason, RpcErrorCode.CANCELLED))
    }
  }

  private fun invalidCall(callId: String, message: String): RendererFunctionResponseMessage =
    RendererFunctionResponseMessage(
      FunctionResponse.failure(callId, RpcErrorCode.INVALID_FUNCTION_CALL.name, message)
    )
}
