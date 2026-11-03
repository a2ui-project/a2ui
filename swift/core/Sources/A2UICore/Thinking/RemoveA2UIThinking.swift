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

// Inline code, a data path, or a term that only comes up when the model thinks
// about the protocol. A bare "surface" or "component" is left out, since the
// user's request may well be about a kitchen surface or a dishwasher component.
private let a2uiTalk = try! NSRegularExpression(
  pattern: #"`|\$/|\ba2ui|\bjson|\bschemas?\b|\bcatalogs?\b|\bdsl\b|\bsyntax\b"#
    + #"|\bdata ?models?\b|\bdata ?bindings?\b|\bsurface ?ids?\b"#
    + #"|\bcomponent ?ids?\b|\bcomponent trees?\b|\broot components?\b"#
    + #"|\bvariable names?\b|\bcreatesurface\b|\bupdatecomponents\b"#
    + #"|\bupdatedatamodel\b|\bdeletesurface\b"#,
  options: .caseInsensitive
)

// The whitespace after a sentence: after `.`, `!` or `?`, and any closing
// emphasis, quotes or brackets, as in `**Done.** Next`.
private let sentenceEnd = try! NSRegularExpression(
  pattern: #"(?<=[.!?])\s+|(?<=[.!?][*_"')\]])\s+|(?<=[.!?][*_"')\]]{2})\s+"#
)

private let listMarker = try! NSRegularExpression(pattern: #"^\s*(?:[-*+]|\d+[.)])\s+"#)

private let a2uiTagLine = try! NSRegularExpression(
  pattern: #"^\s*<a2ui(?:-json)?>\s*$"#,
  options: .caseInsensitive
)

/// Removes the sentences of the model's thinking that are about A2UI.
///
/// An app that shows the model's thinking while the user waits passes each
/// thought through this function, so the user reads about their request and
/// not about the format, its code or its data model. A sentence is removed
/// when it has inline code, a data path such as `$/form/name`, or a protocol
/// term such as A2UI, JSON, schema, catalog or data model. A fenced code block,
/// or a block between `<a2ui>` and `</a2ui>` lines, is removed whole. A line
/// that loses every sentence is removed too, along with the blank lines after
/// it. A thought with nothing to remove comes back unchanged.
///
/// The terms also match a sentence about the user's own code or JSON, so an
/// agent whose users ask about code should show the thinking unfiltered.
public func removeA2UIThinking(_ thinking: String) -> String {
  var lines: [String] = []
  var afterRemovedLine = false
  var blockEnd: String?
  for line in thinking.components(separatedBy: "\n") {
    let cr = line.hasSuffix("\r") ? "\r" : ""
    let text = cr.isEmpty ? line : String(line.dropLast())
    if let end = blockEnd {
      if text.lowercased().contains(end) { blockEnd = nil }
      afterRemovedLine = true
      continue
    }
    if text.drop(while: \.isWhitespace).hasPrefix("```") {
      if text.components(separatedBy: "```").count == 2 { blockEnd = "```" }
      afterRemovedLine = true
      continue
    }
    if matches(a2uiTagLine, text) {
      blockEnd = "</a2ui"
      afterRemovedLine = true
      continue
    }
    if text.trimmingCharacters(in: .whitespaces).isEmpty {
      if !afterRemovedLine { lines.append(line) }
      continue
    }
    let nsText = text as NSString
    let markerRange = listMarker.firstMatch(
      in: text, range: NSRange(location: 0, length: nsText.length))?.range
    let prefix = markerRange.map { nsText.substring(with: $0) } ?? ""
    let sentences = split(nsText.substring(from: prefix.utf16.count), by: sentenceEnd)
      .filter { !$0.isEmpty }
    let kept = sentences.filter { !matches(a2uiTalk, $0) }
    afterRemovedLine = kept.isEmpty
    if kept.count == sentences.count {
      lines.append(line)
    } else if !kept.isEmpty {
      lines.append(prefix + kept.joined(separator: " ") + cr)
    }
  }
  return lines.joined(separator: "\n")
}

private func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
  regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length))
    != nil
}

private func split(_ text: String, by regex: NSRegularExpression) -> [String] {
  let nsText = text as NSString
  var pieces: [String] = []
  var start = 0
  for match in regex.matches(in: text, range: NSRange(location: 0, length: nsText.length)) {
    pieces.append(
      nsText.substring(with: NSRange(location: start, length: match.range.location - start)))
    start = match.range.location + match.range.length
  }
  pieces.append(nsText.substring(from: start))
  return pieces
}
