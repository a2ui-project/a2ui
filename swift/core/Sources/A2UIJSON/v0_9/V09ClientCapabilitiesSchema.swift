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

/// A2UI v0.9 / v0.9.1 client capabilities JSON Schema.
public enum V09ClientCapabilitiesSchema {
  /// The canonical URI for this schema document.
  public static let schemaURI =
    "https://a2ui.org/specification/v0_9/client_capabilities.json"

  /// The parsed JSON Schema document as a `JSONValue`.
  public static let document: JSONValue = parseEmbedded(rawDocument)

  private static func parseEmbedded(_ raw: String) -> JSONValue {
    do {
      return try JSONValue.parse(raw)
    } catch {
      assertionFailure("Failed to parse embedded V09ClientCapabilitiesSchema document: \(error)")
      return .object([:])
    }
  }

  private static let rawDocument = """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/specification/v0_9/client_capabilities.json",
      "title": "A2UI Client Capabilities Schema",
      "description": "A schema for the a2uiClientCapabilities object, which is sent from the \
    client to the server as part of the A2A metadata to describe the client's UI rendering \
    capabilities.",
      "type": "object",
      "properties": {
        "v0.9": {
          "type": "object",
          "description": "The capabilities structure for version 0.9 of the A2UI protocol.",
          "properties": {
            "supportedCatalogIds": {
              "type": "array",
              "description": "An array of string identifiers for each of the component and \
    function catalogs supported by the client.",
              "items": {
                "type": "string"
              }
            },
            "inlineCatalogs": {
              "type": "array",
              "description": "An array of inline catalog definitions, which can contain both \
    components and functions. This should only be provided if the agent declares \
    'acceptsInlineCatalogs: true' in its capabilities.",
              "items": {
                "$ref": "#/$defs/Catalog"
              }
            }
          },
          "required": [
            "supportedCatalogIds"
          ]
        }
      },
      "required": [
        "v0.9"
      ],
      "$defs": {
        "FunctionDefinition": {
          "type": "object",
          "description": "Describes a function's interface.",
          "properties": {
            "name": {
              "type": "string",
              "description": "The unique name of the function."
            },
            "description": {
              "type": "string",
              "description": "A human-readable description of what the function does and how to \
    use it."
            },
            "parameters": {
              "type": "object",
              "description": "A JSON Schema describing the expected arguments (args) for this \
    function.",
              "$ref": "https://json-schema.org/draft/2020-12/schema"
            },
            "returnType": {
              "type": "string",
              "enum": [
                "string",
                "number",
                "boolean",
                "array",
                "object",
                "any",
                "void"
              ],
              "description": "The type of value this function returns."
            }
          },
          "required": [
            "name",
            "parameters",
            "returnType"
          ],
          "additionalProperties": false
        },
        "Catalog": {
          "type": "object",
          "description": "A collection of component and function definitions.",
          "properties": {
            "catalogId": {
              "type": "string",
              "description": "Unique identifier for this catalog."
            },
            "components": {
              "type": "object",
              "description": "Definitions for UI components supported by this catalog.",
              "additionalProperties": {
                "$ref": "https://json-schema.org/draft/2020-12/schema"
              }
            },
            "functions": {
              "type": "array",
              "description": "Definitions for functions supported by this catalog.",
              "items": {
                "$ref": "#/$defs/FunctionDefinition"
              }
            },
            "theme": {
              "title": "A2UI Theme",
              "description": "A schema that defines a catalog of A2UI theme properties. Each key \
    is a theme property name (e.g. 'primaryColor'), and each value is the JSON schema for that \
    property.",
              "type": "object",
              "additionalProperties": {
                "$ref": "https://json-schema.org/draft/2020-12/schema"
              }
            }
          },
          "required": [
            "catalogId"
          ],
          "additionalProperties": false
        }
      }
    }
    """
}
