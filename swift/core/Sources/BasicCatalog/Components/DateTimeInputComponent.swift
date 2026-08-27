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
  // MARK: - DateTimeInput
  public static let dateTimeInput = AnyComponentAPI(
    name: "DateTimeInput",
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
                  "const": "DateTimeInput"
                },
                "value": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString",
                  "description": "The selected date and/or time value in ISO 8601 format. If not yet set, initialize with an empty string."
                },
                "enableDate": {
                  "type": "boolean",
                  "description": "If true, allows the user to select a date.",
                  "default": false
                },
                "enableTime": {
                  "type": "boolean",
                  "description": "If true, allows the user to select a time.",
                  "default": false
                },
                "min": {
                  "allOf": [
                    {
                      "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"
                    },
                    {
                      "if": {
                        "type": "string"
                      },
                      "then": {
                        "oneOf": [
                          {
                            "format": "date"
                          },
                          {
                            "format": "time"
                          },
                          {
                            "format": "date-time"
                          }
                        ]
                      }
                    }
                  ],
                  "description": "The minimum allowed date/time in ISO 8601 format."
                },
                "max": {
                  "allOf": [
                    {
                      "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString"
                    },
                    {
                      "if": {
                        "type": "string"
                      },
                      "then": {
                        "oneOf": [
                          {
                            "format": "date"
                          },
                          {
                            "format": "time"
                          },
                          {
                            "format": "date-time"
                          }
                        ]
                      }
                    }
                  ],
                  "description": "The maximum allowed date/time in ISO 8601 format."
                },
                "label": {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString",
                  "description": "The text label for the input field."
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
