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
  // MARK: - List
  public static let list = AnyComponentAPI(
    name: "List",
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "component": {
              "const": "List"
            },
            "children": {
              "description": "Defines the children. Use an array of strings for a fixed set of children, or a template object to generate children from a data list.",
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/ChildList"
            },
            "direction": {
              "type": "string",
              "description": "The direction in which the list items are laid out.",
              "enum": [
                "vertical",
                "horizontal"
              ],
              "default": "vertical"
            },
            "align": {
              "type": "string",
              "description": "Defines the alignment of children along the cross axis.",
              "enum": [
                "start",
                "center",
                "end",
                "stretch"
              ],
              "default": "stretch"
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
            "children"
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  )
}
