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

import A2UICore
import A2UIJSON
import JSONSchema

extension V10BasicCatalogComponents {
  // MARK: - Row (v1.0)
  public static let row = AnyComponentAPI(
    name: "Row",
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "component": {
              "const": "Row"
            },
            "children": {
              "description": "Defines the children. Use an array of strings for a fixed set of \
        children, or a template object to generate children from a data list. Children cannot be \
        defined inline, they must be referred to by ID.",
              "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList"
            },
            "justify": {
              "type": "string",
              "description": "Defines the arrangement of children along the main axis \
        (horizontally). Use 'spaceBetween' to push items to the edges, or 'start'/'end'/'center' \
        to pack them together.",
              "enum": [
                "center",
                "end",
                "spaceAround",
                "spaceBetween",
                "spaceEvenly",
                "start",
                "stretch"
              ],
              "default": "start"
            },
            "align": {
              "type": "string",
              "description": "Defines the alignment of children along the cross axis \
        (vertically). This is similar to the CSS 'align-items' property, but uses camelCase \
        values (e.g., 'start').",
              "enum": [
                "start",
                "center",
                "end",
                "stretch"
              ],
              "default": "stretch"
            },
            "weight": {
              "type": "number",
              "description": "The relative weight of this component within a Row or Column. This \
        is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the \
        component is a direct descendant of a Row or Column."
            },
            "id": {
              "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId"
            },
            "catalogId": {
              "type": "string"
            },
            "accessibility": {
              "$ref": \
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/AccessibilityAttributes"
            },
            "metadata": {
              "type": "object",
              "properties": {
                "extensions": {
                  "$ref": \
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Extensions"
                }
              },
              "additionalProperties": false
            }
          },
          "unevaluatedProperties": false,
          "required": [
            "component",
            "children"
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  )
}
