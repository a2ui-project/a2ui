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
import OrderedJSON
import Testing

/// Runs the `derive` cases of the shared `conformance/core/catalog.yaml` suite.
///
/// A Swift catalog has no `$id`, title, description or instructions, so the runner does not
/// check `absentKeys`.
struct CatalogDeriveConformanceTests {
  /// Cases that check a catalog field the Swift catalog does not have.
  private static let skippedCases: Set<String> = [
    // `derive` takes no instructions, since a Swift catalog has none.
    "test_v10_catalog_derive_sets_instructions"
  ]

  private static let context = Context(
    dialect: .draft2020_12,
    remoteSchema: A2UICommonSchema.allSchemas
  )

  @Test func catalogDeriveConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/catalog.yaml")
    let cases = ((rawYAML as? [[String: Any]]) ?? []).filter {
      $0["action"] as? String == "derive"
    }
    #expect(!cases.isEmpty, "core/catalog.yaml should hold derive cases")

    var executed = 0
    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      if Self.skippedCases.contains(name) { continue }
      try runDeriveCase(ConformanceTestHelper.toJSONValue(testCase), name: name)
      executed += 1
    }
    #expect(executed > 0, "no derive case of core/catalog.yaml was executed")
  }

  private func runDeriveCase(_ testCase: JSONValue, name: String) throws {
    let source = try sourceCatalog(of: testCase)
    let args = testCase["args"]
    let catalogID = try #require(args?["catalogId"]?.stringValue, "\(name): no catalogId")
    let components = try args?["components"]?.arrayValue.map { entries in
      try entries.map(componentEntry)
    }
    let functions = try args?["functions"]?.arrayValue.map { entries in
      try entries.map(functionEntry)
    }

    if let expectError = testCase["expectError"] {
      #expect(expectError["category"]?.stringValue == "CatalogError", "\(name)")
      let message = expectError["message"]?.stringValue ?? ""
      do {
        _ = try source.derive(id: catalogID, components: components, functions: functions)
        Issue.record("\(name): expected A2UICatalogError")
      } catch let error as A2UICatalogError {
        #expect(error.message.contains(message), "\(name): \(error.message)")
      }
      return
    }

    let derived = try source.derive(id: catalogID, components: components, functions: functions)
    let expect = try #require(testCase["expect"], "\(name): no expect")
    if let expectedID = expect["catalogId"]?.stringValue {
      #expect(derived.id == expectedID, "\(name)")
    }
    if let expectedVersion = expect["protocolVersion"]?.stringValue {
      #expect(derived.protocolVersion == expectedVersion, "\(name)")
    }
    if let expectedComponents = expect["components"] {
      try checkComponents(of: derived, against: expectedComponents, name: name)
    }
    if let expectedFunctions = expect["functions"]?.arrayValue {
      // A v1.0 catalog always holds `@index`, which no catalog file lists.
      let names = Set(derived.functions.keys).subtracting(["@index"])
      #expect(names == Set(expectedFunctions.compactMap(\.stringValue)), "\(name)")
    }
    if let expectedTheme = expect["theme"] {
      #expect(derived.themeSchema == (try schema(expectedTheme)), "\(name)")
    }
  }

  /// Checks a list of component names, or a map of component names to their schemas.
  private func checkComponents(
    of catalog: AnyCatalog,
    against expected: JSONValue,
    name: String
  ) throws {
    if let names = expected.arrayValue {
      #expect(Set(catalog.components.keys) == Set(names.compactMap(\.stringValue)), "\(name)")
      return
    }
    let schemas = try #require(expected.objectValue, "\(name): bad components")
    #expect(Set(catalog.components.keys) == Set(schemas.keys), "\(name)")
    for (componentName, expectedSchema) in schemas {
      #expect(
        catalog.components[componentName]?.schema == (try schema(expectedSchema)),
        "\(name): \(componentName)"
      )
    }
  }

  /// The catalog a case derives from: the file at `catalogPath`, or the inline `catalog`.
  private func sourceCatalog(of testCase: JSONValue) throws -> AnyCatalog {
    let document =
      if let path = testCase["catalogPath"]?.stringValue {
        try ConformanceTestHelper.loadRepositoryJSON(path: path)
      } else {
        try #require(testCase["catalog"], "case has no catalog")
      }
    let components = try (document["components"]?.objectValue ?? [:]).map {
      AnyComponentAPI(name: $0.key, schema: try schema($0.value))
    }
    let functions = try (document["functions"]?.objectValue ?? [:]).map {
      try function(named: $0.key, definition: $0.value)
    }
    return Catalog(
      id: try #require(document["catalogId"]?.stringValue, "catalog has no catalogId"),
      protocolVersion: document["protocolVersion"]?.stringValue,
      components: components,
      functions: functions,
      themeSchema: try document["theme"].map(schema)
    )
  }

  /// A component of `args.components`: a name, or a map from a new component's name to its
  /// schema.
  private func componentEntry(_ value: JSONValue) throws -> DerivedCatalogEntry<AnyComponentAPI> {
    if let name = value.stringValue { return .keep(name) }
    let (name, definition) = try onlyEntry(of: value)
    return .add(AnyComponentAPI(name: name, schema: try schema(definition)))
  }

  /// A function of `args.functions`: a name, or a map from a new function's name to its
  /// definition.
  private func functionEntry(
    _ value: JSONValue
  ) throws -> DerivedCatalogEntry<any FunctionImplementation> {
    if let name = value.stringValue { return .keep(name) }
    let (name, definition) = try onlyEntry(of: value)
    return .add(try function(named: name, definition: definition))
  }

  private func onlyEntry(of value: JSONValue) throws -> (String, JSONValue) {
    let object = try #require(value.objectValue, "entry is neither a name nor a map")
    try #require(object.count == 1, "a new entry must be a map with one key")
    let entry = try #require(object.elements.first)
    return (entry.key, entry.value)
  }

  /// A function from its catalog definition, whose `args` property is its arguments schema.
  private func function(
    named name: String,
    definition: JSONValue
  ) throws -> any FunctionImplementation {
    let properties = definition["properties"]
    let returnType =
      properties?["returnType"]?["const"]?.stringValue.flatMap(FunctionReturnType.init) ?? .any
    let api = FunctionAPI(
      name: name,
      returnType: returnType,
      schema: try schema(properties?["args"] ?? .object([:]))
    )
    return ConformanceFunctionImplementation(api: api)
  }

  private func schema(_ value: JSONValue) throws -> Schema {
    try Schema(rawSchema: value, context: Self.context)
  }
}
