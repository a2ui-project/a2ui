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
import OrderedJSON
import Testing

/// Verifies lossless bidirectional round-tripping of the v0.9, v0.9.1, and v1.0 Basic Catalogs
/// between JSON Schema, canonical ``CatalogModel``, and Catalog Documents (`formatVersion: "1.0"`).
struct BasicCatalogDocumentRoundTripTests {
  private static func repoRootURL() -> URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private static func loadRepoJSON(relativePath: String) throws -> JSONValue {
    let url = repoRootURL().appendingPathComponent(relativePath)
    let data = try Data(contentsOf: url)
    return try JSONValue.parse(data)
  }

  @Test func v10BuiltinBasicCatalogRoundTripsThroughCatalogDocument() throws {
    let original = V10BasicCatalog.catalog
    let document = try original.toDocument()
    #expect(CatalogDocumentCodec.isCatalogDocument(document))
    #expect(document["formatVersion"] == .string("1.0"))
    #expect(document["catalogId"] == .string(V10BasicCatalog.catalogURI))
    #expect(document["protocolVersion"] == .string("1.0"))

    let reparsed = try Catalog.fromDocument(document, functions: V10BasicCatalog.functions)
    #expect(Set(reparsed.components.keys) == Set(original.components.keys))
    #expect(reparsed.components.count == 18)

    let reparsedFunctions = Set(reparsed.functions.keys.filter { !$0.hasPrefix("@") })
    let originalFunctions = Set(original.functions.keys.filter { !$0.hasPrefix("@") })
    #expect(reparsedFunctions == originalFunctions)
    #expect(reparsedFunctions.count == 14)

    // All 6 checkable components preserve checkability across the round-trip.
    for checkableName in [
      "Button", "TextField", "CheckBox", "ChoicePicker", "Slider", "DateTimeInput",
    ] {
      #expect(
        reparsed.components[checkableName]?.definition.isCheckable == true,
        "\(checkableName) should remain checkable after round-trip"
      )
    }

    let secondDocument = try reparsed.toDocument()
    #expect(secondDocument == document)

    let jsonSchema = reparsed.toJSON(protocolVersion: .v10)
    #expect(jsonSchema["catalogId"] == .string(V10BasicCatalog.catalogURI))
    #expect(jsonSchema["components"]?.objectValue?.count == 18)
    #expect(jsonSchema["functions"]?.objectValue?.count == 14)
    #expect(jsonSchema["$defs"]?["anyComponent"] != nil)
    #expect(jsonSchema["$defs"]?["anyFunction"] != nil)
  }

  @Test func v09BuiltinBasicCatalogRoundTripsWithThemeSurfaceProperties() throws {
    let original = V09BasicCatalog.catalog
    let document = try original.toDocument()
    #expect(document["formatVersion"] == .string("1.0"))
    #expect(document["protocolVersion"] == .string("0.9"))
    #expect(document["surfaceProperties"] != nil)

    let reparsed = try Catalog.fromDocument(document, functions: V09BasicCatalog.functions)
    #expect(Set(reparsed.components.keys) == Set(original.components.keys))
    #expect(reparsed.components.count == 18)
    #expect(reparsed.surfaceProperties?.property(named: "primaryColor") != nil)

    let validator = PayloadValidator(catalog: reparsed, config: .strict)
    try validator.validateTheme(["primaryColor": "#00BFFF", "agentDisplayName": "Spark"])
    #expect(throws: A2UIValidationError.self) {
      try validator.validateTheme(["primaryColor": "invalid"])
    }

    let v09JSON = reparsed.toJSON(protocolVersion: .v09)
    #expect(v09JSON["theme"]?["primaryColor"]?["pattern"] == .string("^#[0-9a-fA-F]{6}$"))
  }

  @Test func v10RepositoryCatalogJSONRoundTripsAndValidatesPayloads() throws {
    let rawJSON = try Self.loadRepoJSON(relativePath: "catalogs/basic/v1/catalog.json")
    let loaded = try Catalog.fromJSON(rawJSON)
    #expect(loaded.id == V10BasicCatalog.catalogURI)
    #expect(loaded.components.count == 18)
    #expect(loaded.types["Weight"] != nil)
    #expect(loaded.instructions != nil)

    let doc = try loaded.toDocument()
    let fromDoc = try Catalog.fromDocument(doc)
    #expect(fromDoc.model == loaded.model)
    #expect(try fromDoc.toDocument() == doc)

    let validator = PayloadValidator(catalog: fromDoc, config: .strict)

    // Text + Weight ref.
    try validator.validateComponent([
      "id": "t1",
      "component": "Text",
      "text": "Hello A2UI",
      "variant": "caption",
      "weight": 2,
    ])

    // Icon tagged union (enum, svgPath object, DataBinding).
    try validator.validateComponent(["id": "i1", "component": "Icon", "name": "star"])
    try validator.validateComponent([
      "id": "i2",
      "component": "Icon",
      "name": ["svgPath": ["@path": "/icon/path"]],
    ])
    try validator.validateComponent([
      "id": "i3",
      "component": "Icon",
      "name": ["@path": "/icon/name"],
    ])

    // DateTimeInput multi-format ISO-8601 validation.
    try validator.validateComponent([
      "id": "d1",
      "component": "DateTimeInput",
      "value": ["@path": "/when"],
      "min": "2026-01-01",
      "max": "2026-12-31T23:59:59.000Z",
    ])
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "d2",
        "component": "DateTimeInput",
        "value": "",
        "min": "not-a-date",
      ])
    }

    // ChoicePicker DynamicStringList + nested option objects.
    try validator.validateComponent([
      "id": "cp1",
      "component": "ChoicePicker",
      "options": [["label": "Option A", "value": "a"]],
      "value": ["a"],
    ])

    // Slider integer minimum constraint on steps.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "s1",
        "component": "Slider",
        "value": 5,
        "max": 10,
        "steps": 0,
      ])
    }

    // Function validation: length atLeastOneOf + openUrl URI format.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateFunction(name: "length", args: ["value": "abc"])
    }
    try validator.validateFunction(name: "length", args: ["value": "abc", "min": 1])
    try validator.validateFunction(name: "openUrl", args: ["url": "https://a2ui.org"])
    #expect(throws: A2UIValidationError.self) {
      try validator.validateFunction(name: "openUrl", args: ["url": "not a uri"])
    }
  }

  @Test func v091RepositoryCatalogJSONRoundTripsCleanly() throws {
    let rawJSON = try Self.loadRepoJSON(relativePath: "catalogs/basic/v0_9_1/catalog.json")
    let loaded = try Catalog.fromJSON(rawJSON, protocolVersion: "v0.9.1")
    #expect(loaded.components.count == 18)
    #expect(loaded.surfaceProperties?.property(named: "primaryColor") != nil)

    // v0.9.1 function returnType lives at `properties.returnType.const`.
    #expect(loaded.functions["required"]?.api.returnType == .boolean)
    #expect(loaded.functions["formatString"]?.api.returnType == .string)
    #expect(loaded.functions["openUrl"]?.api.returnType == .void)

    // v0.9.1 CatalogComponentCommon (`weight`) is appended after the component's own parameters.
    #expect(
      loaded.components["Text"]?.definition.parameters.map(\.name) == ["text", "variant", "weight"])

    let doc = try loaded.toDocument()
    #expect(doc["protocolVersion"] == .string("0.9.1"))
    let fromDoc = try Catalog.fromDocument(doc)
    #expect(fromDoc.model == loaded.model)
    #expect(try fromDoc.toDocument() == doc)
  }

  @Test func v10McpCatalogJSONRoundTripsThroughCatalogDocument() throws {
    let rawJSON = try Self.loadRepoJSON(relativePath: "catalogs/mcp/v1/catalog.json")
    let loaded = try Catalog.fromJSON(rawJSON)
    #expect(loaded.components["McpApp"]?.definition.isCanonical == true)
    #expect(loaded.functions["callMcpTool"]?.api.definition.isCanonical == true)

    let doc = try loaded.toDocument()
    let fromDoc = try Catalog.fromDocument(doc)
    #expect(fromDoc.model == loaded.model)
    #expect(try fromDoc.toDocument() == doc)

    let reJSON = fromDoc.toJSON(protocolVersion: .v10)
    let fromReJSON = try Catalog.fromJSON(reJSON)
    #expect(fromReJSON.model == loaded.model)
  }
}
