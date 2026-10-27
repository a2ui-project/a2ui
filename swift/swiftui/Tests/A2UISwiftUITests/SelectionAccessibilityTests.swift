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
import SwiftUI
import Testing

@MainActor
struct SelectionAccessibilityTests {

  // MARK: - Helpers

  /// Creates a v1.0 surface from the given components and returns its view model.
  private func makeSurface(
    components: [[String: Any]],
    dataModel: [String: Any]? = nil
  ) async throws -> (MessageProcessor, SurfaceViewModel) {
    let processor = MessageProcessor(catalogs: [V10BasicCatalog.catalog])
    var messages: [[String: Any]] = [
      [
        "version": "v1.0",
        "createSurface": [
          "surfaceId": "selection",
          "catalogId": V10BasicCatalog.catalogURI,
        ],
      ],
      [
        "version": "v1.0",
        "updateComponents": ["surfaceId": "selection", "components": components],
      ],
    ]
    if let dataModel {
      messages.append([
        "version": "v1.0",
        "updateDataModel": ["surfaceId": "selection", "value": dataModel],
      ])
    }
    try process(messages, with: processor)
    await Task.yield()
    let surface = try #require(processor.surfaceGroupModel.surfacesMap["selection"])
    return (processor, surface)
  }

  private func process(_ messages: [[String: Any]], with processor: MessageProcessor) throws {
    let parser = MessageParser()
    for message in messages {
      let data = try JSONSerialization.data(withJSONObject: message)
      processor.process(message: try parser.decode(jsonData: data))
    }
  }

  /// Finds a node by ID in the resolved tree of the surface.
  private func node(_ id: String, in surface: SurfaceViewModel) throws -> Node {
    var pending = [try #require(surface.rootNode)]
    while let current = pending.popLast() {
      if current.id == id { return current }
      pending.append(contentsOf: current.allChildNodes)
    }
    Issue.record("Node '\(id)' not found")
    throw CancellationError()
  }

  private func choicePickerSurface(
    variant: String,
    displayStyle: String,
    selected: [String]
  ) async throws -> SurfaceViewModel {
    let (_, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "ChoicePicker", "label": "Preference",
          "variant": variant, "displayStyle": displayStyle,
          "options": [
            ["label": "Option 1", "value": "1"],
            ["label": "Option 2", "value": "2"],
            ["label": "Option 3", "value": "3"],
          ],
          "value": ["@path": "/choice"],
        ]
      ],
      dataModel: ["choice": selected]
    )
    return surface
  }

  /// The selection binding of a picker option, read from the current resolved tree so it sees the
  /// latest data model, as a re-rendered view would.
  private func option(
    _ value: String,
    in surface: SurfaceViewModel
  ) async throws -> Binding<Bool> {
    await Task.yield()
    return A2UIChoicePicker(node: try node("root", in: surface)).selectionBinding(
      forOptionValue: value)
  }

  private func selection(in surface: SurfaceViewModel) -> [String]? {
    surface.dataModel.get("/choice")?.arrayValue?.compactMap(\.stringValue)
  }

  // MARK: - CheckBox

  @Test func checkBoxToggleBindingFollowsTheDataModel() async throws {
    let (processor, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "CheckBox", "label": "I agree to terms",
          "value": ["@path": "/agree"],
        ]
      ],
      dataModel: ["agree": true]
    )
    #expect(A2UICheckBox(node: try node("root", in: surface)).isOn.wrappedValue)

    try process(
      [
        [
          "version": "v1.0",
          "updateDataModel": ["surfaceId": "selection", "path": "/agree", "value": false],
        ]
      ],
      with: processor
    )
    await Task.yield()

    #expect(!A2UICheckBox(node: try node("root", in: surface)).isOn.wrappedValue)
  }

  /// The binding behind the checkbox's accessibility toggle writes back like a tap does, so
  /// toggling the checkbox with assistive technologies updates the data model.
  @Test func checkBoxToggleBindingWritesTheDataModel() async throws {
    let (_, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "CheckBox", "label": "I agree to terms",
          "value": ["@path": "/agree"],
          "accessibility": ["label": "Accept Terms and Conditions"],
        ]
      ],
      dataModel: ["agree": false]
    )
    let checkBox = A2UICheckBox(node: try node("root", in: surface))

    checkBox.isOn.wrappedValue = true
    #expect(surface.dataModel.get("/agree")?.boolValue == true)
    #expect(A2UICheckBox(node: try node("root", in: surface)).isOn.wrappedValue)

    checkBox.isOn.wrappedValue = false
    #expect(surface.dataModel.get("/agree")?.boolValue == false)
  }

  // MARK: - ChoicePicker

  @Test func multipleSelectionOptionBindingsToggleTheirOption() async throws {
    for displayStyle in ["checkbox", "chips"] {
      let surface = try await choicePickerSurface(
        variant: "multipleSelection", displayStyle: displayStyle, selected: ["1", "3"])
      #expect(try await option("1", in: surface).wrappedValue)
      #expect(try await option("2", in: surface).wrappedValue == false)

      try await option("2", in: surface).wrappedValue = true
      #expect(selection(in: surface) == ["1", "3", "2"])

      try await option("1", in: surface).wrappedValue = false
      #expect(selection(in: surface) == ["3", "2"])

      // Setting an option to the state it already has leaves the selection alone.
      try await option("3", in: surface).wrappedValue = true
      try await option("1", in: surface).wrappedValue = false
      #expect(selection(in: surface) == ["3", "2"])
    }
  }

  @Test func mutuallyExclusiveOptionBindingsSelectOneOption() async throws {
    for displayStyle in ["checkbox", "chips"] {
      let surface = try await choicePickerSurface(
        variant: "mutuallyExclusive", displayStyle: displayStyle, selected: ["2"])
      #expect(try await option("2", in: surface).wrappedValue)
      #expect(try await option("1", in: surface).wrappedValue == false)

      try await option("1", in: surface).wrappedValue = true
      #expect(selection(in: surface) == ["1"])

      // A radio option cannot be deselected; another option has to be picked instead.
      try await option("1", in: surface).wrappedValue = false
      #expect(selection(in: surface) == ["1"])
    }
  }

  // MARK: - Rendering

  @Test func selectableComponentsRender() async throws {
    let (_, surface) = try await makeSurface(
      components: [
        ["id": "root", "component": "Column", "children": ["agree", "picker", "chips", "tabs"]],
        [
          "id": "agree", "component": "CheckBox", "label": "I agree",
          "value": ["@path": "/agree"],
        ],
        [
          "id": "picker", "component": "ChoicePicker", "variant": "mutuallyExclusive",
          "options": [["label": "A", "value": "a"], ["label": "B", "value": "b"]],
          "value": ["@path": "/picked"],
        ],
        [
          "id": "chips", "component": "ChoicePicker", "variant": "multipleSelection",
          "displayStyle": "chips",
          "options": [["label": "A", "value": "a"], ["label": "B", "value": "b"]],
          "value": ["@path": "/picked"],
        ],
        [
          "id": "tabs", "component": "Tabs",
          "tabs": [["title": "One", "child": "one"], ["title": "Two", "child": "two"]],
        ],
        ["id": "one", "component": "Text", "text": "One"],
        ["id": "two", "component": "Text", "text": "Two"],
      ],
      dataModel: ["agree": true, "picked": ["a"]]
    )

    let root = try #require(surface.rootNode)
    _ = Surface(viewModel: surface, catalogs: BasicCatalogImplementation.allCatalogs).body
    _ = ComponentNodeView(node: root).body
    _ = A2UICheckBox(node: try node("agree", in: surface)).body
    _ = A2UIChoicePicker(node: try node("picker", in: surface)).body
    _ = A2UIChoicePicker(node: try node("chips", in: surface)).body
    _ = A2UITabs(node: try node("tabs", in: surface)).body
  }
}
