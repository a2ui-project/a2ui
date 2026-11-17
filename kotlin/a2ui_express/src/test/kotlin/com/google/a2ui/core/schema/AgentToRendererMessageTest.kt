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

package com.google.a2ui.core.schema

import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.common.jsonValuesEqual
import com.google.a2ui.core.exceptions.A2uiCatalogError
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

class AgentToRendererMessageTest {

  @Test
  fun agentFunctionResponseMessageMatchesCommonTypesSchema() {
    val okJson =
      Json.parseToJsonElement(
          """{"version":"1.0","agentFunctionResponse":{"functionCallId":"c1","value":{"ok":true}}}"""
        )
        .jsonObject
    val okMsg = AgentToRendererMessage.fromJsonObject(okJson) as AgentFunctionResponseMessage
    assertEquals("c1", okMsg.response.functionCallId)
    assertTrue(jsonValuesEqual(okJson, okMsg.toJsonObject()))

    val errMsg =
      AgentFunctionResponseMessage(
        response = FunctionResponse.failure("c2", "TIMEOUT", "Timed out")
      )
    val roundTripped =
      AgentToRendererMessage.fromJsonObject(errMsg.toJsonObject()) as AgentFunctionResponseMessage
    assertEquals(errMsg, roundTripped)
  }

  @Test
  fun catalogFromJsonFailsClosedWithoutProtocolVersionAndAcceptsExplicitExpectedVersion() {
    val schema =
      Json.parseToJsonElement(
          """
          {
            "catalogId": "https://example.com/slider-v1",
            "components": {
              "Slider": {
                "type": "object",
                "description": "Opacity slider (0.8 to 0.95)",
                "properties": {
                  "component": {"const": "Slider"},
                  "opacity": {"type": "number", "minimum": 0.8, "maximum": 0.95}
                }
              }
            }
          }
          """
            .trimIndent()
        )
        .jsonObject
    assertFailsWith<A2uiCatalogError> { Catalog.fromJson(schema) }
    val catalog = Catalog.fromJson(schema, expectedVersion = ProtocolVersion.V1_0)
    assertEquals(ProtocolVersion.V1_0, catalog.protocolVersion)
  }
}
