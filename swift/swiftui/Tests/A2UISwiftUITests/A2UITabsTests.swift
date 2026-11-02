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
struct A2UITabsTests {

  @Test func resolvesTabTitlesFromBindingsAndSelectsFirstTabContent() {
    let firstChild = Node(id: "tab1_body", type: "Text", properties: ["text": "Overview body"])
    let secondChild = Node(id: "tab2_body", type: "Text", properties: ["text": "Details body"])

    let firstTab = ResolvedDictionary([
      "title": DataBinding<String>(
        identity: .path("/tabs/first"),
        value: "Overview",
        set: { _ in }
      ),
      "child": firstChild,
    ])
    let secondTab = ResolvedDictionary([
      "title": DataBinding<String>(
        identity: .path("/tabs/second"),
        value: "Details",
        set: { _ in }
      ),
      "child": secondChild,
    ])

    let tabsNode = Node(
      id: "tabs1",
      type: "Tabs",
      properties: [
        "tabs": ResolvedArray([firstTab, secondTab])
      ]
    )

    #expect(resolvedTabTitles(in: tabsNode) == ["Overview", "Details"])

    var selectedTab = 0
    let selection = Binding(get: { selectedTab }, set: { selectedTab = $0 })
    let view = A2UITabs(node: tabsNode, selectedIndex: selection)

    var renderedChildIDs: [String] = []
    collectComponentNodeIDs(in: view.body, into: &renderedChildIDs)
    #expect(renderedChildIDs == ["tab1_body"])

    selectedTab = 1
    var secondRenderedChildIDs: [String] = []
    collectComponentNodeIDs(in: view.body, into: &secondRenderedChildIDs)
    #expect(secondRenderedChildIDs == ["tab2_body"])
  }

  @Test func boundTabTitlesUpdateWithDataModelAndSelectionSwitchesActiveChild() async throws {
    let processor = MessageProcessor(catalogs: [V10BasicCatalog.catalog])
    let parser = MessageParser()
    let initialMessages: [[String: Any]] = [
      [
        "version": "1.0",
        "createSurface": [
          "surfaceId": "tabs-surface",
          "catalogId": V10BasicCatalog.catalogURI,
        ],
      ],
      [
        "version": "1.0",
        "updateComponents": [
          "surfaceId": "tabs-surface",
          "components": [
            [
              "id": "root",
              "component": "Tabs",
              "tabs": [
                ["title": ["@path": "/firstTitle"], "child": "pane_a"],
                ["title": ["@path": "/secondTitle"], "child": "pane_b"],
              ],
            ],
            ["id": "pane_a", "component": "Text", "text": "Pane A"],
            ["id": "pane_b", "component": "Text", "text": "Pane B"],
          ],
        ],
      ],
      [
        "version": "1.0",
        "updateDataModel": [
          "surfaceId": "tabs-surface",
          "value": ["firstTitle": "Summary", "secondTitle": "Metrics"],
        ],
      ],
    ]

    for message in initialMessages {
      let data = try JSONSerialization.data(withJSONObject: message)
      processor.process(message: try parser.decode(jsonData: data))
    }
    await Task.yield()

    let surface = try #require(processor.surfaceGroupModel.surfacesMap["tabs-surface"])
    let rootBefore = try #require(surface.rootNode)
    #expect(resolvedTabTitles(in: rootBefore) == ["Summary", "Metrics"])

    var selectedTab = 0
    let selection = Binding(get: { selectedTab }, set: { selectedTab = $0 })
    let viewBefore = A2UITabs(node: rootBefore, selectedIndex: selection)

    var activeBefore: [String] = []
    collectComponentNodeIDs(in: viewBefore.body, into: &activeBefore)
    #expect(activeBefore == ["pane_a"])

    // Switch tab selection from 0 to 1 without reordering the tabs array.
    selectedTab = 1
    var activeAfterSelectionChange: [String] = []
    collectComponentNodeIDs(in: viewBefore.body, into: &activeAfterSelectionChange)
    #expect(activeAfterSelectionChange == ["pane_b"])

    // Update the bound title in the data model while keeping selection on tab 1.
    let updateMessage: [String: Any] = [
      "version": "1.0",
      "updateDataModel": [
        "surfaceId": "tabs-surface",
        "path": "/firstTitle",
        "value": "Updated Summary",
      ],
    ]
    let updateData = try JSONSerialization.data(withJSONObject: updateMessage)
    processor.process(message: try parser.decode(jsonData: updateData))
    await Task.yield()

    let rootAfter = try #require(surface.rootNode)
    #expect(resolvedTabTitles(in: rootAfter) == ["Updated Summary", "Metrics"])

    let viewAfter = A2UITabs(node: rootAfter, selectedIndex: selection)
    var activeAfterDataUpdate: [String] = []
    collectComponentNodeIDs(in: viewAfter.body, into: &activeAfterDataUpdate)
    #expect(activeAfterDataUpdate == ["pane_b"])
  }

  @Test func tabsRenderFromCatalogs() throws {
    for version in [A2UIProtocolVersion.v091, .v10] {
      let catalog = BasicCatalogImplementation.makeCatalog(version: version)
      let child = Node(id: "tab_child", type: "Text", properties: ["text": "Body"])
      let node = Node(
        id: "tabsCatalog_\(version.rawValue)",
        type: "Tabs",
        catalogID: catalog.id,
        properties: [
          "tabs": ResolvedArray([
            ResolvedDictionary(["title": "First", "child": child])
          ])
        ]
      )
      let rendered = Surface.render(node: node, using: [catalog.id: catalog])
      #expect(rendered != nil)
    }
  }

  private func resolvedTabTitles(in node: Node) -> [String] {
    guard let array = node.array(for: "tabs") else { return [] }
    return array.enumerated().map { index, element in
      let dict = element as? ResolvedDictionary
      return (dict?["title"] as? String)
        ?? (dict?["title"] as? DataBinding<String>)?.value
        ?? "Tab \(index + 1)"
    }
  }

  private func collectComponentNodeIDs(in value: Any, into ids: inout [String]) {
    if let nodeView = value as? ComponentNodeView {
      ids.append(nodeView.node.id)
      return
    }
    for child in Mirror(reflecting: value).children {
      collectComponentNodeIDs(in: child.value, into: &ids)
    }
  }
}
