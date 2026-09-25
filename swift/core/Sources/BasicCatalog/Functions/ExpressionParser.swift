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
import OrderedCollections
import OrderedJSON

/// A parser for A2UI expressions, supporting string interpolation and function calls.
///
/// Converts template strings containing `${...}` placeholders into arrays of `JSONValue`
/// items representing literals, data-model paths, and nested function calls.
public struct ExpressionParser: Sendable {
  /// Maximum recursion depth allowed during expression parsing.
  ///
  /// Every engine uses the same number: `ExpressionParser.MAX_DEPTH` in
  /// TypeScript and Python. They must agree, or an expression one engine
  /// accepts the other rejects.
  public static let maxDepth = 100

  public init() {}

  /// Parses an input template string into an array of dynamic `JSONValue` parts.
  ///
  /// - Parameters:
  ///   - input: The raw template string to parse.
  ///   - depth: The current recursion depth.
  /// - Returns: An array of `JSONValue` elements (literals, paths, function calls).
  /// - Throws: `FunctionError` if recursion depth is exceeded or syntax is invalid.
  public func parse(_ input: String, depth: Int = 0) throws -> [JSONValue] {
    if depth > Self.maxDepth {
      throw FunctionError.executionFailed(
        name: "expressionParser",
        message: "Max recursion depth reached in parse"
      )
    }
    if input.isEmpty || !input.contains("${") {
      return input.isEmpty ? [] : [.string(input)]
    }

    var parts: [JSONValue] = []
    var scanner = Scanner(input)

    while !scanner.isAtEnd {
      if scanner.matches("${") {
        scanner.advance(by: 2)
        let content = try extractInterpolationContent(&scanner)
        let parsed = try parseExpression(content, depth: depth + 1)
        if parsed != .string("") && parsed != .null {
          parts.append(parsed)
        }
      } else if scanner.matches("\\${") {
        scanner.advance(by: 1)
        parts.append(.string("${"))
        scanner.advance(by: 2)
      } else {
        let start = scanner.pos
        while !scanner.isAtEnd {
          if scanner.matches("${") || scanner.matches("\\${") {
            break
          }
          scanner.advance(by: 1)
        }
        let textContent = String(scanner.input[start..<scanner.pos])
        if !textContent.isEmpty {
          parts.append(.string(textContent))
        }
      }
    }

    return parts.filter {
      if case .string(let s) = $0, s.isEmpty {
        return false
      }
      return true
    }
  }

  /// Parses a single expression string into a `JSONValue`.
  ///
  /// - Parameters:
  ///   - expr: The expression string (content inside `${...}`).
  ///   - depth: The current recursion depth.
  /// - Returns: The parsed `JSONValue`.
  public func parseExpression(_ expr: String, depth: Int = 0) throws -> JSONValue {
    if depth > Self.maxDepth {
      throw FunctionError.executionFailed(
        name: "expressionParser",
        message: "Max recursion depth reached in parse"
      )
    }
    let trimmed = expr.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return .string("")
    }

    var scanner = Scanner(trimmed)
    let result = try parseExpressionInternal(&scanner, depth: depth)
    scanner.skipWhitespace()
    if !scanner.isAtEnd {
      let remaining = String(scanner.input[scanner.pos...])
      throw FunctionError.executionFailed(
        name: "expressionParser",
        message: "Unexpected characters at end of expression: '\(remaining)'"
      )
    }
    return result
  }

  // MARK: - Internal Parsing Helpers

  private func extractInterpolationContent(_ scanner: inout Scanner) throws -> String {
    let start = scanner.pos
    var braceBalance = 1

    while !scanner.isAtEnd && braceBalance > 0 {
      let char = scanner.advance(by: 1)
      if char == "{" {
        braceBalance += 1
      } else if char == "}" {
        braceBalance -= 1
      } else if char == "'" || char == "\"" {
        let quote = Character(char)
        while !scanner.isAtEnd {
          let c = scanner.advance(by: 1)
          if c == "\\" {
            if !scanner.isAtEnd {
              _ = scanner.advance(by: 1)
            }
          } else if c == String(quote) {
            break
          }
        }
      }
    }

    if braceBalance > 0 {
      throw FunctionError.executionFailed(
        name: "expressionParser",
        message: "Unclosed interpolation: missing '}'"
      )
    }

    let end = scanner.input.index(before: scanner.pos)
    return String(scanner.input[start..<end])
  }

  private func parseExpressionInternal(_ scanner: inout Scanner, depth: Int) throws -> JSONValue {
    // Both recursive paths pass through here: interpolations nested inside an interpolation,
    // and function-call arguments that are themselves expressions. Checking here counts both.
    if depth > Self.maxDepth {
      throw FunctionError.executionFailed(
        name: "expressionParser",
        message: "Max recursion depth reached in parse"
      )
    }
    scanner.skipWhitespace()
    if scanner.isAtEnd {
      return .string("")
    }

    // 0. Nested Interpolation (${...})
    if scanner.matches("${") {
      scanner.advance(by: 2)
      let content = try extractInterpolationContent(&scanner)
      return try parseExpression(content, depth: depth + 1)
    }

    // 1. String literals ('...' or "...")
    if let char = scanner.peek(), char == "'" || char == "\"" {
      return .string(parseStringLiteral(&scanner))
    }

    // 2. Number literals
    if isNumberStart(scanner) {
      return try parseNumberLiteral(&scanner)
    }

    // 3. Keywords
    if scanner.matchesKeyword("true") {
      return .boolean(true)
    }
    if scanner.matchesKeyword("false") {
      return .boolean(false)
    }
    if scanner.matchesKeyword("null") {
      return .string("")
    }

    // 4. Identifiers / Paths / Function calls
    let token = scanPathOrIdentifier(&scanner)
    scanner.skipWhitespace()

    if scanner.peek() == "(" {
      return try parseFunctionCall(funcName: token, scanner: &scanner, depth: depth)
    } else {
      if token.isEmpty {
        return .string("")
      }
      return .object(["path": .string(token)])
    }
  }

  private func parseFunctionCall(
    funcName: String,
    scanner: inout Scanner,
    depth: Int
  ) throws -> JSONValue {
    _ = scanner.match("(")
    scanner.skipWhitespace()

    var args: OrderedDictionary<String, JSONValue> = [:]

    while !scanner.isAtEnd && scanner.peek() != ")" {
      let argName = scanIdentifier(&scanner)
      scanner.skipWhitespace()
      if !scanner.match(":") {
        throw FunctionError.executionFailed(
          name: "expressionParser",
          message: "Expected ':' after argument name '\(argName)' in function '\(funcName)'"
        )
      }
      scanner.skipWhitespace()

      let argVal = try parseExpressionInternal(&scanner, depth: depth + 1)
      args[argName] = argVal

      scanner.skipWhitespace()
      if scanner.peek() == "," {
        _ = scanner.advance(by: 1)
        scanner.skipWhitespace()
      }
    }

    if !scanner.match(")") {
      throw FunctionError.executionFailed(
        name: "expressionParser",
        message: "Expected ')' after function arguments for '\(funcName)'"
      )
    }

    var dict: OrderedDictionary<String, JSONValue> = [:]
    dict["call"] = .string(funcName)
    dict["args"] = .object(args)
    dict["returnType"] = .string("any")
    return .object(dict)
  }

  private func scanPathOrIdentifier(_ scanner: inout Scanner) -> String {
    let start = scanner.pos
    while !scanner.isAtEnd, let c = scanner.peek() {
      if c.isLetter || c.isNumber || c == "/" || c == "." || c == "_" || c == "-" {
        _ = scanner.advance(by: 1)
      } else {
        break
      }
    }
    return String(scanner.input[start..<scanner.pos])
  }

  private func scanIdentifier(_ scanner: inout Scanner) -> String {
    let start = scanner.pos
    while !scanner.isAtEnd, let c = scanner.peek() {
      if c.isLetter || c.isNumber || c == "_" {
        _ = scanner.advance(by: 1)
      } else {
        break
      }
    }
    return String(scanner.input[start..<scanner.pos])
  }

  private func parseStringLiteral(_ scanner: inout Scanner) -> String {
    let quote = Character(scanner.advance(by: 1))
    var result = ""
    while !scanner.isAtEnd {
      let c = Character(scanner.advance(by: 1))
      if c == "\\" {
        if !scanner.isAtEnd {
          let next = Character(scanner.advance(by: 1))
          switch next {
          case "n": result.append("\n")
          case "t": result.append("\t")
          case "r": result.append("\r")
          default: result.append(next)
          }
        }
      } else if c == quote {
        break
      } else {
        result.append(c)
      }
    }
    return result
  }

  /// Whether the scanner is at the start of a number literal: a digit, a `.` followed by a digit,
  /// or a `-` or `+` sign followed by either of those.
  ///
  /// The grammar has no arithmetic operators, so a sign here can only belong to a literal. A `-`
  /// or `.` inside a path such as `a-1` or `a.5` never reaches this check, because the path
  /// scanner consumes it as part of the token.
  private func isNumberStart(_ scanner: Scanner) -> Bool {
    let first = scanner.peek()
    let offset = (first == "-" || first == "+") ? 1 : 0
    if Self.isDigit(scanner.peek(offset: offset)) {
      return true
    }
    return scanner.peek(offset: offset) == "." && Self.isDigit(scanner.peek(offset: offset + 1))
  }

  /// Scans and validates a number literal.
  ///
  /// The accepted grammar is an optional sign, a mantissa (`5`, `5.`, `5.25` or `.5`), and an
  /// optional exponent (`e` or `E`, an optional sign, digits). It matches the TypeScript, Python
  /// and Dart parsers, which check the pattern `^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`.
  private func parseNumberLiteral(_ scanner: inout Scanner) throws -> JSONValue {
    let start = scanner.pos
    if scanner.peek() == "-" || scanner.peek() == "+" {
      scanner.advance(by: 1)
    }
    while let c = scanner.peek(), Self.isDigit(c) || c == "." {
      scanner.advance(by: 1)
    }
    if let c = scanner.peek(), c == "e" || c == "E" {
      scanner.advance(by: 1)
      if let sign = scanner.peek(), sign == "+" || sign == "-" {
        scanner.advance(by: 1)
      }
      while Self.isDigit(scanner.peek()) {
        scanner.advance(by: 1)
      }
    }
    let numStr = String(scanner.input[start..<scanner.pos])
    guard Self.isValidNumberLiteral(numStr) else {
      throw FunctionError.executionFailed(
        name: "expressionParser",
        message: "Invalid number literal: '\(numStr)'"
      )
    }
    let isInteger = !numStr.contains(where: { $0 == "." || $0 == "e" || $0 == "E" })
    if isInteger, let i = Int(numStr) {
      return .integer(i)
    }
    if let d = Double(numStr) {
      return .number(d)
    }
    throw FunctionError.executionFailed(
      name: "expressionParser",
      message: "Invalid number literal: '\(numStr)'"
    )
  }

  /// Checks `text` against `^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`.
  private static func isValidNumberLiteral(_ text: String) -> Bool {
    var chars = Substring(text)
    if let first = chars.first, first == "+" || first == "-" {
      chars = chars.dropFirst()
    }
    let intDigits = chars.prefix(while: { isDigit($0) })
    chars = chars.dropFirst(intDigits.count)
    var fracDigits = Substring()
    if chars.first == "." {
      chars = chars.dropFirst()
      fracDigits = chars.prefix(while: { isDigit($0) })
      chars = chars.dropFirst(fracDigits.count)
    }
    if intDigits.isEmpty && fracDigits.isEmpty {
      return false
    }
    if let e = chars.first, e == "e" || e == "E" {
      chars = chars.dropFirst()
      if let sign = chars.first, sign == "+" || sign == "-" {
        chars = chars.dropFirst()
      }
      let expDigits = chars.prefix(while: { isDigit($0) })
      if expDigits.isEmpty {
        return false
      }
      chars = chars.dropFirst(expDigits.count)
    }
    return chars.isEmpty
  }

  /// Whether `c` is an ASCII digit. `Character.isNumber` also accepts non-ASCII numerals such as
  /// `½`, which no other engine treats as part of a number literal.
  private static func isDigit(_ c: Character?) -> Bool {
    guard let c else { return false }
    return c >= "0" && c <= "9"
  }

  // MARK: - Nested Scanner

  private struct Scanner {
    let input: String
    var pos: String.Index

    init(_ input: String) {
      self.input = input
      self.pos = input.startIndex
    }

    var isAtEnd: Bool {
      pos >= input.endIndex
    }

    func peek(offset: Int = 0) -> Character? {
      guard let idx = input.index(pos, offsetBy: offset, limitedBy: input.endIndex),
        idx < input.endIndex
      else {
        return nil
      }
      return input[idx]
    }

    @discardableResult
    mutating func advance(by count: Int = 1) -> String {
      let start = pos
      pos = input.index(pos, offsetBy: count, limitedBy: input.endIndex) ?? input.endIndex
      return String(input[start..<pos])
    }

    mutating func match(_ expected: Character) -> Bool {
      guard !isAtEnd, input[pos] == expected else { return false }
      pos = input.index(after: pos)
      return true
    }

    func matches(_ expected: String) -> Bool {
      input[pos...].hasPrefix(expected)
    }

    mutating func matchesKeyword(_ keyword: String) -> Bool {
      if matches(keyword) {
        if let nextChar = peek(offset: keyword.count) {
          if nextChar.isLetter || nextChar.isNumber || nextChar == "_" {
            return false
          }
        }
        advance(by: keyword.count)
        return true
      }
      return false
    }

    mutating func skipWhitespace() {
      while !isAtEnd, let c = peek(), c.isWhitespace {
        _ = advance(by: 1)
      }
    }
  }
}
