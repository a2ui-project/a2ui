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
struct A2UICheckMessageTests {

  private func check(
    _ message: String,
    passed: Bool = false,
    severity: ValidationSeverity
  ) -> ResolvedCheck {
    ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(passed)), value: passed),
      message: message,
      validationResult: ValidationResult(valid: passed, message: message, severity: severity)
    )
  }

  private func node(type: String, checks: [ResolvedCheck]) -> Node {
    Node(id: "input", type: type, properties: ["label": "Field", "checks": checks])
  }

  @Test(arguments: ["CheckBox", "ChoicePicker", "DateTimeInput", "Slider", "TextField"])
  func warningShowsHintAndKeepsComponentValid(type: String) throws {
    let catalog = BasicCatalogImplementation.makeCatalog(version: .v10)
    let node = Node(
      id: "input",
      type: type,
      catalogID: catalog.id,
      properties: [
        "label": "Field",
        "checks": [check("Looks unusual", severity: .warning)],
      ]
    )

    let message = A2UICheckMessage(node: node, identifierPrefix: "A2UI\(type)")
    #expect(message.errorText == nil)
    #expect(message.hintText == "Looks unusual")
    #expect(node.isValid)
    _ = message.body

    #expect(Surface.render(node: node, using: [catalog.id: catalog]) != nil)
  }

  @Test func infoShowsHint() {
    let message = A2UICheckMessage(
      node: node(type: "Slider", checks: [check("Most people pick 5", severity: .info)]),
      identifierPrefix: "A2UISlider"
    )
    #expect(message.errorText == nil)
    #expect(message.hintText == "Most people pick 5")
  }

  @Test func errorWinsOverEarlierWarning() {
    let node = node(
      type: "CheckBox",
      checks: [
        check("Looks unusual", severity: .warning),
        check("Required", severity: .error),
      ]
    )
    let message = A2UICheckMessage(node: node, identifierPrefix: "A2UICheckBox")
    #expect(message.errorText == "Required")
    #expect(message.hintText == nil)
    #expect(!node.isValid)
    _ = message.body
  }

  @Test func passingChecksShowNothing() {
    let message = A2UICheckMessage(
      node: node(
        type: "DateTimeInput",
        checks: [
          check("Required", passed: true, severity: .error),
          check("Looks unusual", passed: true, severity: .warning),
        ]
      ),
      identifierPrefix: "A2UIDateTimeInput"
    )
    #expect(message.errorText == nil)
    #expect(message.hintText == nil)
  }
}
