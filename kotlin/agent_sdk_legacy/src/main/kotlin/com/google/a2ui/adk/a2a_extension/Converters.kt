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

package com.google.a2ui.adk.a2a_extension

import com.google.a2ui.a2a.A2uiA2a
import com.google.a2ui.parser.hasA2uiParts
import com.google.a2ui.parser.parseResponseToParts
import com.google.a2ui.schema.A2uiCatalog
import com.google.adk.a2a.converters.EventConverter
import com.google.adk.agents.InvocationContext
import com.google.adk.events.Event
import com.google.genai.types.Content
import com.google.genai.types.Part
import io.a2a.spec.Event as A2aEvent
import io.a2a.spec.Message
import io.a2a.spec.Message.Role.ROLE_AGENT
import io.a2a.spec.Part as A2aPart
import io.a2a.spec.TaskState
import io.a2a.spec.TaskStatus
import io.a2a.spec.TaskStatusUpdateEvent
import io.a2a.spec.TextPart
import java.time.OffsetDateTime
import java.util.Optional
import java.util.UUID.randomUUID
import java.util.logging.Logger
import kotlinx.serialization.json.JsonElement

/** A catalog-aware GenAI to A2A part converter. */
class A2uiPartConverter(
  private val catalog: A2uiCatalog,
  private val bypassToolCheck: Boolean = false,
) {
  private val logger = Logger.getLogger(A2uiPartConverter::class.java.name)

  // Note: Due to missing public API for PartConverter in ADK Java SDK, falling back
  // to returning DataParts for A2UI, and omitting standard conversions here.
  // Client applications should adapt this integration logic based on actual available converters.

  fun convert(part: Part): List<A2aPart<*>> {
    val functionResponse = part.functionResponse().orElse(null)
    val isSendA2uiJsonToClientResponse =
      functionResponse != null &&
        functionResponse.name().orElse(null) == SendA2uiToClientToolset.TOOL_NAME

    if (isSendA2uiJsonToClientResponse || bypassToolCheck) {
      if (functionResponse == null) return emptyList()
      val responseMap = functionResponse.response().orElse(null) as? Map<*, *>

      responseMap?.get(SendA2uiToClientToolset.TOOL_ERROR_KEY)?.let {
        logger.warning("A2UI tool call failed: $it")
        return emptyList()
      }

      return (responseMap?.get(SendA2uiToClientToolset.VALIDATED_A2UI_JSON_KEY) as? JsonElement)
        ?.let { listOf(A2uiA2a.createA2uiPart(it)) } ?: emptyList()
    }

    val functionCall = part.functionCall().orElse(null)
    if (
      functionCall != null && functionCall.name().orElse(null) == SendA2uiToClientToolset.TOOL_NAME
    ) {
      return emptyList()
    }

    val text = part.text().orElse(null) ?: return emptyList()
    return if (hasA2uiParts(text)) {
      parseResponseToParts(text, catalog.validator).flatMap { responsePart ->
        responsePart.a2uiJson?.map { A2uiA2a.createA2uiPart(it) } ?: emptyList()
      }
    } else {
      emptyList()
    }
  }
}

/** An event converter that automatically injects the A2UI catalog into part conversion. */
class A2uiEventConverter(
  private val catalogKey: String = "system:a2ui_catalog",
  private val bypassToolCheck: Boolean = false,
) {

  fun convert(
    event: Event,
    invocationContext: InvocationContext,
    taskId: String? = null,
    contextId: String? = null,
  ): List<A2aEvent> {
    val catalog =
      invocationContext.session().state()[catalogKey] as? A2uiCatalog ?: return emptyList()

    val converter = A2uiPartConverter(catalog, bypassToolCheck)
    val events = mutableListOf<A2aEvent>()

    // 1. Process Errors
    val errorCode = event.errorCode().orElse(null)
    if (errorCode != null) {
      val errorMessage = event.errorMessage().orElse("An error occurred during processing")
      val errorMsgObj =
        Message.builder()
          .messageId(randomUUID().toString())
          .role(ROLE_AGENT)
          .parts(listOf(TextPart(errorMessage)))
          .build()

      val status = TaskStatus(TaskState.TASK_STATE_FAILED, errorMsgObj, OffsetDateTime.now())

      events.add(
        TaskStatusUpdateEvent.builder()
          .taskId(taskId ?: EventConverter.taskId(event))
          .contextId(contextId ?: EventConverter.contextId(event))
          .status(status)
          .build()
      )
    }

    // 2. Process Content
    val content = event.content().orElse(null)
    if (content != null) {
      val outputParts = mutableListOf<A2aPart<*>>()

      val genaiParts = content.parts().orElse(emptyList()) ?: emptyList()
      for (part in genaiParts) {
        val a2uiParts = converter.convert(part)
        if (a2uiParts.isNotEmpty()) {
          outputParts.addAll(a2uiParts)
        } else {
          // Fallback to standard GenAI to A2A Part conversion using ADK's internal EventConverter
          // helpers
          val singleContent = Content.builder().role("model").parts(listOf(part)).build()
          val standardParts = EventConverter.contentToParts(Optional.of(singleContent), false)
          outputParts.addAll(standardParts)
        }
      }

      if (outputParts.isNotEmpty()) {
        val msgObj =
          Message.builder()
            .messageId(randomUUID().toString())
            .role(ROLE_AGENT)
            .parts(outputParts)
            .build()

        val status = TaskStatus(TaskState.TASK_STATE_WORKING, msgObj, OffsetDateTime.now())

        events.add(
          TaskStatusUpdateEvent.builder()
            .taskId(taskId ?: EventConverter.taskId(event))
            .contextId(contextId ?: EventConverter.contextId(event))
            .status(status)
            .build()
        )
      }
    }

    return events
  }
}
