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
  // MARK: - CheckBox
  public static let checkBox = AnyComponentAPI(
    name: "CheckBox",
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
                  "const": "CheckBox"
                },
                "label": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString",
                  "description": "The text to display next to the checkbox."
                },
                "value": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicBoolean",
                  "description": "The current state of the checkbox (true for checked, false for unchecked)."
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
                "label",
                "value"
              ]
            }
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  )
}
