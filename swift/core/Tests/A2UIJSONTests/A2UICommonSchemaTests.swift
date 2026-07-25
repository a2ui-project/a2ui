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

  @Test func testUriForDefinition() {
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
    #expect(schemas.count == 1)
    #expect(schemas[A2UICommonSchema.baseURI] != nil)
    #expect(schemas[A2UICommonSchema.baseURI] == A2UICommonSchema.document)
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

  @Test func testComponentCommonValidatesWithId() throws {
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

  @Test func testComponentCommonRejectsMissingId() throws {
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
}
