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

import SwiftUI

/// A structured view that renders multi-block Markdown content (headings, lists, quotes,
/// paragraphs).
struct MarkdownBlockView: View {
  let text: String

  private enum MarkdownBlock {
    case heading(level: Int, text: String)
    case unorderedList(items: [String])
    case orderedList(items: [(Int, String)])
    case codeBlock(code: String)
    case blockquote(text: String)
    case paragraph(text: String)
  }

  private var blocks: [MarkdownBlock] {
    parseBlocks(from: text)
  }

  var body: some View {
    let parsedBlocks = blocks
    if parsedBlocks.count == 1 {
      renderBlock(parsedBlocks[0])
    } else {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(parsedBlocks.indices, id: \.self) { index in
          renderBlock(parsedBlocks[index])
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
        ForEach(items.indices, id: \.self) { index in
          Text("• \(attributedMarkdown(items[index]))")
            .font(.body)
        }
      }

    case .orderedList(let items):
      VStack(alignment: .leading, spacing: 4) {
        ForEach(items.indices, id: \.self) { index in
          let item = items[index]
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
        .clipShape(.rect(cornerRadius: 6))

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

      let blockLines = trimmed.components(separatedBy: "\n")
      if blockLines.count >= 2,
        trimmed.hasPrefix("```"),
        blockLines.last?.trimmingCharacters(in: .whitespaces) == "```"
      {
        let codeLines = blockLines.dropFirst().dropLast()
        result.append(.codeBlock(code: codeLines.joined(separator: "\n")))
      } else if trimmed.hasPrefix("#"),
        blockLines.contains(where: Self.isATXHeadingLine)
      {
        for line in blockLines {
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
      } else if trimmed.hasPrefix(">") {
        let quoteContent = blockLines.map { line -> String in
          if line.hasPrefix("> ") {
            return String(line.dropFirst(2))
          } else if line.hasPrefix(">") {
            return String(line.dropFirst(1))
          }
          return line
        }.joined(separator: "\n")
        result.append(.blockquote(text: quoteContent))
      } else {
        let lines = blockLines
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

    if result.isEmpty, !raw.isEmpty {
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
