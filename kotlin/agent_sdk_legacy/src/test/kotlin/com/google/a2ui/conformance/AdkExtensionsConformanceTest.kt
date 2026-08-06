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

package com.google.a2ui.conformance

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.google.a2ui.adk.a2a_extension.A2uiEventConverter
import com.google.a2ui.adk.a2a_extension.SendA2uiToClientToolset
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiVersion
import com.google.adk.a2a.converters.EventConverter
import com.google.adk.agents.InvocationContext
import com.google.adk.agents.ReadonlyContext
import com.google.adk.events.Event
import com.google.adk.sessions.Session
import com.google.adk.tools.ToolContext
import com.google.common.collect.ImmutableList
import com.google.genai.types.Content
import com.google.genai.types.FinishReason
import com.google.genai.types.Part
import io.a2a.spec.TaskState
import io.a2a.spec.TaskStatusUpdateEvent
import io.a2a.spec.TextPart
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import java.util.Optional
import java.util.concurrent.ConcurrentHashMap
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class AdkExtensionsConformanceTest {

  private val yamlMapper = ObjectMapper(YAMLFactory())
  private val jsonMapper = ObjectMapper()

  @TestFactory
  fun testAdkExtensionsConformance(): List<DynamicTest> {
    val conformanceFile = ConformanceTestHelper.getConformanceFile("suites/adk_extensions.yaml")
    val rawList = yamlMapper.readValue(conformanceFile, Any::class.java) as List<*>

    return rawList.map { caseObj ->
      val case = caseObj as Map<*, *>
      val name = case[ConformanceTestHelper.KEY_NAME] as String
      val action = case[ConformanceTestHelper.KEY_ACTION] as String
      val args = case[ConformanceTestHelper.KEY_ARGS] as? Map<*, *> ?: emptyMap<Any, Any>()

      DynamicTest.dynamicTest(name) {
        when (action) {
          "convert_event" -> {
            val hasCatalog = args["has_catalog"] as? Boolean ?: false
            val session = mockk<Session>()
            val state = ConcurrentHashMap<String, Any>()
            if (hasCatalog) {
              state["system:a2ui_catalog"] = mockk<A2uiCatalog>()
            }
            every { session.state() } returns state

            val context = mockk<InvocationContext>()
            every { context.session() } returns session

            val mockEvent = mockk<Event>()
            val errorCode = args["error_code"] as? String
            val errorMessage = args["error_message"] as? String
            val contentText = args["content_text"] as? String

            if (errorCode != null) {
              val finishReason = mockk<FinishReason>()
              every { mockEvent.errorCode() } returns Optional.of(finishReason)
            } else {
              every { mockEvent.errorCode() } returns Optional.empty()
            }

            every { mockEvent.errorMessage() } returns Optional.ofNullable(errorMessage)
            every { mockEvent.author() } returns "test_author"

            if (contentText != null) {
              val mockGenaiPart = mockk<Part>()
              every { mockGenaiPart.functionResponse() } returns Optional.empty()
              every { mockGenaiPart.functionCall() } returns Optional.empty()
              every { mockGenaiPart.text() } returns Optional.of(contentText)
              every { mockGenaiPart.thought() } returns Optional.empty()
              every { mockGenaiPart.partMetadata() } returns Optional.empty()

              val mockContent = mockk<Content>()
              every { mockContent.parts() } returns Optional.of(listOf(mockGenaiPart))
              every { mockEvent.content() } returns Optional.of(mockContent)

              mockkStatic(EventConverter::class)
              every { EventConverter.contentToParts(any(), false) } returns
                ImmutableList.of(TextPart(contentText))
            } else {
              every { mockEvent.content() } returns Optional.empty()
            }

            mockkStatic(EventConverter::class)
            every { EventConverter.taskId(mockEvent) } returns "task-1"
            every { EventConverter.contextId(mockEvent) } returns "context-1"

            val converter = A2uiEventConverter()
            val results = converter.convert(mockEvent, context)

            val expectEmpty = case["expect_empty"] as? Boolean ?: false
            if (expectEmpty) {
              assertTrue(results.isEmpty())
            } else {
              assertEquals(1, results.size)
              val result = results[0]
              assertIs<TaskStatusUpdateEvent>(result)

              val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
              val expectState = expect["state"] as String
              val expectMessage = expect["message"] as String

              assertEquals("task-1", result.taskId())
              assertEquals("context-1", result.contextId())

              val expectedTaskState =
                when (expectState) {
                  "FAILED" -> TaskState.TASK_STATE_FAILED
                  "WORKING" -> TaskState.TASK_STATE_WORKING
                  else -> throw IllegalArgumentException("Unknown state $expectState")
                }
              assertEquals(expectedTaskState, result.status().state())

              val msg = result.status().message()!!
              val part = msg.parts()!![0] as TextPart
              assertEquals(expectMessage, part.text())
            }
          }
          "execute_tool" -> {
            val a2uiJsonStr = args["a2ui_json"] as? String
            val toolArgs =
              if (a2uiJsonStr != null) mapOf("a2ui_json" to a2uiJsonStr)
              else args as Map<String, Any>

            val serverToClientSchema =
              Json.parseToJsonElement(
                  """{"type": "object", "properties": {"beginRendering": {"type": "object"}}}"""
                )
                .jsonObject
            val catalogSchema =
              Json.parseToJsonElement(
                  """{"catalogId": "dummy", "components": {"TestComp": {"type": "object"}}}"""
                )
                .jsonObject
            val dummyCatalog =
              A2uiCatalog(
                version = A2uiVersion.VERSION_0_8,
                name = "dummy",
                serverToClientSchema = serverToClientSchema,
                commonTypesSchema = JsonObject(emptyMap()),
                catalogSchema = catalogSchema,
              )

            val mockContext = mockk<ReadonlyContext>(relaxed = true)
            val mockToolContext = mockk<ToolContext>(relaxed = true)

            val toolset = SendA2uiToClientToolset.create(true, dummyCatalog, "")
            val tool = toolset.getTools(mockContext).blockingFirst()

            val result = tool.runAsync(toolArgs, mockToolContext).blockingGet()

            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
            val expectSuccess = expect["success"] as Boolean

            if (expectSuccess) {
              assertTrue(result.containsKey(SendA2uiToClientToolset.VALIDATED_A2UI_JSON_KEY))
              val containsValidatedJson = expect["contains_validated_json"] as? Boolean ?: false
              if (containsValidatedJson) {
                val validatedPayload =
                  result[SendA2uiToClientToolset.VALIDATED_A2UI_JSON_KEY].toString()
                assertTrue(validatedPayload.contains("beginRendering"))
              }
            } else {
              assertTrue(result.containsKey(SendA2uiToClientToolset.TOOL_ERROR_KEY))
              val errorContains = expect["error_contains"] as? String
              if (errorContains != null) {
                val errorMsg = result[SendA2uiToClientToolset.TOOL_ERROR_KEY] as String
                assertTrue(errorMsg.contains(errorContains))
              }
            }
          }
          else -> assert(false, { "Unknown action: $action" })
        }
      }
    }
  }
}
