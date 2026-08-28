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
      _ = try parser.parse("depth", depth: 11)
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

  @Test func returnsErrorOnMissingColonInFunctionArgs() {
    #expect(throws: FunctionError.self) {
      _ = try parser.parseExpression("add(a 10, b: 20)")
    }
  }
}
