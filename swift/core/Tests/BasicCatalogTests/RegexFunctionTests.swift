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
import Testing

@testable import BasicCatalog

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    return nil
  }
}

@MainActor
struct RegexFunctionTests {

  let function = RegexFunction()
  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "regex")
    #expect(function.api.returnType == .boolean)
  }

  // MARK: - Evaluation

  @Test func evaluatesToTrueWhenPatternMatches() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("hello world"), "pattern": .string("^hello")], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToFalseWhenPatternDoesNotMatch() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("world hello"), "pattern": .string("^hello")], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToTrueWhenPatternIsPartialMatch() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("foo bar baz"), "pattern": .string("bar")], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToFalseWhenPatternIsInvalid() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("foo"), "pattern": .string("[invalid")], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToFalseWhenValueIsMissing() throws {
    let result = try function.evaluate(
      arguments: ["pattern": .string(".*")], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToFalseWhenPatternIsMissing() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("foo")], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToFalseWhenValueIsNotAString() throws {
    let result = try function.evaluate(
      arguments: ["value": .number(123), "pattern": .string(".*")], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToFalseWhenPatternIsNotAString() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("foo"), "pattern": .boolean(true)], context: context)
    #expect(result == .boolean(false))
  }
}
