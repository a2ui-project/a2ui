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

@MainActor
private final class MockIndexFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    nil
  }
}

@MainActor
struct IndexFunctionTests {
  private let handler = MockIndexFunctionHandler()

  @Test func evaluatesIndexSuccessfully() throws {
    let fn = IndexFunction()
    let dataModel = DataModel()
    let context = DataContext(
      dataModel: dataModel, path: "/items/2", functionHandler: handler, index: 2)

    let result = try fn.evaluate(arguments: [:], context: context)
    #expect(result == JSONValue.integer(2))
  }

  @Test func evaluatesIndexWithOffset() throws {
    let fn = IndexFunction()
    let dataModel = DataModel()
    let context = DataContext(
      dataModel: dataModel, path: "/items/0", functionHandler: handler, index: 0)

    let result = try fn.evaluate(arguments: ["offset": .integer(1)], context: context)
    #expect(result == JSONValue.integer(1))
  }

  @Test func throwsOutsideCollectionScope() {
    let fn = IndexFunction()
    let dataModel = DataModel()
    let context = DataContext(dataModel: dataModel, path: "/items", functionHandler: handler)

    #expect(throws: A2UIValidationError.self) {
      try fn.evaluate(arguments: [:], context: context)
    }
  }

  @Test func v10ValidationFunctionsReturnValidationResult() throws {
    let dataModel = DataModel()
    let context = DataContext(dataModel: dataModel, path: "", functionHandler: handler)

    let emailFn = EmailFunction(protocolVersion: "v1.0")
    #expect(emailFn.api.returnType == .validationResult)
    let validRes = try emailFn.evaluate(
      arguments: ["value": .string("test@example.com")], context: context)
    #expect(validRes == JSONValue.object(["valid": .boolean(true)]))

    let invalidRes = try emailFn.evaluate(
      arguments: ["value": .string("notanemail")], context: context)
    #expect(invalidRes.objectValue?["valid"] == JSONValue.boolean(false))
    #expect(invalidRes.objectValue?["code"] == JSONValue.string("INVALID_EMAIL"))

    let requiredFn = RequiredFunction(protocolVersion: "v1.0")
    #expect(requiredFn.api.returnType == .validationResult)
    let reqValid = try requiredFn.evaluate(arguments: ["value": .string("hello")], context: context)
    #expect(reqValid == JSONValue.object(["valid": .boolean(true)]))
    let reqInvalid = try requiredFn.evaluate(arguments: ["value": .string("")], context: context)
    #expect(reqInvalid == JSONValue.object(["valid": .boolean(false)]))

    let numericFn = NumericFunction(protocolVersion: "v1.0")
    #expect(numericFn.api.returnType == .validationResult)
    let numValid = try numericFn.evaluate(
      arguments: ["value": .number(20), "min": .number(18)], context: context)
    #expect(numValid == JSONValue.object(["valid": .boolean(true)]))
    let numInvalid = try numericFn.evaluate(
      arguments: ["value": .number(15), "min": .number(18)], context: context)
    #expect(numInvalid == JSONValue.object(["valid": .boolean(false)]))

    let lengthFn = LengthFunction(protocolVersion: "v1.0")
    #expect(lengthFn.api.returnType == .validationResult)
    let lenValid = try lengthFn.evaluate(
      arguments: ["value": .string("abc"), "min": .integer(2)], context: context)
    #expect(lenValid == JSONValue.object(["valid": .boolean(true)]))
    let lenInvalid = try lengthFn.evaluate(
      arguments: ["value": .string("a"), "min": .integer(2)], context: context)
    #expect(lenInvalid == JSONValue.object(["valid": .boolean(false)]))

    let regexFn = RegexFunction(protocolVersion: "v1.0")
    #expect(regexFn.api.returnType == .validationResult)
    let regValid = try regexFn.evaluate(
      arguments: ["value": .string("123"), "pattern": .string("^[0-9]+$")], context: context)
    #expect(regValid == JSONValue.object(["valid": .boolean(true)]))
    let regInvalid = try regexFn.evaluate(
      arguments: ["value": .string("abc"), "pattern": .string("^[0-9]+$")], context: context)
    #expect(regInvalid == JSONValue.object(["valid": .boolean(false)]))
  }

  @Test func v10CatalogConfiguration() {
    let v10 = BasicCatalog.v10Catalog
    #expect(v10.id == BasicCatalog.v10CatalogURI)
    #expect(v10.protocolVersion == "v1.0")
    #expect(v10.components.count == 18)
    #expect(v10.functions.count == 15)
    #expect(v10.functions["@index"] != nil)
    #expect(v10.functions["email"]?.api.returnType == .validationResult)

    #expect(BasicCatalog.allCatalogs.count == 3)
    #expect(BasicCatalog.allCatalogs.contains(where: { $0.id == BasicCatalog.v10CatalogURI }))
  }
}
