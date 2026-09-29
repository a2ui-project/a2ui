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
  // MARK: - Button (v1.0)
  public static let button = AnyComponentAPI(
    name: "Button",
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
                  "const": "Button"
                },
                "child": {
                  "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Child",
                  "description": "The ID of the child component. Use a 'Text' component for a \
        labeled button. Only use an 'Icon' if the requirements explicitly ask for an icon-only \
        button."
                },
                "variant": {
                  "type": "string",
                  "description": "A hint for the button style. If omitted, a default button \
        style is used. 'primary' indicates this is the main call-to-action button. 'borderless' \
        means the button has no visual border or background, making its child content appear \
        like a clickable link.",
                  "enum": [
                    "default",
                    "primary",
                    "borderless"
                  ],
                  "default": "default"
                },
                "action": {
                  "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Action"
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
                "child",
                "action"
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
