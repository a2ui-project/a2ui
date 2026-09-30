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
import Foundation
import JSONSchema
import OrderedJSON
import Testing

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    if named == "upper" {
      return UpperFunction()
    }
    return nil
  }
}

private struct UpperFunction: FunctionImplementation, Sendable {
  let api = FunctionAPI(
    name: "upper", returnType: .string, schema: try! JSONSchema.Schema(instance: "{}"))

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    return .string(arguments["text"]?.stringValue?.uppercased() ?? "")
  }
}

@MainActor
struct FormatStringFunctionTests {

  let function = FormatStringFunction()
  let dataModel: DataModel
  let context: DataContext
  private let handler: MockFunctionHandler

  init() {
    let dm = DataModel()
    dm.set(JSONValue.absolutePath(for: "/user/name", in: ""), value: .string("Alice"))
    dm.set(JSONValue.absolutePath(for: "/count", in: ""), value: .integer(5))
    dm.set(JSONValue.absolutePath(for: "/price", in: ""), value: .number(9.99))
    dm.set(JSONValue.absolutePath(for: "/isTrue", in: ""), value: .boolean(true))
    self.dataModel = dm
    let h = MockFunctionHandler()
    self.handler = h
    self.context = DataContext(
      dataModel: dm, path: "", functionHandler: h)
  }

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "formatString")
    #expect(function.api.returnType == .string)
  }

  // MARK: - Evaluation

  @Test func formatsLiteralString() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("hello world")],
      context: context
    )
    #expect(result == .string("hello world"))
  }

  @Test func formatsStringWithDataPaths() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Hello ${/user/name}, you have ${/count} items.")],
      context: context
    )
    #expect(result == .string("Hello Alice, you have 5 items."))
  }

  @Test func formatsStringWithNestedFunctionCall() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Hello ${upper(text: 'bob')}")],
      context: context
    )
    #expect(result == .string("Hello BOB"))
  }

  @Test func formatsStringWithNumbersAndBooleans() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Price: ${/price}, Active: ${/isTrue}")],
      context: context
    )
    #expect(result == .string("Price: 9.99, Active: true"))
  }

  @Test func formatsEscapedInterpolation() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Cost is \\${/price}")],
      context: context
    )
    // Note: The expression parser leaves the inner text unevaluated.
    // Wait, the parser returns "${" and "/price}". So the string is "Cost is ${/price}" literally.
    #expect(result == .string("Cost is ${/price}"))
  }

  @Test func skipsNullValues() throws {
    let result = try function.evaluate(
      arguments: ["value": .string("Hello ${/missing/path}")],
      context: context
    )
    #expect(result == .string("Hello "))
  }

  @Test(arguments: [
    (JSONValue.array([.string("swift"), .string("ios")]), "[\"swift\",\"ios\"]"),
    (.object(["name": .string("Alice")]), "{\"name\":\"Alice\"}"),
    (.array([.integer(1), .null, .boolean(true)]), "[1,null,true]"),
    (.object(["items": .array([.object(["id": .integer(1)])])]), "{\"items\":[{\"id\":1}]}"),
    (
      .object(["z": .object(["b": .integer(2), "a": .integer(1)]), "a": .integer(0)]),
      "{\"z\":{\"b\":2,\"a\":1},\"a\":0}"
    ),
    (.array([]), "[]"),
    (.object([:]), "{}"),
  ])
  func formatsObjectsAndArraysAsJSON(value: JSONValue, expected: String) throws {
    dataModel.set("/payload", value: value)
    let result = try function.evaluate(
      arguments: ["value": .string("Value: ${/payload}!")], context: context)
    #expect(result == .string("Value: \(expected)!"))
  }

  @Test func throwsErrorWhenMissingValueArgument() {
    #expect(throws: FunctionError.self) {
      try function.evaluate(arguments: [:], context: context)
    }
  }
}
