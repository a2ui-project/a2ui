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

private struct LoadedCatalogInfo {
  let catalog: AnyCatalog
  let rawSchema: JSONValue
  let resolvedProtocolVersion: String
}

/// Runs the shared `conformance/core/catalog.yaml` suite (non-`derive` actions) directly through
/// `Catalog.fromJSON`, `Catalog.toJSON`, `Catalog.toDocument`, and `Catalog.fromDocument`.
struct CatalogConformanceTests {
  static let supportedActions: Set<String> = [
    "from_json",
    "round_trip",
    "to_json",
    "validation_schema",
  ]

  private static let knownCaseKeys: Set<String> = [
    "action",
    "builtinCatalog",
    "catalog",
    "catalogId",
    "catalogPath",
    "expect",
    "expectError",
    "expectFile",
    "protocolVersion",
  ]

  private static let knownFromJSONExpectKeys: Set<String> = [
    "catalogId",
    "componentMetadata",
    "components",
    "functions",
    "invalidComponents",
    "matchesBuiltinCatalog",
    "protocolVersion",
    "selfContained",
    "validComponents",
  ]

  private static let knownExpectErrorKeys: Set<String> = [
    "category",
    "message",
  ]

  @Test(arguments: ConformanceTestHelper.cases("core/catalog.yaml", actions: Self.supportedActions))
  func catalogConformance(_ conformanceCase: ConformanceCase) throws {
    let testCase = conformanceCase.rawDictionary
    let version = testCase["protocolVersion"] as? String
    let skippedReason =
      version == "v0.8" ? "protocol version v0.8 is not supported by A2UICore" : nil
    try ConformanceManifest.run(conformanceCase, skippedReason: skippedReason) {
      try ConformanceTestHelper.assertKnownKeys(
        testCase,
        Self.knownCaseKeys,
        "catalog.yaml case '\(conformanceCase.name)'"
      )
      let action = testCase["action"] as? String ?? ""
      try dispatchCatalogCase(testCase, action: action)
    }
  }

  private func dispatchCatalogCase(_ testCase: [String: Any], action: String) throws {
    switch action {
    case "from_json":
      try runFromJSONCase(testCase)
    case "to_json":
      try runToJSONCase(testCase)
    case "round_trip":
      try runRoundTripCase(testCase)
    case "validation_schema":
      try runValidationSchemaCase(testCase)
    default:
      throw UnknownConformanceKeyError("Unknown catalog.yaml action '\(action)'")
    }
  }

  // MARK: - Actions

  private func runFromJSONCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    if let errDict = (testCase["expectError"] ?? testCase["expect_error"]) as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        errDict,
        Self.knownExpectErrorKeys,
        "catalog.yaml expectError in '\(name)'",
        allowMetadata: false
      )
    }
    let expectError = ConformanceTestHelper.parseExpectError(
      testCase["expectError"] ?? testCase["expect_error"]
    )
    if let expectError {
      assertFromJSONThrows(testCase, expectError: expectError, caseName: name)
      return
    }
    let loaded = try loadCatalogFromTestCase(testCase)
    if let expect = testCase["expect"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expect,
        Self.knownFromJSONExpectKeys,
        "catalog.yaml expect in '\(name)'",
        allowMetadata: false
      )
      try assertFromJSONExpectations(loaded, expect: expect, caseName: name)
    }
  }

  private func assertFromJSONThrows(
    _ testCase: [String: Any],
    expectError: ConformanceExpectError,
    caseName: String
  ) {
    do {
      _ = try loadCatalogFromTestCase(testCase)
      Issue.record("[\(caseName)] Expected CatalogError to be thrown, but succeeded")
    } catch let error as A2UICatalogError {
      if let expectedMessage = expectError.message, !expectedMessage.isEmpty {
        #expect(
          ConformanceTestHelper.messageMatches(error.message, expected: expectedMessage),
          "[\(caseName)] Expected message containing '\(expectedMessage)', got '\(error.message)'"
        )
      }
    } catch let error as A2UIValidationError {
      #expect(
        expectError.category == nil || expectError.category == "ValidationError",
        "[\(caseName)] Unexpected ValidationError for \(String(describing: expectError.category))"
      )
      if let expectedMessage = expectError.message, !expectedMessage.isEmpty {
        #expect(
          ConformanceTestHelper.messageMatches(error.message, expected: expectedMessage),
          "[\(caseName)] Expected message containing '\(expectedMessage)', got '\(error.message)'"
        )
      }
    } catch {
      Issue.record("[\(caseName)] Expected A2UICatalogError or A2UIValidationError, got \(error)")
    }
  }

  private func runToJSONCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    guard let expectFile = testCase["expectFile"] as? String else { return }
    let expectedJSON = try ConformanceTestHelper.loadRepositoryJSON(path: expectFile)
    let rawVersion = testCase["protocolVersion"] as? String ?? "v1.0"
    let version = A2UIProtocolVersion(lenientRawValue: rawVersion) ?? .v10
    let builtin = BasicCatalog.makeCatalog(version: version)
    assertMatchesBuiltinCatalog(loadedSchema: expectedJSON, builtin: builtin, caseName: name)
    let emitted = builtin.toJSON(protocolVersion: version)
    let reparsed = try Catalog.fromJSON(emitted, protocolVersion: version.rawValue)
    #expect(
      Set(reparsed.components.keys) == Set(builtin.components.keys),
      "[\(name)] Builtin toJSON() round-trip component keys mismatch"
    )
  }

  private func runRoundTripCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    let firstLoad = try loadCatalogFromTestCase(testCase)
    let targetVersion =
      A2UIProtocolVersion(lenientRawValue: firstLoad.resolvedProtocolVersion) ?? .v10

    // Real JSON Schema round-trip through `toJSON()` -> `Catalog.fromJSON(...)`.
    let roundTrippedJSON = firstLoad.catalog.toJSON(protocolVersion: targetVersion)
    let secondLoad = try Catalog.fromJSON(
      roundTrippedJSON,
      catalogID: firstLoad.catalog.id,
      protocolVersion: firstLoad.resolvedProtocolVersion
    )
    #expect(secondLoad.id == firstLoad.catalog.id, "[\(name)] Round-trip catalogId mismatch")
    #expect(
      secondLoad.model.components == firstLoad.catalog.model.components,
      "[\(name)] Round-trip components mismatch"
    )
    #expect(
      secondLoad.model.functions == firstLoad.catalog.model.functions,
      "[\(name)] Round-trip functions mismatch"
    )
    #expect(
      secondLoad.model.types == firstLoad.catalog.model.types,
      "[\(name)] Round-trip local types mismatch"
    )
    #expect(
      secondLoad.model.surfaceProperties == firstLoad.catalog.model.surfaceProperties,
      "[\(name)] Round-trip surfaceProperties mismatch"
    )

    // Catalog Document round-trip whenever root metadata satisfies Catalog Document v1.0 schema.
    let hasStrictMetadata =
      firstLoad.catalog.metadata == nil
      || (try? MetadataValidator.validate(firstLoad.catalog.metadata)) != nil
    if hasStrictMetadata {
      let document = try firstLoad.catalog.toDocument()
      let fromDoc = try Catalog.fromDocument(document)
      #expect(
        fromDoc.model == firstLoad.catalog.model,
        "[\(name)] Catalog Document round-trip model mismatch"
      )
      #expect(
        try fromDoc.toDocument() == document,
        "[\(name)] Catalog Document re-encoding was not idempotent"
      )
    }
  }

  private func runValidationSchemaCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    guard let expectFile = testCase["expectFile"] as? String else { return }
    let loaded = try loadCatalogFromTestCase(testCase)
    let expectedSchema = try ConformanceTestHelper.loadRepositoryJSON(path: expectFile)
    if let expectedID = expectedSchema["catalogId"]?.stringValue {
      #expect(loaded.catalog.id == expectedID, "[\(name)] validation_schema catalogId mismatch")
    }
    if let expectedComps = expectedSchema["components"]?.objectValue {
      #expect(
        Set(loaded.catalog.components.keys) == Set(expectedComps.keys),
        "[\(name)] validation_schema component keys mismatch"
      )
    }
  }

  // MARK: - Catalog Loading

  private func loadCatalogFromTestCase(_ testCase: [String: Any]) throws -> LoadedCatalogInfo {
    let catalogPath = testCase["catalogPath"] as? String
    let rawSchema = try extractRawCatalogSchema(from: testCase, catalogPath: catalogPath)
    let explicitCatalogID = testCase["catalogId"] as? String
    let explicitVersion = testCase["protocolVersion"] as? String
    let catalog = try Catalog.fromJSON(
      rawSchema,
      catalogID: explicitCatalogID,
      protocolVersion: explicitVersion
    )
    let resolvedVersion = catalog.protocolVersion ?? explicitVersion ?? "0.9"
    return LoadedCatalogInfo(
      catalog: catalog,
      rawSchema: rawSchema,
      resolvedProtocolVersion: resolvedVersion
    )
  }

  private func extractRawCatalogSchema(
    from testCase: [String: Any],
    catalogPath: String?
  ) throws -> JSONValue {
    if let catalogPath {
      return try ConformanceTestHelper.loadRepositoryJSON(path: catalogPath)
    }
    if let rawCatalog = testCase["catalog"] {
      return ConformanceTestHelper.toJSONValue(rawCatalog)
    }
    throw A2UICatalogError("Missing catalog or catalogPath in test case")
  }

  // MARK: - Assertions

  private func assertFromJSONExpectations(
    _ loaded: LoadedCatalogInfo,
    expect: [String: Any],
    caseName: String
  ) throws {
    if let expectedID = expect["catalogId"] as? String {
      #expect(loaded.catalog.id == expectedID, "[\(caseName)] catalogId mismatch")
    }
    if let expectedVersion = expect["protocolVersion"] as? String {
      let actualParsed = A2UIProtocolVersion(lenientRawValue: loaded.resolvedProtocolVersion)
      let expectedParsed = A2UIProtocolVersion(lenientRawValue: expectedVersion)
      #expect(
        actualParsed != nil && actualParsed == expectedParsed,
        """
        [\(caseName)] protocolVersion mismatch: got '\(loaded.resolvedProtocolVersion)', \
        expected '\(expectedVersion)'
        """
      )
    }
    if expect["matchesBuiltinCatalog"] as? Bool == true {
      let version = A2UIProtocolVersion(lenientRawValue: loaded.resolvedProtocolVersion) ?? .v10
      let builtin = BasicCatalog.makeCatalog(version: version)
      assertMatchesBuiltinCatalog(
        loadedSchema: loaded.rawSchema,
        builtin: builtin,
        caseName: caseName
      )
    }
    if let rawComponents = expect["components"] {
      assertExpectedComponents(rawComponents, catalog: loaded.catalog, caseName: caseName)
    }
    if let expCompMeta = expect["componentMetadata"] as? [String: Any] {
      assertExpectedComponentMetadata(expCompMeta, catalog: loaded.catalog, caseName: caseName)
    }
    if let rawFunctions = expect["functions"] {
      assertExpectedFunctions(rawFunctions, catalog: loaded.catalog, caseName: caseName)
    }
    try assertComponentValidationCases(loaded, expect: expect, caseName: caseName)
  }

  private func assertMatchesBuiltinCatalog(
    loadedSchema: JSONValue,
    builtin: AnyCatalog,
    caseName: String
  ) {
    if let schemaComps = loadedSchema["components"]?.objectValue {
      #expect(
        Set(builtin.components.keys) == Set(schemaComps.keys),
        "[\(caseName)] Builtin catalog component names mismatch"
      )
    }
    if let schemaFuncs = loadedSchema["functions"]?.objectValue {
      let builtinFuncNames = Set(builtin.functions.keys.filter { !$0.hasPrefix("@") })
      #expect(
        builtinFuncNames == Set(schemaFuncs.keys),
        "[\(caseName)] Builtin catalog function names mismatch"
      )
    }
  }

  private func assertExpectedComponents(
    _ rawExpected: Any,
    catalog: AnyCatalog,
    caseName: String
  ) {
    if let expectedNames = rawExpected as? [String] {
      #expect(
        Set(catalog.components.keys) == Set(expectedNames),
        """
        [\(caseName)] Expected component names \(expectedNames), \
        got \(Array(catalog.components.keys))
        """
      )
      return
    }
    guard let expectedDict = rawExpected as? [String: Any] else { return }
    for (compName, rawSpec) in expectedDict {
      guard let comp = catalog.components[compName] else {
        Issue.record("[\(caseName)] Missing expected component '\(compName)'")
        continue
      }
      assertSingleComponentMetadata(
        comp,
        spec: (rawSpec as? [String: Any]) ?? [:],
        caseName: caseName
      )
    }
  }

  private func assertSingleComponentMetadata(
    _ comp: AnyComponentAPI,
    spec: [String: Any],
    caseName: String
  ) {
    if let expParents = spec["allowedParents"] as? [String] {
      #expect(
        comp.allowedParents == expParents, "[\(caseName)] \(comp.name) allowedParents mismatch")
    }
    if let expChildren = spec["allowedChildren"] as? [String] {
      #expect(
        comp.allowedChildren == expChildren, "[\(caseName)] \(comp.name) allowedChildren mismatch")
    }
    if let expDesc = spec["description"] as? String {
      let actualDesc = comp.definition.description ?? comp.metadata?["description"]?.stringValue
      #expect(
        actualDesc == expDesc,
        "[\(caseName)] \(comp.name) description mismatch"
      )
    }
  }

  private func assertExpectedComponentMetadata(
    _ expectedMetadata: [String: Any],
    catalog: AnyCatalog,
    caseName: String
  ) {
    for (compName, rawMeta) in expectedMetadata {
      guard let comp = catalog.components[compName] else {
        Issue.record("[\(caseName)] Missing component '\(compName)' for componentMetadata check")
        continue
      }
      if rawMeta is NSNull {
        #expect(comp.metadata == nil, "[\(caseName)] Expected nil metadata for '\(compName)'")
      } else {
        let expectedDict = try? MetadataValidator.validate(
          ConformanceTestHelper.toJSONValue(rawMeta),
          pathPrefix: "components.\(compName).metadata"
        )
        #expect(
          MetadataValidator.areEqual(comp.metadata, expectedDict),
          "[\(caseName)] componentMetadata mismatch for '\(compName)'"
        )
      }
    }
  }

  private func assertExpectedFunctions(
    _ rawExpected: Any,
    catalog: AnyCatalog,
    caseName: String
  ) {
    let declaredFuncNames = Set(catalog.functions.keys.filter { !$0.hasPrefix("@") })
    if let expectedNames = rawExpected as? [String] {
      #expect(
        declaredFuncNames == Set(expectedNames),
        "[\(caseName)] Expected function names \(expectedNames), got \(Array(declaredFuncNames))"
      )
      return
    }
    guard let expectedDict = rawExpected as? [String: Any] else { return }
    for (funcName, rawSpec) in expectedDict {
      guard let fn = catalog.functions[funcName] else {
        Issue.record("[\(caseName)] Missing expected function '\(funcName)'")
        continue
      }
      assertSingleFunctionMetadata(
        fn.api,
        spec: (rawSpec as? [String: Any]) ?? [:],
        caseName: caseName
      )
    }
  }

  private func assertSingleFunctionMetadata(
    _ api: FunctionAPI,
    spec: [String: Any],
    caseName: String
  ) {
    if let expReturn = spec["returnType"] as? String {
      #expect(api.returnType.rawValue == expReturn, "[\(caseName)] \(api.name) returnType mismatch")
    }
    if let expCallers = spec["allowedCallers"] as? String {
      #expect(
        api.allowedCallers.rawValue == expCallers,
        "[\(caseName)] \(api.name) allowedCallers mismatch"
      )
    }
    if let expActivation = spec["requiresUserActivation"] as? Bool {
      #expect(
        api.requiresUserActivation == expActivation,
        "[\(caseName)] \(api.name) requiresUserActivation mismatch"
      )
    }
  }

  private func assertComponentValidationCases(
    _ loaded: LoadedCatalogInfo,
    expect: [String: Any],
    caseName: String
  ) throws {
    let version = A2UIProtocolVersion(lenientRawValue: loaded.resolvedProtocolVersion) ?? .v10
    let config = ValidationConfig(allowUnknownElements: false, protocolVersion: version)
    let validator = PayloadValidator(catalog: loaded.catalog, config: config)

    if let validComps = expect["validComponents"] as? [[String: Any]] {
      for comp in validComps {
        let jsonComp = ConformanceTestHelper.toJSONValue(comp)
        try validator.validateComponent(jsonComp)
      }
    }
    if let invalidComps = expect["invalidComponents"] as? [[String: Any]] {
      for comp in invalidComps {
        let jsonComp = ConformanceTestHelper.toJSONValue(comp)
        #expect(
          throws: (any Error).self, "[\(caseName)] Expected component \(comp) to fail validation"
        ) {
          try validator.validateComponent(jsonComp)
        }
      }
    }
  }
}
