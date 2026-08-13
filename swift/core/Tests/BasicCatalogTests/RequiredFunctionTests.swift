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

@Suite
struct RequiredFunctionTests {

  let function = RequiredFunction()
  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  @Test("Initializes with expected API")
  func initializes() {
    #expect(function.api.name == "required")
    #expect(function.api.returnType == .boolean)
  }

  @Test("Evaluates to true when value is not empty string")
  func evaluatesNonEmptyString() throws {
    let result = try function.evaluate(arguments: ["value": .string("test")], context: context)
    #expect(result == .boolean(true))
  }

  @Test("Evaluates to false when value is empty string")
  func evaluatesEmptyString() throws {
    let result = try function.evaluate(arguments: ["value": .string("")], context: context)
    #expect(result == .boolean(false))
  }

  @Test("Evaluates to true when value is not empty array")
  func evaluatesNonEmptyArray() throws {
    let result = try function.evaluate(
      arguments: ["value": .array([.string("test")])], context: context)
    #expect(result == .boolean(true))
  }

  @Test("Evaluates to false when value is empty array")
  func evaluatesEmptyArray() throws {
    let result = try function.evaluate(arguments: ["value": .array([])], context: context)
    #expect(result == .boolean(false))
  }

  @Test("Evaluates to true when value is not empty object")
  func evaluatesNonEmptyObject() throws {
    let result = try function.evaluate(
      arguments: ["value": .object(["key": .string("value")])], context: context)
    #expect(result == .boolean(true))
  }

  @Test("Evaluates to false when value is empty object")
  func evaluatesEmptyObject() throws {
    let result = try function.evaluate(arguments: ["value": .object([:])], context: context)
    #expect(result == .boolean(false))
  }

  @Test("Evaluates to true when value is true")
  func evaluatesTrue() throws {
    let result = try function.evaluate(arguments: ["value": .boolean(true)], context: context)
    #expect(result == .boolean(true))
  }

  @Test("Evaluates to true when value is false")
  func evaluatesFalseBool() throws {
    let result = try function.evaluate(arguments: ["value": .boolean(false)], context: context)
    #expect(result == .boolean(true))
  }

  @Test("Evaluates to true when value is number")
  func evaluatesNumber() throws {
    let result = try function.evaluate(arguments: ["value": .number(0)], context: context)
    #expect(result == .boolean(true))
  }

  @Test("Evaluates to false when value is null")
  func evaluatesNull() throws {
    let result = try function.evaluate(arguments: ["value": .null], context: context)
    #expect(result == .boolean(false))
  }

  @Test("Evaluates to false when value is missing")
  func evaluatesMissingValue() throws {
    let result = try function.evaluate(arguments: [:], context: context)
    #expect(result == .boolean(false))
  }
}
