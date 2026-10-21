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

  // MARK: - Modifier semantics

  @Test func checkboxReportsCheckedStateAsValue() {
    let checked = A2UISelectionAccessibility(role: .checkbox, isSelected: true)
    let unchecked = A2UISelectionAccessibility(role: .checkbox, isSelected: false)

    #expect(checked.value == "checked")
    #expect(unchecked.value == "unchecked")
    // The state is in the value, so the selected trait would announce it twice.
    #expect(!checked.traits.contains(.isSelected))
    if #available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *) {
      #expect(checked.traits.contains(.isToggle))
      #expect(unchecked.traits.contains(.isToggle))
    }
  }

  @Test func radioAndTabReportSelectionAsTrait() {
    for role in [A2UISelectionAccessibility.Role.radio, .tab] {
      let selected = A2UISelectionAccessibility(role: role, isSelected: true)
      let unselected = A2UISelectionAccessibility(role: role, isSelected: false)

      #expect(selected.traits == .isSelected)
      #expect(unselected.traits == [])
      #expect(selected.value == nil)
      #expect(unselected.value == nil)
    }
  }

  // MARK: - CheckBox

  @Test func checkBoxFollowsItsBoundValue() async throws {
    let (processor, surface) = try await makeSurface(
      components: [
        [
          "id": "root", "component": "CheckBox", "label": "I agree to terms",
          "value": ["@path": "/agree"],
          "accessibility": ["label": "Accept Terms and Conditions"],
        ]
      ],
      dataModel: ["agree": true]
    )

    let before = A2UICheckBox(node: try node("root", in: surface)).selectionAccessibility
    #expect(before == A2UISelectionAccessibility(role: .checkbox, isSelected: true))

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

    let after = A2UICheckBox(node: try node("root", in: surface)).selectionAccessibility
    #expect(after == A2UISelectionAccessibility(role: .checkbox, isSelected: false))
    #expect(after.value == "unchecked")
  }

  // MARK: - ChoicePicker

  @Test func mutuallyExclusiveOptionsAreRadios() async throws {
    let surface = try await choicePickerSurface(
      variant: "mutuallyExclusive", displayStyle: "checkbox", selected: ["2"])
    let picker = A2UIChoicePicker(node: try node("root", in: surface))

    #expect(
      picker.selectionAccessibility(forOptionValue: "1")
        == A2UISelectionAccessibility(role: .radio, isSelected: false))
    #expect(
      picker.selectionAccessibility(forOptionValue: "2")
        == A2UISelectionAccessibility(role: .radio, isSelected: true))
  }

  @Test func multipleSelectionOptionsAreCheckboxes() async throws {
    let surface = try await choicePickerSurface(
      variant: "multipleSelection", displayStyle: "checkbox", selected: ["1", "3"])
    let picker = A2UIChoicePicker(node: try node("root", in: surface))

    #expect(
      picker.selectionAccessibility(forOptionValue: "1")
        == A2UISelectionAccessibility(role: .checkbox, isSelected: true))
    #expect(
      picker.selectionAccessibility(forOptionValue: "2")
        == A2UISelectionAccessibility(role: .checkbox, isSelected: false))
    #expect(
      picker.selectionAccessibility(forOptionValue: "3")
        == A2UISelectionAccessibility(role: .checkbox, isSelected: true))
  }

  @Test func chipsUseTheSameRolesAsTheCheckboxList() async throws {
    let single = try await choicePickerSurface(
      variant: "mutuallyExclusive", displayStyle: "chips", selected: ["1"])
    let multiple = try await choicePickerSurface(
      variant: "multipleSelection", displayStyle: "chips", selected: ["1"])

    #expect(
      A2UIChoicePicker(node: try node("root", in: single)).selectionAccessibility(
        forOptionValue: "1") == A2UISelectionAccessibility(role: .radio, isSelected: true))
    #expect(
      A2UIChoicePicker(node: try node("root", in: multiple)).selectionAccessibility(
        forOptionValue: "1") == A2UISelectionAccessibility(role: .checkbox, isSelected: true))
  }

  // MARK: - Tabs

  @Test func firstTabIsSelectedInitially() async throws {
    let (_, surface) = try await makeSurface(components: [
      [
        "id": "root", "component": "Tabs",
        "tabs": [
          ["title": "Overview", "child": "overview"],
          ["title": "Details", "child": "details"],
        ],
      ],
      ["id": "overview", "component": "Text", "text": "Overview content"],
      ["id": "details", "component": "Text", "text": "Details content"],
    ])
    let tabs = A2UITabs(node: try node("root", in: surface))

    #expect(
      tabs.selectionAccessibility(forTabAt: 0)
        == A2UISelectionAccessibility(role: .tab, isSelected: true))
    #expect(
      tabs.selectionAccessibility(forTabAt: 1)
        == A2UISelectionAccessibility(role: .tab, isSelected: false))
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
