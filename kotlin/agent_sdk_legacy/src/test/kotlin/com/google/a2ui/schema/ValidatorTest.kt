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
import kotlinx.serialization.json.jsonArray
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

  @Test
  fun ignoresLiteralCallKeysInThemeAndUntypedObjectPositions() {
    for (literalCall in
      listOf(
        JsonObject(mapOf("call" to JsonPrimitive("unknownLiteral"))),
        // Matches a real basic-catalog function (`required`) while omitting `args`.
        JsonObject(mapOf("call" to JsonPrimitive("required"))),
      )) {
      // 1. `createSurface.theme` allows `additionalProperties: true` and has no `FunctionCall`
      // refs,
      //    and `required.args.value` is untyped (`{"description": "The value to check."}`).
      val basicPayload =
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
                        JsonPrimitive(
                          BasicCatalog.BASIC_CATALOG_IDS.getValue(A2uiVersion.VERSION_0_9)
                        ),
                      "theme" to
                        JsonObject(
                          mapOf(
                            "primaryColor" to JsonPrimitive("#00BFFF"),
                            "customMeta" to literalCall,
                          )
                        ),
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
                                "component" to JsonPrimitive("TextField"),
                                "label" to JsonPrimitive("Name"),
                                "value" to JsonObject(mapOf("path" to JsonPrimitive("/name"))),
                                "checks" to
                                  JsonArray(
                                    listOf(
                                      JsonObject(
                                        mapOf(
                                          "condition" to
                                            JsonObject(
                                              mapOf(
                                                "call" to JsonPrimitive("required"),
                                                "args" to JsonObject(mapOf("value" to literalCall)),
                                              )
                                            ),
                                          "message" to JsonPrimitive("Required"),
                                        )
                                      )
                                    )
                                  ),
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
      v09BasicValidator.validate(basicPayload, strictIntegrity = true)

      // 2. Custom component literal `object` property and custom function literal `object` arg.
      val s2c = SchemaResourceLoader.loadFromBundledResource("0.9", "server_to_client.json")!!
      val commonTypes = SchemaResourceLoader.loadFromBundledResource("0.9", "common_types.json")!!
      val customCatalogSchema =
        Json.parseToJsonElement(
            """
            {
              "${"\$schema"}": "https://json-schema.org/draft/2020-12/schema",
              "catalogId": "custom-literal-test",
              "components": {
                "Panel": {
                  "type": "object",
                  "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "Panel"},
                    "config": {"type": "object"},
                    "title": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
                  },
                  "required": ["id", "component", "title"],
                  "additionalProperties": false
                }
              },
              "functions": {
                "configure": {
                  "type": "object",
                  "properties": {
                    "call": {"const": "configure"},
                    "args": {
                      "type": "object",
                      "properties": {
                        "options": {"type": "object"},
                        "label": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
                      },
                      "required": ["options", "label"],
                      "additionalProperties": false
                    },
                    "returnType": {"const": "string"}
                  },
                  "required": ["call", "args"],
                  "unevaluatedProperties": false
                },
                "required": {
                  "type": "object",
                  "properties": {
                    "call": {"const": "required"},
                    "args": {
                      "type": "object",
                      "properties": {"value": {}},
                      "required": ["value"],
                      "additionalProperties": false
                    },
                    "returnType": {"const": "boolean"}
                  },
                  "required": ["call", "args"],
                  "unevaluatedProperties": false
                }
              }
            }
            """
          )
          .jsonObject

      val customValidator =
        A2uiValidator(
          A2uiCatalog(
            version = A2uiVersion.VERSION_0_9,
            name = "custom",
            serverToClientSchema = s2c,
            commonTypesSchema = commonTypes,
            catalogSchema = customCatalogSchema,
          )
        )

      val validCustomPayload =
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
                            "component" to JsonPrimitive("Panel"),
                            "config" to literalCall,
                            "title" to
                              JsonObject(
                                mapOf(
                                  "call" to JsonPrimitive("configure"),
                                  "args" to
                                    JsonObject(
                                      mapOf(
                                        "options" to literalCall,
                                        "label" to JsonPrimitive("ok"),
                                      )
                                    ),
                                )
                              ),
                          )
                        )
                      )
                    ),
                )
              ),
          )
        )
      customValidator.validate(validCustomPayload, strictIntegrity = true)

      // Real `DynamicString` slots on the same component/function still reject invalid/unknown
      // calls.
      val invalidNestedSlotPayload =
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
                            "component" to JsonPrimitive("Panel"),
                            "title" to
                              JsonObject(
                                mapOf(
                                  "call" to JsonPrimitive("configure"),
                                  "args" to
                                    JsonObject(
                                      mapOf("options" to literalCall, "label" to literalCall)
                                    ),
                                )
                              ),
                          )
                        )
                      )
                    ),
                )
              ),
          )
        )
      assertFailsWith<A2uiValidationException> {
        customValidator.validate(invalidNestedSlotPayload, strictIntegrity = true)
      }
    }
  }

  @Test
  fun supportsCustomCatalogInlineAndSingleObjectAnyFunctionDefinitions() {
    val s2c = SchemaResourceLoader.loadFromBundledResource("0.9", "server_to_client.json")!!
    val commonTypes = SchemaResourceLoader.loadFromBundledResource("0.9", "common_types.json")!!

    for (anyFunctionJson in
      listOf(
        // Inline `oneOf` branch inside `$defs.anyFunction`
        """
        {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "call": {"const": "wrapText"},
                "args": {
                  "type": "object",
                  "properties": {
                    "value": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
                  },
                  "required": ["value"],
                  "additionalProperties": false
                },
                "returnType": {"const": "string"}
              },
              "required": ["call", "args"],
              "unevaluatedProperties": false
            }
          ]
        }
        """,
        // Inline `anyOf` branch inside `$defs.anyFunction`
        """
        {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "call": {"const": "wrapText"},
                "args": {
                  "type": "object",
                  "properties": {
                    "value": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
                  },
                  "required": ["value"],
                  "additionalProperties": false
                },
                "returnType": {"const": "string"}
              },
              "required": ["call", "args"],
              "unevaluatedProperties": false
            }
          ]
        }
        """,
        // Single-object `$defs.anyFunction` without `oneOf`
        """
        {
          "type": "object",
          "properties": {
            "call": {"const": "wrapText"},
            "args": {
              "type": "object",
              "properties": {
                "value": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
              },
              "required": ["value"],
              "additionalProperties": false
            },
            "returnType": {"const": "string"}
          },
          "required": ["call", "args"],
          "unevaluatedProperties": false
        }
        """,
      )) {
      val catalogSchema =
        Json.parseToJsonElement(
            """
            {
              "${"\$schema"}": "https://json-schema.org/draft/2020-12/schema",
              "catalogId": "inline-any-fn",
              "components": {
                "Text": {
                  "type": "object",
                  "properties": {
                    "id": {"type": "string"},
                    "component": {"const": "Text"},
                    "text": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
                  },
                  "required": ["id", "component", "text"],
                  "additionalProperties": false
                }
              },
              "${"\$defs"}": {
                "anyFunction": $anyFunctionJson
              }
            }
            """
          )
          .jsonObject

      val validator =
        A2uiValidator(
          A2uiCatalog(
            version = A2uiVersion.VERSION_0_9,
            name = "inline",
            serverToClientSchema = s2c,
            commonTypesSchema = commonTypes,
            catalogSchema = catalogSchema,
          )
        )

      fun nestWrapText(depth: Int, leaf: JsonElement = JsonPrimitive("ok")): JsonObject {
        var cur: JsonElement = leaf
        repeat(depth) {
          cur =
            JsonObject(
              mapOf(
                "call" to JsonPrimitive("wrapText"),
                "args" to JsonObject(mapOf("value" to cur)),
              )
            )
        }
        return cur as JsonObject
      }

      validator.validate(textMessage(nestWrapText(15)), strictIntegrity = true)

      assertFailsWith<A2uiValidationException> {
        validator.validate(
          textMessage(nestWrapText(10, JsonPrimitive(999))),
          strictIntegrity = true,
        )
      }
      assertFailsWith<A2uiValidationException> {
        validator.validate(
          textMessage(
            JsonObject(
              mapOf(
                "call" to JsonPrimitive("otherFn"),
                "args" to JsonObject(mapOf("value" to JsonPrimitive("ok"))),
              )
            )
          ),
          strictIntegrity = true,
        )
      }
    }
  }

  private val dynamicString =
    "https://a2ui.org/specification/v0_9/common_types.json#/@defs/DynamicString"

  /** Parses [json], written with `@` for `$` so that schema keywords read as they do in JSON. */
  private fun schemaJson(json: String): JsonObject =
    Json.parseToJsonElement(json.replace('@', '$')).jsonObject

  private fun bundledSchema(name: String): JsonObject =
    SchemaResourceLoader.loadFromBundledResource("0.9", name)!!

  /** A function schema, as JSON, for [name] taking one `DynamicString` as `value`. */
  private fun oneArgFunction(name: String, returnType: String): String =
    """
    {
      "type": "object",
      "properties": {
        "call": {"const": "$name"},
        "args": {
          "type": "object",
          "properties": {"value": {"@ref": "$dynamicString"}},
          "required": ["value"],
          "additionalProperties": false
        },
        "returnType": {"const": "$returnType"}
      },
      "required": ["call", "args"],
      "unevaluatedProperties": false
    }
    """

  /**
   * Returns a v0.9 catalog that declares `wrapText`, returning a string, and `isSet`, returning a
   * boolean, along with [components] and the `$defs` entries in [defs].
   */
  private fun wrapTextCatalog(
    defs: String,
    components: String = "{}",
    anyFunction: String =
      """{"oneOf": [{"@ref": "#/functions/wrapText"}, {"@ref": "#/functions/isSet"}]}""",
  ): JsonObject =
    schemaJson(
      """
      {
        "@schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "wrap-text-catalog",
        "components": $components,
        "functions": {
          "wrapText": ${oneArgFunction("wrapText", "string")},
          "isSet": ${oneArgFunction("isSet", "boolean")}
        },
        "@defs": {
          "anyFunction": $anyFunction,
          $defs
        }
      }
      """
    )

  private fun validatorFor(
    catalogSchema: JsonObject,
    serverToClientSchema: JsonObject = bundledSchema("server_to_client.json"),
    schemaMappings: Map<String, String> = emptyMap(),
  ): A2uiValidator =
    A2uiValidator(
      A2uiCatalog(
        version = A2uiVersion.VERSION_0_9,
        name = "custom",
        serverToClientSchema = serverToClientSchema,
        commonTypesSchema = bundledSchema("common_types.json"),
        catalogSchema = catalogSchema,
      ),
      schemaMappings,
    )

  /** Returns [depth] nested calls of [name] around [innermost]. */
  private fun nestedCalls(
    name: String,
    depth: Int,
    innermost: JsonElement = JsonPrimitive("ok"),
  ): JsonElement {
    var value = innermost
    repeat(depth) {
      value =
        JsonObject(
          mapOf("call" to JsonPrimitive(name), "args" to JsonObject(mapOf("value" to value)))
        )
    }
    return value
  }

  private fun nestedWrapText(
    depth: Int,
    innermost: JsonElement = JsonPrimitive("ok"),
  ): JsonElement = nestedCalls("wrapText", depth, innermost)

  private fun createSurfaceMessage(theme: JsonElement): JsonObject =
    JsonObject(
      mapOf(
        "version" to JsonPrimitive("v0.9"),
        "createSurface" to
          JsonObject(
            mapOf(
              "surfaceId" to JsonPrimitive("s1"),
              "catalogId" to JsonPrimitive("wrap-text-catalog"),
              "theme" to theme,
            )
          ),
      )
    )

  private fun componentMessage(
    component: String,
    properties: Map<String, JsonElement>,
  ): JsonObject =
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
                        "component" to JsonPrimitive(component),
                      ) + properties
                    )
                  )
                ),
            )
          ),
      )
    )

  /** Fails, rather than hangs, when [block] does not return: a walk that never ends would not. */
  private fun assertCompletes(block: () -> Unit) {
    var failure: Throwable? = null
    val worker = Thread {
      try {
        block()
      } catch (t: Throwable) {
        failure = t
      }
    }
    worker.isDaemon = true
    worker.start()
    worker.join(30_000)
    assertTrue(!worker.isAlive, "Validation did not finish within 30 seconds")
    failure?.let { throw it }
  }

  @Test
  fun validatesNestedCallsInThemeHoweverItsSchemaReachesThem() {
    val themeColor = "\"ThemeColor\": {\"@ref\": \"$dynamicString\"}"
    val themeDefs =
      listOf(
        // A `Dynamic*` reference directly on a theme property.
        """
        "theme": {
          "type": "object",
          "properties": {"accent": {"@ref": "$dynamicString"}},
          "additionalProperties": false
        }
        """,
        // A local `$ref` that has an annotation beside it.
        """
        $themeColor,
        "theme": {
          "type": "object",
          "properties": {"accent": {"@ref": "#/@defs/ThemeColor", "description": "Accent"}},
          "additionalProperties": false
        }
        """,
        // A `$ref` that names the catalog document.
        """
        $themeColor,
        "theme": {
          "type": "object",
          "properties": {"accent": {"@ref": "catalog.json#/@defs/ThemeColor"}},
          "additionalProperties": false
        }
        """,
      )

    for (defs in themeDefs) {
      val validator = validatorFor(wrapTextCatalog(defs))
      fun themed(accent: JsonElement) = createSurfaceMessage(JsonObject(mapOf("accent" to accent)))

      validator.validate(themed(nestedWrapText(6)), strictIntegrity = false)
      assertFailsWith<A2uiValidationException>(defs) {
        validator.validate(themed(nestedWrapText(6, JsonPrimitive(9))), strictIntegrity = false)
      }
    }
  }

  @Test
  fun endsOnThemeSchemasThatReferBackToThemselves() {
    // A recursive theme schema that holds no function call slot: the search for one has to end.
    val recursiveTheme =
      validatorFor(
        wrapTextCatalog(
          """
          "ThemeNode": {
            "type": "object",
            "properties": {
              "color": {"type": "string"},
              "child": {"@ref": "#/@defs/ThemeNode", "description": "A nested theme"}
            },
            "additionalProperties": false
          },
          "theme": {"@ref": "#/@defs/ThemeNode"}
          """
        )
      )
    val nestedTheme =
      Json.parseToJsonElement("""{"color": "#112233", "child": {"color": "#445566"}}""")
    assertCompletes {
      recursiveTheme.validate(createSurfaceMessage(nestedTheme), strictIntegrity = false)
    }

    // `allOf` branches that lead straight back to the schema that holds them. `networknt` cannot
    // evaluate such a schema, so these messages leave the theme to the walk alone.
    val messagesWithUncheckedTheme =
      schemaJson(
        """
        {
          "@defs": {
            "CreateSurfaceMessage": {
              "type": "object",
              "properties": {"version": {"const": "v0.9"}, "createSurface": {"type": "object"}},
              "required": ["version", "createSurface"]
            }
          }
        }
        """
      )
    val itself = "{\"@ref\": \"#/@defs/Looping\"}"
    val loopingTheme =
      validatorFor(
        wrapTextCatalog(
          """
          "Looping": {
            "allOf": [$itself, $itself, $itself, $itself],
            "properties": {"label": {"@ref": "$dynamicString"}}
          },
          "theme": {"@ref": "#/@defs/Looping"}
          """
        ),
        serverToClientSchema = messagesWithUncheckedTheme,
      )
    fun labelled(label: JsonElement) = createSurfaceMessage(JsonObject(mapOf("label" to label)))

    assertCompletes { loopingTheme.validate(labelled(nestedWrapText(4)), strictIntegrity = false) }
    assertCompletes {
      assertFailsWith<A2uiValidationException> {
        loopingTheme.validate(
          labelled(nestedWrapText(4, JsonPrimitive(9))),
          strictIntegrity = false,
        )
      }
    }
  }

  @Test
  fun stubsFunctionUnionBranchesThatHoldKeywordsBesideTheirRef() {
    val validator =
      validatorFor(
        wrapTextCatalog(
          defs = "\"theme\": {\"type\": \"object\"}",
          components =
            """
            {
              "Label": {
                "type": "object",
                "properties": {
                  "id": {"type": "string"},
                  "component": {"const": "Label"},
                  "text": {"@ref": "$dynamicString"},
                  "shown": {"@ref": "${dynamicString.replace("DynamicString", "DynamicBoolean")}"}
                },
                "required": ["id", "component"],
                "additionalProperties": false
              }
            }
            """,
          anyFunction =
            """
            {
              "oneOf": [
                {"@ref": "#/functions/wrapText", "description": "Wraps text."},
                {"@ref": "#/functions/isSet", "maxProperties": 2}
              ]
            }
            """,
        )
      )
    fun label(property: String, value: JsonElement) =
      componentMessage("Label", mapOf(property to value))

    // Either branch, left pointing at its function as written, takes exponential time here.
    for (name in listOf("wrapText", "isSet")) {
      assertCompletes {
        validator.validate(label("text", nestedCalls(name, 23)), strictIntegrity = true)
      }
      assertFailsWith<A2uiValidationException>(name) {
        validator.validate(
          label("text", nestedCalls(name, 6, JsonPrimitive(9))),
          strictIntegrity = true,
        )
      }
    }

    // `maxProperties` beside the `$ref` to `isSet` still applies.
    val isSet = nestedCalls("isSet", 1).jsonObject
    validator.validate(label("shown", isSet), strictIntegrity = true)
    assertFailsWith<A2uiValidationException> {
      validator.validate(
        label("shown", JsonObject(isSet + ("returnType" to JsonPrimitive("boolean")))),
        strictIntegrity = true,
      )
    }
  }

  @Test
  fun validatesNestedCallsInsideCommonTypeUnions() {
    // `Action` is a `oneOf` in the common types document, so its branches are matched there.
    fun buttonMessages(action: JsonElement): JsonArray {
      val surface = v09SurfaceMessages(JsonPrimitive("Send"))
      val update = surface[1].jsonObject.getValue("updateComponents").jsonObject
      val button =
        JsonObject(
          mapOf(
            "id" to JsonPrimitive("root"),
            "component" to JsonPrimitive("Button"),
            "child" to JsonPrimitive("label"),
            "action" to action,
          )
        )
      val label =
        JsonObject(
          update.getValue("components").jsonArray[0].jsonObject + ("id" to JsonPrimitive("label"))
        )
      val components = JsonArray(listOf(button, label))
      return JsonArray(
        listOf(
          surface[0],
          JsonObject(
            surface[1].jsonObject +
              ("updateComponents" to JsonObject(update + ("components" to components)))
          ),
        )
      )
    }
    fun event(note: JsonElement) =
      JsonObject(
        mapOf(
          "event" to
            JsonObject(
              mapOf("name" to JsonPrimitive("send"), "context" to JsonObject(mapOf("note" to note)))
            )
        )
      )
    fun functionCall(call: JsonElement) = JsonObject(mapOf("functionCall" to call))
    val valid = nestedFormatString(3)
    val invalid = nestedFormatString(3, innermost = JsonPrimitive(42))

    for (action in listOf(event(valid), functionCall(valid))) {
      v09BasicValidator.validate(buttonMessages(action), strictIntegrity = true)
    }
    for (action in listOf(event(invalid), functionCall(invalid))) {
      assertFailsWith<A2uiValidationException>(action.toString()) {
        v09BasicValidator.validate(buttonMessages(action), strictIntegrity = true)
      }
    }
  }

  @Test
  fun treatsMappedSchemaLocationsAsTheDocumentsTheyStandFor() {
    val specification = "https://a2ui.org/specification/v0_9"
    val commonTypesFile = createTempFile("a2ui-types", ".json").toFile()
    commonTypesFile.writeText(bundledSchema("common_types.json").toString())
    commonTypesFile.deleteOnExit()
    val mappedCommonTypes = commonTypesFile.toURI().toString()
    // This file holds a catalog that accepts no function, so a call validates only when the
    // validator answers for the mapped location from the catalog it was given.
    val catalogFile = createTempFile("a2ui-functions", ".json").toFile()
    catalogFile.writeText(schemaJson("""{"@defs": {"anyFunction": {"not": {}}}}""").toString())
    catalogFile.deleteOnExit()

    val validator =
      validatorFor(
        wrapTextCatalog(
          defs = "\"theme\": {\"type\": \"object\"}",
          components =
            """
            {
              "Field": {
                "type": "object",
                "properties": {
                  "id": {"type": "string"},
                  "component": {"const": "Field"},
                  "label": {"@ref": "$dynamicString"},
                  "checks": {
                    "type": "array",
                    "items": {"@ref": "$mappedCommonTypes#/@defs/CheckRule"}
                  }
                },
                "required": ["id", "component"],
                "additionalProperties": false
              }
            }
            """,
        ),
        schemaMappings =
          mapOf(
            "$specification/common_types.json" to mappedCommonTypes,
            "$specification/catalog.json" to catalogFile.toURI().toString(),
          ),
      )
    fun check(value: JsonElement) =
      JsonArray(
        listOf(
          JsonObject(
            mapOf(
              "condition" to
                JsonObject(
                  mapOf(
                    "call" to JsonPrimitive("isSet"),
                    "args" to JsonObject(mapOf("value" to value)),
                  )
                ),
              "message" to JsonPrimitive("Required"),
            )
          )
        )
      )

    // 23 nested calls take exponential time against the schemas as written.
    assertCompletes {
      validator.validate(
        componentMessage("Field", mapOf("label" to nestedWrapText(23))),
        strictIntegrity = true,
      )
    }
    validator.validate(
      componentMessage("Field", mapOf("checks" to check(nestedWrapText(4)))),
      strictIntegrity = true,
    )
    // The check rule is reached through the mapped location of the common types.
    assertFailsWith<A2uiValidationException> {
      validator.validate(
        componentMessage("Field", mapOf("checks" to check(nestedWrapText(4, JsonPrimitive(9))))),
        strictIntegrity = true,
      )
    }
  }

  @Test
  fun validatesUnionBranchMatchingDraft202012RefSiblingsAndCustomCatalogId() {
    val s2c = SchemaResourceLoader.loadFromBundledResource("0.9", "server_to_client.json")!!
    val commonTypes = SchemaResourceLoader.loadFromBundledResource("0.9", "common_types.json")!!

    val customCatalogId = "https://example.com/schemas/custom-v09-bundle"
    val catalogSchema =
      Json.parseToJsonElement(
          """
          {
            "${"\$schema"}": "https://json-schema.org/draft/2020-12/schema",
            "${"\$id"}": "$customCatalogId",
            "catalogId": "$customCatalogId",
            "components": {
              "SmartWidget": {
                "${"\$ref"}": "#/${"\$defs"}/BaseWidget",
                "properties": {
                  "subtitle": {
                    "${"\$ref"}": "$customCatalogId#/${"\$defs"}/SharedDynamicString"
                  },
                  "footer": {
                    "${"\$ref"}": "custom-v09-bundle#/${"\$defs"}/SharedDynamicString"
                  },
                  "payloadUnion": {
                    "oneOf": [
                      {
                        "type": "object",
                        "properties": {
                          "mode": {"const": "raw"},
                          "data": {"type": "object"}
                        },
                        "required": ["mode", "data"],
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "properties": {
                          "mode": {"const": "expr"},
                          "data": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
                        },
                        "required": ["mode", "data"],
                        "additionalProperties": false
                      }
                    ]
                  },
                  "flexibleSlot": {
                    "oneOf": [
                      {
                        "type": "object",
                        "properties": {
                          "caption": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
                        },
                        "required": ["caption"],
                        "additionalProperties": false
                      },
                      {"${"\$ref"}": "#/${"\$defs"}/anyFunction"}
                    ]
                  }
                },
                "unevaluatedProperties": false
              }
            },
            "functions": {
              "wrapText": {
                "type": "object",
                "properties": {
                  "call": {"const": "wrapText"},
                  "args": {
                    "type": "object",
                    "properties": {
                      "value": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
                    },
                    "required": ["value"],
                    "additionalProperties": false
                  },
                  "returnType": {"const": "string"}
                },
                "required": ["call", "args"],
                "unevaluatedProperties": false
              }
            },
            "${"\$defs"}": {
              "anyFunction": {
                "oneOf": [{"${"\$ref"}": "#/functions/wrapText"}]
              },
              "SharedDynamicString": {
                "${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"
              },
              "BaseWidget": {
                "type": "object",
                "properties": {
                  "id": {"type": "string"},
                  "component": {"const": "SmartWidget"},
                  "title": {"${"\$ref"}": "https://a2ui.org/specification/v0_9/common_types.json#/${"\$defs"}/DynamicString"}
                },
                "required": ["id", "component", "title"]
              }
            }
          }
          """
        )
        .jsonObject

    val validator =
      A2uiValidator(
        A2uiCatalog(
          version = A2uiVersion.VERSION_0_9,
          name = "smart",
          serverToClientSchema = s2c,
          commonTypesSchema = commonTypes,
          catalogSchema = catalogSchema,
        )
      )

    fun nestWrapText(depth: Int, leaf: JsonElement = JsonPrimitive("ok")): JsonObject {
      var cur: JsonElement = leaf
      repeat(depth) {
        cur =
          JsonObject(
            mapOf("call" to JsonPrimitive("wrapText"), "args" to JsonObject(mapOf("value" to cur)))
          )
      }
      return cur as JsonObject
    }

    fun widgetMsg(extraProps: Map<String, JsonElement>): JsonObject =
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
                          "component" to JsonPrimitive("SmartWidget"),
                          "title" to nestWrapText(3),
                        ) + extraProps
                      )
                    )
                  ),
              )
            ),
        )
      )

    // Literal-object union branch (`mode = "raw"`) accepts a literal map with `"call": "wrapText"`
    // and undeclared keys without running `validateCallAtSlot` from the unmatched `"expr"` branch.
    validator.validate(
      widgetMsg(
        mapOf(
          "subtitle" to nestWrapText(4),
          "payloadUnion" to
            JsonObject(
              mapOf(
                "mode" to JsonPrimitive("raw"),
                "data" to
                  JsonObject(
                    mapOf("call" to JsonPrimitive("wrapText"), "extraLiteral" to JsonPrimitive(1))
                  ),
              )
            ),
          "flexibleSlot" to JsonObject(mapOf("caption" to nestWrapText(4))),
        )
      ),
      strictIntegrity = true,
    )

    // Matched `"expr"` branch still validates nested calls.
    assertFailsWith<A2uiValidationException> {
      validator.validate(
        widgetMsg(
          mapOf(
            "payloadUnion" to
              JsonObject(
                mapOf(
                  "mode" to JsonPrimitive("expr"),
                  "data" to nestWrapText(4, JsonPrimitive(999)),
                )
              )
          )
        ),
        strictIntegrity = true,
      )
    }

    // Sibling `properties.subtitle` next to `$ref: "#/$defs/BaseWidget"` (via custom `$id` URI)
    // validates nested function calls.
    assertFailsWith<A2uiValidationException> {
      validator.validate(
        widgetMsg(mapOf("subtitle" to nestWrapText(4, JsonPrimitive(999)))),
        strictIntegrity = true,
      )
    }

    // A `$ref` relative to the catalog's `$id` leads back to the catalog as well.
    validator.validate(widgetMsg(mapOf("footer" to nestWrapText(4))), strictIntegrity = true)
    assertFailsWith<A2uiValidationException> {
      validator.validate(
        widgetMsg(mapOf("footer" to nestWrapText(4, JsonPrimitive(999)))),
        strictIntegrity = true,
      )
    }

    // Mixed `oneOf` (`[objectWithDynamicProps, anyFunction]`) validates nested calls inside the
    // non-call object branch as well as direct calls.
    validator.validate(widgetMsg(mapOf("flexibleSlot" to nestWrapText(4))), strictIntegrity = true)
    assertFailsWith<A2uiValidationException> {
      validator.validate(
        widgetMsg(
          mapOf("flexibleSlot" to JsonObject(mapOf("caption" to nestWrapText(4, JsonPrimitive(9)))))
        ),
        strictIntegrity = true,
      )
    }
  }

  @Test
  fun validatesVersion091CatalogAndReportsExpectedVersions() {
    val v091Validator =
      A2uiSchemaManager(
          version = A2uiVersion.VERSION_0_9_1,
          catalogs = listOf(BasicCatalog.getConfig(A2uiVersion.VERSION_0_9_1)),
        )
        .getSelectedCatalog()
        .validator

    for (ver in listOf("v0.9", "v0.9.1")) {
      val msg =
        JsonObject(
          mapOf(
            "version" to JsonPrimitive(ver),
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
                            "text" to nestedFormatString(12),
                          )
                        )
                      )
                    ),
                )
              ),
          )
        )
      v091Validator.validate(msg, strictIntegrity = true)
    }

    val invalidVerErr =
      assertFailsWith<A2uiValidationException> {
        v091Validator.validate(
          JsonObject(
            mapOf(
              "version" to JsonPrimitive("v1.0"),
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
                              "text" to JsonPrimitive("hi"),
                            )
                          )
                        )
                      ),
                  )
                ),
            )
          ),
          strictIntegrity = true,
        )
      }
    assertTrue(
      invalidVerErr.message!!.contains("Invalid version, expected 'v0.9' or 'v0.9.1'"),
      "Unexpected error message: ${invalidVerErr.message}",
    )
  }
}
