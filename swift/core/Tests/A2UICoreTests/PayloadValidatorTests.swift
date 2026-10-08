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
import A2UIJSON
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing

struct PayloadValidatorTests {

  private final class MockAddFunction: FunctionImplementation, Sendable {
    let api = FunctionAPI(
      name: "add",
      returnType: .number,
      schema: try! Schema(
        instance: """
          {
            "type": "object",
            "properties": {
              "a": { "type": "number" },
              "b": { "type": "number" }
            },
            "required": ["a", "b"]
          }
          """
      )
    )

    func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
      let a = arguments["a"]?.doubleValue ?? 0
      let b = arguments["b"]?.doubleValue ?? 0
      return .number(a + b)
    }
  }

  private func makeTestCatalog() throws -> AnyCatalog {
    let textSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "const": "Text" },
            "text": {
              "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicString"
            }
          },
          "required": ["id", "component", "text"],
          "additionalProperties": false
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let themeSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "primaryColor": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" }
          },
          "required": ["primaryColor"],
          "additionalProperties": false
        }
        """
    )
    return Catalog(
      id: "https://example.com/catalogs/test/v1/catalog.json",
      protocolVersion: "v1.0",
      components: [AnyComponentAPI(name: "Text", schema: textSchema)],
      functions: [MockAddFunction()],
      themeSchema: themeSchema
    ).eraseToAnyCatalog()
  }

  @Test func validateComponentSuccessAndFailure() throws {
    let catalog = try makeTestCatalog()
    let validator = PayloadValidator(
      catalog: catalog,
      config: ValidationConfig(protocolVersion: .v10)
    )

    // Valid component
    try validator.validateComponent([
      "id": .string("header_1"),
      "component": .string("Text"),
      "text": .string("Hello"),
    ])

    // Missing required property 'text'
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("header_1"),
        "component": .string("Text"),
      ])
    }

    // Invalid UAX #31 component ID in v1.0
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("123-invalid-id"),
        "component": .string("Text"),
        "text": .string("Hello"),
      ])
    }

    // Unknown component rejected by default
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("unknown_1"),
        "component": .string("UnknownWidget"),
      ])
    }

    // Unknown component allowed when allowUnknownElements is true
    let permissiveValidator = PayloadValidator(
      catalog: catalog,
      config: ValidationConfig(allowUnknownElements: true, protocolVersion: .v10)
    )
    try permissiveValidator.validateComponent([
      "id": .string("unknown_1"),
      "component": .string("UnknownWidget"),
    ])
  }

  @Test func validateFunctionAndNestedFunctionCalls() throws {
    let catalog = try makeTestCatalog()
    let validator = PayloadValidator(
      catalog: catalog,
      config: ValidationConfig(protocolVersion: .v10)
    )

    // Direct function validation: valid
    try validator.validateFunction(
      name: "add",
      args: ["a": .integer(1), "b": .integer(2)]
    )

    // Built-in @index system function: valid in v1.0
    try validator.validateFunction(
      name: "@index",
      args: ["offset": .integer(1)]
    )

    // Missing required argument 'b'
    #expect(throws: A2UIValidationError.self) {
      try validator.validateFunction(
        name: "add",
        args: ["a": .integer(1)]
      )
    }

    // Wrong argument type
    #expect(throws: A2UIValidationError.self) {
      try validator.validateFunction(
        name: "add",
        args: ["a": .string("not_a_number"), "b": .integer(2)]
      )
    }

    // Unknown function
    #expect(throws: A2UIValidationError.self) {
      try validator.validateFunction(
        name: "nonExistentFunc",
        args: [:]
      )
    }

    // Invalid UAX #31 argument key
    #expect(throws: A2UIValidationError.self) {
      try validator.validateFunction(
        name: "add",
        args: ["1invalidKey": .integer(1), "b": .integer(2)]
      )
    }
  }

  @Test func validateThemeSuccessAndFailure() throws {
    let catalog = try makeTestCatalog()
    let validator = PayloadValidator(
      catalog: catalog,
      config: ValidationConfig(protocolVersion: .v10)
    )

    // Valid theme
    try validator.validateTheme(["primaryColor": .string("#FF5733")])

    // Invalid hex color pattern
    #expect(throws: A2UIValidationError.self) {
      try validator.validateTheme(["primaryColor": .string("red")])
    }

    // Non-object theme JSONValue
    #expect(throws: A2UIValidationError.self) {
      try validator.validateTheme(JSONValue.string("invalid"))
    }
  }

  @Test func graphTopologyIgnoresPlainStringChildAndChildrenWithoutSchemaRef() throws {
    // Regression test: properties named "child" or "children" that are plain string / string array
    // without $ref to Child / ComponentId / ChildList must NOT be treated as component ID
    // references during strict topology validation.
    let customSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "const": "FamilyRecord" },
            "child": { "type": "string" },
            "children": {
              "type": "array",
              "items": { "type": "string" }
            }
          },
          "required": ["id", "component"]
        }
        """
    )
    let catalog = Catalog(
      id: "family_cat",
      protocolVersion: "v1.0",
      components: [AnyComponentAPI(name: "FamilyRecord", schema: customSchema)]
    ).eraseToAnyCatalog()

    // Even in strict mode (allowDanglingReferences: false), "Alice", "Bob", and "root"
    // in plain string properties named "child" and "children" are data strings, not component IDs
    // (so they neither trigger dangling reference errors nor self-reference cycle errors).
    let components: [[String: JSONValue]] = [
      [
        "id": .string("root"),
        "component": .string("FamilyRecord"),
        "child": .string("root"),
        "children": .array([.string("Alice"), .string("Bob")]),
      ]
    ]

    try GraphTopologyValidator.validate(
      components: components,
      rootID: "root",
      config: .strict,
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id
    )
  }
}
