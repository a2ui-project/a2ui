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
import Foundation
import JSONSchema
import OrderedJSON
import Testing

struct CatalogV10Tests {
  @Test func unicodeIdentifierValidator() {
    #expect(UnicodeIdentifierValidator.isValidIdentifier("validName"))
    #expect(UnicodeIdentifierValidator.isValidIdentifier("_privateName"))
    #expect(UnicodeIdentifierValidator.isValidIdentifier("@index"))
    #expect(UnicodeIdentifierValidator.isValidIdentifier("camelCase123"))
    #expect(UnicodeIdentifierValidator.isValidIdentifier("résumé"))

    #expect(!UnicodeIdentifierValidator.isValidIdentifier(""))
    #expect(!UnicodeIdentifierValidator.isValidIdentifier("123invalid"))
    #expect(!UnicodeIdentifierValidator.isValidIdentifier("invalid-with-dash"))
    #expect(!UnicodeIdentifierValidator.isValidIdentifier("invalid with spaces"))
    #expect(!UnicodeIdentifierValidator.isValidIdentifier("@"))
  }

  @Test func validationResultEncodingAndDecoding() throws {
    let result = ValidationResult(
      valid: false,
      code: "OUT_OF_RANGE",
      message: "Value must be between 1 and 10",
      severity: .error
    )
    let data = try JSONEncoder().encode(result)
    let decoded = try JSONDecoder().decode(ValidationResult.self, from: data)
    #expect(decoded.valid == false)
    let unwrappedCode = try #require(decoded.code)
    #expect(unwrappedCode == "OUT_OF_RANGE")
    let unwrappedMessage = try #require(decoded.message)
    #expect(unwrappedMessage == "Value must be between 1 and 10")
    let unwrappedSeverity = try #require(decoded.severity)
    #expect(unwrappedSeverity == .error)
  }

  @Test func componentAPIHierarchyConstraints() throws {
    let schema = try Schema(
      rawSchema: .object(["type": .string("object")]),
      context: Context(dialect: .draft2020_12)
    )
    let comp = AnyComponentAPI(
      name: "Modal",
      schema: schema,
      allowedParents: ["Surface"],
      allowedChildren: ["Button", "Text"],
      metadata: ["custom": .boolean(true)]
    )
    #expect(comp.allowedParents == ["Surface"])
    #expect(comp.allowedChildren == ["Button", "Text"])
    #expect(comp.metadata?["custom"] == .boolean(true))

    let catalog = Catalog(
      id: "testCatalog",
      protocolVersion: "v1.0",
      components: [comp]
    )
    #expect(catalog.protocolVersion == "v1.0")
    let erased = catalog.eraseToAnyCatalog()
    #expect(erased.protocolVersion == "v1.0")
    #expect(erased.components["Modal"]?.allowedParents == ["Surface"])
  }

  @Test func functionAPIAllowedCallers() throws {
    let schema = try Schema(
      rawSchema: .object(["type": .string("object")]),
      context: Context(dialect: .draft2020_12)
    )
    let api = FunctionAPI(
      name: "remoteCall",
      returnType: .validationResult,
      schema: schema,
      allowedCallers: .rendererOrAgent,
      requiresUserActivation: true
    )
    #expect(api.returnType == .validationResult)
    #expect(api.allowedCallers == .rendererOrAgent)
    #expect(api.requiresUserActivation == true)
  }
}
