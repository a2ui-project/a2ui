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
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing

/// Covers how a v1.0 `PayloadValidator` scopes component envelopes and nested function calls
/// to its single catalog.
struct PayloadValidatorCatalogScopeTests {

  private let catalogID = "cat"

  private func makeCatalog(
    textSchema: String = "{\"type\": \"object\"}",
    protocolVersion: A2UIProtocolVersion = .v10
  ) throws -> AnyCatalog {
    Catalog(
      id: catalogID,
      protocolVersion: protocolVersion,
      components: [AnyComponentAPI(name: "Text", schema: try Schema(instance: textSchema))],
      functions: [ConcatFunction()]
    ).eraseToAnyCatalog()
  }

  private func makeValidator(
    textSchema: String = "{\"type\": \"object\"}",
    config: ValidationConfig = ValidationConfig(protocolVersion: .v10)
  ) throws -> PayloadValidator {
    PayloadValidator(catalog: try makeCatalog(textSchema: textSchema), config: config)
  }

  private func textComponent(
    text: JSONValue,
    catalogID componentCatalogID: String? = nil
  ) -> [String: JSONValue] {
    var component: [String: JSONValue] = [
      "id": .string("t1"),
      "component": .string("Text"),
      "text": text,
    ]
    if let componentCatalogID {
      component["catalogId"] = .string(componentCatalogID)
    }
    return component
  }

  private func call(
    _ name: String,
    catalogID callCatalogID: String? = nil,
    args: JSONValue = .object(["a": .integer(1)])
  ) -> JSONValue {
    var dict: OrderedDictionary<String, JSONValue> = ["@call": .string(name), "args": args]
    if let callCatalogID {
      dict["catalogId"] = .string(callCatalogID)
    }
    return .object(dict)
  }

  // MARK: - Envelope keys

  private let closedTextSchema = """
    {
      "type": "object",
      "properties": {
        "component": { "const": "Text" },
        "text": { "type": "string" }
      },
      "required": ["component", "text"],
      "additionalProperties": false
    }
    """

  @Test func v10LeavesUndeclaredEnvelopeKeysOutOfClosedSchema() throws {
    let validator = try makeValidator(textSchema: closedTextSchema)
    try validator.validateComponent([
      "id": .string("t1"),
      "component": .string("Text"),
      "catalogId": .string(catalogID),
      "metadata": .object([:]),
      "text": .string("hi"),
    ])
  }

  @Test func v09KeepsEnvelopeKeysInClosedSchema() throws {
    let validator = PayloadValidator(
      catalog: try makeCatalog(textSchema: closedTextSchema, protocolVersion: .v09),
      config: ValidationConfig(protocolVersion: .v09)
    )
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("t1"),
        "component": .string("Text"),
        "text": .string("hi"),
      ])
    }
  }

  @Test func v10KeepsEnvelopeKeyDeclaredThroughLocalRef() throws {
    let schema = """
      {
        "type": "object",
        "allOf": [
          { "$ref": "#/$defs/MyCommon" },
          {
            "properties": {
              "component": { "const": "Text" },
              "text": { "type": "string" }
            }
          }
        ],
        "required": ["id"],
        "unevaluatedProperties": false,
        "$defs": {
          "MyCommon": { "properties": { "id": { "type": "string" } } }
        }
      }
      """
    let validator = try makeValidator(textSchema: schema)
    try validator.validateComponent([
      "id": .string("t1"),
      "component": .string("Text"),
      "text": .string("hi"),
    ])
  }

  // MARK: - Nested call scope

  @Test func callInComponentWithoutCatalogIDIsFullyChecked() throws {
    let validator = try makeValidator()
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(self.textComponent(text: self.call("concat")))
    }
  }

  @Test func cataloglessCallInComponentNamingCatalogGetsIdentifierChecksOnly() throws {
    let validator = try makeValidator()
    // The component may be in another catalog, so the call may run in another default.
    try validator.validateComponent(
      textComponent(text: call("concat"), catalogID: catalogID)
    )
    try validator.validateComponent(
      textComponent(text: call("mystery"), catalogID: catalogID)
    )
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(
        self.textComponent(text: self.call("1bad"), catalogID: self.catalogID)
      )
    }
  }

  @Test func callNamingValidatorCatalogIsFullyCheckedInComponentNamingCatalog() throws {
    let validator = try makeValidator()
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(
        self.textComponent(
          text: self.call("concat", catalogID: self.catalogID),
          catalogID: "other"
        )
      )
    }
  }

  @Test func callNamingAnotherCatalogGetsIdentifierChecksOnly() throws {
    let validator = try makeValidator()
    try validator.validateComponent(textComponent(text: call("mystery", catalogID: "other")))
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(
        self.textComponent(text: self.call("1bad", catalogID: "other"))
      )
    }
  }

  @Test func callWithNonObjectArgsIsRejected() throws {
    let validator = try makeValidator()
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(
        self.textComponent(
          text: self.call("mystery", catalogID: "other", args: .array([.integer(1)]))
        )
      )
    }
  }

  @Test func systemFunctionCallsAreChecked() throws {
    let validator = try makeValidator()
    try validator.validateComponent(
      textComponent(text: call("@index", args: .object(["offset": .integer(1)])))
    )
    // A system function belongs to no catalog.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(
        self.textComponent(
          text: self.call("@index", catalogID: self.catalogID, args: .object([:]))
        )
      )
    }
    // v1.0 defines no @foo.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(
        self.textComponent(text: self.call("@foo", args: .object([:])))
      )
    }
    // An empty name is not a valid identifier.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(self.textComponent(text: self.call("", args: .object([:]))))
    }
  }

  @Test func nonStringCallNameIsNotAFunctionCall() throws {
    // Matches the TypeScript and Python validators: only a string `@call` names a function.
    let validator = try makeValidator()
    try validator.validateComponent(textComponent(text: .object(["@call": .integer(42)])))
  }

  @Test func nonStringCatalogIDIsRejected() throws {
    let validator = try makeValidator()
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(
        self.textComponent(
          text: .object(["@call": .string("concat"), "catalogId": .integer(1)])
        )
      )
    }
  }
}
