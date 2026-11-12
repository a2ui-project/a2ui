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
      protocolVersion: "1.0",
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

    // Invalid UAX #31 component type identifier in v1.0
    #expect(throws: A2UIValidationError.self) {
      try permissiveValidator.validateComponent([
        "id": .string("button_bar_1"),
        "component": .string("flex:button-bar"),
      ])
    }
  }

  @Test func validateComponentAllowsNamespacedComponentIdentifiersInV091() throws {
    let buttonBarSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "const": "flex:button-bar" }
          },
          "required": ["id", "component"],
          "additionalProperties": false
        }
        """
    )
    let v091Catalog = Catalog(
      id: "https://example.com/catalogs/flex/v0/catalog.json",
      protocolVersion: "v0.9.1",
      components: [AnyComponentAPI(name: "flex:button-bar", schema: buttonBarSchema)]
    ).eraseToAnyCatalog()
    let validator = PayloadValidator(
      catalog: v091Catalog,
      config: ValidationConfig(protocolVersion: .v091)
    )
    let component: [String: JSONValue] = [
      "id": .string("root"),
      "component": .string("flex:button-bar"),
    ]

    #expect(throws: Never.self) {
      try validator.validateComponent(component)
    }
  }

  @Test(arguments: [A2UIProtocolVersion.v09, .v091])
  func preV10NestedCallWithCatalogIDIsCheckedInTheSurfaceCatalog(
    version: A2UIProtocolVersion
  ) throws {
    let textSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "const": "Text" },
            "text": {}
          },
          "required": ["id", "component", "text"],
          "additionalProperties": false
        }
        """
    )
    let catalog = Catalog(
      id: "https://example.com/catalogs/v0/catalog.json",
      protocolVersion: version.rawValue,
      components: [AnyComponentAPI(name: "Text", schema: textSchema)],
      functions: [MockAddFunction()]
    ).eraseToAnyCatalog()
    let validator = PayloadValidator(
      catalog: catalog,
      config: ValidationConfig(protocolVersion: version)
    )
    func text(_ call: JSONValue) -> [String: JSONValue] {
      ["id": .string("root"), "component": .string("Text"), "text": call]
    }

    // Before v1.0 a call's catalogId is ignored, so the call is checked against this catalog.
    #expect(throws: Never.self) {
      try validator.validateComponent(
        text([
          "call": "add", "catalogId": "missing-catalog", "args": ["a": 1, "b": 2],
        ]))
    }
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(
        text(["call": "add", "catalogId": "missing-catalog", "args": ["a": 1]]))
    }
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(
        text(["call": "nonExistentFunc", "catalogId": "missing-catalog", "args": [:]]))
    }
  }

  @Test func validateComponentChecksAccessibilityOnSchemaWithoutIt() throws {
    // The test catalog's Text schema is closed and leaves `accessibility` to `ComponentCommon`.
    let validator = PayloadValidator(
      catalog: try makeTestCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )

    try validator.validateComponent([
      "id": .string("header_1"),
      "component": .string("Text"),
      "text": .string("Hello"),
      "accessibility": .object(["label": .object(["@path": .string("/greeting")])]),
    ])

    let error = try #require(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("header_1"),
        "component": .string("Text"),
        "text": .string("Hello"),
        "accessibility": .object(["live": .string("loud")]),
      ])
    }
    #expect(error.details.map(\.path) == ["accessibility/live"])
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
      protocolVersion: "1.0",
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

  @Test func graphTopologyReportsArrayOfComponentIdItemsByIndex() throws {
    // A property declared directly as an array of ComponentId refs is a list of
    // child references, and a missing item is reported at its index.
    let customSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "const": "Stack" },
            "slots": {
              "type": "array",
              "items": {
                "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId"
              }
            }
          },
          "required": ["id", "component"]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let catalog = Catalog(
      id: "stack_cat",
      protocolVersion: "1.0",
      components: [AnyComponentAPI(name: "Stack", schema: customSchema)]
    ).eraseToAnyCatalog()

    let components: [[String: JSONValue]] = [
      [
        "id": .string("root"),
        "component": .string("Stack"),
        "slots": .array([.string("held"), .string("missing")]),
      ],
      [
        "id": .string("held"),
        "component": .string("Stack"),
        "slots": .array([]),
      ],
    ]

    let error = try #require(throws: A2UIIntegrityError.self) {
      try GraphTopologyValidator.validate(
        components: components,
        rootID: "root",
        config: .strict,
        catalogs: [catalog.id: catalog],
        defaultCatalogID: catalog.id
      )
    }
    #expect(error.message.contains("'missing' in field 'slots[1]'"))
  }

  // MARK: - Component Mixins

  private static let commonTypesURI = "https://a2ui.org/specification/v1_0/common_types.json"

  /// A catalog whose `Table` declares properties of its own named `metadata`, `catalogId`,
  /// `accessibility`, and `checks`, and whose `Input` is checkable. `Table` declares `id` inline,
  /// so its `catalogId` is not `type: string`, which would make it the standard mixin.
  private func makeMixinCatalog(protocolVersion: A2UIProtocolVersion) throws -> AnyCatalog {
    let tableSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "component": { "const": "Table" },
            "metadata": {
              "type": "object",
              "properties": { "pageNumber": { "type": "number" } },
              "additionalProperties": false
            },
            "catalogId": { "const": "source-catalog" },
            "accessibility": { "type": "string" },
            "checks": { "type": "array", "items": { "type": "string" } }
          },
          "required": ["id", "component"],
          "additionalProperties": false
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let inputSchema = try Schema(
      instance: """
        {
          "type": "object",
          "allOf": [
            { "$ref": "\(Self.commonTypesURI)#/$defs/Checkable" },
            {
              "properties": {
                "id": { "type": "string" },
                "component": { "const": "Input" },
                "value": { "$ref": "\(Self.commonTypesURI)#/$defs/DynamicString" }
              },
              "required": ["id", "component"]
            }
          ],
          "unevaluatedProperties": false
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    return Catalog(
      id: "mixins",
      protocolVersion: protocolVersion,
      components: [
        AnyComponentAPI(name: "Table", schema: tableSchema),
        AnyComponentAPI(name: "Input", schema: inputSchema),
      ]
    ).eraseToAnyCatalog()
  }

  @Test(arguments: [A2UIProtocolVersion.v09, .v091])
  func validateComponentKeepsMetadataAndCatalogIDPropertiesBeforeV10(
    version: A2UIProtocolVersion
  ) throws {
    let validator = PayloadValidator(
      catalog: try makeMixinCatalog(protocolVersion: version),
      config: ValidationConfig(protocolVersion: version)
    )

    // `metadata` and `catalogId` are the component's own properties, not v1.0 mixins (#4012).
    try validator.validateComponent([
      "id": .string("table"),
      "component": .string("Table"),
      "metadata": .object(["pageNumber": .integer(2)]),
      "catalogId": .string("source-catalog"),
    ])

    // So they are checked against the component's schema.
    let error = try #require(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("table"),
        "component": .string("Table"),
        "metadata": .object(["extensions": .object([:])]),
      ])
    }
    #expect(error.details.contains { $0.path.hasPrefix("metadata") })
  }

  @Test func validateComponentRejectsPrefixedMixinsBeforeV10() throws {
    let validator = PayloadValidator(
      catalog: try makeTestCatalog(),
      config: ValidationConfig(protocolVersion: .v09)
    )
    for key in ["@metadata", "@catalogId", "@accessibility", "@checks"] {
      let error = try #require(throws: A2UIValidationError.self) {
        try validator.validateComponent([
          "id": .string("header_1"),
          "component": .string("Text"),
          "text": .string("Hello"),
          key: .object([:]),
        ])
      }
      #expect(error.details.map(\.path) == [key])
    }
  }

  @Test func validateComponentAcceptsPrefixedAndLegacyMixinsInV10() throws {
    let validator = PayloadValidator(
      catalog: try makeTestCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    let extensions: JSONValue = .object(["extensions": .object(["com_example": .string("a")])])

    try validator.validateComponent([
      "id": .string("header_1"),
      "component": .string("Text"),
      "text": .string("Hello"),
      "@metadata": extensions,
      "@accessibility": .object(["label": .string("Greeting")]),
    ])
    try validator.validateComponent([
      "id": .string("header_1"),
      "component": .string("Text"),
      "text": .string("Hello"),
      "metadata": extensions,
      "accessibility": .object(["label": .string("Greeting")]),
    ])
  }

  @Test func validateComponentTreatsComponentCommonMetadataRefAsMixinInV10() throws {
    let cardSchema = try Schema(
      instance: """
        {
          "type": "object",
          "$defs": {
            "ComponentCommonMetadata": {
              "type": "object",
              "properties": {
                "extensions": { "$ref": "\(Self.commonTypesURI)#/$defs/Extensions" }
              },
              "additionalProperties": false
            }
          },
          "properties": {
            "id": { "type": "string" },
            "component": { "const": "Card" },
            "metadata": { "$ref": "#/$defs/ComponentCommonMetadata" }
          },
          "required": ["id", "component"]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let validator = PayloadValidator(
      catalog: Catalog(
        id: "cards",
        protocolVersion: .v10,
        components: [AnyComponentAPI(name: "Card", schema: cardSchema)]
      ).eraseToAnyCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    let extensions: JSONValue = .object(["extensions": .object([:])])

    // A `metadata` that references `ComponentCommonMetadata` is the standard mixin, not a
    // property of the component's own, so carrying it under both keys is a conflict.
    let error = try #require(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("card"),
        "component": .string("Card"),
        "@metadata": extensions,
        "metadata": extensions,
      ])
    }
    #expect(error.details.map(\.path) == ["@metadata"])
  }

  @Test(arguments: ["@metadata", "metadata"])
  func validateComponentChecksMixinMetadataExtensionKeysInV10(key: String) throws {
    let validator = PayloadValidator(
      catalog: try makeTestCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    // #3466: the metadata mixin's extension keys must be UAX #31 identifiers.
    let error = try #require(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("header_1"),
        "component": .string("Text"),
        "text": .string("Hello"),
        key: .object(["extensions": .object(["com.example.bad": .string("a")])]),
      ])
    }
    #expect(error.details.allSatisfy { $0.path.hasPrefix(key) })
  }

  @Test func validateComponentChecksPrefixedAccessibilityInV10() throws {
    let validator = PayloadValidator(
      catalog: try makeTestCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    let error = try #require(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("header_1"),
        "component": .string("Text"),
        "text": .string("Hello"),
        "@accessibility": .object(["live": .string("loud")]),
      ])
    }
    #expect(error.details.map(\.path) == ["@accessibility/live"])
  }

  @Test(arguments: ["metadata", "catalogId", "accessibility", "checks"])
  func validateComponentRejectsPrefixedAndLegacyMixinTogetherInV10(bareKey: String) throws {
    let validator = PayloadValidator(
      catalog: try makeMixinCatalog(protocolVersion: .v10),
      config: ValidationConfig(protocolVersion: .v10)
    )
    let values: [String: JSONValue] = [
      "metadata": .object(["extensions": .object([:])]),
      "catalogId": .string("mixins"),
      "accessibility": .object(["label": .string("Value")]),
      "checks": .array([]),
    ]
    let value = try #require(values[bareKey])
    let error = try #require(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("input"),
        "component": .string("Input"),
        "@\(bareKey)": value,
        bareKey: value,
      ])
    }
    #expect(error.details.map(\.path) == ["@\(bareKey)"])
  }

  @Test func validateComponentKeepsCustomPropertiesBesidePrefixedMixinsInV10() throws {
    let validator = PayloadValidator(
      catalog: try makeMixinCatalog(protocolVersion: .v10),
      config: ValidationConfig(protocolVersion: .v10)
    )

    // The bare names are `Table`'s own properties, so they coexist with the mixins.
    try validator.validateComponent([
      "id": .string("table"),
      "component": .string("Table"),
      "metadata": .object(["pageNumber": .integer(0)]),
      "catalogId": .string("source-catalog"),
      "accessibility": .string("compact"),
      "checks": .array([.string("non_empty")]),
      "@metadata": .object(["extensions": .object(["com_example": .string("a")])]),
      "@accessibility": .object(["label": .string("Revenue")]),
    ])

    // The bare properties are checked against `Table`'s schema.
    let error = try #require(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("table"),
        "component": .string("Table"),
        "metadata": .object(["extensions": .object([:])]),
      ])
    }
    #expect(error.details.contains { $0.path.hasPrefix("metadata") })
  }

  @Test func validateComponentAcceptsChecksOnlyOnCheckableComponentsInV10() throws {
    let validator = PayloadValidator(
      catalog: try makeMixinCatalog(protocolVersion: .v10),
      config: ValidationConfig(protocolVersion: .v10)
    )
    let checks: JSONValue = .array([
      .object([
        "condition": .object(["@path": .string("/accepted")]),
        "message": .string("Required"),
      ])
    ])

    for key in ["@checks", "checks"] {
      try validator.validateComponent([
        "id": .string("input"),
        "component": .string("Input"),
        key: checks,
      ])
    }

    // The checks mixin is checked against `CheckRule`.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("input"),
        "component": .string("Input"),
        "@checks": .array([.object(["message": .string("No condition")])]),
      ])
    }

    let textValidator = PayloadValidator(
      catalog: try makeTestCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    let error = try #require(throws: A2UIValidationError.self) {
      try textValidator.validateComponent([
        "id": .string("header_1"),
        "component": .string("Text"),
        "text": .string("Hello"),
        "@checks": checks,
      ])
    }
    #expect(error.details.map(\.path) == ["@checks"])
  }

  @Test func validateComponentKeepsCheckableWithCustomChecksPropertyInV10() throws {
    // `Field` mixes in `Checkable` and also declares a `checks` property of its own that is not
    // a `CheckRule` list. It is still checkable, so it accepts the `@checks` mixin.
    let fieldSchema = try Schema(
      instance: """
        {
          "type": "object",
          "allOf": [
            { "$ref": "\(Self.commonTypesURI)#/$defs/Checkable" },
            {
              "properties": {
                "id": { "type": "string" },
                "component": { "const": "Field" },
                "checks": { "type": "array" }
              },
              "required": ["id", "component"]
            }
          ]
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let validator = PayloadValidator(
      catalog: Catalog(
        id: "fields",
        protocolVersion: .v10,
        components: [AnyComponentAPI(name: "Field", schema: fieldSchema)]
      ).eraseToAnyCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    try validator.validateComponent([
      "id": .string("field"),
      "component": .string("Field"),
      "@checks": .array([
        .object([
          "condition": .object(["@path": .string("/accepted")]),
          "message": .string("Required"),
        ])
      ]),
    ])
  }

  /// Returns a v1.0 validator for a catalog holding one `Widget` component with `schemaJSON`.
  private func makeWidgetValidator(_ schemaJSON: String) throws -> PayloadValidator {
    PayloadValidator(
      catalog: Catalog(
        id: "widgets",
        protocolVersion: .v10,
        components: [AnyComponentAPI(name: "Widget", schema: try Schema(instance: schemaJSON))]
      ).eraseToAnyCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
  }

  /// A `Widget` schema that declares `property` in one `properties` block, beside `id` when
  /// `besideID` is true, or with `id` in a separate `allOf` branch otherwise.
  private func widgetSchema(declaring property: String, besideID: Bool) -> String {
    let id = #""id": { "type": "string" }"#
    guard besideID else {
      return """
        { "allOf": [{ "properties": { \(id) } }, { "properties": { \(property) } }] }
        """
    }
    return #"{ "properties": { \#(id), \#(property) } }"#
  }

  private func widget(_ properties: [String: JSONValue]) -> [String: JSONValue] {
    properties.merging(["id": .string("w"), "component": .string("Widget")]) { _, new in new }
  }

  @Test func validateComponentTreatsInlineCatalogIDAsMixinOnlyBesideIDInV10() throws {
    // Beside `id`, a `catalogId` of type string is an inlined `ComponentCommon` mixin, so naming
    // it both ways is a conflict.
    let stringCatalogID = #""catalogId": { "type": "string" }"#
    let standard = try makeWidgetValidator(widgetSchema(declaring: stringCatalogID, besideID: true))
    let error = try #require(throws: A2UIValidationError.self) {
      try standard.validateComponent(
        widget(["@catalogId": .string("widgets"), "catalogId": .string("widgets")])
      )
    }
    #expect(error.details.map(\.path) == ["@catalogId"])

    // With another shape, or without `id` in the same `properties` block, it is the component's
    // own property.
    let integerCatalogID = #""catalogId": { "type": "integer" }"#
    try makeWidgetValidator(widgetSchema(declaring: integerCatalogID, besideID: true))
      .validateComponent(widget(["@catalogId": .string("widgets"), "catalogId": .integer(1)]))
    try makeWidgetValidator(widgetSchema(declaring: stringCatalogID, besideID: false))
      .validateComponent(widget(["@catalogId": .string("widgets"), "catalogId": .string("own")]))
  }

  @Test func validateComponentTreatsInlineMetadataAsMixinOnlyBesideIDInV10() throws {
    let extensions: JSONValue = .object(["extensions": .object([:])])
    // Beside `id`, an object `metadata` holding only `extensions` is an inlined
    // `ComponentCommon` mixin, so naming it both ways is a conflict.
    let extensionsMetadata = """
      "metadata": { "type": "object", "properties": { "extensions": { "type": "object" } } }
      """
    let standard = try makeWidgetValidator(
      widgetSchema(declaring: extensionsMetadata, besideID: true)
    )
    let error = try #require(throws: A2UIValidationError.self) {
      try standard.validateComponent(widget(["@metadata": extensions, "metadata": extensions]))
    }
    #expect(error.details.map(\.path) == ["@metadata"])

    // With another shape, or without `id` in the same `properties` block, it is the component's
    // own property.
    let stringMetadata = #""metadata": { "type": "string" }"#
    try makeWidgetValidator(widgetSchema(declaring: stringMetadata, besideID: true))
      .validateComponent(widget(["@metadata": extensions, "metadata": .string("own")]))
    try makeWidgetValidator(widgetSchema(declaring: extensionsMetadata, besideID: false))
      .validateComponent(widget(["@metadata": extensions, "metadata": extensions]))
  }

  @Test func validateComponentRejectsPrefixedMixinNestedInPropertyInV10() throws {
    let validator = PayloadValidator(
      catalog: try makeTestCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    // The mixin keys are allowed at the component's root only.
    let error = try #require(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("header_1"),
        "component": .string("Text"),
        "text": .object(["@metadata": .object([:])]),
      ])
    }
    #expect(error.details.contains { $0.code == "INVALID_RESERVED_KEY" })
  }

  @Test func validateComponentReadsComponentCatalogFromPrefixedCatalogIDInV10() throws {
    let validator = PayloadValidator(
      catalog: try makeTestCatalog(),
      config: ValidationConfig(protocolVersion: .v10)
    )
    let error = try #require(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": .string("header_1"),
        "component": .string("Text"),
        "text": .string("Hello"),
        "@catalogId": .integer(1),
      ])
    }
    #expect(error.details.map(\.path) == ["@catalogId"])
  }
}
