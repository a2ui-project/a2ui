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
  // MARK: - Image
  public static let image = AnyComponentAPI(
    name: "Image",
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "component": {
              "const": "Image"
            },
            "url": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString",
              "description": "The URL of the image to display."
            },
            "description": {
              "$ref": "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DynamicString",
              "description": "Accessibility text for the image."
            },
            "fit": {
              "type": "string",
              "description": "Specifies how the image should be resized to fit its container. This corresponds to the CSS 'object-fit' property.",
              "enum": [
                "contain",
                "cover",
                "fill",
                "none",
                "scaleDown"
              ],
              "default": "fill"
            },
            "variant": {
              "type": "string",
              "description": "A hint for the image size and style.",
              "enum": [
                "icon",
                "avatar",
                "smallFeature",
                "mediumFeature",
                "largeFeature",
                "header"
              ],
              "default": "mediumFeature"
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
            "url"
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  )
}
