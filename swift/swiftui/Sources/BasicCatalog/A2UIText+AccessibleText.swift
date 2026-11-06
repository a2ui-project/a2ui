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

import Foundation

extension A2UIText {
  /// The text a `Text` component shows, without Markdown syntax, as reported to live regions
  /// with `a2uiAccessibleText(_:)`.
  ///
  /// Heading and caption variants render inline Markdown only. The other variants render
  /// Markdown blocks, which are joined with line breaks.
  static func accessibleText(_ text: String, variant: String) -> String {
    switch variant {
    case "h1", "h2", "h3", "h4", "h5", "caption":
      return String(attributedMarkdown(text).characters)
    default:
      return blockText(text)
    }
  }

  private static func blockText(_ text: String) -> String {
    guard
      let attributed = try? AttributedString(
        markdown: text,
        options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .full)
      )
    else {
      return text
    }
    // Runs in the same block share a presentation intent; inline styles only split runs.
    var blocks: [String] = []
    var currentIntent: PresentationIntent?
    for run in attributed.runs {
      let runText = String(attributed[run.range].characters)
      if !blocks.isEmpty, run.presentationIntent == currentIntent {
        blocks[blocks.count - 1] += runText
      } else {
        blocks.append(runText)
      }
      currentIntent = run.presentationIntent
    }
    return
      blocks
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
      .joined(separator: "\n")
  }
}
