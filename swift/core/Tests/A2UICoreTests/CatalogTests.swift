// Copyright 2026 Google LLC
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
import JSONSchema
import OrderedJSON
import Testing

/// A concrete `FunctionImplementation` for testing that concatenates
/// string arguments.
struct ConcatFunction: FunctionImplementation {
  let api = FunctionAPI(
    name: "concat",
    returnType: .string,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "a": { "type": "string" },
            "b": { "type": "string" }
          }
        }
        """
    )
  )

  func evaluate(arguments: [String: JSONValue]) throws -> JSONValue {
    let first = arguments["a"]?.stringValue ?? ""
    let second = arguments["b"]?.stringValue ?? ""
    return .string(first + second)
  }
}

/// A concrete `FunctionImplementation` for testing that returns a
/// boolean.
struct IsEmptyFunction: FunctionImplementation {
  let api = FunctionAPI(
    name: "isEmpty",
    returnType: .boolean,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": { "type": "string" }
          }
        }
        """
    )
  )

  func evaluate(arguments: [String: JSONValue]) throws -> JSONValue {
    let value = arguments["value"]?.stringValue ?? ""
    return .boolean(value.isEmpty)
  }
}

struct ComponentAPITests {

  // MARK: - Initialization

  @Test func componentAPIInitializesWithNameAndSchema() throws {
    let schema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" }
          }
        }
        """
    )
    let api = ComponentAPI(name: "Button", schema: schema)
    #expect(api.name == "Button")
    #expect(api.schema == schema)
  }

  // MARK: - Equality

  @Test func componentAPIsEqualByNameAndSchema() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let a = ComponentAPI(name: "Button", schema: schema)
    let b = ComponentAPI(name: "Button", schema: schema)
    #expect(a == b)
  }

  @Test func componentAPIsNotEqualByDifferentName() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let a = ComponentAPI(name: "Button", schema: schema)
    let b = ComponentAPI(name: "Text", schema: schema)
    #expect(a != b)
  }
}

struct FunctionAPITests {

  // MARK: - Initialization

  @Test func functionAPIInitializesWithNameReturnTypeAndSchema() throws {
    let schema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "a": { "type": "number" },
            "b": { "type": "number" }
          }
        }
        """
    )
    let api = FunctionAPI(
      name: "add",
      returnType: .number,
      schema: schema
    )
    #expect(api.name == "add")
    #expect(api.returnType == .number)
    #expect(api.schema == schema)
  }

  // MARK: - ReturnType

  @Test func functionReturnTypeRawValuesAreCorrect() {
    #expect(FunctionReturnType.string.rawValue == "string")
    #expect(FunctionReturnType.number.rawValue == "number")
    #expect(FunctionReturnType.boolean.rawValue == "boolean")
    #expect(FunctionReturnType.array.rawValue == "array")
    #expect(FunctionReturnType.object.rawValue == "object")
    #expect(FunctionReturnType.any.rawValue == "any")
    #expect(FunctionReturnType.void.rawValue == "void")
  }
}

struct CatalogTests {

  // MARK: - Initialization

  @Test func catalogInitializesWithIdComponentsAndFunctions() throws {
    let buttonSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" }
          }
        }
        """
    )
    let buttonAPI = ComponentAPI(name: "Button", schema: buttonSchema)
    let catalog = Catalog(
      id: "test-catalog",
      components: [buttonAPI],
      functions: [ConcatFunction()]
    )

    #expect(catalog.id == "test-catalog")
    #expect(catalog.components.count == 1)
    #expect(catalog.components["Button"] != nil)
    #expect(catalog.functions.count == 1)
    #expect(catalog.functions["concat"] != nil)
  }

  @Test func catalogInitializesWithEmptyDefaults() {
    let catalog = Catalog(id: "empty-catalog", components: [])
    #expect(catalog.id == "empty-catalog")
    #expect(catalog.components.isEmpty)
    #expect(catalog.functions.isEmpty)
    #expect(catalog.themeSchema == nil)
  }

  @Test func catalogInitializesWithThemeSchema() throws {
    let themeSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "primaryColor": { "type": "string" }
          }
        }
        """
    )
    let catalog = Catalog(
      id: "themed-catalog",
      components: [],
      themeSchema: themeSchema
    )
    #expect(catalog.themeSchema != nil)
  }

  // MARK: - Component Lookup

  @Test func catalogComponentsLookupReturnsAPIForRegisteredName() throws {
    let schema = try Schema(instance: "{\"type\": \"object\"}")
    let api = ComponentAPI(name: "Text", schema: schema)
    let catalog = Catalog(id: "test", components: [api])

    let result = catalog.components["Text"]
    #expect(result != nil)
    #expect(result?.name == "Text")
    #expect(result?.schema == schema)
  }

  @Test func catalogComponentsLookupReturnsNilForUnregisteredName() {
    let catalog = Catalog(id: "test", components: [])
    #expect(catalog.components["Unknown"] == nil)
  }

  // MARK: - Function Lookup

  @Test func catalogFunctionsLookupReturnsImplementation() {
    let catalog = Catalog(
      id: "test",
      components: [],
      functions: [ConcatFunction(), IsEmptyFunction()]
    )
    let fn = catalog.functions["concat"]
    #expect(fn != nil)
  }

  @Test func catalogFunctionsLookupReturnsNilForUnregistered() {
    let catalog = Catalog(id: "test", components: [])
    #expect(catalog.functions["unknown"] == nil)
  }

  @Test func catalogFunctionEvaluatesCorrectly() throws {
    let catalog = Catalog(
      id: "test",
      components: [],
      functions: [ConcatFunction()]
    )
    let fn = try #require(catalog.functions["concat"])
    let result = try fn.evaluate(arguments: [
      "a": "Hello, ",
      "b": "World!",
    ])
    #expect(result.stringValue == "Hello, World!")
  }

  @Test func catalogFunctionEvaluatesBooleanResult() throws {
    let catalog = Catalog(
      id: "test",
      components: [],
      functions: [IsEmptyFunction()]
    )
    let fn = try #require(catalog.functions["isEmpty"])
    let result = try fn.evaluate(arguments: ["value": ""])
    #expect(result.boolValue == true)

    let result2 = try fn.evaluate(arguments: ["value": "hello"])
    #expect(result2.boolValue == false)
  }
}

struct FunctionImplementationTests {

  // MARK: - ConcatFunction

  @Test func concatFunctionEvaluatesWithBothArgs() throws {
    let fn = ConcatFunction()
    let result = try fn.evaluate(arguments: [
      "a": "Hello, ",
      "b": "World!",
    ])
    #expect(result.stringValue == "Hello, World!")
  }

  @Test func concatFunctionHandlesMissingArgs() throws {
    let fn = ConcatFunction()
    let result = try fn.evaluate(arguments: [:])
    #expect(result.stringValue == "")
  }

  // MARK: - IsEmptyFunction

  @Test func isEmptyFunctionReturnsTrueForEmptyString() throws {
    let fn = IsEmptyFunction()
    let result = try fn.evaluate(arguments: ["value": ""])
    #expect(result.boolValue == true)
  }

  @Test func isEmptyFunctionReturnsFalseForNonEmptyString() throws {
    let fn = IsEmptyFunction()
    let result = try fn.evaluate(arguments: ["value": "hello"])
    #expect(result.boolValue == false)
  }

  @Test func isEmptyFunctionReturnsTrueForMissingArg() throws {
    let fn = IsEmptyFunction()
    let result = try fn.evaluate(arguments: [:])
    #expect(result.boolValue == true)
  }

  // MARK: - API Exposure

  @Test func functionImplementationExposesAPI() {
    let fn = ConcatFunction()
    #expect(fn.api.name == "concat")
    #expect(fn.api.returnType == .string)
  }
}
