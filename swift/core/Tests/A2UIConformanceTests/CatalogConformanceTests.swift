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
import BasicCatalog
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing

private struct LoadedCatalogInfo {
  let catalog: AnyCatalog
  let rawSchema: JSONValue
  let resolvedProtocolVersion: String
}

/// Runs the shared `conformance/core/catalog.yaml` suite.
struct CatalogConformanceTests {
  @Test func catalogConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/catalog.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/catalog.yaml should hold test cases")

    var executed = 0
    for testCase in cases {
      let version = testCase["protocolVersion"] as? String
      if version == "v0.8" { continue }
      let action = testCase["action"] as? String ?? "from_json"
      try dispatchCatalogCase(testCase, action: action)
      executed += 1
    }
    #expect(executed > 0, "Should execute catalog conformance cases")
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
      break
    }
  }

  // MARK: - Actions

  private func runFromJSONCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    let expectError = ConformanceTestHelper.parseExpectError(
      testCase["expectError"] ?? testCase["expect_error"]
    )
    if let expectError {
      assertFromJSONThrows(testCase, expectError: expectError, caseName: name)
      return
    }
    let loaded = try loadCatalogFromTestCase(testCase)
    if let expect = testCase["expect"] as? [String: Any] {
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
    } catch {
      Issue.record("[\(caseName)] Expected A2UICatalogError, got \(error)")
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
  }

  private func runRoundTripCase(_ testCase: [String: Any]) throws {
    let name = testCase["name"] as? String ?? "<unnamed>"
    let firstLoad = try loadCatalogFromTestCase(testCase)
    let roundTrippedData = try JSONEncoder().encode(firstLoad.rawSchema)
    let reparsedSchema = try JSONValue.parse(roundTrippedData)
    #expect(
      reparsedSchema == firstLoad.rawSchema,
      "[\(name)] Round-tripped JSON schema should equal original"
    )
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

  // MARK: - Catalog Loading & Validation

  private func loadCatalogFromTestCase(_ testCase: [String: Any]) throws -> LoadedCatalogInfo {
    let catalogPath = testCase["catalogPath"] as? String
    let rawSchema = try extractRawCatalogSchema(from: testCase, catalogPath: catalogPath)
    let catalogID =
      (testCase["catalogId"] as? String)
      ?? rawSchema["catalogId"]?.stringValue
      ?? rawSchema["id"]?.stringValue
    guard let catalogID, !catalogID.isEmpty else {
      throw A2UICatalogError("catalog_id must be provided or exist in catalog schema")
    }
    let resolvedVersion = resolveProtocolVersion(testCase: testCase, rawSchema: rawSchema)
    if resolvedVersion == "v1.0" {
      try validateV10CatalogIdentifiers(rawSchema)
      try checkV10ExternalRefs(rawSchema)
    }
    let catalog = try buildFilteredCatalog(
      rawSchema: rawSchema,
      catalogID: catalogID,
      protocolVersion: resolvedVersion,
      catalogPath: catalogPath
    )
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

  private func resolveProtocolVersion(
    testCase: [String: Any],
    rawSchema: JSONValue
  ) -> String {
    let raw =
      (testCase["protocolVersion"] as? String)
      ?? rawSchema["protocolVersion"]?.stringValue
      ?? rawSchema["protocol_version"]?.stringValue
      ?? "v0.9"
    switch raw {
    case "1.0", "v1.0":
      return "v1.0"
    case "0.9.1", "v0.9.1":
      return "v0.9.1"
    case "0.8", "v0.8":
      return "v0.8"
    default:
      return "v0.9"
    }
  }

  private func validateV10CatalogIdentifiers(_ schema: JSONValue) throws {
    if let components = schema["components"]?.objectValue {
      for (compName, compDef) in components {
        try validateV10ComponentIdentifiers(name: compName, definition: compDef)
      }
    }
    if let functions = schema["functions"]?.objectValue {
      for (funcName, funcDef) in functions {
        try validateV10FunctionIdentifiers(name: funcName, definition: funcDef)
      }
    }
  }

  private func validateV10ComponentIdentifiers(name: String, definition: JSONValue) throws {
    guard UnicodeIdentifierValidator.isValidIdentifier(name) else {
      throw A2UICatalogError("Invalid UAX #31 component identifier: '\(name)'")
    }
    guard let props = definition["properties"]?.objectValue else { return }
    for propName in props.keys where !UnicodeIdentifierValidator.isValidIdentifier(propName) {
      throw A2UICatalogError(
        "Invalid UAX #31 property identifier '\(propName)' in component '\(name)'"
      )
    }
  }

  private func validateV10FunctionIdentifiers(name: String, definition: JSONValue) throws {
    guard !name.hasPrefix("@"), UnicodeIdentifierValidator.isValidIdentifier(name) else {
      throw A2UICatalogError("Invalid UAX #31 function identifier: '\(name)'")
    }
    let paramDict =
      definition["parameters"]?.objectValue
      ?? definition["properties"]?["args"]?["properties"]?.objectValue
    guard let paramDict else { return }
    for argName in paramDict.keys where !UnicodeIdentifierValidator.isValidIdentifier(argName) {
      throw A2UICatalogError(
        "Invalid UAX #31 argument identifier '\(argName)' in function '\(name)'"
      )
    }
  }

  // MARK: - External $ref Validation

  private func isSupportedV10Ref(_ ref: String) -> Bool {
    let document =
      ref.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(
        String.init
      ) ?? ""
    if document.isEmpty || document == "catalog.json" {
      return true
    }
    return document.split(separator: "/", omittingEmptySubsequences: false).last
      == "common_types.json"
  }

  private func checkV10ExternalRefs(_ node: JSONValue, pointer: String = "") throws {
    if let obj = node.objectValue {
      if let ref = obj["$ref"]?.stringValue, !isSupportedV10Ref(ref) {
        throw A2UICatalogError(
          "Unsupported external $ref '\(ref)' at \(pointer)/$ref: a v1.0 catalog may only reference its own components and functions (#/...) or common_types.json."
        )
      }
      for (key, value) in obj {
        let escapedKey = key.replacingOccurrences(of: "~", with: "~0").replacingOccurrences(
          of: "/",
          with: "~1"
        )
        try checkV10ExternalRefs(value, pointer: "\(pointer)/\(escapedKey)")
      }
    } else if let arr = node.arrayValue {
      for (index, item) in arr.enumerated() {
        try checkV10ExternalRefs(item, pointer: "\(pointer)/\(index)")
      }
    }
  }

  // MARK: - Building Filtered Catalog

  private func buildFilteredCatalog(
    rawSchema: JSONValue,
    catalogID: String,
    protocolVersion: String,
    catalogPath: String?
  ) throws -> AnyCatalog {
    let commonTypes = try loadCommonTypes(
      protocolVersion: protocolVersion,
      catalogPath: catalogPath
    )
    let (remoteSchemas, allDefs) = makeSchemaContext(
      rawSchema: rawSchema,
      commonTypes: commonTypes
    )
    let context = Context(dialect: .draft2020_12, remoteSchema: remoteSchemas)
    let allowedCompNames = extractUnionAllowedNames(
      in: rawSchema["$defs"]?["anyComponent"],
      prefix: "#/components/"
    )
    let allowedFuncNames = extractUnionAllowedNames(
      in: rawSchema["$defs"]?["anyFunction"],
      prefix: "#/functions/"
    )
    let components = buildCatalogComponents(
      rawSchema: rawSchema,
      allowedNames: allowedCompNames,
      allDefinitions: allDefs,
      context: context
    )
    let functions = buildCatalogFunctions(
      rawSchema: rawSchema,
      allowedNames: allowedFuncNames,
      context: context
    )
    return Catalog(
      id: catalogID,
      protocolVersion: protocolVersion,
      components: components,
      functions: functions
    )
  }

  private func loadCommonTypes(
    protocolVersion: String,
    catalogPath: String?
  ) throws -> JSONValue? {
    if let catalogPath,
      let fromPath = try ConformanceTestHelper.commonTypesSchema(forCatalogPath: catalogPath)
    {
      return fromPath
    }
    return try ConformanceTestHelper.commonTypesSchema(forProtocolVersion: protocolVersion)
  }

  private func makeSchemaContext(
    rawSchema: JSONValue,
    commonTypes: JSONValue?
  ) -> ([String: JSONValue], OrderedDictionary<String, JSONValue>) {
    var remoteSchemas = A2UICommonSchema.allSchemas
    var allDefs: OrderedDictionary<String, JSONValue> = [:]
    if let commonTypes {
      if let idStr = commonTypes["$id"]?.stringValue {
        remoteSchemas[idStr] = commonTypes
      }
      remoteSchemas["common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/specification/v1_0/common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/specification/v0_9/common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/schemas/v0_9_1/common.json"] = commonTypes
      for (k, v) in commonTypes["$defs"]?.objectValue ?? [:] {
        allDefs[k] = v
      }
    }
    for (k, v) in rawSchema["$defs"]?.objectValue ?? [:]
    where k != "anyComponent" && k != "anyFunction" {
      allDefs[k] = v
    }
    return (remoteSchemas, allDefs)
  }

  private func extractUnionAllowedNames(in unionDef: JSONValue?, prefix: String) -> Set<String>? {
    guard let oneOf = unionDef?["oneOf"]?.arrayValue else { return nil }
    let names = oneOf.compactMap { item -> String? in
      guard let ref = item["$ref"]?.stringValue, ref.hasPrefix(prefix) else { return nil }
      return String(ref.dropFirst(prefix.count))
    }
    return names.isEmpty ? nil : Set(names)
  }

  private func buildCatalogComponents(
    rawSchema: JSONValue,
    allowedNames: Set<String>?,
    allDefinitions: OrderedDictionary<String, JSONValue>,
    context: Context
  ) -> [AnyComponentAPI] {
    guard let compObj = rawSchema["components"]?.objectValue else { return [] }
    return compObj.compactMap { name, val in
      if let allowedNames, !allowedNames.contains(name) { return nil }
      return makeSingleComponentAPI(
        name: name,
        schemaValue: val,
        allDefinitions: allDefinitions,
        context: context
      )
    }
  }

  private func makeSingleComponentAPI(
    name: String,
    schemaValue: JSONValue,
    allDefinitions: OrderedDictionary<String, JSONValue>,
    context: Context
  ) -> AnyComponentAPI? {
    var fullObj = schemaValue.objectValue ?? [:]
    if !allDefinitions.isEmpty {
      var defs = fullObj["$defs"]?.objectValue ?? [:]
      for (k, v) in allDefinitions where defs[k] == nil {
        defs[k] = v
      }
      fullObj["$defs"] = .object(defs)
    }
    guard let schema = try? Schema(rawSchema: .object(fullObj), context: context) else {
      Issue.record("Failed to compile schema for component '\(name)'")
      return nil
    }
    let parents = schemaValue["allowedParents"]?.arrayValue?.compactMap(\.stringValue)
    let children = schemaValue["allowedChildren"]?.arrayValue?.compactMap(\.stringValue)
    var meta: [String: JSONValue]?
    if let desc = schemaValue["description"] {
      meta = ["description": desc]
    }
    return AnyComponentAPI(
      name: name,
      schema: schema,
      allowedParents: parents,
      allowedChildren: children,
      metadata: meta
    )
  }

  private func buildCatalogFunctions(
    rawSchema: JSONValue,
    allowedNames: Set<String>?,
    context: Context
  ) -> [any FunctionImplementation] {
    guard let funcObj = rawSchema["functions"]?.objectValue else { return [] }
    return funcObj.compactMap { name, val in
      if let allowedNames, !allowedNames.contains(name) { return nil }
      return makeSingleFunction(name: name, funcValue: val, context: context)
    }
  }

  private func makeSingleFunction(
    name: String,
    funcValue: JSONValue,
    context: Context
  ) -> (any FunctionImplementation)? {
    let argsSchemaJSON = extractFunctionArgsSchema(from: funcValue)
    guard let schema = try? Schema(rawSchema: argsSchemaJSON, context: context) else {
      Issue.record("Failed to compile schema for function '\(name)'")
      return nil
    }
    let returnTypeString = funcValue["returnType"]?.stringValue ?? "any"
    let returnType = FunctionReturnType(rawValue: returnTypeString) ?? .any
    let allowedCallersString = funcValue["allowedCallers"]?.stringValue ?? "rendererOnly"
    let callers = AllowedCallers(rawValue: allowedCallersString) ?? .rendererOnly
    let requiresActivation = funcValue["requiresUserActivation"]?.boolValue ?? false
    let api = FunctionAPI(
      name: name,
      returnType: returnType,
      schema: schema,
      allowedCallers: callers,
      requiresUserActivation: requiresActivation
    )
    return ConformanceFunctionImplementation(api: api)
  }

  private func extractFunctionArgsSchema(from funcValue: JSONValue) -> JSONValue {
    if let argsSchema = funcValue["properties"]?["args"], argsSchema.objectValue != nil {
      return argsSchema
    }
    if let paramsObj = funcValue["parameters"]?.objectValue {
      if paramsObj["type"]?.stringValue == "object" {
        return .object(paramsObj)
      }
      return .object(["type": .string("object"), "properties": .object(paramsObj)])
    }
    return .object(["type": .string("object")])
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
      #expect(
        loaded.resolvedProtocolVersion == expectedVersion,
        "[\(caseName)] protocolVersion mismatch"
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
        "[\(caseName)] Expected component names \(expectedNames), got \(Array(catalog.components.keys))"
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
      #expect(comp.allowedParents == expParents, "[\(caseName)] \(comp.name) allowedParents mismatch")
    }
    if let expChildren = spec["allowedChildren"] as? [String] {
      #expect(comp.allowedChildren == expChildren, "[\(caseName)] \(comp.name) allowedChildren mismatch")
    }
    if let expDesc = spec["description"] as? String {
      #expect(
        comp.metadata?["description"]?.stringValue == expDesc,
        "[\(caseName)] \(comp.name) description mismatch"
      )
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
        #expect(throws: (any Error).self, "[\(caseName)] Expected component \(comp) to fail validation") {
          try validator.validateComponent(jsonComp)
        }
      }
    }
  }
}
