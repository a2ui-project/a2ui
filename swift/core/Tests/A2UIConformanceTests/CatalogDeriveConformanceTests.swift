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
struct CatalogDeriveConformanceTests {
  /// Catalog document keys a Swift ``Catalog`` has no property for, so it never carries them.
  private static let keysWithoutProperty: Set<String> = ["$id", "title", "description"]

  private static let knownCaseKeys: Set<String> = [
    "action",
    "args",
    "catalog",
    "catalogPath",
    "expect",
    "expectError",
  ]

  private static let knownArgsKeys: Set<String> = [
    "catalogId",
    "components",
    "functions",
    "instructions",
  ]

  private static let knownExpectKeys: Set<String> = [
    "absentKeys",
    "catalogId",
    "components",
    "functions",
    "instructions",
    "protocolVersion",
    "theme",
  ]

  private static let knownExpectErrorKeys: Set<String> = [
    "category",
    "message",
  ]

  private static let context = Context(
    dialect: .draft2020_12,
    remoteSchema: A2UICommonSchema.allSchemas
  )

  @Test(arguments: ConformanceTestHelper.cases("core/catalog.yaml", action: "derive"))
  func catalogDeriveConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      try runDeriveCase(conformanceCase.json, name: conformanceCase.name)
    }
  }

  private func runDeriveCase(_ testCase: JSONValue, name: String) throws {
    if let obj = testCase.objectValue {
      try ConformanceTestHelper.assertKnownKeys(
        obj,
        Self.knownCaseKeys,
        "catalog.yaml derive case '\(name)'"
      )
    }
    let source = try sourceCatalog(of: testCase)
    let args = testCase["args"]
    if let argsObj = args?.objectValue {
      try ConformanceTestHelper.assertKnownKeys(
        argsObj,
        Self.knownArgsKeys,
        "catalog.yaml derive args in '\(name)'",
        allowMetadata: false
      )
    }
    let catalogID = try #require(args?["catalogId"]?.stringValue, "\(name): no catalogId")
    let components = try args?["components"]?.arrayValue.map { entries in
      try entries.map(componentEntry)
    }
    let functions = try args?["functions"]?.arrayValue.map { entries in
      try entries.map(functionEntry)
    }
    let instructions = args?["instructions"]?.stringValue

    if let expectError = testCase["expectError"] {
      if let errObj = expectError.objectValue {
        try ConformanceTestHelper.assertKnownKeys(
          errObj,
          Self.knownExpectErrorKeys,
          "catalog.yaml derive expectError in '\(name)'",
          allowMetadata: false
        )
      }
      #expect(expectError["category"]?.stringValue == "CatalogError", "\(name)")
      let message = expectError["message"]?.stringValue ?? ""
      do {
        _ = try source.derive(
          id: catalogID,
          components: components,
          functions: functions,
          instructions: instructions
        )
        Issue.record("\(name): expected A2UICatalogError")
      } catch let error as A2UICatalogError {
        #expect(error.message.contains(message), "\(name): \(error.message)")
      }
      return
    }

    let derived = try source.derive(
      id: catalogID,
      components: components,
      functions: functions,
      instructions: instructions
    )
    let expect = try #require(testCase["expect"], "\(name): no expect")
    if let expectObj = expect.objectValue {
      try ConformanceTestHelper.assertKnownKeys(
        expectObj,
        Self.knownExpectKeys,
        "catalog.yaml derive expect in '\(name)'",
        allowMetadata: false
      )
    }
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
    if let expectedInstructions = expect["instructions"] {
      let instructions = try #require(expectedInstructions.stringValue, "\(name): bad instructions")
      #expect(derived.instructions == instructions, "\(name)")
    }
    if let absentKeys = expect["absentKeys"] {
      let keys = try #require(absentKeys.arrayValue, "\(name): bad absentKeys")
      for key in keys {
        try checkAbsent(try #require(key.stringValue, "\(name): bad absentKeys"), in: derived)
      }
    }
  }

  /// Checks that `catalog` does not carry the catalog document key `key`.
  private func checkAbsent(_ key: String, in catalog: AnyCatalog) throws {
    switch key {
    case "instructions":
      #expect(catalog.instructions == nil, "expected no instructions")
    case _ where Self.keysWithoutProperty.contains(key):
      break
    default:
      throw UnknownConformanceKeyError("catalog.yaml derive absentKeys has unknown key '\(key)'")
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
      themeSchema: try document["theme"].map(schema),
      instructions: document["instructions"]?.stringValue
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
