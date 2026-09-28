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
      .accessibilityIdentifier("A2UIText_\(node.id)")
      .accessibilityLabel(accessibilityLabel.isEmpty ? textContent : accessibilityLabel)
  }

  @ViewBuilder
  private func textForVariant(_ text: String, variant: String) -> some View {
    switch variant {
    case "h1":
      Text(attributedMarkdown(text))
        .font(.system(size: 32, weight: .bold))
    case "h2":
      Text(attributedMarkdown(text))
        .font(.system(size: 26, weight: .bold))
    case "h3":
      Text(attributedMarkdown(text))
        .font(.system(size: 22, weight: .semibold))
    case "h4":
      Text(attributedMarkdown(text))
        .font(.system(size: 18, weight: .semibold))
    case "h5":
      Text(attributedMarkdown(text))
        .font(.system(size: 16, weight: .medium))
    case "caption":
      Text(attributedMarkdown(text))
        .font(.caption)
        .italic()
        .foregroundStyle(.secondary)
    default:
      MarkdownBlockView(text: text)
    }
  }

  private var accessibilityLabel: String {
    if let accessibility = node.jsonValue(for: "accessibility"),
      let label = accessibility["label"]?.stringValue
    {
      return label
    }
    return textContent
  }
}

/// Helper function to parse inline markdown into an AttributedString.
func attributedMarkdown(_ text: String) -> AttributedString {
  if let attr = try? AttributedString(
    markdown: text,
    options: AttributedString.MarkdownParsingOptions(
      interpretedSyntax: .inlineOnlyPreservingWhitespace
    )
  ) {
    return attr
  }
  return AttributedString(text)
}

/// A structured view that renders multi-block Markdown content (headings, lists, quotes, paragraphs).
struct MarkdownBlockView: View {
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
      case .heading(let level, let text): return "h\(level)_\(text)"
      case .unorderedList(let items): return "ul_\(items.joined(separator: "_"))"
      case .orderedList(let items):
        return "ol_\(items.map { "\($0.0)_\($0.1)" }.joined(separator: "_"))"
      case .codeBlock(let code): return "code_\(code.hashValue)"
      case .blockquote(let text): return "quote_\(text)"
      case .paragraph(let text): return "p_\(text)"
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
    case .heading(let level, let hText):
      let font: Font = {
        switch level {
        case 1: return .system(size: 32, weight: .bold)
        case 2: return .system(size: 26, weight: .bold)
        case 3: return .system(size: 22, weight: .semibold)
        case 4: return .system(size: 18, weight: .semibold)
        case 5: return .system(size: 16, weight: .medium)
        default: return .system(size: 14, weight: .bold)
        }
      }()
      Text(attributedMarkdown(hText))
        .font(font)

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

    case .blockquote(let qText):
      HStack(spacing: 8) {
        Rectangle()
          .fill(Color.secondary.opacity(0.4))
          .frame(width: 3)
        Text(attributedMarkdown(qText))
          .font(.body)
          .foregroundStyle(.secondary)
      }

    case .paragraph(let pText):
      Text(attributedMarkdown(pText))
        .font(.body)
    }
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
      } else if trimmed.hasPrefix("#") {
        var level = 0
        for char in trimmed {
          if char == "#" { level += 1 } else { break }
        }
        let headingContent = String(trimmed.dropFirst(level)).trimmingCharacters(in: .whitespaces)
        result.append(.heading(level: level, text: headingContent))
      } else if trimmed.hasPrefix("> ") {
        let quoteContent = trimmed.components(separatedBy: "\n").map { line in
          line.hasPrefix("> ")
            ? String(line.dropFirst(2)) : (line.hasPrefix(">") ? String(line.dropFirst(1)) : line)
        }.joined(separator: "\n")
        result.append(.blockquote(text: quoteContent))
      } else {
        let lines = trimmed.components(separatedBy: "\n")
        let isUnordered = lines.allSatisfy { line in
          let t = line.trimmingCharacters(in: .whitespaces)
          return t.hasPrefix("- ") || t.hasPrefix("* ")
        }
        let isOrdered = lines.allSatisfy { line in
          let t = line.trimmingCharacters(in: .whitespaces)
          if let dotIndex = t.firstIndex(of: ".") {
            let numStr = t[..<dotIndex]
            return Int(numStr) != nil && t[t.index(after: dotIndex)...].hasPrefix(" ")
          }
          return false
        }

        if isUnordered {
          let items = lines.map { line -> String in
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("- ") || t.hasPrefix("* ") {
              return String(t.dropFirst(2))
            }
            return t
          }
          result.append(.unorderedList(items: items))
        } else if isOrdered {
          let items = lines.compactMap { line -> (Int, String)? in
            let t = line.trimmingCharacters(in: .whitespaces)
            if let dotIndex = t.firstIndex(of: "."),
              let num = Int(t[..<dotIndex])
            {
              let itemText = String(t[t.index(after: dotIndex)...]).trimmingCharacters(
                in: .whitespaces)
              return (num, itemText)
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
}
