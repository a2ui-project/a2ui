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
import OrderedJSON
import SwiftUI
import Testing

@testable import BasicCatalogSwiftUI

@MainActor
struct A2UIChoicePickerTests {

  @Test func choicePickerInitializesWithChips() {
    let node = Node(
      id: "picker1",
      type: "ChoicePicker",
      properties: [
        "label": "Billing Period",
        "displayStyle": "chips",
        "variant": "mutuallyExclusive",
        "value": ["annual"],
        "options": JSONValue.array([
          JSONValue.object(["label": .string("Annual"), "value": .string("annual")]),
          JSONValue.object(["label": .string("Monthly"), "value": .string("monthly")]),
        ]),
      ]
    )

    let view = A2UIChoicePicker(node: node)
    #expect(node.string(for: "label") == "Billing Period")
    #expect(node.string(for: "displayStyle") == "chips")
    #expect(node.string(for: "variant") == "mutuallyExclusive")
    _ = view.body
  }

  @Test func choicePickerInitializesWithCheckboxAndFilter() {
    let node = Node(
      id: "picker2",
      type: "ChoicePicker",
      properties: [
        "label": "Interests",
        "displayStyle": "checkbox",
        "variant": "multipleSelection",
        "filterable": true,
        "value": ["sports", "music"],
        "options": JSONValue.array([
          JSONValue.object(["label": .string("Sports"), "value": .string("sports")]),
          JSONValue.object(["label": .string("Music"), "value": .string("music")]),
          JSONValue.object(["label": .string("Tech"), "value": .string("tech")]),
        ]),
      ]
    )

    let view = A2UIChoicePicker(node: node)
    #expect(node.bool(for: "filterable") == true)
    _ = view.body
  }

  @Test func choicePickerInitializesWithResolvedArray() {
    let opt1 = ResolvedDictionary(["label": "Annual", "value": "annual"])
    let opt2 = ResolvedDictionary(["label": "Monthly", "value": "monthly"])
    let node = Node(
      id: "pickerResolved",
      type: "ChoicePicker",
      properties: [
        "label": "Billing Period",
        "displayStyle": "chips",
        "variant": "mutuallyExclusive",
        "value": ["annual"],
        "options": ResolvedArray([opt1, opt2]),
      ]
    )

    let view = A2UIChoicePicker(node: node)
    _ = view.body
  }

  @Test func choicePickerRendersFromCatalog() throws {
    let catalog = BasicCatalogImplementation.v091Catalog

    let node = Node(
      id: "pickerCatalog",
      type: "ChoicePicker",
      properties: [
        "label": "Subscription",
        "displayStyle": "chips",
        "options": JSONValue.array([
          JSONValue.object(["label": .string("Plan A"), "value": .string("planA")])
        ]),
      ]
    )

    let rendered = Surface.render(node: node, using: [catalog.id: catalog])
    #expect(rendered != nil)
  }
}
