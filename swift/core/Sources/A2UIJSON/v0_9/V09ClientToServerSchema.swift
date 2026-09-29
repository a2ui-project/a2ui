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

/// A2UI v0.9 / v0.9.1 client-to-server event JSON Schema.
public enum V09ClientToServerSchema {
  /// The canonical URI for this schema document.
  public static let schemaURI =
    "https://a2ui.org/specification/v0_9/client_to_server.json"

  /// The parsed JSON Schema document as a `JSONValue`.
  public static let document: JSONValue = parseEmbedded(rawDocument)

  private static func parseEmbedded(_ raw: String) -> JSONValue {
    do {
      return try JSONValue.parse(raw)
    } catch {
      assertionFailure("Failed to parse embedded V09ClientToServerSchema document: \(error)")
      return .object([:])
    }
  }

  private static let rawDocument = """
    {
      "title": "A2UI (Agent to UI) Client-to-Server Event Schema",
      "description": "Describes a JSON payload for a client-to-server event message.",
      "type": "object",
      "minProperties": 2,
      "maxProperties": 2,
      "properties": {
        "version": {
          "enum": [
            "v0.9",
            "v0.9.1"
          ]
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
            "surfaceId": {
              "type": "string",
              "description": "The id of the surface where the event originated."
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
        "error": {
          "description": "Reports a client-side error.",
          "oneOf": [
            {
              "type": "object",
              "title": "Validation Failed Error",
              "properties": {
                "code": {
                  "const": "VALIDATION_FAILED"
                },
                "surfaceId": {
                  "type": "string",
                  "description": "The id of the surface where the error occurred."
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
                  "not": {
                    "const": "VALIDATION_FAILED"
                  }
                },
                "message": {
                  "type": "string",
                  "description": "A short one or two sentence description of why the error \
    occurred."
                },
                "surfaceId": {
                  "type": "string",
                  "description": "The id of the surface where the error occurred."
                }
              },
              "required": [
                "code",
                "surfaceId",
                "message"
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
            "error",
            "version"
          ]
        }
      ]
    }
    """
}
