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
struct A2UITextFieldTests {

  @Test func textFieldWithoutPlaceholderHasNoPlaceholderText() {
    let node = Node(
      id: "tf1",
      type: "TextField",
      properties: [
        "label": "Name"
      ]
    )

    let view = A2UITextField(node: node)
    #expect(view.placeholderText == nil)
    _ = view.body
  }

  @Test func textFieldSupportsPlaceholderAndV10Catalog() throws {
    let v10Catalog = BasicCatalogImplementation.makeCatalog(version: .v10)
    let node = Node(
      id: "tfV10",
      type: "TextField",
      catalogID: v10Catalog.id,
      properties: [
        "label": "Name",
        "placeholder": "Jane Doe",
      ]
    )

    let view = A2UITextField(node: node)
    #expect(view.placeholderText == "Jane Doe")
    _ = view.body

    let rendered = Surface.render(node: node, using: [v10Catalog.id: v10Catalog])
    #expect(rendered != nil)
  }

  @Test func textFieldResolvesBoundPlaceholder() {
    let node = Node(
      id: "tfBound",
      type: "TextField",
      properties: [
        "label": "Email",
        "placeholder": DataBinding<String>(
          identity: .path("/hints/email"), value: "you@example.com", set: { _ in }),
      ]
    )

    let view = A2UITextField(node: node)
    #expect(view.placeholderText == "you@example.com")
    _ = view.body
  }

  @Test(arguments: ["shortText", "number", "obscured", "longText"])
  func textFieldRendersPlaceholderForEveryVariant(variant: String) {
    let node = Node(
      id: "tf_\(variant)",
      type: "TextField",
      properties: [
        "label": "Field",
        "placeholder": "Type here",
        "variant": variant,
        "value": "",
      ]
    )

    let view = A2UITextField(node: node)
    #expect(view.placeholderText == "Type here")
    _ = view.body
  }
}
