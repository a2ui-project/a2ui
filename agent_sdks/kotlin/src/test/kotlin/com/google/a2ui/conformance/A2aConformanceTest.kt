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

// TODO: Migrate to extensions.yaml conformance tests when Kotlin SDK matches Python version's
// RequestContext and Card usage.

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.google.a2ui.a2a.A2aHandler
import com.google.a2ui.a2a.A2uiA2a
import com.google.adk.agents.RunConfig
import com.google.adk.events.Event
import com.google.adk.runner.Runner
import com.google.adk.sessions.BaseSessionService
import com.google.adk.sessions.GetSessionConfig
import com.google.adk.sessions.Session
import com.google.genai.types.Content
import com.google.genai.types.Part
import io.a2a.spec.DataPart
import io.mockk.every
import io.mockk.mockk
import io.reactivex.rxjava3.core.Flowable
import io.reactivex.rxjava3.core.Maybe
import java.util.Optional
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class A2aConformanceTest {

  private val yamlMapper = ObjectMapper(YAMLFactory())
  private val jsonMapper = ObjectMapper()

  private fun anyToJsonElement(any: Any?): JsonElement =
    when (any) {
      null -> JsonNull
      is Map<*, *> -> {
        val map: Map<String, JsonElement> =
          any.entries.associate { (key, value) -> key.toString() to anyToJsonElement(value) }
        JsonObject(map)
      }
      is List<*> -> JsonArray(any.map { anyToJsonElement(it) })
      is String -> JsonPrimitive(any)
      is Number -> JsonPrimitive(any)
      is Boolean -> JsonPrimitive(any)
      else -> throw IllegalArgumentException("Unsupported type: ${any.javaClass.name}")
    }

  @TestFactory
  fun testA2aIntegrationConformance(): List<DynamicTest> {
    val conformanceFile = ConformanceTestHelper.getConformanceFile("suites/a2a_integration.yaml")
    val rawList = yamlMapper.readValue(conformanceFile, Any::class.java) as List<*>

    return rawList.map { caseObj ->
      val case = caseObj as Map<*, *>
      val name = case[ConformanceTestHelper.KEY_NAME] as String
      val action = case[ConformanceTestHelper.KEY_ACTION] as String
      val args = case[ConformanceTestHelper.KEY_ARGS] as? Map<*, *> ?: emptyMap<Any, Any>()

      DynamicTest.dynamicTest(name) {
        when (action) {
          "create_a2ui_part" -> {
            val data = args["data"] as Map<*, *>
            val jsonElement = anyToJsonElement(data) as JsonObject

            val version = args["version"] as? String
            val part = A2uiA2a.createA2uiPart(jsonElement, version)
            assertTrue(part is DataPart)
            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
            assertEquals(
              expect["mime_type"] as String,
              (part as DataPart).metadata?.get(A2uiA2a.MIME_TYPE_KEY),
            )
          }
          "is_a2ui_part" -> {
            val mimeType = args["mime_type"] as String
            val part = mockk<DataPart>()
            every { part.metadata } returns mapOf(A2uiA2a.MIME_TYPE_KEY to mimeType)

            val result = A2uiA2a.isA2uiPart(part)
            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Boolean
            assertEquals(expect, result)
          }
          "try_activate_extension" -> {
            val uris = args["uris"] as List<String>
            val activated = mutableListOf<String>()
            val result =
              A2uiA2a.tryActivateA2uiExtension(
                uris,
                listOf("${A2uiA2a.A2UI_EXTENSION_BASE_URI}0.8"),
              ) {
                activated.add(it)
              }

            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Boolean
            assertEquals(expect, result != null)
            if (expect) {
              assertTrue(activated.contains("${A2uiA2a.A2UI_EXTENSION_BASE_URI}0.8"))
            }
          }
          "get_extension" -> {
            val version = args["version"] as String
            val acceptsInlineCatalogs = args["accepts_inline_catalogs"] as? Boolean ?: false
            @Suppress("UNCHECKED_CAST")
            val supportedCatalogIds = args["supported_catalog_ids"] as? List<String> ?: emptyList()

            val ext =
              A2uiA2a.getA2uiAgentExtension(version, acceptsInlineCatalogs, supportedCatalogIds)
            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
            assertEquals(expect["uri"] as String, ext.uri)
            assertEquals(expect["params"] as? Map<*, *>, ext.params)
          }
          "try_activate" -> {
            @Suppress("UNCHECKED_CAST") val requested = args["requested"] as List<String>
            @Suppress("UNCHECKED_CAST") val advertised = args["advertised"] as List<String>
            var activated: String? = null
            val result = A2uiA2a.tryActivateA2uiExtension(requested, advertised) { activated = it }

            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
            assertEquals(expect["version"] as? String, result)
            assertEquals(expect["activated"] as? String, activated)
          }
          "select_newest" -> {
            @Suppress("UNCHECKED_CAST") val requested = args["requested"] as List<String>
            @Suppress("UNCHECKED_CAST") val advertised = args["advertised"] as List<String>
            val result = A2uiA2a.selectNewestA2uiExtension(requested, advertised)

            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
            assertEquals(expect["newest"] as? String, result)
          }
          "handle_rpc" -> {
            val request = args["request"] as Map<*, *>
            val runnerOutput = args["runner_output"] as String

            val mockRunner = mockk<Runner>(relaxed = true)
            val mockSessionService = mockk<BaseSessionService>(relaxed = true)
            val mockSession = mockk<Session>(relaxed = true)

            every { mockRunner.appName() } returns "test-app"
            every { mockRunner.sessionService() } returns mockSessionService
            every {
              mockSessionService.getSession(
                any<String>(),
                any<String>(),
                any<String>(),
                any<Optional<GetSessionConfig>>(),
              )
            } returns Maybe.just(mockSession)

            val mockPart = mockk<Part>(relaxed = true)
            every { mockPart.text() } returns Optional.of(runnerOutput)
            every { mockPart.functionCall() } returns Optional.empty()

            val mockContent = mockk<Content>(relaxed = true)
            every { mockContent.parts() } returns Optional.of(listOf(mockPart))

            val mockEvent = mockk<Event>(relaxed = true)
            every { mockEvent.id() } returns "test-event-id"
            every { mockEvent.content() } returns Optional.of(mockContent)

            every { mockRunner.runAsync(any<Session>(), any<Content>(), any<RunConfig>()) } returns
              Flowable.just(mockEvent)

            val handler = A2aHandler(mockRunner)

            val response = handler.handleA2aPost(request as Map<String, Any>)

            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
            val expectParts = expect["parts"] as List<*>

            val result = response["result"] as Map<String, Any>
            val parts = result["parts"] as List<Map<String, Any>>

            assertEquals(expectParts.size, parts.size)
            for (i in expectParts.indices) {
              val expPart = expectParts[i] as Map<*, *>
              val part = parts[i]
              assertEquals(expPart["kind"] as String, part["kind"])

              if (expPart.containsKey("text")) {
                assertEquals(expPart["text"] as String, part["text"])
              }
              if (expPart.containsKey("mimeType")) {
                assertEquals(
                  expPart["mimeType"] as String,
                  (part["metadata"] as Map<*, *>)["mimeType"],
                )
              }
              if (expPart.containsKey("data")) {
                val expData = expPart["data"] as Map<*, *>
                assertEquals(expData, part["data"] as Map<*, *>)
              }
            }
          }
          else -> assert(false, { "Unknown action: $action" })
        }
      }
    }
  }
}
