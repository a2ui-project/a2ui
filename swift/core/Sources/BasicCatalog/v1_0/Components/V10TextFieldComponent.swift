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
  // MARK: - TextField (v1.0)
  public static let textField = AnyComponentAPI(
    name: "TextField",
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "allOf": [
            {
              "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Checkable"
            },
            {
              "type": "object",
              "properties": {
                "component": {
                  "const": "TextField"
                },
                "label": {
                  "$ref": \
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicString",
                  "description": "The text label for the input field."
                },
                "value": {
                  "$ref": \
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicString",
                  "description": "The value of the text field."
                },
                "placeholder": {
                  "$ref": \
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicString",
                  "description": "The placeholder text for the input field."
                },
                "variant": {
                  "type": "string",
                  "description": "The type of input field to display.",
                  "enum": [
                    "longText",
                    "number",
                    "shortText",
                    "obscured"
                  ],
                  "default": "shortText"
                },
                "weight": {
                  "type": "number",
                  "description": "The relative weight of this component within a Row or Column. \
        This is similar to the CSS 'flex-grow' property. Note: this may ONLY be set when the \
        component is a direct descendant of a Row or Column."
                },
                "id": {
                  "$ref": \
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId"
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
              "required": [
                "component",
                "label"
              ]
            }
          ],
          "unevaluatedProperties": false
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  )
}
