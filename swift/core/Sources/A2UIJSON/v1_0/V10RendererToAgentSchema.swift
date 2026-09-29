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

/// A2UI v1.0 renderer-to-agent event JSON Schema.
public enum V10RendererToAgentSchema {
  /// The canonical URI for this schema document.
  public static let schemaURI =
    "https://a2ui.org/specification/v1_0/renderer_to_agent.json"

  /// The parsed JSON Schema document as a `JSONValue`.
  public static let document: JSONValue = parseEmbedded(rawDocument)

  private static func parseEmbedded(_ raw: String) -> JSONValue {
    do {
      return try JSONValue.parse(raw)
    } catch {
      assertionFailure("Failed to parse embedded V10RendererToAgentSchema document: \(error)")
      return .object([:])
    }
  }

  private static let rawDocument = """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/specification/v1_0/renderer_to_agent.json",
      "title": "A2UI (Agent to UI) Renderer-to-Agent Event Schema",
      "description": "Describes a JSON payload for a renderer-to-agent event message.",
      "type": "object",
      "minProperties": 2,
      "maxProperties": 2,
      "properties": {
        "version": {
          "const": "v1.0"
        },
        "action": {
          "type": "object",
          "description": "Reports a user-initiated action from a component.",
          "properties": {
            "name": {
              "type": "string",
              "description": "The name of the action, taken from the component's \
    action.event.name property."
            },
            "userMessage": {
              "type": "string",
              "description": "An optional human-readable string describing the action performed \
    by the user, taken from the component's action.event.userMessage property after resolving \
    bindings."
            },
            "surfaceId": {
              "type": "string",
              "description": "The id of the surface where the event originated. It must be \
    globally unique for the renderer's lifetime."
            },
            "sourceComponentId": {
              "type": "string",
              "description": "The id of the component that triggered the event."
            },
            "timestamp": {
              "type": "string",
              "format": "date-time",
              "description": "An ISO 8601 timestamp of when the event occurred."
            },
            "context": {
              "type": "object",
              "description": "A JSON object containing the key-value pairs from the component's \
    action.event.context, after resolving all data bindings.",
              "additionalProperties": true
            },
            "metadata": {
              "type": "object",
              "description": "Optional renderer-side metadata to send back to the agent with the \
    action.",
              "properties": {
                "extensions": {
                  "$ref": "common_types.json#/$defs/Extensions"
                }
              },
              "additionalProperties": false
            }
          },
          "required": [
            "name",
            "surfaceId",
            "sourceComponentId",
            "timestamp",
            "context"
          ]
        },
        "callAgentFunction": {
          "type": "object",
          "description": "Signals the agent to execute a function remotely on behalf of the \
    renderer.",
          "properties": {
            "surfaceId": {
              "type": "string",
              "description": "The surface ID where the call originated."
            },
            "functionCallId": {
              "$ref": "common_types.json#/$defs/CallId",
              "description": "Unique ID for this instance of the function call. The agent MUST \
    copy this ID into the return response."
            },
            "callFunction": {
              "$ref": "common_types.json#/$defs/FunctionCall"
            }
          },
          "required": [
            "surfaceId",
            "functionCallId",
            "callFunction"
          ],
          "additionalProperties": false
        },
        "rendererFunctionResponse": {
          "$ref": "common_types.json#/$defs/FunctionResponse"
        },
        "error": {
          "description": "Reports a renderer-side error.",
          "oneOf": [
            {
              "type": "object",
              "title": "Validation Failed Error",
              "properties": {
                "code": {
                  "enum": [
                    "VALIDATION_FAILED",
                    "UNALLOWED_PARENT",
                    "UNALLOWED_CHILD"
                  ]
                },
                "surfaceId": {
                  "type": "string",
                  "description": "The id of the surface where the error occurred. It must be \
    globally unique for the renderer's lifetime."
                },
                "path": {
                  "type": "string",
                  "description": "The JSON pointer to the field that failed validation (e.g. \
    '/components/0/text')."
                },
                "message": {
                  "type": "string",
                  "description": "A short one or two sentence description of why validation \
    failed."
                }
              },
              "required": [
                "code",
                "path",
                "message",
                "surfaceId"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "title": "Generic Error",
              "properties": {
                "code": {
                  "type": "string",
                  "not": {
                    "enum": [
                      "VALIDATION_FAILED",
                      "UNALLOWED_PARENT",
                      "UNALLOWED_CHILD"
                    ]
                  }
                },
                "message": {
                  "type": "string",
                  "description": "A short one or two sentence description of why the error \
    occurred."
                },
                "surfaceId": {
                  "type": "string",
                  "description": "The id of the surface where the error occurred. It must be \
    globally unique for the renderer's lifetime."
                },
                "functionCallId": {
                  "$ref": "common_types.json#/$defs/CallId",
                  "description": "The unique ID of the function invocation, which must be \
    identical to the value specified in the function invocation."
                }
              },
              "required": [
                "code",
                "message"
              ],
              "oneOf": [
                {
                  "required": [
                    "surfaceId"
                  ],
                  "not": {
                    "required": [
                      "functionCallId"
                    ]
                  }
                },
                {
                  "required": [
                    "functionCallId"
                  ],
                  "not": {
                    "required": [
                      "surfaceId"
                    ]
                  }
                }
              ],
              "additionalProperties": true
            }
          ]
        }
      },
      "oneOf": [
        {
          "required": [
            "action",
            "version"
          ]
        },
        {
          "required": [
            "callAgentFunction",
            "version"
          ]
        },
        {
          "required": [
            "rendererFunctionResponse",
            "version"
          ]
        },
        {
          "required": [
            "error",
            "version"
          ]
        }
      ]
    }
    """
}
