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

import JSONSchema
import OrderedJSON

/// Namespace for A2UI common type schema URIs and schema registration.
///
/// This enum provides the base URI for all A2UI v0.9.1 common type schemas
/// and utilities for registering them into a ``JSONSchema.Context`` so that
/// `$ref` references to A2UI common types resolve correctly during
/// validation.
public enum A2UICommonSchema {
  /// The base URI for all A2UI v0.9.1 common type schemas.
  public static let baseURI =
    "https://a2ui.org/schemas/v0_9_1/common.json"

  /// Returns the full URI for a named A2UI common type schema definition.
  ///
  /// - Parameter name: The name of the common type (e.g., `"DataBinding"`).
  /// - Returns: The full URI (e.g.,
  ///   `https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding`).
  public static func uri(for name: String) -> String {
    "\(baseURI)#/$defs/\(name)"
  }

  /// The raw JSON string of the complete common types document.
  ///
  /// This document contains all 14 A2UI v0.9.1 common type schema
  /// definitions under the `$defs` key, with cross-references using
  /// `$ref` URIs relative to `baseURI`.

  /// The base URI for all A2UI v1.0 common type schemas.
  public static let v10BaseURI =
    "https://a2ui.org/specification/v1_0/common_types.json"

  /// The base URI for the A2UI v1.0 catalog definition schema.
  public static let v10CatalogDefinitionURI =
    "https://a2ui.org/specification/v1_0/catalog_definition.json"

  /// Returns the full URI for a named A2UI v1.0 common type schema definition.
  public static func v10URI(for name: String) -> String {
    "\(v10BaseURI)#/$defs/\(name)"
  }

  static let rawDocument = """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/schemas/v0_9_1/common.json",
      "title": "A2UI Common Types",
      "description": "Common type definitions used across A2UI schemas.",
      "$defs": {
        "ComponentId": {
          "type": "string",
          "description": "The unique identifier for a component, used for \
    both definitions and references within the same surface."
        },
        "AccessibilityAttributes": {
          "type": "object",
          "description": "Attributes to enhance accessibility when using \
    assistive technologies like screen readers.",
          "properties": {
            "label": {
              "$ref": "#/$defs/DynamicString",
              "description": "A short string, typically 1 to 3 words, \
    used by assistive technologies to convey the purpose or intent of an \
    element."
            },
            "description": {
              "$ref": "#/$defs/DynamicString",
              "description": "Additional information provided by assistive \
    technologies about an element such as instructions, format \
    requirements, or result of an action."
            }
          }
        },
        "ComponentCommon": {
          "type": "object",
          "properties": {
            "id": { "$ref": "#/$defs/ComponentId" },
            "accessibility": { "$ref": "#/$defs/AccessibilityAttributes" }
          },
          "required": ["id"]
        },
        "ChildList": {
          "oneOf": [
            {
              "type": "array",
              "items": { "$ref": "#/$defs/ComponentId" },
              "description": "A static list of child component IDs."
            },
            {
              "type": "object",
              "description": "A template for generating a dynamic list of \
    children from a data model list.",
              "properties": {
                "componentId": { "$ref": "#/$defs/ComponentId" },
                "path": {
                  "type": "string",
                  "description": "The path to the list of component property \
    objects in the data model."
                }
              },
              "required": ["componentId", "path"],
              "additionalProperties": false
            }
          ]
        },
        "DataBinding": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "A JSON Pointer path to a value in the data model."
            }
          },
          "required": ["path"],
          "additionalProperties": false
        },
        "DynamicValue": {
          "description": "A value that can be a literal, a path, or a \
    function call returning any type.",
          "oneOf": [
            { "type": "string" },
            { "type": "number" },
            { "type": "boolean" },
            { "type": "array" },
            { "$ref": "#/$defs/DataBinding" },
            { "$ref": "#/$defs/FunctionCall" }
          ]
        },
        "DynamicString": {
          "description": "Represents a string",
          "oneOf": [
            { "type": "string" },
            { "$ref": "#/$defs/DataBinding" },
            {
              "allOf": [
                { "$ref": "#/$defs/FunctionCall" },
                {
                  "properties": {
                    "returnType": { "const": "string" }
                  }
                }
              ]
            }
          ]
        },
        "DynamicNumber": {
          "description": "Represents a value that can be either a literal \
    number, a path to a number in the data model, or a function call \
    returning a number.",
          "oneOf": [
            { "type": "number" },
            { "$ref": "#/$defs/DataBinding" },
            {
              "allOf": [
                { "$ref": "#/$defs/FunctionCall" },
                {
                  "properties": {
                    "returnType": { "const": "number" }
                  }
                }
              ]
            }
          ]
        },
        "DynamicBoolean": {
          "description": "A boolean value that can be a literal, a path, or \
    a function call returning a boolean.",
          "oneOf": [
            { "type": "boolean" },
            { "$ref": "#/$defs/DataBinding" },
            {
              "allOf": [
                { "$ref": "#/$defs/FunctionCall" },
                {
                  "properties": {
                    "returnType": { "const": "boolean" }
                  }
                }
              ]
            }
          ]
        },
        "DynamicStringList": {
          "description": "Represents a value that can be either a literal \
    array of strings, a path to a string array in the data model, or a \
    function call returning a string array.",
          "oneOf": [
            {
              "type": "array",
              "items": { "type": "string" }
            },
            { "$ref": "#/$defs/DataBinding" },
            {
              "allOf": [
                { "$ref": "#/$defs/FunctionCall" },
                {
                  "properties": {
                    "returnType": { "const": "array" }
                  }
                }
              ]
            }
          ]
        },
        "FunctionCall": {
          "type": "object",
          "description": "Invokes a named function on the client.",
          "properties": {
            "call": {
              "type": "string",
              "description": "The name of the function to call."
            },
            "args": {
              "type": "object",
              "description": "Arguments passed to the function.",
              "additionalProperties": {
                "anyOf": [
                  { "$ref": "#/$defs/DynamicValue" },
                  {
                    "type": "object",
                    "description": "A literal object argument (e.g. configuration)."
                  }
                ]
              }
            },
            "returnType": {
              "type": "string",
              "description": "The expected return type of the function call.",
              "enum": ["string", "number", "boolean", "array", "object", "any", "void"],
              "default": "boolean"
            }
          },
          "required": ["call"]
        },
        "CheckRule": {
          "type": "object",
          "description": "A single validation rule applied to an input component.",
          "properties": {
            "condition": { "$ref": "#/$defs/DynamicBoolean" },
            "message": {
              "type": "string",
              "description": "The error message to display if the check fails."
            }
          },
          "required": ["condition", "message"],
          "additionalProperties": false
        },
        "Checkable": {
          "description": "Properties for components that support client-side checks.",
          "type": "object",
          "properties": {
            "checks": {
              "type": "array",
              "description": "A list of checks to perform.",
              "items": { "$ref": "#/$defs/CheckRule" }
            }
          }
        },
        "Action": {
          "description": "Defines an interaction handler that can either \
    trigger a server-side event or execute a local client-side function.",
          "oneOf": [
            {
              "type": "object",
              "description": "Triggers a server-side event.",
              "properties": {
                "event": {
                  "type": "object",
                  "description": "The event to dispatch to the server.",
                  "properties": {
                    "name": {
                      "type": "string",
                      "description": "The name of the action to be dispatched to the server."
                    },
                    "context": {
                      "type": "object",
                      "description": "A JSON object containing the \
    key-value pairs for the action context.",
                      "additionalProperties": {
                        "$ref": "#/$defs/DynamicValue"
                      }
                    }
                  },
                  "required": ["name"],
                  "additionalProperties": false
                }
              },
              "required": ["event"],
              "additionalProperties": false
            },
            {
              "type": "object",
              "description": "Executes a local client-side function.",
              "properties": {
                "functionCall": { "$ref": "#/$defs/FunctionCall" }
              },
              "required": ["functionCall"],
              "additionalProperties": false
            }
          ]
        }
      }
    }
    """

  /// The complete common types document as a parsed `JSONValue`.
  ///
  /// This document contains all 14 A2UI common type schema definitions
  /// under the `$defs` key, with cross-references using `$ref` URIs
  /// relative to `baseURI`.
  public static let document: JSONValue = {
    do {
      return try JSONValue.parse(rawDocument)
    } catch {
      assertionFailure("Failed to parse A2UICommonSchema rawDocument: \(error)")
      return .object([:])
    }
  }()

  /// A dictionary mapping the base URI to the common types document.
  ///
  /// Pass this to ``Context/init(dialect:remoteSchema:formatValidators:)``
  /// via the `remoteSchema` parameter to enable `$ref` resolution for
  /// all A2UI common types.

  static let v10RawDocument = """
    {
      \"$schema\": \"https://json-schema.org/draft/2020-12/schema\",
      \"$id\": \"https://a2ui.org/specification/v1_0/common_types.json\",
      \"title\": \"A2UI Common Types\",
      \"description\": \"Common type definitions used across A2UI schemas.\",
      \"$defs\": {
        \"ComponentId\": {
          \"type\": \"string\",
          \"description\": \"The unique identifier for a component, used for both \
    definitions and references within the same surface.\"
        },
        \"CallId\": {
          \"type\": \"string\",
          \"description\": \"The unique identifier for a function call.\"
        },
        \"AccessibilityAttributes\": {
          \"type\": \"object\",
          \"description\": \"Attributes to enhance accessibility when using \
    assistive technologies like screen readers or model understanding.\",
          \"properties\": {
            \"label\": {
              \"$ref\": \"#/$defs/DynamicString\",
              \"description\": \"A short string, typically 1 to 3 words, used by \
    assistive technologies to convey the purpose or intent of an element. For \
    example, an input field might have an accessible label of 'User ID' or a button \
    might be labeled 'Submit'.\"
            },
            \"description\": {
              \"$ref\": \"#/$defs/DynamicString\",
              \"description\": \"Additional information provided by assistive \
    technologies about an element such as instructions, format requirements, or \
    result of an action. For example, a mute button might have a label of 'Mute' \
    and a description of 'Silences notifications about this conversation'.\"
            },
            \"live\": {
              \"type\": \"string\",
              \"enum\": [
                \"off\",
                \"polite\",
                \"assertive\"
              ],
              \"default\": \"off\",
              \"description\": \"Controls screen reader announcements for dynamic \
    updates (WAI-ARIA aria-live). 'polite' waits for user pause; 'assertive' \
    interrupts immediately for alerts.\"
            },
            \"hidden\": {
              \"$ref\": \"#/$defs/DynamicBoolean\",
              \"description\": \"Hides the element and its children from assistive \
    technologies when true. Default is false.\"
            }
          },
          \"additionalProperties\": false
        },
        \"Extensions\": {
          \"type\": \"object\",
          \"description\": \"Optional extension metadata. Keys MUST be Unicode \
    identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official \
    extensions.\",
          \"patternProperties\": {
            \"^[\\\\p{XID_Start}_][\\\\p{XID_Continue}]*$\": {}
          },
          \"additionalProperties\": false
        },
        \"ComponentCommon\": {
          \"type\": \"object\",
          \"properties\": {
            \"id\": {
              \"$ref\": \"#/$defs/ComponentId\"
            },
            \"catalogId\": {
              \"type\": \"string\",
              \"description\": \"The catalog ID for this component, overriding any \
    surface-level default catalogId.\"
            },
            \"accessibility\": {
              \"$ref\": \"#/$defs/AccessibilityAttributes\"
            },
            \"metadata\": {
              \"type\": \"object\",
              \"description\": \"Optional component-level metadata for vendor \
    extensions.\",
              \"properties\": {
                \"extensions\": {
                  \"$ref\": \"#/$defs/Extensions\"
                }
              },
              \"additionalProperties\": false
            }
          },
          \"required\": [
            \"id\"
          ]
        },
        \"Child\": {
          \"$ref\": \"#/$defs/ComponentId\",
          \"description\": \"A reference to a single child component ID.\"
        },
        \"ChildList\": {
          \"oneOf\": [
            {
              \"type\": \"array\",
              \"items\": {
                \"$ref\": \"#/$defs/ComponentId\"
              },
              \"description\": \"A static list of child component IDs.\"
            },
            {
              \"type\": \"object\",
              \"description\": \"A template for generating a dynamic list of \
    children from a data model list. The `componentId` is the component to use as a \
    template.\",
              \"properties\": {
                \"componentId\": {
                  \"$ref\": \"#/$defs/ComponentId\"
                },
                \"path\": {
                  \"type\": \"string\",
                  \"description\": \"The path to the list of component property \
    objects in the data model.\"
                }
              },
              \"required\": [
                \"componentId\",
                \"path\"
              ],
              \"additionalProperties\": false
            }
          ]
        },
        \"DataBinding\": {
          \"type\": \"object\",
          \"properties\": {
            \"path\": {
              \"type\": \"string\",
              \"description\": \"A JSON Pointer path to a value in the data model.\"
            }
          },
          \"required\": [
            \"path\"
          ],
          \"additionalProperties\": false
        },
        \"DynamicValue\": {
          \"description\": \"A value that can be a literal, a path, or a function \
    call returning any type.\",
          \"oneOf\": [
            {
              \"type\": \"string\"
            },
            {
              \"type\": \"number\"
            },
            {
              \"type\": \"boolean\"
            },
            {
              \"type\": \"array\"
            },
            {
              \"type\": \"object\",
              \"not\": {
                \"anyOf\": [
                  {
                    \"required\": [
                      \"path\"
                    ]
                  },
                  {
                    \"required\": [
                      \"call\"
                    ]
                  }
                ]
              }
            },
            {
              \"$ref\": \"#/$defs/DataBinding\"
            },
            {
              \"$ref\": \"#/$defs/FunctionCall\"
            }
          ]
        },
        \"DynamicString\": {
          \"description\": \"Represents a string\",
          \"oneOf\": [
            {
              \"type\": \"string\"
            },
            {
              \"$ref\": \"#/$defs/DataBinding\"
            },
            {
              \"$ref\": \"#/$defs/FunctionCall\"
            }
          ]
        },
        \"DynamicNumber\": {
          \"description\": \"Represents a value that can be either a literal \
    number, a path to a number in the data model, or a function call returning a \
    number.\",
          \"oneOf\": [
            {
              \"type\": \"number\"
            },
            {
              \"$ref\": \"#/$defs/DataBinding\"
            },
            {
              \"$ref\": \"#/$defs/FunctionCall\"
            }
          ]
        },
        \"DynamicBoolean\": {
          \"description\": \"A boolean value that can be a literal, a path, or a \
    function call returning a boolean.\",
          \"oneOf\": [
            {
              \"type\": \"boolean\"
            },
            {
              \"$ref\": \"#/$defs/DataBinding\"
            },
            {
              \"$ref\": \"#/$defs/FunctionCall\"
            }
          ]
        },
        \"DynamicStringList\": {
          \"description\": \"Represents a value that can be either a literal array \
    of strings, a path to a string array in the data model, or a function call \
    returning a string array.\",
          \"oneOf\": [
            {
              \"type\": \"array\",
              \"items\": {
                \"type\": \"string\"
              }
            },
            {
              \"$ref\": \"#/$defs/DataBinding\"
            },
            {
              \"$ref\": \"#/$defs/FunctionCall\"
            }
          ]
        },
        \"FunctionCommon\": {
          \"type\": \"object\",
          \"description\": \"Baseline envelope properties common to all function \
    calls. Function-specific argument schemas ('args') are defined individually by \
    each function in the active catalog.\",
          \"properties\": {
            \"call\": {
              \"type\": \"string\",
              \"description\": \"The name of the function to call.\"
            },
            \"catalogId\": {
              \"type\": \"string\",
              \"description\": \"The catalog ID for this function, overriding any \
    surface-level default catalogId.\"
            }
          },
          \"required\": [
            \"call\"
          ]
        },
        \"IndexSystemFunction\": {
          \"type\": \"object\",
          \"description\": \"Returns the 0-based index of the current item when \
    rendering a dynamic list from a template. This function MUST ONLY be available \
    when evaluating template items within a list context.\",
          \"returnType\": \"number\",
          \"properties\": {
            \"call\": {
              \"const\": \"@index\"
            },
            \"args\": {
              \"type\": \"object\",
              \"properties\": {
                \"offset\": {
                  \"$ref\": \"#/$defs/DynamicNumber\",
                  \"description\": \"Optional. An offset to add to the 0-based \
    index (e.g., 1 for 1-based indexing). Defaults to 0.\",
                  \"default\": 0
                }
              },
              \"unevaluatedProperties\": false
            }
          },
          \"required\": [
            \"call\"
          ],
          \"unevaluatedProperties\": false
        },
        \"FunctionCall\": {
          \"type\": \"object\",
          \"description\": \"Invokes a named function, combining common function \
    properties with the catalog function definition.\",
          \"properties\": {
            \"call\": {
              \"type\": \"string\",
              \"description\": \"The name of the function to call.\"
            },
            \"catalogId\": {
              \"type\": \"string\",
              \"description\": \"The catalog ID for this function, overriding any \
    surface-level default catalogId.\"
            },
            \"args\": {
              \"type\": \"object\",
              \"description\": \"Arguments passed to the function.\"
            },
            \"returnType\": {
              \"type\": \"string\",
              \"description\": \"The expected return type of the function call.\"
            }
          },
          \"required\": [
            \"call\"
          ]
        },
        \"CheckRule\": {
          \"type\": \"object\",
          \"description\": \"A single validation check rule applied to an input \
    component. The condition function or path evaluates to a ValidationResult \
    object.\",
          \"properties\": {
            \"condition\": {
              \"oneOf\": [
                {
                  \"$ref\": \"#/$defs/DataBinding\"
                },
                {
                  \"$ref\": \"#/$defs/FunctionCall\"
                }
              ],
              \"description\": \"Path or function call evaluating to a \
    ValidationResult object.\"
            },
            \"message\": {
              \"type\": \"string\",
              \"description\": \"Optional fallback error message.\"
            }
          },
          \"required\": [
            \"condition\"
          ],
          \"additionalProperties\": false
        },
        \"Checkable\": {
          \"description\": \"Properties for components that support renderer-side \
    checks.\",
          \"type\": \"object\",
          \"properties\": {
            \"checks\": {
              \"type\": \"array\",
              \"description\": \"A list of checks to perform. These are function \
    calls that must return a boolean indicating validity.\",
              \"items\": {
                \"$ref\": \"#/$defs/CheckRule\"
              }
            }
          }
        },
        \"Action\": {
          \"description\": \"Defines an interaction handler that can either trigger \
    an agent-side event or execute a local renderer-side function.\",
          \"oneOf\": [
            {
              \"type\": \"object\",
              \"description\": \"Triggers an agent-side event.\",
              \"properties\": {
                \"event\": {
                  \"type\": \"object\",
                  \"description\": \"The event to dispatch to the agent.\",
                  \"properties\": {
                    \"name\": {
                      \"type\": \"string\",
                      \"description\": \"The name of the action to be dispatched to \
    the agent.\"
                    },
                    \"userMessage\": {
                      \"$ref\": \"#/$defs/DynamicString\",
                      \"description\": \"An optional human-readable message \
    describing the action performed by the user, to present in conversation history \
    or user feedback.\"
                    },
                    \"context\": {
                      \"type\": \"object\",
                      \"description\": \"A JSON object containing the key-value \
    pairs for the action context. Values can be literals or paths. Use literal \
    values unless the value must be dynamically bound to the data model. Do NOT use \
    paths for static IDs.\",
                      \"additionalProperties\": {
                        \"$ref\": \"#/$defs/DynamicValue\"
                      }
                    }
                  },
                  \"required\": [
                    \"name\"
                  ],
                  \"additionalProperties\": false
                }
              },
              \"required\": [
                \"event\"
              ],
              \"additionalProperties\": false
            },
            {
              \"type\": \"object\",
              \"description\": \"Executes a renderer or agent-side function.\",
              \"properties\": {
                \"functionCall\": {
                  \"$ref\": \"#/$defs/FunctionCall\"
                }
              },
              \"required\": [
                \"functionCall\"
              ],
              \"additionalProperties\": false
            }
          ]
        },
        \"Surface\": {
          \"title\": \"Surface Container Component\",
          \"description\": \"The reserved canonical container component \
    representing an A2UI surface. The Surface component is immutable and always has \
    'child': 'root'.\",
          \"type\": \"object\",
          \"allowedParents\": [],
          \"properties\": {
            \"component\": {
              \"const\": \"Surface\"
            },
            \"child\": {
              \"const\": \"root\"
            }
          },
          \"additionalProperties\": false
        },
        \"FunctionResponse\": {
          \"type\": \"object\",
          \"description\": \"The return response matching a callAgentFunction or \
    callRendererFunction invocation.\",
          \"properties\": {
            \"functionCallId\": {
              \"$ref\": \"#/$defs/CallId\",
              \"description\": \"The unique ID matching the initiating function \
    call.\"
            },
            \"value\": {
              \"description\": \"The return value of the function.\"
            },
            \"error\": {
              \"type\": \"object\",
              \"description\": \"An error object indicating failure of the function \
    execution.\",
              \"properties\": {
                \"code\": {
                  \"type\": \"string\"
                },
                \"message\": {
                  \"type\": \"string\"
                }
              },
              \"required\": [
                \"code\",
                \"message\"
              ],
              \"additionalProperties\": false
            }
          },
          \"required\": [
            \"functionCallId\"
          ],
          \"oneOf\": [
            {
              \"required\": [
                \"value\"
              ]
            },
            {
              \"required\": [
                \"error\"
              ]
            }
          ],
          \"additionalProperties\": false
        }
      }
    }
    """

  /// The complete A2UI v1.0 common types document as a parsed `JSONValue`.
  public static let v10Document: JSONValue = {
    do {
      return try JSONValue.parse(v10RawDocument)
    } catch {
      assertionFailure("Failed to parse A2UICommonSchema v10RawDocument: \(error)")
      return .object([:])
    }
  }()

  static let v10CatalogDefinitionRawDocument = """
    {
      \"$schema\": \"https://json-schema.org/draft/2020-12/schema\",
      \"$id\": \"https://a2ui.org/specification/v1_0/catalog_definition.json\",
      \"title\": \"A2UI Catalog Definition Schema\",
      \"description\": \"A collection of component and function definitions.\",
      \"type\": \"object\",
      \"properties\": {
        \"$schema\": {
          \"type\": \"string\"
        },
        \"$id\": {
          \"type\": \"string\"
        },
        \"protocolVersion\": {
          \"type\": \"string\",
          \"pattern\": \
    \"^(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)(?:\\\\.(0|[1-9][0-9]*))?(?:-((?:0|[1-9][0 \
    -9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\\\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a- \
    zA-Z-]*))*))?(?:\\\\+([0-9a-zA-Z-]+(?:\\\\.[0-9a-zA-Z-]+)*))?$\",
          \"default\": \"0.9\",
          \"description\": \"The A2UI specification version of this catalog \
    definition (e.g. '1.0'). Defaults to '0.9' if omitted.\"
        },
        \"$defs\": {
          \"type\": \"object\",
          \"description\": \"Standardized schema definitions referenced from \
    outside the catalog file.\",
          \"properties\": {
            \"anyComponent\": {
              \"title\": \"A2UI Any Component Schema\",
              \"description\": \"Unified validation schema for all components.\",
              \"$ref\": \"https://json-schema.org/draft/2020-12/schema\"
            },
            \"anyFunction\": {
              \"title\": \"A2UI Any Function Schema\",
              \"description\": \"Unified validation schema for all functions.\",
              \"$ref\": \"https://json-schema.org/draft/2020-12/schema\"
            }
          },
          \"required\": [
            \"anyComponent\",
            \"anyFunction\"
          ],
          \"additionalProperties\": false
        },
        \"title\": {
          \"type\": \"string\",
          \"description\": \"The title of the catalog.\"
        },
        \"description\": {
          \"type\": \"string\",
          \"description\": \"A human-readable description of the catalog.\"
        },
        \"catalogId\": {
          \"type\": \"string\",
          \"description\": \"Unique identifier for this catalog.\"
        },
        \"instructions\": {
          \"type\": \"string\",
          \"description\": \"Markdown-formatted design guidelines or instructions \
    specific to this catalog.\"
        },
        \"components\": {
          \"type\": \"object\",
          \"description\": \"Definitions for UI components supported by this \
    catalog.\",
          \"propertyNames\": {
            \"not\": {
              \"const\": \"Surface\"
            }
          },
          \"additionalProperties\": {
            \"$ref\": \"#/$defs/ComponentDefinition\"
          }
        },
        \"functions\": {
          \"type\": \"object\",
          \"description\": \"Definitions for functions supported by this catalog.\",
          \"additionalProperties\": {
            \"$ref\": \"#/$defs/FunctionDefinition\"
          }
        }
      },
      \"required\": [
        \"catalogId\"
      ],
      \"additionalProperties\": false,
      \"$defs\": {
        \"FunctionCallValidationSchema\": {
          \"type\": \"object\",
          \"description\": \"JSON Schema structure that validates a wire-level \
    FunctionCall object.\",
          \"properties\": {
            \"type\": {
              \"const\": \"object\"
            },
            \"description\": {
              \"type\": \"string\"
            },
            \"properties\": {
              \"type\": \"object\",
              \"properties\": {
                \"call\": {
                  \"type\": \"object\",
                  \"properties\": {
                    \"const\": {
                      \"type\": \"string\"
                    }
                  },
                  \"required\": [
                    \"const\"
                  ]
                },
                \"args\": {
                  \"type\": \"object\",
                  \"description\": \"A JSON Schema describing the expected \
    arguments (args) for this function.\",
                  \"$ref\": \"https://json-schema.org/draft/2020-12/schema\"
                }
              },
              \"required\": [
                \"call\"
              ],
              \"additionalProperties\": false
            },
            \"required\": {
              \"type\": \"array\",
              \"items\": {
                \"type\": \"string\"
              },
              \"contains\": {
                \"const\": \"call\"
              }
            }
          },
          \"required\": [
            \"type\",
            \"properties\",
            \"required\"
          ]
        },
        \"FunctionDefinition\": {
          \"type\": \"object\",
          \"description\": \"Describes a function's validation schema and interface \
    metadata.\",
          \"allOf\": [
            {
              \"$ref\": \"#/$defs/FunctionCallValidationSchema\"
            },
            {
              \"type\": \"object\",
              \"properties\": {
                \"returnType\": {
                  \"type\": \"string\",
                  \"enum\": [
                    \"string\",
                    \"number\",
                    \"boolean\",
                    \"array\",
                    \"object\",
                    \"validationResult\",
                    \"any\",
                    \"void\"
                  ],
                  \"description\": \"The type of value this function returns.\"
                },
                \"allowedCallers\": {
                  \"type\": \"string\",
                  \"enum\": [
                    \"rendererOnly\",
                    \"agentOnly\",
                    \"rendererOrAgent\"
                  ],
                  \"default\": \"rendererOnly\",
                  \"description\": \"Specifies which roles are authorized to invoke \
    this function.\"
                },
                \"requiresUserActivation\": {
                  \"type\": \"boolean\",
                  \"default\": false,
                  \"description\": \"Specifies whether this function requires a \
    user activation context to execute.\"
                }
              },
              \"required\": [
                \"returnType\"
              ]
            },
            {
              \"if\": {
                \"properties\": {
                  \"requiresUserActivation\": {
                    \"const\": true
                  }
                }
              },
              \"then\": {
                \"properties\": {
                  \"allowedCallers\": {
                    \"enum\": [
                      \"rendererOnly\"
                    ]
                  }
                }
              }
            }
          ],
          \"unevaluatedProperties\": false
        },
        \"ComponentDefinition\": {
          \"type\": \"object\",
          \"description\": \"Describes a component's validation schema and \
    composition constraints.\",
          \"allOf\": [
            {
              \"$ref\": \"https://json-schema.org/draft/2020-12/schema\"
            },
            {
              \"type\": \"object\",
              \"properties\": {
                \"allowedParents\": {
                  \"type\": \"array\",
                  \"items\": {
                    \"type\": \"string\"
                  },
                  \"description\": \"The list of parent component type names that \
    can contain this component type. If omitted, all parent component types are \
    allowed. To restrict a component so it can appear only as the top-level \
    component (id='root') of a surface, set \\\"allowedParents\\\": \
    [\\\"Surface\\\"]. To allow a component as either the top-level component of a \
    surface or a child of a specific container, specify both (e.g., \
    \\\"allowedParents\\\": [\\\"Surface\\\", \\\"CanvasContainer\\\"]).\",
                  \"uniqueItems\": true
                },
                \"allowedChildren\": {
                  \"type\": \"array\",
                  \"items\": {
                    \"type\": \"string\"
                  },
                  \"description\": \"The list of child component type names allowed \
    inside this container or slot. If omitted, all child component types are \
    allowed.\",
                  \"uniqueItems\": true
                },
                \"metadata\": {
                  \"type\": \"object\",
                  \"description\": \"Optional static metadata.\",
                  \"properties\": {
                    \"extensions\": {
                      \"$ref\": \"common_types.json#/$defs/Extensions\"
                    }
                  },
                  \"additionalProperties\": false
                }
              }
            }
          ]
        },
        \"ValidationResult\": {
          \"type\": \"object\",
          \"description\": \"Dynamic validation result object returned by a \
    validation condition function or data binding.\",
          \"properties\": {
            \"valid\": {
              \"type\": \"boolean\",
              \"description\": \"Whether the check passed.\"
            },
            \"code\": {
              \"type\": \"string\",
              \"description\": \"Machine-readable error code (e.g. EXPIRED_CARD, \
    OUT_OF_RANGE).\"
            },
            \"message\": {
              \"type\": \"string\",
              \"description\": \"Human-readable error or warning message.\"
            },
            \"severity\": {
              \"type\": \"string\",
              \"enum\": [
                \"error\",
                \"warning\",
                \"info\"
              ],
              \"default\": \"error\",
              \"description\": \"Severity level of the validation result.\"
            }
          },
          \"required\": [
            \"valid\"
          ]
        }
      }
    }
    """

  /// The complete A2UI v1.0 catalog definition document as a parsed `JSONValue`.
  public static let v10CatalogDefinitionDocument: JSONValue = {
    do {
      return try JSONValue.parse(v10CatalogDefinitionRawDocument)
    } catch {
      assertionFailure("Failed to parse A2UICommonSchema v10CatalogDefinitionRawDocument: \(error)")
      return .object([:])
    }
  }()

  public static var allSchemas: [String: JSONValue] {
    [
      baseURI: document,
      v10BaseURI: v10Document,
      v10CatalogDefinitionURI: v10CatalogDefinitionDocument,
    ]
  }
}
