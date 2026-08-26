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
  // MARK: - ChoicePicker
  public static let choicePicker = AnyComponentAPI(
    name: "ChoicePicker",
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
                  "const": "ChoicePicker"
                },
                "label": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString",
                  "description": "The label for the group of options."
                },
                "variant": {
                  "type": "string",
                  "description": "A hint for how the choice picker should be displayed and behave.",
                  "enum": [
                    "multipleSelection",
                    "mutuallyExclusive"
                  ],
                  "default": "mutuallyExclusive"
                },
                "options": {
                  "type": "array",
                  "description": "The list of available options to choose from.",
                  "items": {
                    "type": "object",
                    "properties": {
                      "label": {
                        "description": "The text to display for this option.",
                        "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"
                      },
                      "value": {
                        "type": "string",
                        "description": "The stable value associated with this option."
                      }
                    },
                    "required": [
                      "label",
                      "value"
                    ],
                    "additionalProperties": false
                  }
                },
                "value": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicStringList",
                  "description": "The list of currently selected values. This should be bound to a string array in the data model."
                },
                "displayStyle": {
                  "type": "string",
                  "description": "The display style of the component.",
                  "enum": [
                    "checkbox",
                    "chips"
                  ],
                  "default": "checkbox"
                },
                "filterable": {
                  "type": "boolean",
                  "description": "If true, displays a search input to filter the options.",
                  "default": false
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
                "options",
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
