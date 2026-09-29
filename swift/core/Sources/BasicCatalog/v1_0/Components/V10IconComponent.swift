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
  // MARK: - Icon (v1.0)
  public static let icon = AnyComponentAPI(
    name: "Icon",
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "component": {
              "const": "Icon"
            },
            "name": {
              "description": "The name of the icon to display.",
              "oneOf": [
                {
                  "type": "string",
                  "enum": [
                    "accountCircle",
                    "add",
                    "arrowBack",
                    "arrowForward",
                    "attachFile",
                    "calendarToday",
                    "call",
                    "camera",
                    "check",
                    "close",
                    "delete",
                    "download",
                    "edit",
                    "event",
                    "error",
                    "fastForward",
                    "favorite",
                    "favoriteOff",
                    "folder",
                    "help",
                    "home",
                    "info",
                    "locationOn",
                    "lock",
                    "lockOpen",
                    "mail",
                    "menu",
                    "moreVert",
                    "moreHoriz",
                    "notificationsOff",
                    "notifications",
                    "pause",
                    "payment",
                    "person",
                    "phone",
                    "photo",
                    "play",
                    "print",
                    "refresh",
                    "rewind",
                    "search",
                    "send",
                    "settings",
                    "share",
                    "shoppingCart",
                    "skipNext",
                    "skipPrevious",
                    "star",
                    "starHalf",
                    "starOff",
                    "stop",
                    "upload",
                    "visibility",
                    "visibilityOff",
                    "volumeDown",
                    "volumeMute",
                    "volumeOff",
                    "volumeUp",
                    "warning"
                  ]
                },
                {
                  "type": "object",
                  "properties": {
                    "svgPath": {
                      "$ref": \
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicString"
                    }
                  },
                  "required": [
                    "svgPath"
                  ],
                  "additionalProperties": false
                },
                {
                  "$ref": \
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DataBinding"
                }
              ]
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
            "name"
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  )
}
