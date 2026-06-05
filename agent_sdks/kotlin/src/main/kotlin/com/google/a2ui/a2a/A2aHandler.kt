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

package com.google.a2ui.a2a

import com.google.a2ui.parser.hasA2uiParts
import com.google.a2ui.parser.parseResponseToParts
import com.google.a2ui.schema.A2uiConstants
import com.google.adk.agents.RunConfig
import com.google.adk.events.Event
import com.google.adk.runner.Runner
import com.google.adk.sessions.Session
import com.google.adk.sessions.SessionKey
import com.google.genai.types.Content
import com.google.genai.types.Part
import java.util.Optional
import java.util.UUID
import java.util.logging.Logger
import kotlinx.serialization.json.*

/**
 * Simplifies implementing the Agent-to-App (A2A) protocol for ADK agents without needing heavy
 * server dependencies.
 */
class A2aHandler(private val runner: Runner) {

  /** Handles the /.well-known/agent-card.json HTTP GET request. */
  fun handleAgentCardGet(
    agentName: String,
    serverUrl: String,
    supportedCatalogIds: List<String> = emptyList(),
    version: String = A2uiConstants.VERSION_0_9,
  ): Map<String, Any> {
    return mapOf(
      "name" to agentName,
      "url" to serverUrl,
      "endpoints" to mapOf("chat" to serverUrl),
      "capabilities" to
        mapOf(
          "streaming" to true,
          "extensions" to
            listOf(
              mapOf(
                "uri" to "${A2uiA2a.A2UI_EXTENSION_BASE_URI}$version",
                "params" to mapOf("supportedCatalogIds" to supportedCatalogIds),
              )
            ),
        ),
    )
  }

  /** Handles the /a2a HTTP POST JSON-RPC request. */
  @JvmOverloads
  fun handleA2aPost(
    requestBody: Map<String, Any>,
    sessionPreparer: ((Session, Map<*, *>) -> Unit)? = null,
  ): Map<String, Any> {
    val method = requestBody["method"] as? String
    val id = requestBody["id"] ?: ""
    val response = mutableMapOf<String, Any>("jsonrpc" to "2.0", "id" to id)

    try {
      if (method == "a2a.agent.card.get") {
        response["result"] = handleAgentCardGet(runner.appName(), "/a2a")
      } else if (method == "a2a.agent.invoke" || method == "message/send") {
        val params = requestBody["params"] as? Map<*, *>
        val messageMap = params?.get("message") as? Map<*, *>

        if (messageMap == null) {
          response["error"] = mapOf("code" to -32602, "message" to "Invalid params")
          return response
        }

        val contextId = messageMap["contextId"] as? String ?: DEFAULT_CONTEXT_ID
        val sessionId = contextId
        val userId = A2A_USER_ID

        val content = extractUserContent(messageMap)
        val session = getOrCreateSession(userId, sessionId)

        sessionPreparer?.invoke(session, requestBody)

        val events =
          runner.runAsync(session, content, RunConfig.builder().build()).toList().blockingGet()

        val allParts = translateEventsToA2aParts(events)
        response["result"] = createFinalMessage(contextId, events, allParts)
      } else {
        response["error"] = mapOf("code" to -32601, "message" to "Method not found")
      }
    } catch (e: Exception) {
      logger.severe(e.message)
      response["error"] = mapOf("code" to -32000, "message" to (e.message ?: "Unknown error"))
    }

    return response
  }

  private fun extractUserContent(messageMap: Map<*, *>): Content {
    val partsList = messageMap["parts"] as? List<*> ?: emptyList<Any>()
    val userText =
      partsList
        .filterIsInstance<Map<*, *>>()
        .filter { it["kind"] == "text" }
        .joinToString(separator = "") { it["text"] as? String ?: "" }
    return Content.builder()
      .role("user")
      .parts(listOf(Part.builder().text(userText).build()))
      .build()
  }

  private fun getOrCreateSession(userId: String, sessionId: String): Session {
    var session =
      runner
        .sessionService()
        .getSession(runner.appName(), userId, sessionId, Optional.empty())
        .blockingGet()
    if (session == null) {
      session =
        runner
          .sessionService()
          .createSession(SessionKey(runner.appName(), userId, sessionId))
          .blockingGet()
    }
    return session
  }

  private fun translateEventsToA2aParts(events: List<*>): List<Map<String, Any>> {
    return events.filterIsInstance<Event>().flatMap { event ->
      if (event.content().isPresent && event.content().get().parts().isPresent) {
        event.content().get().parts().get().flatMap { part -> processPart(part) }
      } else {
        emptyList()
      }
    }
  }

  private fun processPart(part: Part): List<Map<String, Any>> {
    val parsedParts = mutableListOf<Map<String, Any>>()

    val functionCall = part.functionCall().orElse(null)
    if (functionCall != null && functionCall.name().orElse(null) == "send_a2ui_json_to_client") {
      val argsMap = functionCall.args().orElse(null) as? Map<*, *>
      val a2uiJsonStr = argsMap?.get("a2ui_json") as? String
      if (a2uiJsonStr != null) {
        processA2uiJsonFunctionArg(a2uiJsonStr, parsedParts)
      }
    }

    val text = part.text().orElse("")?.trim() ?: ""
    if (text.isEmpty()) return parsedParts

    if (hasA2uiParts(text)) {
      processA2uiTextParts(text, parsedParts)
    } else {
      parsedParts.add(mapOf("kind" to "text", "text" to text))
    }

    return parsedParts
  }

  private fun processA2uiJsonFunctionArg(
    a2uiJsonStr: String,
    parsedParts: MutableList<Map<String, Any>>,
  ) {
    try {
      val element = Json.parseToJsonElement(a2uiJsonStr)
      val data = jsonElementToAny(element)
      if (data is Map<*, *> || data is List<*>) {
        parsedParts.add(
          mapOf(
            "kind" to "data",
            "metadata" to mapOf(A2uiA2a.MIME_TYPE_KEY to A2uiA2a.A2UI_MIME_TYPE),
            "data" to data,
          )
        )
      }
    } catch (e: Exception) {
      logger.severe(e.message)
    }
  }

  private fun processA2uiTextParts(text: String, parsedParts: MutableList<Map<String, Any>>) {
    try {
      val responseParts = parseResponseToParts(text)
      for (responsePart in responseParts) {
        if (responsePart.text.isNotBlank()) {
          parsedParts.add(mapOf("kind" to "text", "text" to responsePart.text.trim()))
        }

        responsePart.a2uiJson?.forEach { element ->
          val data = jsonElementToAny(element)
          if (data != null) {
            parsedParts.add(
              mapOf(
                "kind" to "data",
                "metadata" to mapOf(A2uiA2a.MIME_TYPE_KEY to A2uiA2a.A2UI_MIME_TYPE),
                "data" to data,
              )
            )
          }
        }
      }
    } catch (e: Exception) {
      logger.severe(e.message)
      parsedParts.add(mapOf("kind" to "text", "text" to text))
    }
  }

  private fun createFinalMessage(
    contextId: String,
    events: List<*>,
    allParts: List<Map<String, Any>>,
  ): Map<String, Any> {
    val lastEvent = events.lastOrNull() as? Event
    return mapOf(
      "messageId" to (lastEvent?.id() ?: UUID.randomUUID().toString()),
      "contextId" to contextId,
      "role" to "model",
      "kind" to "message",
      "parts" to allParts,
    )
  }

  private fun jsonElementToAny(element: JsonElement): Any? =
    when (element) {
      is JsonObject -> element.mapValues { jsonElementToAny(it.value) }
      is JsonArray -> element.map { jsonElementToAny(it) }
      is JsonPrimitive -> {
        if (element.isString) element.content
        else if (element.booleanOrNull != null) element.booleanOrNull
        else if (element.longOrNull != null) element.longOrNull
        else if (element.doubleOrNull != null) element.doubleOrNull else null
      }
    }

  private companion object {
    val logger: Logger = Logger.getLogger(A2aHandler::class.java.name)
    const val A2A_USER_ID = "a2a-user"
    const val DEFAULT_CONTEXT_ID = "default-context"
  }
}
