/*
 * Copyright 2024 Google LLC
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

package com.google.a2ui.schema

import com.google.a2ui.basic_catalog.BasicCatalog
import com.google.a2ui.exceptions.A2uiRecursionException
import com.google.a2ui.exceptions.A2uiValidationException
import kotlin.io.path.createTempFile
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

class ValidatorTest {

  @Test
  fun reportsPreciseJsonPathsForValidationFailures() {
    val s2cSchema =
      Json.parseToJsonElement(
          """
      {
        "${"\$schema"}": "https://json-schema.org/draft/2020-12/schema",
        "${"\$id"}": "https://a2ui.org/specification/v0_9/server_to_client.json",
        "oneOf": [
          {"${"\$ref"}": "#/${"\$defs"}/CreateSurfaceMessage"},
          {"${"\$ref"}": "#/${"\$defs"}/UpdateComponentsMessage"},
          {"${"\$ref"}": "#/${"\$defs"}/UpdateDataModelMessage"},
          {"${"\$ref"}": "#/${"\$defs"}/DeleteSurfaceMessage"}
        ],
        "${"\$defs"}": {
          "CreateSurfaceMessage": {
            "type": "object",
            "properties": {
              "version": {"const": "v0.9"},
              "createSurface": {
                "type": "object",
                "properties": {
                  "surfaceId": {"type": "string"},
                  "catalogId": {"type": "string"}
                },
                "required": ["surfaceId", "catalogId"],
                "additionalProperties": false
              }
            },
            "required": ["version", "createSurface"],
            "additionalProperties": false
          },
          "UpdateComponentsMessage": {
            "type": "object",
            "properties": {
              "version": {"const": "v0.9"},
              "updateComponents": {
                "type": "object",
                "properties": {
                  "surfaceId": {"type": "string"},
                  "components": {
                    "type": "array",
                    "items": {"type": "object"}
                  }
                },
                "required": ["surfaceId", "components"],
                "additionalProperties": false
              }
            },
            "required": ["version", "updateComponents"],
            "additionalProperties": false
          },
          "UpdateDataModelMessage": {
            "type": "object",
            "properties": {
              "version": {"const": "v0.9"},
              "updateDataModel": {
                "type": "object",
                "properties": {
                  "surfaceId": {"type": "string"},
                  "value": {"type": "object"}
                },
                "required": ["surfaceId"],
                "additionalProperties": false
              }
            },
            "required": ["version", "updateDataModel"],
            "additionalProperties": false
          },
          "DeleteSurfaceMessage": {
            "type": "object",
            "properties": {
              "version": {"const": "v0.9"},
              "deleteSurface": {
                "type": "object",
                "properties": {
                  "surfaceId": {"type": "string"}
                },
                "required": ["surfaceId"],
                "additionalProperties": false
              }
            },
            "required": ["version", "deleteSurface"],
            "additionalProperties": false
          }
        }
      }
    """
        )
        .jsonObject

    val catalogSchema =
      Json.parseToJsonElement(
          """
      {
        "${"\$schema"}": "https://json-schema.org/draft/2020-12/schema",
        "${"\$id"}": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        "catalogId": "basic",
        "components": {
          "Text": {
            "type": "object",
            "properties": {
              "component": {"const": "Text"},
              "id": {"type": "string"},
              "text": {"type": "string"}
            },
            "required": ["component", "id", "text"],
            "additionalProperties": false
          },
          "Image": {
            "type": "object",
            "properties": {
              "component": {"const": "Image"},
              "id": {"type": "string"},
              "url": {"type": "string"}
            },
            "required": ["component", "id", "url"],
            "additionalProperties": false
          }
        }
      }
    """
        )
        .jsonObject

    val tempCatalogFile = createTempFile("catalog", ".json").toFile()
    tempCatalogFile.writeText(catalogSchema.toString())
    tempCatalogFile.deleteOnExit()

    val catalog =
      A2uiCatalog(
        version = A2uiVersion.VERSION_0_9,
        name = "standard",
        serverToClientSchema = s2cSchema,
        commonTypesSchema = JsonObject(emptyMap()),
        catalogSchema = catalogSchema,
      )

    val schemaMappings = mapOf("catalog.json" to tempCatalogFile.toURI().toString())
    val validator = A2uiValidator(catalog, schemaMappings)

    val payload =
      Json.parseToJsonElement(
        """
      [
        {
          "version": "v0.9",
          "createSurface": {
            "surfaceId": "s1"
          }
        },
        {
          "version": "v0.9",
          "updateComponents": {
            "surfaceId": "s1",
            "components": [
              {
                "id": "t1",
                "component": "Text",
                "usageHint": "h3"
              },
              {
                "component": "Image",
                "url": 123
              }
            ]
          }
        }
      ]
    """
      ) as JsonArray

    val exception =
      assertFailsWith<IllegalArgumentException> {
        validator.validate(payload, strictIntegrity = false)
      }

    val msg = exception.message!!
    assertTrue(
      msg.contains("messages.0.createSurface"),
      "Expected missing catalogId error path, got: " + msg,
    )
    assertTrue(
      msg.contains("messages.1.updateComponents.components[id='t1']"),
      "Expected id-based component error path, got: " + msg,
    )
    assertTrue(
      msg.contains("messages.1.updateComponents.components.1"),
      "Expected index-based component error path, got: " + msg,
    )
  }

  private val simpleCatalog =
    A2uiCatalog(
      version = A2uiVersion.VERSION_0_8,
      name = "test",
      serverToClientSchema = JsonObject(mapOf("type" to JsonPrimitive("object"))),
      commonTypesSchema = JsonObject(emptyMap()),
      catalogSchema = JsonObject(mapOf(A2uiConstants.CATALOG_ID_KEY to JsonPrimitive("test_id"))),
    )

  private val pathValidator = A2uiValidator(simpleCatalog)

  @Test
  fun validatesAbsolutePathsSuccessfully() {
    val payload =
      JsonObject(
        mapOf(
          "version" to JsonPrimitive("v0.9"),
          "updateDataModel" to
            JsonObject(
              mapOf(
                "surfaceId" to JsonPrimitive("s1"),
                "value" to
                  JsonObject(
                    mapOf(
                      "path" to JsonPrimitive("/absolute/path/to/property"),
                      "data" to JsonPrimitive("val"),
                    )
                  ),
              )
            ),
        )
      )
    pathValidator.validate(payload, strictIntegrity = false)
  }

  @Test
  fun validatesRelativePathsSuccessfully() {
    val payload =
      JsonObject(
        mapOf(
          "version" to JsonPrimitive("v0.9"),
          "updateDataModel" to
            JsonObject(
              mapOf(
                "surfaceId" to JsonPrimitive("s1"),
                "value" to
                  JsonObject(
                    mapOf(
                      "path" to JsonPrimitive("relative/path/to/property"),
                      "data" to JsonPrimitive("val"),
                    )
                  ),
              )
            ),
        )
      )
    pathValidator.validate(payload, strictIntegrity = false)
  }

  @Test
  fun rejectsInvalidPathsWithUpdatedErrorMessage() {
    val payload =
      JsonObject(
        mapOf(
          "version" to JsonPrimitive("v0.9"),
          "updateDataModel" to
            JsonObject(
              mapOf(
                "surfaceId" to JsonPrimitive("s1"),
                "value" to
                  JsonObject(
                    mapOf(
                      "path" to JsonPrimitive("/invalid/escape/~2"),
                      "data" to JsonPrimitive("val"),
                    )
                  ),
              )
            ),
        )
      )

    val exception =
      assertFailsWith<IllegalArgumentException> {
        pathValidator.validate(payload, strictIntegrity = false)
      }

    assertEquals("Invalid path syntax: '/invalid/escape/~2'", exception.message)
  }

  /** Returns [depth] function calls, each nested in the args of the one before. */
  private fun nestCalls(depth: Int): JsonObject {
    var value = JsonObject(mapOf("call" to JsonPrimitive("leaf"), "args" to JsonObject(emptyMap())))
    repeat(depth - 1) {
      value =
        JsonObject(
          mapOf("call" to JsonPrimitive("wrap"), "args" to JsonObject(mapOf("value" to value)))
        )
    }
    return value
  }

  /** Returns an `updateComponents` message whose root `Text` takes [text]. */
  private fun textMessage(text: JsonObject): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive("v0.9"),
        "updateComponents" to
          JsonObject(
            mapOf(
              "surfaceId" to JsonPrimitive("s1"),
              "components" to
                JsonArray(
                  listOf(
                    JsonObject(
                      mapOf(
                        "id" to JsonPrimitive("root"),
                        "component" to JsonPrimitive("Text"),
                        "text" to text,
                      )
                    )
                  )
                ),
            )
          ),
      )
    )

  @Test
  fun acceptsFunctionCallsNestedDeeperThanFive() {
    pathValidator.validate(textMessage(nestCalls(6)), strictIntegrity = false)
    // The outermost call is at depth 4 from the message and each call adds two levels, the call
    // and its args, so the args of the 23rd call are at depth 49.
    pathValidator.validate(textMessage(nestCalls(23)), strictIntegrity = false)
  }

  @Test
  fun rejectsFunctionCallsNestedPastTheGlobalDepthLimit() {
    // The args of the 24th call are at depth 51.
    val exception =
      assertFailsWith<A2uiRecursionException> {
        pathValidator.validate(textMessage(nestCalls(24)), strictIntegrity = false)
      }

    assertEquals("Global recursion limit exceeded: Depth > 50", exception.message)
  }

  private val v09BasicValidator: A2uiValidator by lazy {
    A2uiSchemaManager(
        version = A2uiVersion.VERSION_0_9,
        catalogs = listOf(BasicCatalog.getConfig(A2uiVersion.VERSION_0_9)),
      )
      .getSelectedCatalog()
      .validator
  }

  /**
   * Returns [depth] nested `formatString` calls, with the innermost call taking [innermost] as its
   * `value` argument.
   */
  private fun nestedFormatString(
    depth: Int,
    innermost: JsonElement = JsonPrimitive("leaf"),
  ): JsonObject {
    var value: JsonElement = innermost
    repeat(depth) {
      value =
        JsonObject(
          mapOf(
            "call" to JsonPrimitive("formatString"),
            "args" to JsonObject(mapOf("value" to value)),
          )
        )
    }
    return value as JsonObject
  }

  private fun v09SurfaceMessages(text: JsonElement): JsonArray =
    JsonArray(
      listOf(
        JsonObject(
          mapOf(
            "version" to JsonPrimitive("v0.9"),
            "createSurface" to
              JsonObject(
                mapOf(
                  "surfaceId" to JsonPrimitive("s1"),
                  "catalogId" to
                    JsonPrimitive(BasicCatalog.BASIC_CATALOG_IDS.getValue(A2uiVersion.VERSION_0_9)),
                )
              ),
          )
        ),
        JsonObject(
          mapOf(
            "version" to JsonPrimitive("v0.9"),
            "updateComponents" to
              JsonObject(
                mapOf(
                  "surfaceId" to JsonPrimitive("s1"),
                  "components" to
                    JsonArray(
                      listOf(
                        JsonObject(
                          mapOf(
                            "id" to JsonPrimitive("root"),
                            "component" to JsonPrimitive("Text"),
                            "text" to text,
                          )
                        )
                      )
                    ),
                )
              ),
          )
        ),
      )
    )

  @Test
  fun validatesDeeplyNestedV09BasicCatalogFunctionCallsWithStrictIntegrity() {
    v09BasicValidator.validate(v09SurfaceMessages(nestedFormatString(10)), strictIntegrity = true)
    // 23 nested calls reach depth 50 from the message and must validate linearly rather than
    // branching exponentially across `FunctionCall` and `anyFunction`.
    v09BasicValidator.validate(v09SurfaceMessages(nestedFormatString(23)), strictIntegrity = true)

    val recursionError =
      assertFailsWith<A2uiRecursionException> {
        v09BasicValidator.validate(
          v09SurfaceMessages(nestedFormatString(24)),
          strictIntegrity = true,
        )
      }
    assertEquals("Global recursion limit exceeded: Depth > 50", recursionError.message)
  }

  @Test
  fun rejectsInvalidNestedV09BasicCatalogFunctionCallsWithStrictIntegrity() {
    val invalidInnermostCalls =
      listOf(
        // Unknown function name nested ten deep
        JsonObject(
          mapOf(
            "call" to JsonPrimitive("unknownFunc"),
            "args" to JsonObject(mapOf("value" to JsonPrimitive("x"))),
          )
        ),
        // Wrong argument type nested ten deep
        JsonObject(
          mapOf(
            "call" to JsonPrimitive("formatString"),
            "args" to JsonObject(mapOf("value" to JsonPrimitive(42))),
          )
        ),
        // Undeclared extra argument nested ten deep
        JsonObject(
          mapOf(
            "call" to JsonPrimitive("formatString"),
            "args" to JsonObject(mapOf("value" to JsonPrimitive("x"), "extra" to JsonPrimitive(1))),
          )
        ),
        // Missing required `args` nested ten deep
        JsonObject(mapOf("call" to JsonPrimitive("formatString"))),
        // Undeclared top-level field on call nested ten deep
        JsonObject(
          mapOf(
            "call" to JsonPrimitive("formatString"),
            "args" to JsonObject(mapOf("value" to JsonPrimitive("x"))),
            "bogus" to JsonPrimitive(1),
          )
        ),
        // Mismatched `returnType` for `formatString` nested ten deep
        JsonObject(
          mapOf(
            "call" to JsonPrimitive("formatString"),
            "args" to JsonObject(mapOf("value" to JsonPrimitive("x"))),
            "returnType" to JsonPrimitive("number"),
          )
        ),
        // Boolean-returning call in a `DynamicString` slot nested ten deep
        JsonObject(
          mapOf(
            "call" to JsonPrimitive("required"),
            "args" to JsonObject(mapOf("value" to JsonPrimitive("x"))),
            "returnType" to JsonPrimitive("boolean"),
          )
        ),
        // Null argument value nested ten deep
        JsonObject(
          mapOf(
            "call" to JsonPrimitive("formatString"),
            "args" to JsonObject(mapOf("value" to JsonNull)),
          )
        ),
      )

    for (invalidInnermost in invalidInnermostCalls) {
      assertFailsWith<A2uiValidationException> {
        v09BasicValidator.validate(
          v09SurfaceMessages(nestedFormatString(9, innermost = invalidInnermost)),
          strictIntegrity = true,
        )
      }
    }
  }
}
