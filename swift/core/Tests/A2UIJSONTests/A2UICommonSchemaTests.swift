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

import A2UIJSON
import JSONSchema
import OrderedJSON
import Testing

struct A2UICommonSchemaTests {

  // MARK: - URI Helpers

  @Test func testBaseURI() {
    #expect(
      A2UICommonSchema.baseURI
        == "https://a2ui.org/schemas/v0_9_1/common.json"
    )
  }

  @Test func testURIForDefinition() {
    #expect(
      A2UICommonSchema.uri(for: "DataBinding")
        == "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/DataBinding"
    )
    #expect(
      A2UICommonSchema.uri(for: "Action")
        == "https://a2ui.org/schemas/v0_9_1/common.json#/$defs/Action"
    )
  }

  // MARK: - Document Structure

  @Test func testDocumentParsesSuccessfully() throws {
    let doc = A2UICommonSchema.document
    #expect(doc.object != nil)
    #expect(doc.object?["$id"]?.string == A2UICommonSchema.baseURI)
    #expect(doc.object?["title"]?.string == "A2UI Common Types")
  }

  @Test func testDocumentContainsAll14Defs() throws {
    let defs = try #require(
      A2UICommonSchema.document.object?["$defs"]?.object
    )
    let expected: Set<String> = [
      "ComponentId", "AccessibilityAttributes", "ComponentCommon",
      "ChildList", "DataBinding", "DynamicValue", "DynamicString",
      "DynamicNumber", "DynamicBoolean", "DynamicStringList",
      "FunctionCall", "CheckRule", "Checkable", "Action",
    ]
    #expect(Set(defs.keys) == expected)
  }

  @Test func testAllSchemasMapsBaseURIToDocument() {
    let schemas = A2UICommonSchema.allSchemas
    #expect(schemas.count == 14)
    #expect(schemas[A2UICommonSchema.baseURI] == A2UICommonSchema.document)
    #expect(schemas[A2UICommonSchema.v10BaseURI] == A2UICommonSchema.v10Document)
    #expect(schemas["common_types.json"] == A2UICommonSchema.v10Document)
    #expect(
      schemas[A2UICommonSchema.v10CatalogDefinitionURI]
        == A2UICommonSchema.v10CatalogDefinitionDocument
    )
    #expect(
      schemas["catalog_definition.json"]
        == A2UICommonSchema.v10CatalogDefinitionDocument
    )
    #expect(
      schemas["https://a2ui.org/schemas/v0_9_1/catalog.json"]
        == A2UICommonSchema.v09CatalogFunctionStubDocument
    )
    #expect(
      schemas["https://a2ui.org/specification/v1_0/catalog.json"]
        == A2UICommonSchema.v10CatalogFunctionStubDocument
    )
  }

  @Test func testAllSchemasIdentifiesEachAliasByItsURL() throws {
    // swift-json-schema caches a document under its `$id` and looks it up by the `$ref` URL,
    // so an alias whose document keeps another `$id` is built again on every `$ref`.
    for (key, document) in A2UICommonSchema.allSchemas where key.hasPrefix("https://") {
      #expect(document.object?["$id"]?.string == key, "\(key)")
    }
  }

  @Test func testAliasCopyKeepsRelativeRefTargets() throws {
    let alias = try #require(
      A2UICommonSchema.allSchemas["https://swift-json-schema.invalid/common_types.json"]
    )
    let functionRefs = try #require(
      alias.object?["$defs"]?.object?["FunctionCall"]?.object?["allOf"]?.array?.last?
        .object?["oneOf"]?.array
    )
    #expect(
      functionRefs.first?.object?["$ref"]?.string
        == "https://a2ui.org/specification/v1_0/catalog.json#/$defs/anyFunction"
    )
    #expect(functionRefs.last?.object?["$ref"]?.string == "#/$defs/IndexSystemFunction")

    var withCanonicalID = try #require(alias.object)
    withCanonicalID["$id"] = .string(A2UICommonSchema.v10BaseURI)
    let canonicalDefs = try #require(A2UICommonSchema.v10Document.object?["$defs"]?.object)
    for (name, definition) in withCanonicalID["$defs"]?.object ?? [:] where name != "FunctionCall" {
      #expect(definition == canonicalDefs[name], "\(name)")
    }
  }

  @Test(arguments: [
    "common_types.json#/$defs/DynamicString",
    "https://a2ui.org/specification/v1_0/catalogs/basic/common_types.json#/$defs/DynamicString",
  ])
  func testAliasRefValidatesLikeCanonicalRef(_ aliasRef: String) throws {
    func schema(_ ref: String) throws -> Schema {
      try Schema(
        rawSchema: .object(["$ref": .string(ref)]),
        context: A2UISchemaRegistry.makeContext()
      )
    }
    let canonical = try schema(A2UICommonSchema.v10URI(for: "DynamicString"))
    let viaAlias = try schema(aliasRef)
    let instances: [JSONValue] = [
      "text",
      42,
      ["@path": "/name"],
      ["@path": "/name", "extra": true],
      ["@call": "@index"],
      ["@call": "@index", "args": ["offset": "one"]],
    ]
    #expect(canonical.validate("text").isValid)
    #expect(!canonical.validate(42).isValid)
    for instance in instances {
      #expect(viaAlias.validate(instance).isValid == canonical.validate(instance).isValid)
    }
  }

  // MARK: - Schema Registry

  @Test func testMakeContextResolvesA2UIRefs() throws {
    let context = A2UISchemaRegistry.makeContext()
    // Verify the context can resolve A2UI refs by validating a DataBinding
    let rawSchema: JSONValue = try .parse(
      """
      { "$ref": "\(A2UICommonSchema.uri(for: "DataBinding"))" }
      """
    )
    let schema = try Schema(
      rawSchema: rawSchema,
      context: context
    )
    let value: JSONValue = ["path": "/test"]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  // MARK: - Validation: DataBinding

  @Test func testDataBindingValidatesCorrectPayload() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DataBinding"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let valid: JSONValue = ["path": "/user/name"]
    let result = schema.validate(valid)
    #expect(result.isValid)
  }

  @Test func testDataBindingRejectsMissingPath() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DataBinding"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let invalid: JSONValue = ["other": "value"]
    let result = schema.validate(invalid)
    #expect(!result.isValid)
  }

  @Test func testDataBindingRejectsAdditionalProperties() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DataBinding"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let invalid: JSONValue = [
      "path": "/user/name",
      "extra": "not allowed",
    ]
    let result = schema.validate(invalid)
    #expect(!result.isValid)
  }

  // MARK: - Validation: DynamicString

  @Test func testDynamicStringValidatesLiteralString() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicString"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let result = schema.validate("hello")
    #expect(result.isValid)
  }

  @Test func testDynamicStringValidatesDataBinding() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicString"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = ["path": "/user/name"]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  @Test func testDynamicStringRejectsNumber() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicString"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let result = schema.validate(.number(42.0))
    #expect(!result.isValid)
  }

  // MARK: - Validation: DynamicBoolean

  @Test func testDynamicBooleanValidatesLiteralBool() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicBoolean"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let result = schema.validate(true)
    #expect(result.isValid)
  }

  @Test func testDynamicBooleanValidatesDataBinding() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicBoolean"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = ["path": "/user/enabled"]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  // MARK: - Validation: DynamicNumber

  @Test func testDynamicNumberValidatesLiteralNumber() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicNumber"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let result = schema.validate(.number(3.14))
    #expect(result.isValid)
  }

  @Test func testDynamicNumberValidatesInteger() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicNumber"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let result = schema.validate(.integer(42))
    #expect(result.isValid)
  }

  // MARK: - Validation: FunctionCall

  @Test func testFunctionCallValidatesWithCallOnly() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "FunctionCall"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = ["call": "toUpperCase"]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  @Test func testFunctionCallRejectsMissingCall() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "FunctionCall"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = ["args": JSONValue.object([:])]
    let result = schema.validate(value)
    #expect(!result.isValid)
  }

  @Test func testFunctionCallValidatesWithArgsAndReturnType() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "FunctionCall"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [
      "call": "format",
      "args": [
        "template": "Hello {name}"
      ],
      "returnType": "string",
    ]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  // MARK: - Validation: Action

  @Test func testActionValidatesServerEvent() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "Action"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [
      "event": [
        "name": "click",
        "context": ["userID": "123"],
      ]
    ]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  @Test func testActionValidatesFunctionCall() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "Action"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [
      "functionCall": [
        "call": "submit",
        "returnType": "void",
      ]
    ]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  @Test func testActionRejectsMissingEventName() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "Action"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [
      "event": [
        "context": JSONValue.object([:])
      ]
    ]
    let result = schema.validate(value)
    #expect(!result.isValid)
  }

  // MARK: - Validation: ChildList

  @Test func testChildListValidatesStaticArray() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "ChildList"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = ["header", "body", "footer"]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  @Test func testChildListValidatesTemplateObject() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "ChildList"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [
      "componentId": "listItem",
      "path": "/items",
    ]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  // MARK: - Validation: ComponentCommon

  @Test func testComponentCommonValidatesWithID() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "ComponentCommon"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = ["id": "myButton"]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  @Test func testComponentCommonRejectsMissingID() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "ComponentCommon"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [
      "accessibility": JSONValue.object([:])
    ]
    let result = schema.validate(value)
    #expect(!result.isValid)
  }

  // MARK: - Validation: DynamicValue

  @Test func testDynamicValueValidatesString() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicValue"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let result = schema.validate("hello")
    #expect(result.isValid)
  }

  @Test func testDynamicValueValidatesArray() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicValue"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [1, 2, 3]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  // MARK: - Validation: CheckRule

  @Test func testCheckRuleValidatesCorrectPayload() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "CheckRule"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [
      "condition": true,
      "message": "Field is required",
    ]
    let result = schema.validate(value)
    #expect(result.isValid)
  }

  @Test func testCheckRuleRejectsMissingFields() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "CheckRule"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = ["condition": true]
    let result = schema.validate(value)
    #expect(!result.isValid)
  }

  // MARK: - Cross-reference Resolution

  @Test func testActionSchemaResolvesRecursiveRefs() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "Action"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let event: JSONValue = [
      "event": [
        "name": "click",
        "context": ["userID": "123"],
      ]
    ]
    let result = schema.validate(event)
    #expect(result.isValid)
  }

  @Test func testDynamicStringResolvesFunctionCallRef() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.uri(for: "DynamicString"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let funcCall: JSONValue = [
      "call": "getUserName",
      "returnType": "string",
    ]
    let result = schema.validate(funcCall)
    #expect(result.isValid)
  }

  // MARK: - v1.0 FunctionCall Schema

  @Test func testV10FunctionCallValidatesCallAndCatalogId() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.v10URI(for: "FunctionCall"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [
      "@call": "formatString",
      "catalogId": "https://a2ui.org/specification/v1_0/basic_catalog.json",
      "args": ["value": "Hello"],
    ]
    #expect(schema.validate(value).isValid)
  }

  @Test func testV10FunctionCallValidatesIndexSystemFunction() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.v10URI(for: "FunctionCall"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let validValue: JSONValue = [
      "@call": "@index",
      "args": ["offset": 1],
    ]
    #expect(schema.validate(validValue).isValid)

    let invalidArgsValue: JSONValue = [
      "@call": "@index",
      "args": ["unknownArg": 0],
    ]
    #expect(!schema.validate(invalidArgsValue).isValid)
  }

  @Test func testV10FunctionCallRejectsReturnType() throws {
    let schema = try Schema(
      instance: """
        { "$ref": "\(A2UICommonSchema.v10URI(for: "FunctionCall"))" }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let value: JSONValue = [
      "@call": "formatString",
      "args": ["value": "Hello"],
      "returnType": "string",
    ]
    #expect(!schema.validate(value).isValid)
  }
}
