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
import A2UISwiftUI
import BasicCatalog
import BasicCatalogSwiftUI
import Foundation
import OrderedJSON
import SwiftUI
import Testing

@MainActor
struct A2UIIconTests {

  @Test func iconInitializesWithSymbolName() {
    let node = Node(
      id: "icon1",
      type: "Icon",
      properties: ["name": "star"]
    )

    let view = A2UIIcon(node: node)
    _ = view.body
  }

  @Test func iconInitializesWithSVGPath() {
    let node = Node(
      id: "iconSVG",
      type: "Icon",
      properties: [
        "name": ResolvedDictionary([
          "svgPath": "M10 10 H 90 V 90 H 10 Z"
        ])
      ]
    )

    let view = A2UIIcon(node: node)
    _ = view.body
  }

  @Test func svgPathParserParsesCommands() {
    let path = SVGPathParser.parse(
      "M0 0 L10 10 H20 V30 C1 2 3 4 5 6 S7 8 9 10 Q11 12 13 14 T15 16 Z")
    #expect(!path.isEmpty)
  }

  @Test func iconDataBoundSVGPathRendersEndToEnd() async throws {
    let catalog = Catalog(
      id: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
      components: BasicCatalogComponents.allComponents
    )
    let processor = MessageProcessor(catalogs: [catalog])
    let group = processor.surfaceGroupModel
    let parser = MessageParser()

    // Step 1: Create surface
    let createMsg: [String: Any] = [
      "version": "v0.9",
      "createSurface": [
        "surfaceId": "test-svg",
        "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        "sendDataModel": true,
      ],
    ]
    let cData = try JSONSerialization.data(withJSONObject: createMsg)
    processor.process(message: try parser.decode(jsonData: cData))

    // Step 2: updateComponents with data-bound name
    let updateCompMsg: [String: Any] = [
      "version": "v0.9",
      "updateComponents": [
        "surfaceId": "test-svg",
        "components": [
          [
            "id": "root",
            "component": "Icon",
            "name": [
              "path": "/shieldIcon"
            ],
          ]
        ],
      ],
    ]
    let uData = try JSONSerialization.data(withJSONObject: updateCompMsg)
    processor.process(message: try parser.decode(jsonData: uData))

    await Task.yield()
    let surface = try #require(group.surfacesMap["test-svg"])
    let nodeBefore = try #require(surface.rootNode)
    #expect(nodeBefore.id == "root")

    // Step 3: updateDataModel
    let updateDataMsg: [String: Any] = [
      "version": "v0.9",
      "updateDataModel": [
        "surfaceId": "test-svg",
        "value": [
          "shieldIcon": [
            "svgPath":
              "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16"
              + "l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"
          ]
        ],
      ],
    ]
    let dData = try JSONSerialization.data(withJSONObject: updateDataMsg)
    processor.process(message: try parser.decode(jsonData: dData))

    await Task.yield()
    let nodeAfter = try #require(surface.rootNode)
    let iconView = A2UIIcon(node: nodeAfter)
    #expect(
      iconView.iconSource
        == A2UIIcon.IconSource.svg(
          "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16"
            + "l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"
        ))
  }
}
