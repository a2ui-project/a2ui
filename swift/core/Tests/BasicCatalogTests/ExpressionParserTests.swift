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

  @Test func returnsErrorOnMaxDepthExceeded() {
    #expect(throws: FunctionError.self) {
      _ = try parser.parse("depth", depth: ExpressionParser.maxDepth + 1)
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

  @Test func distinguishesIntegerAndFloatingPointNumberLiterals() throws {
    #expect(try parser.parseExpression("42") == .integer(42))
    #expect(try parser.parseExpression("-3.5") == .number(-3.5))
    #expect(try parser.parseExpression("1e5") == .number(100_000))
  }

  @Test func rejectsTemplateExceedingMaxLength() {
    #expect(ExpressionParser.maxTemplateLength == 10_000)
    let oversized = String(repeating: "a", count: ExpressionParser.maxTemplateLength + 1)
    let message = executionFailedMessage {
      _ = try parser.parse(oversized)
    }
    #expect(message?.contains("exceeds maximum limit") == true)
  }

  @Test func rejectsExpressionExceedingMaxParts() {
    #expect(ExpressionParser.maxTemplateParts == 1_000)
    let manyParts = String(repeating: "${x}", count: ExpressionParser.maxTemplateParts + 1)
    let message = executionFailedMessage {
      _ = try parser.parse(manyParts)
    }
    #expect(message?.contains("parts count exceeds maximum limit") == true)
  }

  private func executionFailedMessage(_ body: () throws -> Void) -> String? {
    do {
      try body()
      return nil
    } catch FunctionError.executionFailed(_, let message) {
      return message
    } catch {
      return nil
    }
  }
}
