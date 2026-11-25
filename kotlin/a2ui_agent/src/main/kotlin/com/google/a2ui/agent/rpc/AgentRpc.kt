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

package com.google.a2ui.agent.rpc

import com.google.a2ui.core.catalog.AgentFunction
import com.google.a2ui.core.catalog.AgentFunctionContext
import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.common.Uax31Identifier
import com.google.a2ui.core.exceptions.A2uiCatalogError
import com.google.a2ui.core.exceptions.A2uiRpcError
import com.google.a2ui.core.exceptions.A2uiValidationError
import com.google.a2ui.core.exceptions.RpcErrorCode
import com.google.a2ui.core.schema.ActionMessage
import com.google.a2ui.core.schema.AgentFunctionResponseMessage
import com.google.a2ui.core.schema.AgentToRendererMessage
import com.google.a2ui.core.schema.CallAgentFunctionMessage
import com.google.a2ui.core.schema.CallRendererFunctionMessage
import com.google.a2ui.core.schema.ErrorMessage
import com.google.a2ui.core.schema.FunctionCall
import com.google.a2ui.core.schema.FunctionResponse
import com.google.a2ui.core.schema.RendererFunctionResponseMessage
import com.google.a2ui.core.schema.RendererToAgentMessage
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.serialization.json.JsonObject

/** Outcome of `RendererToAgentMessageProcessor.processMessage` (`agent_functions` §4). */
data class ProcessResult(
  val handled: Boolean,
  val replies: List<AgentToRendererMessage> = emptyList(),
)

/** Returning `false` declines the message so it continues to the model's turn. */
fun interface RendererMessageCallback<in T : RendererToAgentMessage> {
  suspend fun onMessage(message: T): Boolean
}

/**
 * Agent-side processor for inbound `RendererToAgentMessage` envelopes (`agent_functions` §2, §4).
 */
class RendererToAgentMessageProcessor(
  catalogs: Iterable<CatalogApi>,
  val agentFunctionTimeout: Duration? = null,
  private val onAction: RendererMessageCallback<ActionMessage>? = null,
  private val onError: RendererMessageCallback<ErrorMessage>? = null,
  private val onRendererFunctionResponse:
    RendererMessageCallback<RendererFunctionResponseMessage>? =
    null,
) {
  private val catalogsById: Map<String, CatalogApi>

  init {
    if (
      agentFunctionTimeout != null &&
        (!agentFunctionTimeout.isPositive() || !agentFunctionTimeout.isFinite())
    ) {
      throw IllegalArgumentException("agentFunctionTimeout must be a finite positive Duration")
    }
    val map = linkedMapOf<String, CatalogApi>()
    for (cat in catalogs) {
      if (map.put(cat.id, cat) != null) {
        throw A2uiCatalogError(
          "Duplicate catalog ID '${cat.id}' in RendererToAgentMessageProcessor"
        )
      }
    }
    catalogsById = map
  }

  suspend fun processMessage(message: RendererToAgentMessage): ProcessResult =
    when (message) {
      is CallAgentFunctionMessage ->
        ProcessResult(handled = true, replies = listOf(executeCall(message)))
      is ActionMessage ->
        if (onAction != null) ProcessResult(handled = onAction.onMessage(message))
        else ProcessResult(handled = false)
      is ErrorMessage ->
        if (onError != null) ProcessResult(handled = onError.onMessage(message))
        else ProcessResult(handled = false)
      is RendererFunctionResponseMessage ->
        if (onRendererFunctionResponse != null) {
          ProcessResult(handled = onRendererFunctionResponse.onMessage(message))
        } else {
          ProcessResult(handled = false)
        }
    }

  private suspend fun executeCall(msg: CallAgentFunctionMessage): AgentFunctionResponseMessage {
    if (msg.functionCallId.isEmpty()) {
      throw A2uiValidationError("callAgentFunction requires a non-empty 'functionCallId'")
    }
    if (msg.surfaceId.isEmpty() || msg.callFunction.call.isEmpty()) {
      return errorReply(
        msg.functionCallId,
        RpcErrorCode.INVALID_FUNCTION_CALL.name,
        "Invalid call target",
      )
    }
    val targetFn: Pair<String, AgentFunction> =
      if (msg.callFunction.catalogId == null) {
        val matches =
          catalogsById.mapNotNull { (catId, cat) ->
            cat.agentFunctions[msg.callFunction.call]?.let { catId to it }
          }
        when (matches.size) {
          0 ->
            return errorReply(
              msg.functionCallId,
              RpcErrorCode.UNKNOWN_FUNCTION.name,
              "Unknown agent function",
            )
          1 -> matches.single()
          else ->
            return errorReply(
              msg.functionCallId,
              RpcErrorCode.INVALID_FUNCTION_CALL.name,
              "Ambiguous agent function '${msg.callFunction.call}' across catalogs",
            )
        }
      } else {
        val cat =
          catalogsById[msg.callFunction.catalogId]
            ?: return errorReply(
              msg.functionCallId,
              RpcErrorCode.UNKNOWN_FUNCTION.name,
              "Unknown catalog",
            )
        val fn =
          cat.agentFunctions[msg.callFunction.call]
            ?: return errorReply(
              msg.functionCallId,
              RpcErrorCode.UNKNOWN_FUNCTION.name,
              "Unknown agent function",
            )
        cat.id to fn
      }

    return try {
      val argsMap = msg.callFunction.args?.toMap() ?: emptyMap()
      val ctx =
        AgentFunctionContext(
          catalogId = targetFn.first,
          surfaceId = msg.surfaceId,
          functionCallId = msg.functionCallId,
        )
      val value = targetFn.second.handler.invoke(argsMap, ctx)
      AgentFunctionResponseMessage(FunctionResponse.success(msg.functionCallId, value))
    } catch (e: A2uiRpcError) {
      errorReply(msg.functionCallId, e.rpcCode.name, e.message)
    } catch (t: Throwable) {
      errorReply(
        msg.functionCallId,
        RpcErrorCode.EXECUTION_ERROR.name,
        t.message ?: "Execution failed",
      )
    }
  }

  private fun errorReply(
    callId: String,
    code: String,
    message: String,
  ): AgentFunctionResponseMessage =
    AgentFunctionResponseMessage(FunctionResponse.failure(callId, code, message))
}

/** Handle to an in-flight `callRendererFunction` invocation (`agent_functions` §5). */
class PendingRendererCall
internal constructor(val functionCallId: String, private val onCancel: (String) -> Unit) {
  @Volatile
  var isDone: Boolean = false
    private set

  @Volatile
  var value: kotlinx.serialization.json.JsonElement? = null
    private set

  @Volatile
  var failure: A2uiRpcError? = null
    private set

  internal fun complete(result: kotlinx.serialization.json.JsonElement?) {
    if (isDone) return
    value = result
    isDone = true
  }

  internal fun fail(error: A2uiRpcError) {
    if (isDone) return
    failure = error
    isDone = true
  }

  fun cancel() {
    if (isDone) return
    isDone = true
    onCancel(functionCallId)
  }
}

/** Tracks pending agent-to-renderer function calls (`agent_functions.blueprint.md` §5). */
class RendererFunctionCalls(
  val defaultTimeout: Duration? = 30.seconds,
  val maxPending: Int? = null,
  catalogs: Iterable<CatalogApi>? = null,
) {
  private val catalogsById: Map<String, CatalogApi>? =
    catalogs?.let { list ->
      val map = linkedMapOf<String, CatalogApi>()
      for (c in list) {
        if (map.put(c.id, c) != null) {
          throw A2uiCatalogError("Duplicate catalog ID '${c.id}' in RendererFunctionCalls")
        }
      }
      map
    }
  private val pending = ConcurrentHashMap<String, PendingRendererCall>()

  @Volatile
  var disposed: Boolean = false
    private set

  val pendingCount: Int
    get() = pending.size

  fun isPending(functionCallId: String): Boolean = pending.containsKey(functionCallId)

  fun call(
    catalogId: String,
    name: String,
    args: JsonObject? = null,
    surfaceId: String? = null,
    timeout: Duration? = null,
    functionCallId: String? = null,
  ): Pair<CallRendererFunctionMessage, PendingRendererCall> {
    if (timeout != null && (!timeout.isPositive() || !timeout.isFinite())) {
      throw IllegalArgumentException("Per-call timeout must be finite and positive")
    }
    if (disposed) {
      throw A2uiRpcError("RendererFunctionCalls is disposed", RpcErrorCode.DISPOSED)
    }
    if (functionCallId != null && functionCallId.isEmpty()) {
      throw A2uiRpcError("functionCallId must not be empty", RpcErrorCode.INVALID_FUNCTION_CALL)
    }
    val resolvedCallId = functionCallId ?: "call_${UUID.randomUUID()}"
    if (pending.containsKey(resolvedCallId)) {
      throw A2uiRpcError(
        "Duplicate pending functionCallId '$resolvedCallId'",
        RpcErrorCode.DUPLICATE,
      )
    }
    if (maxPending != null && pending.size >= maxPending) {
      throw A2uiRpcError("Exceeded maxPending ($maxPending)", RpcErrorCode.TOO_MANY_PENDING)
    }
    if (name.isEmpty()) {
      throw A2uiRpcError("The call needs a function name.", RpcErrorCode.INVALID_FUNCTION_CALL)
    }
    if (catalogId.isEmpty()) {
      throw A2uiRpcError(
        "The call needs a non-empty catalogId.",
        RpcErrorCode.INVALID_FUNCTION_CALL,
      )
    }
    if (name.startsWith("@") || !Uax31Identifier.isValid(name)) {
      throw A2uiRpcError("Invalid function identifier '$name'", RpcErrorCode.INVALID_FUNCTION_CALL)
    }
    args?.keys?.forEach { key ->
      if (!Uax31Identifier.isValid(key)) {
        throw A2uiRpcError("Invalid argument key '$key'", RpcErrorCode.INVALID_FUNCTION_CALL)
      }
    }
    if (catalogsById != null) {
      val cat =
        catalogsById[catalogId]
          ?: throw A2uiRpcError("Unknown catalog '$catalogId'", RpcErrorCode.UNKNOWN_FUNCTION)
      val fn =
        cat.rendererFunctions[name]
          ?: throw A2uiRpcError(
            "Function '$name' is not a renderer function in '$catalogId'",
            RpcErrorCode.UNKNOWN_FUNCTION,
          )
      if (!fn.allowedCallers.isAgentCallable || fn.requiresUserActivation) {
        throw A2uiRpcError(
          "Function '$name' cannot be invoked by the agent",
          RpcErrorCode.INVALID_FUNCTION_CALL,
        )
      }
    }

    val handle = PendingRendererCall(resolvedCallId) { id -> pending.remove(id) }
    pending[resolvedCallId] = handle
    val message =
      CallRendererFunctionMessage(
        functionCallId = resolvedCallId,
        callFunction = FunctionCall(call = name, catalogId = catalogId, args = args),
        surfaceId = surfaceId?.takeIf { it.isNotEmpty() },
      )
    return message to handle
  }

  fun resolve(message: RendererFunctionResponseMessage): Boolean {
    val handle = pending.remove(message.response.functionCallId) ?: return false
    val err = message.response.error
    if (err != null) {
      val code =
        RpcErrorCode.entries.firstOrNull { it.name == err.code } ?: RpcErrorCode.EXECUTION_ERROR
      handle.fail(A2uiRpcError(err.message, code))
    } else {
      handle.complete(message.response.value)
    }
    return true
  }

  fun dispose(reason: String = "Disposed") {
    disposed = true
    for (id in pending.keys.toList()) {
      pending.remove(id)?.fail(A2uiRpcError(reason, RpcErrorCode.CANCELLED))
    }
  }
}
