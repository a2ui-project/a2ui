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
import BasicCatalog
import OrderedJSON
import Testing

struct ExpressionParserTests {
  let parser = ExpressionParser()

  @Test func parsesLiteralStringsUnchanged() throws {
    let result = try parser.parse("hello world")
    #expect(result == [.string("hello world")])
  }

  @Test func parsesSimpleInterpolation() throws {
    let result = try parser.parse("hello ${foo}")
    #expect(result == [.string("hello "), .object(["path": .string("foo")])])
  }

  @Test func parsesNumberInterpolation() throws {
    let result = try parser.parse("number is ${num}")
    #expect(result == [.string("number is "), .object(["path": .string("num")])])
  }

  @Test func parsesNestedInterpolation() throws {
    let result = try parser.parse("val is ${${nested}}")
    #expect(result == [.string("val is "), .object(["path": .string("nested")])])
  }

  @Test func handlesEscapedInterpolation() throws {
    let result = try parser.parse("escaped \\${foo}")
    #expect(result == [.string("escaped "), .string("${"), .string("foo}")])
  }

  @Test func parsesFunctionCalls() throws {
    let result = try parser.parse("sum is ${add(a: 10, b: 20)}")
    #expect(
      result == [
        .string("sum is "),
        .object([
          "call": .string("add"),
          "args": .object(["a": .integer(10), "b": .integer(20)]),
          "returnType": .string("any"),
        ]),
      ]
    )
  }

  @Test func parsesFunctionCallsWithStringLiterals() throws {
    let result = try parser.parse("case is ${upper(text: \"hello\")}")
    #expect(
      result == [
        .string("case is "),
        .object([
          "call": .string("upper"),
          "args": .object(["text": .string("hello")]),
          "returnType": .string("any"),
        ]),
      ]
    )
  }

  @Test func parsesKeywords() throws {
    let result = try parser.parse("${true} ${false} ${null}")
    #expect(result == [.boolean(true), .string(" "), .boolean(false), .string(" ")])
  }

  @Test func returnsErrorOnMaxDepthExceeded() {
    #expect(throws: FunctionError.self) {
      _ = try parser.parse("depth", depth: ExpressionParser.maxDepth + 1)
    }
  }

  @Test func handlesDeepRecursionGracefully() throws {
    let result = try parser.parse("${${\"hello\"}}")
    #expect(result == [.string("hello")])
  }

  @Test func returnsErrorOnUnclosedInterpolation() {
    #expect(throws: FunctionError.self) {
      _ = try parser.parse("hello ${world")
    }
  }

  @Test func returnsErrorOnInvalidFunctionSyntax() {
    #expect(throws: FunctionError.self) {
      _ = try parser.parse("${add(a: 1, b: 2}")
    }
  }

  @Test func returnsErrorOnUnexpectedCharactersAtEnd() {
    #expect(throws: FunctionError.self) {
      _ = try parser.parse("${true false}")
    }
  }

  @Test func handlesEmptyIdentifiers() throws {
    let result = try parser.parse("${()}")
    #expect(
      result == [
        .object([
          "call": .string(""),
          "args": .object([:]),
          "returnType": .string("any"),
        ])
      ]
    )
    #expect(try parser.parseExpression("") == .string(""))
    #expect(
      try parser.parseExpression("()")
        == .object([
          "call": .string(""),
          "args": .object([:]),
          "returnType": .string("any"),
        ])
    )
  }

  @Test func handlesStringLiteralsWithEscapedCharacters() throws {
    let result = try parser.parseExpression(#"'line1\nline2\t\r\'\\x'"#)
    #expect(result == .string("line1\nline2\t\r'\\x"))
  }

  @Test func handlesParsingPathsWithSpecialCharacters() throws {
    let result = try parser.parseExpression("my-path.with_underscores")
    #expect(result == .object(["path": .string("my-path.with_underscores")]))
  }

  @Test func parsesSignedAndExponentNumberLiterals() throws {
    #expect(try parser.parseExpression("42") == .integer(42))
    #expect(try parser.parseExpression("-42") == .integer(-42))
    #expect(try parser.parseExpression("+42") == .integer(42))
    #expect(try parser.parseExpression("-3.5") == .number(-3.5))
    #expect(try parser.parseExpression("1.") == .number(1))
    #expect(try parser.parseExpression("1e5") == .number(100_000))
    #expect(try parser.parseExpression("1.5e-3") == .number(0.0015))
    #expect(try parser.parseExpression("2.5E+4") == .number(25_000))
  }

  @Test func parsesLeadingDotNumberLiterals() throws {
    #expect(try parser.parseExpression(".5") == .number(0.5))
    #expect(try parser.parseExpression("-.5") == .number(-0.5))
    #expect(try parser.parseExpression("+.5") == .number(0.5))
    #expect(try parser.parseExpression(".5e2") == .number(50))
    #expect(try parser.parseExpression("-.5E-1") == .number(-0.05))
  }

  @Test func parsesSignedNumberLiteralsAsFunctionArguments() throws {
    let result = try parser.parseExpression("f(a: -.5, b: +10)")
    #expect(
      result
        == .object([
          "call": .string("f"),
          "args": .object(["a": .number(-0.5), "b": .integer(10)]),
          "returnType": .string("any"),
        ])
    )
  }

  @Test(arguments: [".foo", "./x", "-.", ".e5", "a-1", "a.5", "/items/.5", "-foo"])
  func keepsPathsThatStartWithOrContainASignOrDot(expr: String) throws {
    #expect(try parser.parseExpression(expr) == .object(["path": .string(expr)]))
  }

  @Test(arguments: ["1.2.3", ".5.5", "1e", "-.5e", ".5e+", "-1x"])
  func rejectsMalformedNumberLiterals(expr: String) {
    #expect(throws: FunctionError.self) {
      _ = try parser.parseExpression(expr)
    }
  }

  @Test func returnsErrorOnMissingColonInFunctionArgs() {
    #expect(throws: FunctionError.self) {
      _ = try parser.parseExpression("add(a 10, b: 20)")
    }
  }
}
