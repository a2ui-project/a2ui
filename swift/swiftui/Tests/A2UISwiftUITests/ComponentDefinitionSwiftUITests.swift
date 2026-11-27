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
import OrderedJSON
import SwiftUI
import Testing

/// Verifies authoring custom SwiftUI ``ComponentImplementation`` views purely with canonical
/// ``ComponentDefinition`` and ``ParameterDefinition`` builders — without importing `JSONSchema`.
@MainActor
struct ComponentDefinitionSwiftUITests {

  @Test func customSwiftUIComponentAuthoredWithoutJSONSchemaRendersEndToEnd() throws {
    let cardImplementation = ComponentImplementation(
      definition: ComponentDefinition(
        name: "BannerCard",
        description: "Displays a dynamic headline above a single child.",
        parameters: [
          .string("headline", dynamic: true, required: true),
          .enum("tone", values: ["info", "warning"], defaultValue: "info"),
          .child("body", required: true),
        ]
      )
    ) { node in
      VStack {
        Text(node.string(for: "headline") ?? "")
        if let bodyChild = node.child(for: "body") {
          ComponentNodeView(node: bodyChild)
        }
      }
    }

    let badgeImplementation = ComponentImplementation(
      definition: ComponentDefinition(
        name: "StatusBadge",
        isCheckable: true,
        parameters: [
          .string("label", dynamic: true, required: true)
        ]
      )
    ) { node in
      Text(node.string(for: "label") ?? "")
    }

    #expect(cardImplementation.definition.isCanonical)
    #expect(badgeImplementation.definition.isCanonical)
    #expect(badgeImplementation.definition.isCheckable)

    let catalog = Catalog(
      id: "https://example.com/catalogs/swiftui-canonical",
      protocolVersion: .v10,
      components: [cardImplementation, badgeImplementation]
    )

    // Erasing to AnyCatalog preserves canonical definitions without compiling JSON Schema.
    let erased = catalog.eraseToAnyCatalog()
    #expect(erased.components["BannerCard"]?.definition.isCanonical == true)
    #expect(erased.components["StatusBadge"]?.definition.isCanonical == true)

    let processor = MessageProcessor(catalog: catalog, validationConfig: .strict)
    let payload: JSONValue = [
      [
        "version": "1.0",
        "createSurface": [
          "surfaceId": "main",
          "catalogId": .string(catalog.id),
        ],
      ],
      [
        "version": "1.0",
        "updateDataModel": [
          "surfaceId": "main",
          "path": "/",
          "value": ["heading": "Launch Ready", "status": "Green"],
        ],
      ],
      [
        "version": "1.0",
        "updateComponents": [
          "surfaceId": "main",
          "components": [
            [
              "id": "root",
              "component": "BannerCard",
              "headline": ["@path": "/heading"],
              "tone": "info",
              "body": "statusBadge",
            ],
            [
              "id": "statusBadge",
              "component": "StatusBadge",
              "label": ["@path": "/status"],
            ],
          ],
        ],
      ],
    ]

    try processor.processMessages(payload)

    let viewModel = try #require(processor.surfaceGroupModel["main"])
    let rootNode = try #require(viewModel.rootNode)
    #expect(rootNode.type == "BannerCard")
    #expect(rootNode.string(for: "headline") == "Launch Ready")

    let childNode = try #require(rootNode.child(for: "body"))
    #expect(childNode.type == "StatusBadge")
    #expect(childNode.string(for: "label") == "Green")

    let catalogMap = [catalog.id: catalog]
    let resolvedImpl = Surface.implementation(
      for: rootNode,
      using: catalogMap,
      defaultCatalogID: catalog.id
    )
    #expect(resolvedImpl?.name == "BannerCard")
    #expect(Surface.render(node: rootNode, using: catalogMap, defaultCatalogID: catalog.id) != nil)
    #expect(Surface.render(node: childNode, using: catalogMap, defaultCatalogID: catalog.id) != nil)
  }
}
