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
import A2UIJSON
import BasicCatalog
import Foundation
import OrderedCollections
import OrderedJSON
import Testing

@MainActor
struct AccessibilityConformanceTests {
  @Test func accessibilityConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/accessibility.yaml")
    let testCases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!testCases.isEmpty, "Should find test cases in accessibility.yaml")

    var checkedComponents = 0
    for testCase in testCases {
      checkedComponents += try runAccessibilityCase(testCase)
    }

    #expect(checkedComponents > 0, "no accessibilityTree assertion of the suite was checked")
  }

  private func runAccessibilityCase(_ testCase: [String: Any]) throws -> Int {
    let name = testCase["name"] as? String ?? "<unnamed>"
    let processor = MessageProcessor(
      catalogs: BasicCatalog.allCatalogs,
      validationConfig: .relaxed
    )
    let steps = (testCase["steps"] as? [[String: Any]]) ?? [testCase]
    var checked = 0

    for step in steps {
      if let rawMessages = step["messages"] {
        try processor.processMessages(ConformanceTestHelper.toJSONValue(rawMessages))
      }
      let surface = try #require(
        processor.surfaceGroupModel.surfacesMap["a11y_surface"]
          ?? processor.surfaceGroupModel.surfacesMap.values.first,
        "[\(name)] Expected surface 'a11y_surface' to exist"
      )
      let rootNode = try #require(
        surface.nodeResolver.resolveTree(),
        "[\(name)] Expected resolved root node"
      )
      #expect(surface.rootNode == rootNode, "[\(name)] Surface rootNode should match resolved tree")

      let assertions =
        (step["assertions"] as? [String: Any])
        ?? (testCase["assertions"] as? [String: Any])
        ?? [:]
      let treeAssertions = assertions["accessibilityTree"] as? [String: Any] ?? [:]

      for (targetID, rawExpected) in treeAssertions {
        guard let expectedDict = rawExpected as? [String: Any] else { continue }
        let targetNode = try #require(
          findNode(id: targetID, in: rootNode),
          "[\(name)] Expected node '\(targetID)' in resolved tree"
        )
        assertNodeAccessibility(
          node: targetNode,
          expected: expectedDict,
          caseName: name
        )
        checked += 1
      }
    }
    return checked
  }

  private func findNode(id: String, in root: Node) -> Node? {
    var stack: [Node] = [root]
    while let current = stack.popLast() {
      if current.id == id {
        return current
      }
      stack.append(contentsOf: current.allChildNodes)
    }
    return nil
  }

  private func assertNodeAccessibility(
    node: Node,
    expected: [String: Any],
    caseName: String
  ) {
    let attributes = node.accessibilityAttributes
    if let expectedLabel = expected["label"] as? String {
      let actualLabel = effectiveLabel(for: node)
      #expect(
        actualLabel == expectedLabel,
        "[\(caseName)] Expected label '\(expectedLabel)' for '\(node.id)'"
      )
    }
    if let expectedDescription = expected["description"] as? String {
      #expect(
        attributes?.description == expectedDescription,
        "[\(caseName)] Expected description '\(expectedDescription)' for '\(node.id)'"
      )
    }
    if let expectedLive = expected["live"] as? String {
      #expect(
        attributes?.live == expectedLive,
        "[\(caseName)] Expected live '\(expectedLive)' for '\(node.id)'"
      )
    }
    if let expectedHidden = expected["hidden"] as? Bool {
      let actualHidden = attributes?.hidden ?? false
      #expect(
        actualHidden == expectedHidden,
        "[\(caseName)] Expected hidden '\(expectedHidden)' for '\(node.id)'"
      )
    }
    if let expectedRole = expected["role"] as? String {
      let actualRole = effectiveRole(for: node)
      #expect(
        actualRole == expectedRole,
        "[\(caseName)] Expected role '\(expectedRole)' for '\(node.id)', got '\(actualRole)'"
      )
    }
    if let expectedChecked = expected["checked"] as? Bool {
      let actualChecked = node.bool(for: "value") ?? false
      #expect(
        actualChecked == expectedChecked,
        "[\(caseName)] Expected checked '\(expectedChecked)' for '\(node.id)'"
      )
    }
  }

  private func effectiveLabel(for node: Node) -> String? {
    if let label = node.accessibilityAttributes?.label, !label.isEmpty {
      return label
    }
    if let child = node.child(for: "child") {
      if let childLabel = child.accessibilityAttributes?.label, !childLabel.isEmpty {
        return childLabel
      }
      return child.string(for: "text")
    }
    return nil
  }

  private func effectiveRole(for node: Node) -> String {
    switch node.type {
    case "Button":
      return "button"
    case "TextField":
      return "textbox"
    case "CheckBox":
      return "checkbox"
    case "ChoicePicker":
      let variant = node.string(for: "variant") ?? "mutuallyExclusive"
      return variant == "mutuallyExclusive" ? "radiogroup" : "group"
    default:
      return node.type.lowercased()
    }
  }
}
