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
import Foundation
import OrderedJSON
import SwiftUI

// MARK: - Component Implementation

@MainActor
extension BasicCatalogImplementation {
  public static let text = ComponentImplementation(api: BasicCatalogComponents.text) { node in
    A2UIText(node: node)
  }
}

// MARK: - View

/// SwiftUI component view for the A2UI Basic Catalog `Text` component.
public struct A2UIText: View {
  /// Summary of the visible text and semantic formatting constructs rendered by ``A2UIText``.
  @_spi(Testing)
  public struct RenderedMarkdown: Sendable, Equatable {
    public let visibleText: String
    public let presentSemantics: Set<String>

    public init(visibleText: String, presentSemantics: Set<String>) {
      self.visibleText = visibleText
      self.presentSemantics = presentSemantics
    }
  }

  public let node: Node

  public init(node: Node) {
    self.node = node
  }

  private var textContent: String {
    node.string(for: "text") ?? ""
  }

  private var variant: String {
    node.string(for: "variant") ?? "body"
  }

  public var body: some View {
    textForVariant(textContent, variant: variant)
      .accessibilityIdentifier("a2ui-\(node.id)")
      .a2uiAccessibilityElement(for: node, children: .combine)
  }

  /// Evaluates the rendered visible text and semantic formatting constructs for this `Text` node.
  @_spi(Testing)
  public var renderedMarkdown: RenderedMarkdown {
    switch variant {
    case "h1", "h2", "h3", "h4", "h5":
      let attributed = attributedMarkdown(textContent)
      var semantics = inlineMarkdownSemantics(in: attributed)
      semantics.insert("heading")
      Self.collectRenderedViewSemantics(in: body, into: &semantics)
      return RenderedMarkdown(
        visibleText: String(attributed.characters),
        presentSemantics: semantics
      )
    case "caption":
      let attributed = attributedMarkdown(textContent)
      var semantics = inlineMarkdownSemantics(in: attributed)
      semantics.insert("emphasis")
      Self.collectRenderedViewSemantics(in: body, into: &semantics)
      return RenderedMarkdown(
        visibleText: String(attributed.characters),
        presentSemantics: semantics
      )
    default:
      let summary = MarkdownBlockView(text: textContent).renderedMarkdown()
      var semantics = summary.presentSemantics
      Self.collectRenderedViewSemantics(in: body, into: &semantics)
      return RenderedMarkdown(visibleText: summary.visibleText, presentSemantics: semantics)
    }
  }

  /// Returns the font for a heading level, used by both the `h1`–`h5` variants and Markdown
  /// headings.
  ///
  /// Headings map to semantic text styles so they scale with Dynamic Type along with body
  /// text. Levels deeper than 5 use a semibold subheadline.
  public static func headingFont(level: Int) -> Font {
    switch level {
    case 1: return .largeTitle
    case 2: return .title
    case 3: return .title2
    case 4: return .title3
    case 5: return .headline
    default: return .subheadline.weight(.semibold)
    }
  }

  @ViewBuilder
  private func textForVariant(_ text: String, variant: String) -> some View {
    switch variant {
    case "h1", "h2", "h3", "h4", "h5":
      let level = Int(variant.dropFirst()) ?? 1
      Text(attributedMarkdown(text))
        .font(Self.headingFont(level: level))
        .a2uiHeading(level: level)
    case "caption":
      Text(attributedMarkdown(text))
        .font(.caption)
        .italic()
        .foregroundStyle(.secondary)
    default:
      MarkdownBlockView(text: text)
    }
  }

  private static func collectRenderedViewSemantics(
    in value: Any,
    into semantics: inout Set<String>
  ) {
    if let view = value as? any View {
      let typeName = String(reflecting: type(of: view))
      if typeName.hasPrefix("SwiftUI.Image") || typeName.hasPrefix("SwiftUI.AsyncImage") {
        semantics.insert("image")
        return
      }
      if typeName.hasPrefix("BasicCatalogSwiftUI.") {
        collectRenderedViewSemantics(in: expandBody(of: view), into: &semantics)
        return
      }
    }
    for child in Mirror(reflecting: value).children {
      collectRenderedViewSemantics(in: child.value, into: &semantics)
    }
  }

  private static func expandBody<ViewType: View>(of view: ViewType) -> any View {
    view.body
  }
}

extension View {
  /// Marks this view as a heading for assistive technologies, so VoiceOver announces it as one
  /// and lists it in the headings rotor, like the `<h1>`–`<h5>` elements of the web renderer.
  ///
  /// Levels deeper than 6 are reported as level 6, the deepest level SwiftUI supports.
  fileprivate func a2uiHeading(level: Int) -> some View {
    let headingLevel: AccessibilityHeadingLevel =
      switch level {
      case 1: .h1
      case 2: .h2
      case 3: .h3
      case 4: .h4
      case 5: .h5
      default: .h6
      }
    return
      self
      .accessibilityAddTraits(.isHeader)
      .accessibilityHeading(headingLevel)
  }
}

/// Parses inline Markdown into an `AttributedString`, stripping link and image URL attributes
/// because Basic Catalog `Text` renders link and image syntax as plain text without targets.
private func attributedMarkdown(_ text: String) -> AttributedString {
  guard
    var attributed = try? AttributedString(
      markdown: text,
      options: AttributedString.MarkdownParsingOptions(
        interpretedSyntax: .inlineOnlyPreservingWhitespace
      )
    )
  else {
    return AttributedString(text)
  }
  for run in attributed.runs {
    let linkURL: URL? = run.link
    if linkURL != nil {
      attributed[run.range].link = nil
    }
    let imageURL: URL? = run.imageURL
    if imageURL != nil {
      attributed[run.range].imageURL = nil
    }
  }
  return attributed
}

private func inlineMarkdownSemantics(in attributed: AttributedString) -> Set<String> {
  var semantics: Set<String> = []
  for run in attributed.runs {
    if let intent: InlinePresentationIntent = run.inlinePresentationIntent {
      if intent.contains(.stronglyEmphasized) {
        semantics.insert("strong")
      }
      if intent.contains(.emphasized) {
        semantics.insert("emphasis")
      }
      if intent.contains(.code) {
        semantics.insert("code")
      }
    }
    let linkURL: URL? = run.link
    if linkURL != nil {
      semantics.insert("link")
    }
    let imageURL: URL? = run.imageURL
    if imageURL != nil {
      semantics.insert("image")
    }
  }
  return semantics
}

/// Structured view rendering multi-block Markdown content (headings, lists, quotes, paragraphs).
private struct MarkdownBlockView: View {
  let text: String

  private enum MarkdownBlock: Identifiable {
    case heading(level: Int, text: String)
    case unorderedList(items: [String])
    case orderedList(items: [(Int, String)])
    case codeBlock(code: String)
    case blockquote(text: String)
    case paragraph(text: String)

    var id: String {
      switch self {
      case .heading(let level, let headingText):
        return "h\(level)_\(headingText)"
      case .unorderedList(let items):
        return "ul_\(items.joined(separator: "_"))"
      case .orderedList(let items):
        return "ol_\(items.map { "\($0.0)_\($0.1)" }.joined(separator: "_"))"
      case .codeBlock(let code):
        return "code_\(code.hashValue)"
      case .blockquote(let quoteText):
        return "quote_\(quoteText)"
      case .paragraph(let paragraphText):
        return "p_\(paragraphText)"
      }
    }
  }

  private var blocks: [MarkdownBlock] {
    parseBlocks(from: text)
  }

  var body: some View {
    if blocks.count == 1 {
      renderBlock(blocks[0])
    } else {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(blocks) { block in
          renderBlock(block)
        }
      }
    }
  }

  @ViewBuilder
  private func renderBlock(_ block: MarkdownBlock) -> some View {
    switch block {
    case .heading(let level, let headingText):
      Text(attributedMarkdown(headingText))
        .font(A2UIText.headingFont(level: level))
        .a2uiHeading(level: level)

    case .unorderedList(let items):
      VStack(alignment: .leading, spacing: 4) {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
          Text("• \(attributedMarkdown(item))")
            .font(.body)
        }
      }

    case .orderedList(let items):
      VStack(alignment: .leading, spacing: 4) {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
          Text("\(item.0). \(attributedMarkdown(item.1))")
            .font(.body)
        }
      }

    case .codeBlock(let code):
      Text(code)
        .font(.system(.subheadline, design: .monospaced))
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.gray.opacity(0.12))
        .cornerRadius(6)

    case .blockquote(let quoteText):
      HStack(spacing: 8) {
        Rectangle()
          .fill(Color.secondary.opacity(0.4))
          .frame(width: 3)
        Text(attributedMarkdown(quoteText))
          .font(.body)
          .foregroundStyle(.secondary)
      }

    case .paragraph(let paragraphText):
      Text(attributedMarkdown(paragraphText))
        .font(.body)
    }
  }

  private static func isATXHeadingLine(_ line: String) -> Bool {
    let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
    let level = trimmedLine.prefix(while: { $0 == "#" }).count
    let remainder = trimmedLine.dropFirst(level)
    return (1...6).contains(level)
      && (remainder.isEmpty || remainder.first?.isWhitespace == true)
  }

  private func parseBlocks(from raw: String) -> [MarkdownBlock] {
    let rawBlocks = raw.components(separatedBy: "\n\n")
    var result: [MarkdownBlock] = []

    for rawBlock in rawBlocks {
      let trimmed = rawBlock.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { continue }

      if trimmed.hasPrefix("```") && trimmed.hasSuffix("```") && trimmed.count >= 6 {
        var lines = trimmed.components(separatedBy: "\n")
        lines.removeFirst()
        if !lines.isEmpty { lines.removeLast() }
        result.append(.codeBlock(code: lines.joined(separator: "\n")))
      } else if trimmed.hasPrefix("#"),
        trimmed.components(separatedBy: "\n").contains(where: Self.isATXHeadingLine)
      {
        for line in trimmed.components(separatedBy: "\n") {
          let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
          guard !trimmedLine.isEmpty else { continue }
          let level = trimmedLine.prefix(while: { $0 == "#" }).count
          let remainder = trimmedLine.dropFirst(level)
          if (1...6).contains(level),
            remainder.isEmpty || remainder.first?.isWhitespace == true
          {
            let headingContent = remainder.trimmingCharacters(in: .whitespaces)
            result.append(.heading(level: level, text: headingContent))
          } else {
            result.append(.paragraph(text: trimmedLine))
          }
        }
      } else if trimmed.hasPrefix("> ") {
        let quoteContent = trimmed.components(separatedBy: "\n").map { line in
          line.hasPrefix("> ")
            ? String(line.dropFirst(2)) : (line.hasPrefix(">") ? String(line.dropFirst(1)) : line)
        }.joined(separator: "\n")
        result.append(.blockquote(text: quoteContent))
      } else {
        let lines = trimmed.components(separatedBy: "\n")
        let isUnordered = lines.allSatisfy { line in
          let trimmedLine = line.trimmingCharacters(in: .whitespaces)
          return trimmedLine.hasPrefix("- ") || trimmedLine.hasPrefix("* ")
        }
        let isOrdered = lines.allSatisfy { line in
          let trimmedLine = line.trimmingCharacters(in: .whitespaces)
          if let dotIndex = trimmedLine.firstIndex(of: ".") {
            let numberPrefix = trimmedLine[..<dotIndex]
            return Int(numberPrefix) != nil
              && trimmedLine[trimmedLine.index(after: dotIndex)...].hasPrefix(" ")
          }
          return false
        }

        if isUnordered {
          let items = lines.map { line -> String in
            let trimmedLine = line.trimmingCharacters(in: .whitespaces)
            if trimmedLine.hasPrefix("- ") || trimmedLine.hasPrefix("* ") {
              return String(trimmedLine.dropFirst(2))
            }
            return trimmedLine
          }
          result.append(.unorderedList(items: items))
        } else if isOrdered {
          let items = lines.compactMap { line -> (Int, String)? in
            let trimmedLine = line.trimmingCharacters(in: .whitespaces)
            if let dotIndex = trimmedLine.firstIndex(of: "."),
              let itemNumber = Int(trimmedLine[..<dotIndex])
            {
              let itemText = String(trimmedLine[trimmedLine.index(after: dotIndex)...])
                .trimmingCharacters(in: .whitespaces)
              return (itemNumber, itemText)
            }
            return nil
          }
          result.append(.orderedList(items: items))
        } else {
          result.append(.paragraph(text: trimmed))
        }
      }
    }

    if result.isEmpty && !raw.isEmpty {
      result.append(.paragraph(text: raw))
    }

    return result
  }

  func renderedMarkdown() -> A2UIText.RenderedMarkdown {
    var semantics: Set<String> = []
    let blockTexts = blocks.map { block -> String in
      switch block {
      case .heading(_, let headingText):
        semantics.insert("heading")
        let attributed = attributedMarkdown(headingText)
        semantics.formUnion(inlineMarkdownSemantics(in: attributed))
        return String(attributed.characters)
      case .unorderedList(let items):
        if !items.isEmpty {
          semantics.insert("list_item")
        }
        return items.map { item in
          let attributed = attributedMarkdown(item)
          semantics.formUnion(inlineMarkdownSemantics(in: attributed))
          return String(attributed.characters)
        }.joined(separator: " ")
      case .orderedList(let items):
        if !items.isEmpty {
          semantics.insert("list_item")
        }
        return items.map { item in
          let attributed = attributedMarkdown(item.1)
          semantics.formUnion(inlineMarkdownSemantics(in: attributed))
          return String(attributed.characters)
        }.joined(separator: " ")
      case .codeBlock(let code):
        semantics.insert("code")
        return code
      case .blockquote(let quoteText):
        let attributed = attributedMarkdown(quoteText)
        semantics.formUnion(inlineMarkdownSemantics(in: attributed))
        return String(attributed.characters)
      case .paragraph(let paragraphText):
        let attributed = attributedMarkdown(paragraphText)
        semantics.formUnion(inlineMarkdownSemantics(in: attributed))
        return String(attributed.characters)
      }
    }
    return A2UIText.RenderedMarkdown(
      visibleText: blockTexts.joined(separator: " "),
      presentSemantics: semantics
    )
  }
}
