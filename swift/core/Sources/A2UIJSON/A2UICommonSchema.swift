// Copyright 2026 Google LLC
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
  public static var allSchemas: [String: JSONValue] {
    [baseURI: document]
  }
}
