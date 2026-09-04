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
struct NumericFunctionTests {

  let function = NumericFunction()
  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "numeric")
    #expect(function.api.returnType == .boolean)
  }

  // MARK: - Edge-Case & Boundary Evaluation

  @Test func evaluatesToTrueWhenWithinMinAndMax() throws {
    let result = try function.evaluate(
      arguments: ["value": .number(5), "min": .number(3), "max": .number(10)], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToFalseWhenLessThanMin() throws {
    let result = try function.evaluate(
      arguments: ["value": .number(2.5), "min": .number(3)], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToFalseWhenGreaterThanMax() throws {
    let result = try function.evaluate(
      arguments: ["value": .number(12), "max": .number(5)], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToTrueWhenOnlyMinIsProvidedAndValid() throws {
    let result = try function.evaluate(
      arguments: ["value": .number(4), "min": .number(3)], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToTrueWhenOnlyMaxIsProvidedAndValid() throws {
    let result = try function.evaluate(
      arguments: ["value": .number(8), "max": .number(10)], context: context)
    #expect(result == .boolean(true))
  }

  @Test func evaluatesToFalseWhenValueIsMissing() throws {
    let result = try function.evaluate(arguments: ["min": .number(3)], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToFalseWhenValueIsBoolean() throws {
    let result = try function.evaluate(
      arguments: ["value": .boolean(true), "min": .number(1)], context: context)
    #expect(result == .boolean(false))
  }
}
