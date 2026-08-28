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

private final class MockFunctionHandler: FunctionHandler, @unchecked Sendable {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    return nil
  }
}

struct RequiredFunctionTests {

  let function = RequiredFunction()
  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "required")
    #expect(function.api.returnType == .boolean)
  }

  // MARK: - Edge-Case Evaluation

  @Test func evaluatesToTrueWhenValueIsNotEmptyArray() throws {
    let result = try function.evaluate(
      arguments: ["value": .array([.string("test")])], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToFalseWhenValueIsEmptyArray() throws {
    let result = try function.evaluate(arguments: ["value": .array([])], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToTrueWhenValueIsNotEmptyObject() throws {
    let result = try function.evaluate(
      arguments: ["value": .object(["key": .string("value")])], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToFalseWhenValueIsEmptyObject() throws {
    let result = try function.evaluate(arguments: ["value": .object([:])], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToTrueWhenValueIsTrue() throws {
    let result = try function.evaluate(arguments: ["value": .boolean(true)], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToTrueWhenValueIsFalse() throws {
    let result = try function.evaluate(arguments: ["value": .boolean(false)], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToTrueWhenValueIsNumber() throws {
    let result = try function.evaluate(arguments: ["value": .number(0)], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToFalseWhenValueIsNull() throws {
    let result = try function.evaluate(arguments: ["value": .null], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToFalseWhenValueIsMissing() throws {
    let result = try function.evaluate(arguments: [:], context: context)
    #expect(result == .boolean(false))
  }
}
