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

import A2UICore
import A2UIJSON
import JSONSchema

extension BasicCatalogComponents {
  // MARK: - Slider
  public static let slider = AnyComponentAPI(
    name: "Slider",
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "allOf": [
            {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/Checkable"
            },
            {
              "type": "object",
              "properties": {
                "component": {
                  "const": "Slider"
                },
                "label": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString",
                  "description": "The label for the slider."
                },
                "min": {
                  "type": "number",
                  "description": "The minimum value of the slider.",
                  "default": 0
                },
                "max": {
                  "type": "number",
                  "description": "The maximum value of the slider."
                },
                "value": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicNumber",
                  "description": "The current value of the slider."
                },
                "id": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ComponentId"
                },
                "accessibility": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/AccessibilityAttributes"
                },
                "weight": {
                  "type": "number"
                }
              },
              "required": [
                "component",
                "value",
                "max"
              ]
            }
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  )
}
