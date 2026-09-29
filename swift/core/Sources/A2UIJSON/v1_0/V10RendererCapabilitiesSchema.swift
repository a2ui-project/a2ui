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

/// A2UI v1.0 renderer capabilities JSON Schema.
public enum V10RendererCapabilitiesSchema {
  /// The canonical URI for this schema document.
  public static let schemaURI =
    "https://a2ui.org/specification/v1_0/renderer_capabilities.json"

  /// The parsed JSON Schema document as a `JSONValue`.
  public static let document: JSONValue = parseEmbedded(rawDocument)

  private static func parseEmbedded(_ raw: String) -> JSONValue {
    do {
      return try JSONValue.parse(raw)
    } catch {
      assertionFailure("Failed to parse embedded V10RendererCapabilitiesSchema document: \(error)")
      return .object([:])
    }
  }

  private static let rawDocument = """
    {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/specification/v1_0/renderer_capabilities.json",
      "title": "A2UI Renderer Capabilities Schema",
      "description": "A schema for the a2uiRendererCapabilities object, which is sent from the \
    renderer to the agent as part of the A2A metadata to describe the renderer's UI rendering \
    capabilities.",
      "type": "object",
      "properties": {
        "v1.0": {
          "type": "object",
          "description": "The capabilities structure for version 1.0 of the A2UI protocol.",
          "properties": {
            "supportedCatalogIds": {
              "type": "array",
              "description": "An array of string identifiers for each of the component and \
    function catalogs supported by the renderer. Multiple catalogs can be mixed in a single \
    surface.",
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
                "$ref": "https://a2ui.org/specification/v1_0/catalog_definition.json"
              }
            }
          },
          "required": [
            "supportedCatalogIds"
          ]
        }
      },
      "required": [
        "v1.0"
      ]
    }
    """
}
