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
}
