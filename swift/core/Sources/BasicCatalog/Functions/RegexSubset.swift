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
import Foundation

/// Inclusive Unicode scalar range (`start <= end`, `0x0000...0x10FFFF`).
public struct CodePointRange: Equatable, Sendable {
  public let start: UInt32
  public let end: UInt32

  public init(start: UInt32, end: UInt32) {
    self.start = start
    self.end = end
  }
}

/// Zero-width assertion anchor kinds supported by the A2UI portable regex subset.
public enum RegexAnchor: String, Equatable, Sendable {
  case start
  case end
  case wordBoundary
  case notWordBoundary
}

/// Abstract syntax tree for the A2UI portable regular expression subset.
public indirect enum RegexNode: Equatable, Sendable {
  case empty
  case charSet([CodePointRange])
  case group(capturing: Bool, child: RegexNode)
  case lookahead(negated: Bool, child: RegexNode)
  case anchor(RegexAnchor)
  case concat([RegexNode])
  case alt([RegexNode])
  case repeatNode(child: RegexNode, min: Int, max: Int?, lazy: Bool)
}

/// Machine-readable reason token for a rejected regex pattern.
public enum RegexRejection: String, Equatable, Sendable, Error {
  case patternTooLong = "PATTERN_TOO_LONG"
  case unsupportedSyntax = "UNSUPPORTED_SYNTAX"
  case nestedQuantifier = "NESTED_QUANTIFIER"
  case overlappingAlternation = "OVERLAPPING_ALTERNATION"
  case adjacentOverlap = "ADJACENT_OVERLAP"
}

/// Thrown when a pattern fails to parse under the A2UI regex subset grammar.
public struct RegexSyntaxError: Error, Equatable, Sendable {
  public let message: String
  public let offset: Int

  public init(_ message: String, offset: Int) {
    self.message = message
    self.offset = offset
  }
}

/// Outcome of validating a pattern against the grammar and static safety guard.
public struct RegexAnalysisResult: Equatable, Sendable {
  public let ok: Bool
  public let ast: RegexNode?
  public let reason: RegexRejection?
  public let detail: String?

  public static func accepted(_ ast: RegexNode) -> RegexAnalysisResult {
    RegexAnalysisResult(ok: true, ast: ast, reason: nil, detail: nil)
  }

  public static func rejected(
    _ reason: RegexRejection,
    detail: String? = nil
  ) -> RegexAnalysisResult {
    RegexAnalysisResult(ok: false, ast: nil, reason: reason, detail: detail)
  }
}

/// Portable A2UI regex subset parser, static safety guard, ICU translator,
/// and LRU-cached compiler.
public enum RegexSubset {
  /// Maximum length of a regex pattern in Unicode code points.
  public static let maxPatternCodePoints = 256

  /// Maximum length of an input value in Unicode code points for regex matching.
  public static let maxValueCodePoints = 4096

  private static let maxQuantifierBound = 256
  private static let maxCodePoint: UInt32 = 0x10FFFF
  private static let cacheCapacity = 256

  private static let asciiWordClass = "[A-Za-z0-9_]"
  private static let asciiWordBoundary =
    "(?:(?<=\(asciiWordClass))(?!\(asciiWordClass))|(?<!\(asciiWordClass))(?=\(asciiWordClass)))"
  private static let asciiNonWordBoundary =
    "(?:(?<=\(asciiWordClass))(?=\(asciiWordClass))|(?<!\(asciiWordClass))(?!\(asciiWordClass)))"

  private static let digitRanges: [CodePointRange] = [
    CodePointRange(start: 0x30, end: 0x39)
  ]
  private static let nonDigitRanges: [CodePointRange] = complementRanges(digitRanges)

  private static let wordRanges: [CodePointRange] = [
    CodePointRange(start: 0x30, end: 0x39),
    CodePointRange(start: 0x41, end: 0x5A),
    CodePointRange(start: 0x5F, end: 0x5F),
    CodePointRange(start: 0x61, end: 0x7A),
  ]
  private static let nonWordRanges: [CodePointRange] = complementRanges(wordRanges)

  private static let spaceRanges: [CodePointRange] = [
    CodePointRange(start: 0x09, end: 0x0D),
    CodePointRange(start: 0x20, end: 0x20),
  ]
  private static let nonSpaceRanges: [CodePointRange] = complementRanges(spaceRanges)

  private static let dotRanges: [CodePointRange] = [
    CodePointRange(start: 0x00, end: 0x09),
    CodePointRange(start: 0x0B, end: 0x0C),
    CodePointRange(start: 0x0E, end: maxCodePoint),
  ]

  // MARK: - Range algebra

  public static func normalizeRanges(_ ranges: [CodePointRange]) -> [CodePointRange] {
    let valid = ranges.filter { $0.start <= $0.end }
    guard !valid.isEmpty else { return [] }
    let sorted = valid.sorted {
      $0.start != $1.start ? $0.start < $1.start : $0.end < $1.end
    }
    var merged: [CodePointRange] = [sorted[0]]
    for cur in sorted.dropFirst() {
      let last = merged[merged.count - 1]
      if cur.start <= last.end + 1 {
        if cur.end > last.end {
          merged[merged.count - 1] = CodePointRange(start: last.start, end: cur.end)
        }
      } else {
        merged.append(cur)
      }
    }
    return merged
  }

  public static func complementRanges(_ ranges: [CodePointRange]) -> [CodePointRange] {
    let normalized = normalizeRanges(ranges)
    var out: [CodePointRange] = []
    var cursor: UInt32 = 0
    for r in normalized {
      if r.start > cursor {
        out.append(CodePointRange(start: cursor, end: r.start - 1))
      }
      if r.end >= maxCodePoint {
        return out
      }
      cursor = r.end + 1
    }
    if cursor <= maxCodePoint {
      out.append(CodePointRange(start: cursor, end: maxCodePoint))
    }
    return out
  }

  public static func rangesOverlap(_ a: [CodePointRange], _ b: [CodePointRange]) -> Bool {
    var i = 0
    var j = 0
    while i < a.count && j < b.count {
      let ra = a[i]
      let rb = b[j]
      if ra.start <= rb.end && rb.start <= ra.end {
        return true
      }
      if ra.end < rb.end {
        i += 1
      } else {
        j += 1
      }
    }
    return false
  }

  // MARK: - Parser

  /// Parses `pattern` into a `RegexNode` AST under the portable A2UI grammar.
  public static func parse(_ pattern: String) throws -> RegexNode {
    var parser = Parser(Array(pattern.unicodeScalars.map(\.value)))
    return try parser.parsePattern()
  }

  private struct Parser {
    let cps: [UInt32]
    var pos: Int = 0

    init(_ cps: [UInt32]) {
      self.cps = cps
    }

    var atEnd: Bool { pos >= cps.count }

    func peek(_ offset: Int = 0) -> UInt32? {
      let idx = pos + offset
      return idx >= 0 && idx < cps.count ? cps[idx] : nil
    }

    mutating func next() throws -> UInt32 {
      guard pos < cps.count else {
        throw RegexSyntaxError("Unexpected end of pattern", offset: pos)
      }
      let cp = cps[pos]
      pos += 1
      return cp
    }

    mutating func eat(_ expected: UInt32) -> Bool {
      if peek() == expected {
        pos += 1
        return true
      }
      return false
    }

    mutating func parsePattern() throws -> RegexNode {
      let node = try parseDisjunction()
      if !atEnd {
        throw RegexSyntaxError("Unexpected token in pattern", offset: pos)
      }
      return node
    }

    mutating func parseDisjunction() throws -> RegexNode {
      var branches: [RegexNode] = [try parseAlternative()]
      while eat(0x7C) {  // '|'
        branches.append(try parseAlternative())
      }
      return branches.count == 1 ? branches[0] : .alt(branches)
    }

    mutating func parseAlternative() throws -> RegexNode {
      var items: [RegexNode] = []
      while !atEnd, let ch = peek(), ch != 0x7C && ch != 0x29 {
        items.append(try parseTerm())
      }
      if items.isEmpty { return .empty }
      return items.count == 1 ? items[0] : .concat(items)
    }

    mutating func parseTerm() throws -> RegexNode {
      let atom = try parseAtom()
      guard let q = peek(), isQuantifierStart(q) else {
        return atom
      }
      if case .anchor = atom {
        throw RegexSyntaxError("Zero-width assertion cannot be quantified", offset: pos)
      }
      if case .lookahead = atom {
        throw RegexSyntaxError("Zero-width assertion cannot be quantified", offset: pos)
      }
      return try parseQuantifier(atom)
    }

    mutating func parseQuantifier(_ child: RegexNode) throws -> RegexNode {
      let qOffset = pos
      let q = try next()
      let bounds: (min: Int, max: Int?)
      switch q {
      case 0x2A:  // '*'
        bounds = (0, nil)
      case 0x2B:  // '+'
        bounds = (1, nil)
      case 0x3F:  // '?'
        bounds = (0, 1)
      default:
        bounds = try parseBracedBounds(startOffset: qOffset)
      }
      let lazy = eat(0x3F)
      if let after = peek(), isQuantifierStart(after) {
        throw RegexSyntaxError(
          "Possessive or chained quantifiers are not supported",
          offset: pos
        )
      }
      return .repeatNode(child: child, min: bounds.min, max: bounds.max, lazy: lazy)
    }

    mutating func parseBracedBounds(startOffset: Int) throws -> (min: Int, max: Int?) {
      guard let minVal = try readDecimal(startOffset: startOffset) else {
        throw RegexSyntaxError("Malformed brace quantifier", offset: startOffset)
      }
      var maxVal: Int? = minVal
      if eat(0x2C) {  // ','
        if peek() == 0x7D {
          maxVal = nil
        } else {
          guard let parsedMax = try readDecimal(startOffset: startOffset) else {
            throw RegexSyntaxError("Malformed brace quantifier", offset: startOffset)
          }
          maxVal = parsedMax
        }
      }
      guard eat(0x7D) else {  // '}'
        throw RegexSyntaxError("Unclosed or malformed brace quantifier", offset: startOffset)
      }
      if minVal > RegexSubset.maxQuantifierBound {
        throw RegexSyntaxError("Quantifier lower bound exceeds 256", offset: startOffset)
      }
      if let maxVal {
        if maxVal > RegexSubset.maxQuantifierBound {
          throw RegexSyntaxError("Quantifier upper bound exceeds 256", offset: startOffset)
        }
        if maxVal < minVal {
          throw RegexSyntaxError("Quantifier range out of order", offset: startOffset)
        }
      }
      return (minVal, maxVal)
    }

    mutating func readDecimal(startOffset: Int) throws -> Int? {
      let start = pos
      var value = 0
      while let cp = peek(), cp >= 0x30 && cp <= 0x39 {
        _ = try next()
        value = value * 10 + Int(cp - 0x30)
        if value > 0x7FFF_FFFF {
          throw RegexSyntaxError("Quantifier bound overflow", offset: startOffset)
        }
      }
      return pos == start ? nil : value
    }

    mutating func parseAtom() throws -> RegexNode {
      let atomOffset = pos
      let cp = try next()
      switch cp {
      case 0x5E:  // '^'
        return .anchor(.start)
      case 0x24:  // '$'
        return .anchor(.end)
      case 0x2E:  // '.'
        return .charSet(RegexSubset.dotRanges)
      case 0x5B:  // '['
        return try parseCharClass(startOffset: atomOffset)
      case 0x28:  // '('
        return try parseGroup(startOffset: atomOffset)
      case 0x5C:  // '\'
        return try parseAtomEscape(escOffset: atomOffset)
      case 0x2A, 0x2B, 0x3F, 0x7B:
        throw RegexSyntaxError("Unexpected quantifier without atom", offset: atomOffset)
      case 0x7D, 0x5D, 0x29:
        throw RegexSyntaxError("Unescaped closing bracket or parenthesis", offset: atomOffset)
      default:
        return .charSet([CodePointRange(start: cp, end: cp)])
      }
    }

    mutating func parseGroup(startOffset: Int) throws -> RegexNode {
      if !eat(0x3F) {
        let body = try parseDisjunction()
        guard eat(0x29) else {
          throw RegexSyntaxError("Unclosed group '('", offset: startOffset)
        }
        return .group(capturing: true, child: body)
      }
      guard let mod = peek(), mod == 0x3A || mod == 0x3D || mod == 0x21 else {
        throw RegexSyntaxError("Unsupported group extension", offset: startOffset)
      }
      _ = try next()
      let body = try parseDisjunction()
      guard eat(0x29) else {
        throw RegexSyntaxError("Unclosed group '('", offset: startOffset)
      }
      if mod == 0x3A {
        return .group(capturing: false, child: body)
      }
      return .lookahead(negated: mod == 0x21, child: body)
    }

    mutating func parseAtomEscape(escOffset: Int) throws -> RegexNode {
      guard !atEnd else {
        throw RegexSyntaxError("Trailing backslash at end of pattern", offset: escOffset)
      }
      let cp = try next()
      if cp == 0x62 { return .anchor(.wordBoundary) }  // 'b'
      if cp == 0x42 { return .anchor(.notWordBoundary) }  // 'B'
      if let ranges = classEscapeRanges(cp) {
        return .charSet(ranges)
      }
      if let scalar = try parseScalarEscape(cp, escOffset: escOffset) {
        return .charSet([CodePointRange(start: scalar, end: scalar)])
      }
      throw RegexSyntaxError("Unsupported escape sequence", offset: escOffset)
    }

    mutating func parseScalarEscape(_ cp: UInt32, escOffset: Int) throws -> UInt32? {
      switch cp {
      case 0x74: return 0x09  // \t
      case 0x6E: return 0x0A  // \n
      case 0x72: return 0x0D  // \r
      case 0x66: return 0x0C  // \f
      case 0x76: return 0x0B  // \v
      case 0x78:  // \xHH
        return try readFixedHex(digits: 2, escOffset: escOffset)
      case 0x75:  // \uHHHH or \u{H..}
        if eat(0x7B) {
          return try readBracedHex(escOffset: escOffset)
        }
        let val = try readFixedHex(digits: 4, escOffset: escOffset)
        if val >= 0xD800 && val <= 0xDFFF {
          throw RegexSyntaxError("Lone surrogate in \\uHHHH escape", offset: escOffset)
        }
        return val
      default:
        if isSyntaxChar(cp) {
          return cp
        }
        return nil
      }
    }

    mutating func readFixedHex(digits: Int, escOffset: Int) throws -> UInt32 {
      var val: UInt32 = 0
      for _ in 0..<digits {
        guard let c = peek(), let d = hexDigitValue(c) else {
          throw RegexSyntaxError("Malformed hex escape", offset: escOffset)
        }
        _ = try next()
        val = (val << 4) | d
      }
      return val
    }

    mutating func readBracedHex(escOffset: Int) throws -> UInt32 {
      var val: UInt32 = 0
      var count = 0
      while let c = peek(), c != 0x7D {
        guard let d = hexDigitValue(c) else {
          throw RegexSyntaxError("Invalid hex digit in \\u{...} escape", offset: escOffset)
        }
        _ = try next()
        count += 1
        if count > 6 {
          throw RegexSyntaxError("Too many hex digits in \\u{...} escape", offset: escOffset)
        }
        val = (val << 4) | d
      }
      guard count > 0, eat(0x7D) else {
        throw RegexSyntaxError("Malformed \\u{...} escape", offset: escOffset)
      }
      if val > RegexSubset.maxCodePoint || (val >= 0xD800 && val <= 0xDFFF) {
        throw RegexSyntaxError("Unicode escape out of scalar range", offset: escOffset)
      }
      return val
    }

    mutating func parseCharClass(startOffset: Int) throws -> RegexNode {
      let negated = eat(0x5E)  // '^'
      if peek() == 0x5D {
        throw RegexSyntaxError("Empty character class is not allowed", offset: startOffset)
      }
      var ranges: [CodePointRange] = []
      while !atEnd && peek() != 0x5D {
        let firstAtom = try parseClassAtom()
        if peek() == 0x2D && peek(1) != 0x5D {
          let dashOffset = pos
          _ = try next()  // consume '-'
          if peek() == 0x2D {
            throw RegexSyntaxError(
              "Character class subtraction is not supported",
              offset: dashOffset
            )
          }
          if atEnd {
            throw RegexSyntaxError("Unclosed character class '['", offset: startOffset)
          }
          let secondAtom = try parseClassAtom()
          guard let lo = firstAtom.single, let hi = secondAtom.single else {
            throw RegexSyntaxError(
              "Character class range endpoint cannot be a shorthand class",
              offset: dashOffset
            )
          }
          if lo > hi {
            throw RegexSyntaxError("Character class range out of order", offset: dashOffset)
          }
          ranges.append(CodePointRange(start: lo, end: hi))
        } else {
          ranges.append(contentsOf: firstAtom.ranges)
        }
      }
      guard eat(0x5D) else {
        throw RegexSyntaxError("Unclosed character class '['", offset: startOffset)
      }
      let normalized =
        negated
        ? RegexSubset.complementRanges(ranges)
        : RegexSubset.normalizeRanges(ranges)
      return .charSet(normalized)
    }

    mutating func parseClassAtom() throws -> (single: UInt32?, ranges: [CodePointRange]) {
      let atomOffset = pos
      let cp = try next()
      if cp == 0x5B {  // '['
        throw RegexSyntaxError(
          "Nested character class or POSIX class is not supported",
          offset: atomOffset
        )
      }
      if cp == 0x26 && peek() == 0x26 {  // '&&'
        throw RegexSyntaxError(
          "Character class intersection is not supported",
          offset: atomOffset
        )
      }
      if cp == 0x5C {  // '\'
        guard !atEnd else {
          throw RegexSyntaxError("Trailing backslash in character class", offset: atomOffset)
        }
        let esc = try next()
        if let classRanges = classEscapeRanges(esc) {
          return (nil, classRanges)
        }
        if let scalar = try parseScalarEscape(esc, escOffset: atomOffset) {
          return (scalar, [CodePointRange(start: scalar, end: scalar)])
        }
        throw RegexSyntaxError("Unsupported escape in character class", offset: atomOffset)
      }
      return (cp, [CodePointRange(start: cp, end: cp)])
    }

    func classEscapeRanges(_ cp: UInt32) -> [CodePointRange]? {
      switch cp {
      case 0x64: return RegexSubset.digitRanges  // \d
      case 0x44: return RegexSubset.nonDigitRanges  // \D
      case 0x77: return RegexSubset.wordRanges  // \w
      case 0x57: return RegexSubset.nonWordRanges  // \W
      case 0x73: return RegexSubset.spaceRanges  // \s
      case 0x53: return RegexSubset.nonSpaceRanges  // \S
      default: return nil
      }
    }

    func isQuantifierStart(_ cp: UInt32) -> Bool {
      cp == 0x2A || cp == 0x2B || cp == 0x3F || cp == 0x7B
    }

    func isSyntaxChar(_ cp: UInt32) -> Bool {
      switch cp {
      case 0x5E, 0x24, 0x5C, 0x2E, 0x2A, 0x2B, 0x3F,
        0x28, 0x29, 0x5B, 0x5D, 0x7B, 0x7D, 0x7C, 0x2F, 0x2D:
        return true
      default:
        return false
      }
    }

    func hexDigitValue(_ cp: UInt32) -> UInt32? {
      if cp >= 0x30 && cp <= 0x39 { return cp - 0x30 }
      if cp >= 0x41 && cp <= 0x46 { return cp - 0x41 + 10 }
      if cp >= 0x61 && cp <= 0x66 { return cp - 0x61 + 10 }
      return nil
    }
  }

  // MARK: - Static safety guard (Rules 1-4)

  public static func isNullable(_ node: RegexNode) -> Bool {
    switch node {
    case .empty, .anchor, .lookahead:
      return true
    case .charSet:
      return false
    case .group(_, let child):
      return isNullable(child)
    case .repeatNode(let child, let min, _, _):
      return min == 0 || isNullable(child)
    case .concat(let items):
      return items.allSatisfy(isNullable)
    case .alt(let branches):
      return branches.contains(where: isNullable)
    }
  }

  public static func firstSet(_ node: RegexNode) -> [CodePointRange] {
    switch node {
    case .empty, .anchor, .lookahead:
      return []
    case .charSet(let ranges):
      return ranges
    case .group(_, let child):
      return firstSet(child)
    case .repeatNode(let child, _, let max, _):
      return max == 0 ? [] : firstSet(child)
    case .concat(let items):
      var acc: [CodePointRange] = []
      for item in items {
        acc.append(contentsOf: firstSet(item))
        if !isNullable(item) { break }
      }
      return normalizeRanges(acc)
    case .alt(let branches):
      return normalizeRanges(branches.flatMap(firstSet))
    }
  }

  public static func charsSet(_ node: RegexNode) -> [CodePointRange] {
    switch node {
    case .empty, .anchor, .lookahead:
      return []
    case .charSet(let ranges):
      return ranges
    case .group(_, let child):
      return charsSet(child)
    case .repeatNode(let child, _, let max, _):
      return max == 0 ? [] : charsSet(child)
    case .concat(let items):
      return normalizeRanges(items.flatMap(charsSet))
    case .alt(let branches):
      return normalizeRanges(branches.flatMap(charsSet))
    }
  }

  private static func unwrap(_ node: RegexNode) -> RegexNode {
    var cur = node
    while case .group(_, let child) = cur {
      cur = child
    }
    return cur
  }

  private static func hasUnbounded(_ node: RegexNode) -> Bool {
    switch node {
    case .empty, .charSet, .anchor:
      return false
    case .group(_, let child), .lookahead(_, let child):
      return hasUnbounded(child)
    case .repeatNode(let child, _, let max, _):
      return max == nil || hasUnbounded(child)
    case .concat(let items):
      return items.contains(where: hasUnbounded)
    case .alt(let branches):
      return branches.contains(where: hasUnbounded)
    }
  }

  private static func hasNestedQuantifier(_ node: RegexNode) -> Bool {
    switch node {
    case .empty, .charSet, .anchor:
      return false
    case .group(_, let child), .lookahead(_, let child):
      return hasNestedQuantifier(child)
    case .repeatNode(let child, _, let max, _):
      if (max == nil || max! > 1) && hasUnbounded(child) {
        return true
      }
      return hasNestedQuantifier(child)
    case .concat(let items):
      return items.contains(where: hasNestedQuantifier)
    case .alt(let branches):
      return branches.contains(where: hasNestedQuantifier)
    }
  }

  private static func collectAltBranches(_ node: RegexNode, into out: inout [RegexNode]) {
    switch node {
    case .alt(let branches):
      for b in branches {
        collectAltBranches(b, into: &out)
      }
    case .group(_, let child):
      collectAltBranches(child, into: &out)
    default:
      out.append(node)
    }
  }

  private static func altBranchesOverlap(_ altNode: RegexNode) -> Bool {
    var branches: [RegexNode] = []
    collectAltBranches(altNode, into: &branches)
    let firstSets = branches.map { firstSet(unwrap($0)) }
    for i in 0..<firstSets.count {
      for j in (i + 1)..<firstSets.count {
        if rangesOverlap(firstSets[i], firstSets[j]) {
          return true
        }
      }
    }
    return false
  }

  private static func containsOverlappingAlt(_ node: RegexNode) -> Bool {
    switch node {
    case .empty, .charSet, .anchor, .lookahead:
      return false
    case .group(_, let child), .repeatNode(let child, _, _, _):
      return containsOverlappingAlt(child)
    case .concat(let items):
      return items.contains(where: containsOverlappingAlt)
    case .alt(let branches):
      return altBranchesOverlap(node) || branches.contains(where: containsOverlappingAlt)
    }
  }

  private static func hasOverlappingAlternation(_ node: RegexNode) -> Bool {
    switch node {
    case .empty, .charSet, .anchor:
      return false
    case .group(_, let child), .lookahead(_, let child):
      return hasOverlappingAlternation(child)
    case .repeatNode(let child, _, let max, _):
      if (max == nil || max! > 1) && containsOverlappingAlt(child) {
        return true
      }
      return hasOverlappingAlternation(child)
    case .concat(let items):
      return items.contains(where: hasOverlappingAlternation)
    case .alt(let branches):
      return branches.contains(where: hasOverlappingAlternation)
    }
  }

  private static func flattenConcat(_ node: RegexNode, into out: inout [RegexNode]) {
    switch node {
    case .concat(let items):
      for item in items {
        flattenConcat(item, into: &out)
      }
    case .group(_, let child):
      flattenConcat(child, into: &out)
    default:
      out.append(node)
    }
  }

  private static func concatHasAdjacentOverlap(_ concatNode: RegexNode) -> Bool {
    var items: [RegexNode] = []
    flattenConcat(concatNode, into: &items)
    for i in 0..<items.count {
      guard case .repeatNode(let xChild, _, let xMax, _) = unwrap(items[i]),
        xMax == nil
      else {
        continue
      }
      let xChars = charsSet(xChild)
      for j in (i + 1)..<items.count {
        if case .repeatNode(let yChild, _, let yMax, _) = unwrap(items[j]),
          yMax == nil
        {
          if rangesOverlap(xChars, charsSet(yChild)) {
            return true
          }
        }
        if !isNullable(items[j]) {
          break
        }
      }
    }
    return false
  }

  private static func hasAdjacentOverlap(_ node: RegexNode) -> Bool {
    switch node {
    case .empty, .charSet, .anchor:
      return false
    case .group(_, let child), .lookahead(_, let child), .repeatNode(let child, _, _, _):
      return hasAdjacentOverlap(child)
    case .alt(let branches):
      return branches.contains(where: hasAdjacentOverlap)
    case .concat(let items):
      return concatHasAdjacentOverlap(node) || items.contains(where: hasAdjacentOverlap)
    }
  }

  /// Evaluates the four static safety rules on `pattern` and its parsed `tree`.
  public static func checkSafety(_ pattern: String, tree: RegexNode) -> RegexRejection? {
    if pattern.unicodeScalars.count > maxPatternCodePoints {
      return .patternTooLong
    }
    if hasNestedQuantifier(tree) {
      return .nestedQuantifier
    }
    if hasOverlappingAlternation(tree) {
      return .overlappingAlternation
    }
    if hasAdjacentOverlap(tree) {
      return .adjacentOverlap
    }
    return nil
  }

  /// Validates `pattern` against both the portable grammar and the static safety guard.
  public static func analyze(_ pattern: String) -> RegexAnalysisResult {
    if pattern.unicodeScalars.count > maxPatternCodePoints {
      return .rejected(
        .patternTooLong,
        detail: "Pattern exceeds \(maxPatternCodePoints) Unicode code points"
      )
    }
    let ast: RegexNode
    do {
      ast = try parse(pattern)
    } catch let err as RegexSyntaxError {
      return .rejected(.unsupportedSyntax, detail: err.message)
    } catch {
      return .rejected(.unsupportedSyntax, detail: "\(error)")
    }
    if let rejection = checkSafety(pattern, tree: ast) {
      return .rejected(rejection)
    }
    return .accepted(ast)
  }

  // MARK: - ICU Translation

  /// Translates a validated `RegexNode` AST into an ICU (`NSRegularExpression`)
  /// pattern with identical portable semantics.
  public static func translateToICU(_ tree: RegexNode) -> String {
    switch tree {
    case .empty:
      return ""
    case .anchor(let kind):
      switch kind {
      case .start:
        return "\\A"
      case .end:
        return "\\z"
      case .wordBoundary:
        return asciiWordBoundary
      case .notWordBoundary:
        return asciiNonWordBoundary
      }
    case .charSet(let ranges):
      return translateCharSetToICU(ranges)
    case .group(let capturing, let child):
      let inner = translateToICU(child)
      return capturing ? "(\(inner))" : "(?:\(inner))"
    case .lookahead(let negated, let child):
      let prefix = negated ? "(?!" : "(?="
      return "\(prefix)\(translateToICU(child)))"
    case .concat(let items):
      return items.map { item -> String in
        if case .alt = item {
          return "(?:\(translateToICU(item)))"
        }
        return translateToICU(item)
      }.joined()
    case .alt(let branches):
      return branches.map(translateToICU).joined(separator: "|")
    case .repeatNode(let child, let min, let max, let lazy):
      let atom: String
      switch child {
      case .concat, .alt, .repeatNode:
        atom = "(?:\(translateToICU(child)))"
      default:
        atom = translateToICU(child)
      }
      let suffix: String
      if min == 0 && max == nil {
        suffix = "*"
      } else if min == 1 && max == nil {
        suffix = "+"
      } else if min == 0 && max == 1 {
        suffix = "?"
      } else if let max, min == max {
        suffix = "{\(min)}"
      } else if let max {
        suffix = "{\(min),\(max)}"
      } else {
        suffix = "{\(min),}"
      }
      return "\(atom)\(suffix)\(lazy ? "?" : "")"
    }
  }

  private static func translateCharSetToICU(_ ranges: [CodePointRange]) -> String {
    var scalarRanges: [CodePointRange] = []
    for r in ranges {
      if r.start < 0xD800 {
        let hi = Swift.min(r.end, 0xD7FF)
        if r.start <= hi {
          scalarRanges.append(CodePointRange(start: r.start, end: hi))
        }
      }
      if r.end > 0xDFFF {
        let lo = Swift.max(r.start, 0xE000)
        if lo <= r.end {
          scalarRanges.append(CodePointRange(start: lo, end: r.end))
        }
      }
    }
    guard !scalarRanges.isEmpty else {
      return "(?!)"
    }
    var parts: [String] = ["["]
    for r in scalarRanges {
      if r.start == r.end {
        parts.append(encodeICUClassScalar(r.start))
      } else {
        parts.append("\(encodeICUClassScalar(r.start))-\(encodeICUClassScalar(r.end))")
      }
    }
    parts.append("]")
    return parts.joined()
  }

  private static func encodeICUClassScalar(_ cp: UInt32) -> String {
    if (cp >= 0x30 && cp <= 0x39)
      || (cp >= 0x41 && cp <= 0x5A)
      || (cp >= 0x61 && cp <= 0x7A)
      || cp == 0x5F
    {
      return String(UnicodeScalar(cp)!)
    }
    return String(format: "\\x{%X}", cp)
  }

  // MARK: - Cached compiler & evaluation

  private static let cacheLock = NSLock()
  private nonisolated(unsafe) static var cacheOrder: [String] = []
  private nonisolated(unsafe) static var cacheMap: [String: NSRegularExpression] = [:]

  /// Validates `pattern` against the portable regex subset and static safety guard,
  /// translates it to ICU syntax, and returns a cached `NSRegularExpression`.
  public static func compileGuarded(_ pattern: String) throws -> NSRegularExpression {
    cacheLock.lock()
    if let existing = cacheMap[pattern] {
      if let idx = cacheOrder.firstIndex(of: pattern) {
        cacheOrder.remove(at: idx)
      }
      cacheOrder.append(pattern)
      cacheLock.unlock()
      return existing
    }
    cacheLock.unlock()

    let analysis = analyze(pattern)
    guard analysis.ok, let ast = analysis.ast else {
      let token = analysis.reason?.rawValue ?? RegexRejection.unsupportedSyntax.rawValue
      let detail = analysis.detail.map { ": \($0)" } ?? ""
      throw FunctionError.executionFailed(
        name: "regex",
        message: "Invalid or unsafe regular expression '\(pattern)' [\(token)]\(detail)"
      )
    }

    let icuPattern = translateToICU(ast)
    let compiled: NSRegularExpression
    do {
      compiled = try NSRegularExpression(pattern: icuPattern, options: [])
    } catch {
      let token = RegexRejection.unsupportedSyntax.rawValue
      throw FunctionError.executionFailed(
        name: "regex",
        message: "Invalid regular expression '\(pattern)' [\(token)]: \(error)"
      )
    }

    cacheLock.lock()
    if cacheMap[pattern] == nil {
      if cacheOrder.count >= cacheCapacity, let oldest = cacheOrder.first {
        cacheOrder.removeFirst()
        cacheMap.removeValue(forKey: oldest)
      }
      cacheOrder.append(pattern)
      cacheMap[pattern] = compiled
    }
    cacheLock.unlock()
    return compiled
  }

  /// Evaluates `pattern` against `value` under the portable A2UI regex contract.
  ///
  /// Returns `nil` when `value` exceeds `maxValueCodePoints` (4,096) Unicode
  /// scalars, or a boolean indicating whether a match was found.
  public static func test(pattern: String, value: String) throws -> Bool? {
    let regex = try compileGuarded(pattern)
    if value.unicodeScalars.count > maxValueCodePoints {
      return nil
    }
    let nsRange = NSRange(value.startIndex..<value.endIndex, in: value)
    return regex.firstMatch(in: value, options: [], range: nsRange) != nil
  }
}
