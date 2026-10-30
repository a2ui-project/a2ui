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
import BasicCatalogSwiftUI
import SwiftUI
import Testing

@MainActor
struct A2UITextTests {

  @Test func headingLevelsMapToSemanticTextStyles() {
    #expect(A2UIText.headingFont(level: 1) == .largeTitle)
    #expect(A2UIText.headingFont(level: 2) == .title)
    #expect(A2UIText.headingFont(level: 3) == .title2)
    #expect(A2UIText.headingFont(level: 4) == .title3)
    #expect(A2UIText.headingFont(level: 5) == .headline)
  }

  @Test func deeperHeadingLevelsUseSemiboldSubheadline() {
    #expect(A2UIText.headingFont(level: 6) == .subheadline.weight(.semibold))
    #expect(A2UIText.headingFont(level: 7) == .subheadline.weight(.semibold))
  }

  @Test func rendersEveryVariant() {
    for variant in ["h1", "h2", "h3", "h4", "h5", "caption", "body"] {
      let node = Node(
        id: "text_\(variant)",
        type: "Text",
        properties: ["text": "Title", "variant": variant]
      )
      _ = A2UIText(node: node).body
    }
  }

  @Test func rendersMarkdownHeadings() {
    let node = Node(
      id: "markdown",
      type: "Text",
      properties: ["text": "# One\n\n## Two\n\n##### Five\n\n###### Six\n\nBody"]
    )
    _ = A2UIText(node: node).body
  }

  // MARK: - Accessibility headings

  @Test func headingVariantsAreAccessibilityHeadings() {
    let expected: [String: AccessibilityHeadingLevel] = [
      "h1": .h1, "h2": .h2, "h3": .h3, "h4": .h4, "h5": .h5,
    ]
    for (variant, level) in expected {
      #expect(headingLevels(text: "Title", variant: variant) == [level], "variant \(variant)")
    }
  }

  @Test func markdownHeadingsAreAccessibilityHeadings() {
    #expect(headingLevels(text: "# Title") == [.h1])
    #expect(headingLevels(text: "### Title") == [.h3])
    #expect(headingLevels(text: "###### Title") == [.h6])
    #expect(headingLevels(text: "####### Title") == [.h6])
  }

  @Test func bodyAndCaptionTextAreNotAccessibilityHeadings() {
    #expect(headingLevels(text: "Title").isEmpty)
    #expect(headingLevels(text: "Title", variant: "body").isEmpty)
    #expect(headingLevels(text: "Title", variant: "caption").isEmpty)
    #expect(headingLevels(text: "- One\n- Two").isEmpty)
    #expect(headingLevels(text: "> Quote").isEmpty)
  }

  /// Returns the accessibility heading levels set on the view a `Text` component renders.
  private func headingLevels(text: String, variant: String? = nil) -> [AccessibilityHeadingLevel] {
    var properties: [String: any Resolved] = ["text": text]
    if let variant { properties["variant"] = variant }
    let node = Node(id: "text", type: "Text", properties: properties)
    var levels: [AccessibilityHeadingLevel] = []
    collectHeadingLevels(in: A2UIText(node: node).body, into: &levels)
    return levels
  }

  /// Walks a view value with `Mirror` and collects the heading levels its accessibility modifiers
  /// store. Views defined in the basic catalog are expanded through their `body`; SwiftUI's own
  /// views are not, because their `body` must not be called.
  private func collectHeadingLevels(in value: Any, into levels: inout [AccessibilityHeadingLevel]) {
    if let level = value as? AccessibilityHeadingLevel {
      levels.append(level)
      return
    }
    if let view = value as? any View,
      String(reflecting: type(of: view)).hasPrefix("BasicCatalogSwiftUI.")
    {
      collectHeadingLevels(in: body(of: view), into: &levels)
      return
    }
    for child in Mirror(reflecting: value).children {
      collectHeadingLevels(in: child.value, into: &levels)
    }
  }

  private func body<V: View>(of view: V) -> any View {
    view.body
  }
}
