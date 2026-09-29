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

/// A2UI v0.9 / v0.9.1 server-to-client message JSON Schema.
public enum V09ServerToClientSchema {
  /// The canonical URI for this schema document.
  public static let schemaURI =
    "https://a2ui.org/specification/v0_9/server_to_client.json"

  /// The parsed JSON Schema document as a `JSONValue`.
  public static let document: JSONValue = parseEmbedded(rawDocument)

  private static func parseEmbedded(_ raw: String) -> JSONValue {
    do {
      return try JSONValue.parse(raw)
    } catch {
      assertionFailure("Failed to parse embedded V09ServerToClientSchema document: \(error)")
      return .object([:])
    }
  }

  private static let rawDocument = """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/specification/v0_9/server_to_client.json",
      "title": "A2UI Message Schema",
      "description": "Describes a JSON payload for an A2UI (Agent to UI) message, which is used \
    to dynamically construct and update user interfaces.",
      "type": "object",
      "oneOf": [
        {
          "$ref": "#/$defs/CreateSurfaceMessage"
        },
        {
          "$ref": "#/$defs/UpdateComponentsMessage"
        },
        {
          "$ref": "#/$defs/UpdateDataModelMessage"
        },
        {
          "$ref": "#/$defs/DeleteSurfaceMessage"
        }
      ],
      "$defs": {
        "CreateSurfaceMessage": {
          "type": "object",
          "properties": {
            "version": {
              "enum": [
                "v0.9",
                "v0.9.1"
              ]
            },
            "createSurface": {
              "type": "object",
              "description": "Signals the client to create a new surface and begin rendering it. \
    It is an error to send 'createSurface' for a surfaceId that already exists without first \
    deleting it. When this message is sent, the client will expect 'updateComponents' and/or \
    'updateDataModel' messages for the same surfaceId that define the component tree.",
              "properties": {
                "surfaceId": {
                  "type": "string",
                  "description": "The unique identifier for the UI surface to be rendered."
                },
                "catalogId": {
                  "description": "A string that uniquely identifies this catalog. It is \
    recommended to prefix this with an internet domain that you own, to avoid conflicts e.g. \
    mycompany.com:somecatalog'.",
                  "type": "string"
                },
                "theme": {
                  "$ref": "catalog.json#/$defs/theme",
                  "description": "Theme parameters for the surface (e.g., {'primaryColor': \
    '#FF0000'}). These must validate against the 'theme' schema defined in the catalog."
                },
                "sendDataModel": {
                  "type": "boolean",
                  "description": "If true, the client will send the full data model of this \
    surface in the metadata of every A2A message sent to the server that created the surface. \
    Defaults to false."
                }
              },
              "required": [
                "surfaceId",
                "catalogId"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "createSurface",
            "version"
          ],
          "additionalProperties": false
        },
        "UpdateComponentsMessage": {
          "type": "object",
          "properties": {
            "version": {
              "enum": [
                "v0.9",
                "v0.9.1"
              ]
            },
            "updateComponents": {
              "type": "object",
              "description": "Updates a surface with a new set of components. This message can \
    be sent multiple times to update the component tree of an existing surface. One of the \
    components in one of the components lists MUST have an 'id' of 'root' to serve as the root \
    of the component tree. A createSurface message MUST have been previously sent for the \
    'surfaceId' in this message; the surface's catalog is the one specified by that \
    createSurface.",
              "properties": {
                "surfaceId": {
                  "type": "string",
                  "description": "The unique identifier for the UI surface to be updated."
                },
                "components": {
                  "type": "array",
                  "description": "A list containing all UI components for the surface.",
                  "minItems": 1,
                  "items": {
                    "$ref": "catalog.json#/$defs/anyComponent"
                  }
                }
              },
              "required": [
                "surfaceId",
                "components"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "updateComponents",
            "version"
          ],
          "additionalProperties": false
        },
        "UpdateDataModelMessage": {
          "type": "object",
          "properties": {
            "version": {
              "enum": [
                "v0.9",
                "v0.9.1"
              ]
            },
            "updateDataModel": {
              "type": "object",
              "description": "Updates the data model for an existing surface. This message can \
    be sent multiple times to update the data model. A createSurface message MUST have been \
    previously sent for the 'surfaceId' in this message; the surface's catalog is the one \
    specified by that createSurface.",
              "properties": {
                "surfaceId": {
                  "type": "string",
                  "description": "The unique identifier for the UI surface this data model \
    update applies to."
                },
                "path": {
                  "type": "string",
                  "description": "An optional path to a location within the data model (e.g., \
    '/user/name'). If omitted, or set to '/', refers to the entire data model."
                },
                "value": {
                  "description": "The data to be updated in the data model. If present, the \
    value at 'path' is replaced (or created). If omitted, the key at 'path' is removed.",
                  "additionalProperties": true
                }
              },
              "required": [
                "surfaceId"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "updateDataModel",
            "version"
          ],
          "additionalProperties": false
        },
        "DeleteSurfaceMessage": {
          "type": "object",
          "properties": {
            "version": {
              "enum": [
                "v0.9",
                "v0.9.1"
              ]
            },
            "deleteSurface": {
              "type": "object",
              "description": "Signals the client to delete the surface identified by \
    'surfaceId'. A createSurface message MUST have been previously sent for the 'surfaceId' in \
    this message; the surface's catalog is the one specified by that createSurface.",
              "properties": {
                "surfaceId": {
                  "type": "string",
                  "description": "The unique identifier for the UI surface to be deleted."
                }
              },
              "required": [
                "surfaceId"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "deleteSurface",
            "version"
          ],
          "additionalProperties": false
        }
      }
    }
    """
}
