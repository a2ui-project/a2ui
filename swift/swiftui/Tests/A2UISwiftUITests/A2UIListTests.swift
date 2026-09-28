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
import SwiftUI
import Testing

@MainActor
struct A2UIListTests {

  @Test func verticalListInitializesWithAlignAndChildren() {
    let child1 = Node(id: "c1", type: "Text", properties: ["text": "First"])
    let child2 = Node(id: "c2", type: "Text", properties: ["text": "Second"])
    let node = Node(
      id: "list1",
      type: "List",
      properties: [
        "direction": "vertical",
        "align": "center",
        "children": [child1, child2],
      ]
    )

    let view = A2UIList(node: node)
    #expect(node.string(for: "direction") == "vertical")
    #expect(node.string(for: "align") == "center")
    #expect(node.children(for: "children").count == 2)
    _ = view.body
  }

  @Test func horizontalListInitializesWithAlign() {
    let child1 = Node(id: "c1", type: "Text", properties: ["text": "Card A"])
    let node = Node(
      id: "list2",
      type: "List",
      properties: [
        "direction": "horizontal",
        "align": "start",
        "children": [child1],
      ]
    )

    let view = A2UIList(node: node)
    #expect(node.string(for: "direction") == "horizontal")
    #expect(node.string(for: "align") == "start")
    _ = view.body
  }

  @Test func listRendersFromCatalog() throws {
    let catalog = BasicCatalogImplementation.v091Catalog

    let child = Node(id: "c1", type: "Text", properties: ["text": "Item"])
    let node = Node(
      id: "listCatalog",
      type: "List",
      properties: [
        "direction": "vertical",
        "align": "stretch",
        "children": [child],
      ]
    )

    let rendered = Surface.render(node: node, using: [catalog.id: catalog])
    #expect(rendered != nil)
  }
}
