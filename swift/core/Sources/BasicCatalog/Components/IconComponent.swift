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
  // MARK: - Icon
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
                      "type": "string"
                    }
                  },
                  "required": [
                    "svgPath"
                  ],
                  "additionalProperties": false
                },
                {
                  "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding"
                }
              ]
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
            "name"
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  )
}
