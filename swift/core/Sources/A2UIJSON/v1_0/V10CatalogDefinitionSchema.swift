// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/ via swift/scripts/generate_schemas.py

import Foundation
import OrderedJSON

/// A2UI v1.0 catalog definition JSON Schema.
public enum V10CatalogDefinitionSchema {
  /// The canonical URI for this schema document.
  public static let schemaURI =
    "https://a2ui.org/specification/v1_0/catalog_definition.json"

  /// The parsed JSON Schema document as a `JSONValue`.
  public static let document: JSONValue = parseEmbedded(rawDocument)

  private static func parseEmbedded(_ raw: String) -> JSONValue {
    do {
      return try JSONValue.parse(raw)
    } catch {
      assertionFailure("Failed to parse embedded V10CatalogDefinitionSchema document: \(error)")
      return .object([:])
    }
  }

  private static let rawDocument = """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/specification/v1_0/catalog_definition.json",
      "title": "A2UI Catalog Definition Schema",
      "description": "A collection of component and function definitions.",
      "type": "object",
      "properties": {
        "$schema": {
          "type": "string"
        },
        "$id": {
          "type": "string"
        },
        "protocolVersion": {
          "type": "string",
          "pattern": \
    "^(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)(?:\\\\.(0|[1-9][0-9]*))?(?:-((?:0|[1-9][0-9]*|[0-9]*[a\
    -zA-Z-][0-9a-zA-Z-]*)(?:\\\\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\\\+([0-\
    9a-zA-Z-]+(?:\\\\.[0-9a-zA-Z-]+)*))?$",
          "default": "0.9",
          "description": "The A2UI specification version of this catalog definition (e.g. \
    '1.0'). Defaults to '0.9' if omitted."
        },
        "$defs": {
          "type": "object",
          "description": "Standardized schema definitions referenced from outside the catalog \
    file.",
          "properties": {
            "anyComponent": {
              "title": "A2UI Any Component Schema",
              "description": "Unified validation schema for all components.",
              "$ref": "https://json-schema.org/draft/2020-12/schema"
            },
            "anyFunction": {
              "title": "A2UI Any Function Schema",
              "description": "Unified validation schema for all functions.",
              "$ref": "https://json-schema.org/draft/2020-12/schema"
            }
          },
          "required": [
            "anyComponent",
            "anyFunction"
          ],
          "additionalProperties": false
        },
        "title": {
          "type": "string",
          "description": "The title of the catalog."
        },
        "description": {
          "type": "string",
          "description": "A human-readable description of the catalog."
        },
        "catalogId": {
          "type": "string",
          "description": "Unique identifier for this catalog."
        },
        "instructions": {
          "type": "string",
          "description": "Markdown-formatted design guidelines or instructions specific to this \
    catalog."
        },
        "components": {
          "type": "object",
          "description": "Definitions for UI components supported by this catalog.",
          "propertyNames": {
            "not": {
              "const": "Surface"
            }
          },
          "additionalProperties": {
            "$ref": "#/$defs/ComponentDefinition"
          }
        },
        "functions": {
          "type": "object",
          "description": "Definitions for functions supported by this catalog.",
          "additionalProperties": {
            "$ref": "#/$defs/FunctionDefinition"
          }
        }
      },
      "required": [
        "catalogId"
      ],
      "additionalProperties": false,
      "$defs": {
        "FunctionCallValidationSchema": {
          "type": "object",
          "description": "JSON Schema structure that validates a wire-level FunctionCall object.",
          "properties": {
            "type": {
              "const": "object"
            },
            "description": {
              "type": "string"
            },
            "properties": {
              "type": "object",
              "properties": {
                "call": {
                  "type": "object",
                  "properties": {
                    "const": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "const"
                  ]
                },
                "args": {
                  "type": "object",
                  "description": "A JSON Schema describing the expected arguments (args) for \
    this function.",
                  "$ref": "https://json-schema.org/draft/2020-12/schema"
                }
              },
              "required": [
                "call"
              ],
              "additionalProperties": false
            },
            "required": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "contains": {
                "const": "call"
              }
            }
          },
          "required": [
            "type",
            "properties",
            "required"
          ]
        },
        "FunctionDefinition": {
          "type": "object",
          "description": "Describes a function's validation schema and interface metadata.",
          "allOf": [
            {
              "$ref": "#/$defs/FunctionCallValidationSchema"
            },
            {
              "type": "object",
              "properties": {
                "returnType": {
                  "type": "string",
                  "enum": [
                    "string",
                    "number",
                    "boolean",
                    "array",
                    "object",
                    "validationResult",
                    "any",
                    "void"
                  ],
                  "description": "The type of value this function returns."
                },
                "allowedCallers": {
                  "type": "string",
                  "enum": [
                    "rendererOnly",
                    "agentOnly",
                    "rendererOrAgent"
                  ],
                  "default": "rendererOnly",
                  "description": "Specifies which roles are authorized to invoke this function."
                },
                "requiresUserActivation": {
                  "type": "boolean",
                  "default": false,
                  "description": "Specifies whether this function requires a user activation \
    context to execute."
                }
              },
              "required": [
                "returnType"
              ]
            },
            {
              "if": {
                "properties": {
                  "requiresUserActivation": {
                    "const": true
                  }
                }
              },
              "then": {
                "properties": {
                  "allowedCallers": {
                    "enum": [
                      "rendererOnly"
                    ]
                  }
                }
              }
            }
          ],
          "unevaluatedProperties": false
        },
        "ComponentDefinition": {
          "type": "object",
          "description": "Describes a component's validation schema and composition constraints.",
          "allOf": [
            {
              "$ref": "https://json-schema.org/draft/2020-12/schema"
            },
            {
              "type": "object",
              "properties": {
                "allowedParents": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "The list of parent component type names that can contain this \
    component type. If omitted, all parent component types are allowed. To restrict a component \
    so it can appear only as the top-level component (id='root') of a surface, set \
    \\"allowedParents\\": [\\"Surface\\"]. To allow a component as either the top-level \
    component of a surface or a child of a specific container, specify both (e.g., \
    \\"allowedParents\\": [\\"Surface\\", \\"CanvasContainer\\"]).",
                  "uniqueItems": true
                },
                "allowedChildren": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "The list of child component type names allowed inside this \
    container or slot. If omitted, all child component types are allowed.",
                  "uniqueItems": true
                },
                "metadata": {
                  "type": "object",
                  "description": "Optional static metadata.",
                  "properties": {
                    "extensions": {
                      "$ref": "common_types.json#/$defs/Extensions"
                    }
                  },
                  "additionalProperties": false
                }
              }
            }
          ]
        },
        "ValidationResult": {
          "type": "object",
          "description": "Dynamic validation result object returned by a validation condition \
    function or data binding.",
          "properties": {
            "valid": {
              "type": "boolean",
              "description": "Whether the check passed."
            },
            "code": {
              "type": "string",
              "description": "Machine-readable error code (e.g. EXPIRED_CARD, OUT_OF_RANGE)."
            },
            "message": {
              "type": "string",
              "description": "Human-readable error or warning message."
            },
            "severity": {
              "type": "string",
              "enum": [
                "error",
                "warning",
                "info"
              ],
              "default": "error",
              "description": "Severity level of the validation result."
            }
          },
          "required": [
            "valid"
          ]
        }
      }
    }
    """
}
