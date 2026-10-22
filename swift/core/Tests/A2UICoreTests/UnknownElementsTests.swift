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

/// Covers `ValidationConfig.allowUnknownElements`: `.relaxed` accepts unknown component types,
/// functions and component properties, and `.strict` rejects them.
@MainActor
struct UnknownElementsTests {

  private let textSchema = """
    {
      "type": "object",
      "properties": {
        "component": { "const": "Text" },
        "text": {},
        "meta": {
          "type": "object",
          "patternProperties": { "^[a-z]+$": {} },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
    """

  private let labelSchema = """
    {
      "type": "object",
      "allOf": [{ "properties": { "component": { "const": "Label" } } }],
      "properties": { "text": { "type": "string" } },
      "unevaluatedProperties": false
    }
    """

  private func makeCatalog() throws -> AnyCatalog {
    Catalog(
      id: "a",
      protocolVersion: .v10,
      components: [
        AnyComponentAPI(name: "Text", schema: try Schema(instance: textSchema)),
        AnyComponentAPI(name: "Label", schema: try Schema(instance: labelSchema)),
      ]
    ).eraseToAnyCatalog()
  }

  private func makeValidator(_ config: ValidationConfig) throws -> PayloadValidator {
    var config = config
    config.protocolVersion = .v10
    return PayloadValidator(catalog: try makeCatalog(), config: config)
  }

  private func text(_ properties: [String: JSONValue]) -> [String: JSONValue] {
    var component: [String: JSONValue] = ["id": .string("root"), "component": .string("Text")]
    component.merge(properties) { _, new in new }
    return component
  }

  // MARK: - Presets

  @Test func relaxedAllowsUnknownElementsAndStrictDoesNot() {
    #expect(ValidationConfig.relaxed.allowUnknownElements)
    #expect(!ValidationConfig.strict.allowUnknownElements)
  }

  // MARK: - Message processing

  private func makeProcessorWithSurface(
    validationConfig: ValidationConfig
  ) throws -> MessageProcessor {
    let processor = MessageProcessor(
      catalogs: [try makeCatalog()],
      validationConfig: validationConfig
    )
    try processor.processMessages(
      try JSONValue.parse(
        """
        { "version": "v1.0", "createSurface": { "surfaceId": "s", "catalogId": "a" } }
        """
      )
    )
    return processor
  }

  private func update(with component: String) throws -> JSONValue {
    try JSONValue.parse(
      """
      {
        "version": "v1.0",
        "updateComponents": { "surfaceId": "s", "components": [\(component)] }
      }
      """
    )
  }

  private var unknownFunction: String {
    #"{ "id": "root", "component": "Text", "text": { "@call": "notAFunction" } }"#
  }

  private var unknownComponentType: String {
    #"{ "id": "root", "component": "Mystery" }"#
  }

  private var unknownProperty: String {
    #"{ "id": "root", "component": "Text", "text": "hi", "bogus": 1 }"#
  }

  @Test func relaxedProcessingAcceptsUnknownElements() throws {
    for component in [unknownFunction, unknownComponentType, unknownProperty] {
      let processor = try makeProcessorWithSurface(validationConfig: .relaxed)
      try processor.processMessages(try update(with: component))
      #expect(processor.surfaceGroupModel["s"]?.componentsModel.get("root") != nil)
    }
  }

  @Test func strictProcessingRejectsUnknownElements() throws {
    for component in [unknownFunction, unknownComponentType, unknownProperty] {
      let processor = try makeProcessorWithSurface(validationConfig: .strict)
      #expect(throws: A2UIValidationError.self) {
        try processor.processMessages(try self.update(with: component))
      }
    }
  }

  @Test func unknownSystemFunctionIsRejectedInBothModes() throws {
    let component = #"{ "id": "root", "component": "Text", "text": { "@call": "@mystery" } }"#
    for config in [ValidationConfig.relaxed, .strict] {
      let processor = try makeProcessorWithSurface(validationConfig: config)
      #expect(throws: A2UIValidationError.self) {
        try processor.processMessages(try self.update(with: component))
      }
      let validator = try makeValidator(config)
      #expect(throws: A2UIValidationError.self) {
        try validator.validateFunction(name: "@mystery", args: [:])
      }
    }
  }

  // MARK: - Validator

  @Test func relaxedValidatorAcceptsUnknownFunction() throws {
    try makeValidator(.relaxed).validateFunction(name: "mystery", args: [:])
    let strict = try makeValidator(.strict)
    #expect(throws: A2UIValidationError.self) {
      try strict.validateFunction(name: "mystery", args: [:])
    }
  }

  @Test func relaxedValidatorAcceptsPropertyRejectedByUnevaluatedProperties() throws {
    let label: [String: JSONValue] = [
      "id": .string("root"),
      "component": .string("Label"),
      "text": .string("hi"),
      "bogus": .integer(1),
    ]
    try makeValidator(.relaxed).validateComponent(label)
    let strict = try makeValidator(.strict)
    #expect(throws: A2UIValidationError.self) {
      try strict.validateComponent(label)
    }
  }

  @Test func relaxedValidatorStillRejectsBadValues() throws {
    let relaxed = try makeValidator(.relaxed)
    #expect(throws: A2UIValidationError.self) {
      try relaxed.validateComponent([
        "id": .string("root"),
        "component": .string("Label"),
        "text": .integer(42),
      ])
    }
    // An unknown property next to a bad value doesn't hide the bad value.
    #expect(throws: A2UIValidationError.self) {
      try relaxed.validateComponent([
        "id": .string("root"),
        "component": .string("Label"),
        "text": .integer(42),
        "bogus": .integer(1),
      ])
    }
  }

  @Test func relaxedValidatorStillRejectsKeyBreakingPatternProperties() throws {
    let relaxed = try makeValidator(.relaxed)
    try relaxed.validateComponent(text(["meta": .object(["good": .integer(1)])]))
    #expect(throws: A2UIValidationError.self) {
      try relaxed.validateComponent(self.text(["meta": .object(["BAD-KEY": .integer(1)])]))
    }
  }
}
