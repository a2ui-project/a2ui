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
import JSONSchema
import SwiftUI
import Testing

@testable import BasicCatalogSwiftUI

@MainActor
struct RenderedChildrenTests {

  @Test func leavesOutChildrenWithNoViewBuilder() {
    let catalog = BasicCatalogImplementation.makeCatalog(version: .v091)
    let node = Node(
      id: "col",
      type: "Column",
      properties: [
        "children": [
          Node(id: "a", type: "Text", properties: ["text": "A"]),
          Node(id: "x", type: "StarRating", properties: [:]),
          Node(id: "b", type: "Text", properties: ["text": "B"]),
        ]
      ]
    )

    let ids = node.renderedChildren(
      for: "children", in: [catalog.id: catalog], defaultCatalogID: catalog.id
    ).map(\.id)
    #expect(ids == ["a", "b"])
  }

  @Test func keepsChildrenThatAnotherCatalogRenders() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let basic = BasicCatalogImplementation.makeCatalog(version: .v091)
    let maps = Catalog(
      id: "maps",
      components: [
        ComponentImplementation(name: "Map", schema: schema) { _ in AnyView(EmptyView()) }
      ]
    )
    let catalogs = [basic.id: basic, maps.id: maps]
    let map = Node(id: "m", type: "Map", properties: [:])
    let node = Node(
      id: "col",
      type: "Column",
      properties: [
        "children": [
          Node(id: "a", type: "Text", properties: ["text": "A"]),
          map,
          Node(id: "x", type: "StarRating", properties: [:]),
        ]
      ]
    )

    let ids = node.renderedChildren(for: "children", in: catalogs, defaultCatalogID: basic.id)
      .map(\.id)
    #expect(ids == ["a", "m"])
    #expect(Surface.render(node: map, using: catalogs, defaultCatalogID: basic.id) != nil)
  }
}
