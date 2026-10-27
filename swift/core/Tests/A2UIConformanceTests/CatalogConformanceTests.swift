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

private struct PeerCatalogDocument {
  let path: String
  let schemaID: String?
  let catalogID: String?
  let document: JSONValue
}

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
    }
    let peerPaths = (testCase["peerCatalogPaths"] as? [String]) ?? []
    let peers = try loadPeerCatalogs(paths: peerPaths)
    let resolvedSchema =
      peers.isEmpty ? rawSchema : resolvePeerReferences(in: rawSchema, peers: peers)
    let catalog = try buildFilteredCatalog(
      rawSchema: resolvedSchema,
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

  // MARK: - Peer Catalog Resolution

  private func loadPeerCatalogs(paths: [String]) throws -> [PeerCatalogDocument] {
    try paths.map { path in
      let doc = try ConformanceTestHelper.loadRepositoryJSON(path: path)
      return PeerCatalogDocument(
        path: path,
        schemaID: doc["$id"]?.stringValue,
        catalogID: doc["catalogId"]?.stringValue,
        document: doc
      )
    }
  }

  private func resolvePeerReferences(
    in schema: JSONValue,
    peers: [PeerCatalogDocument]
  ) -> JSONValue {
    guard var rootObj = schema.objectValue else { return schema }
    if let compsObj = rootObj["components"]?.objectValue {
      var resolvedComps: OrderedDictionary<String, JSONValue> = [:]
      for (name, compVal) in compsObj {
        resolvedComps[name] = resolvePeerComponent(compVal, peers: peers)
      }
      rootObj["components"] = .object(resolvedComps)
    }
    if let funcsObj = rootObj["functions"]?.objectValue {
      var resolvedFuncs: OrderedDictionary<String, JSONValue> = [:]
      for (name, funcVal) in funcsObj {
        resolvedFuncs[name] = inlinePeerSubschemas(in: funcVal, peers: peers)
      }
      rootObj["functions"] = .object(resolvedFuncs)
    }
    return .object(rootObj)
  }

  private func resolvePeerComponent(
    _ compVal: JSONValue,
    peers: [PeerCatalogDocument]
  ) -> JSONValue {
    guard var compObj = compVal.objectValue else { return compVal }
    var mergedProps: OrderedDictionary<String, JSONValue> = [:]
    var mergedRequired: [String] = []

    if let allOf = compObj["allOf"]?.arrayValue {
      var remainingAllOf: [JSONValue] = []
      for item in allOf {
        if let ref = item["$ref"]?.stringValue,
          let peerTarget = resolvePeerPointer(ref: ref, peers: peers)?.objectValue
        {
          mergeInheritedProperties(
            from: peerTarget,
            intoProps: &mergedProps,
            intoRequired: &mergedRequired
          )
        } else {
          remainingAllOf.append(item)
        }
      }
      compObj["allOf"] = remainingAllOf.isEmpty ? nil : .array(remainingAllOf)
    }

    for (key, val) in compObj["properties"]?.objectValue ?? [:] {
      mergedProps[key] = inlinePeerSubschemas(in: val, peers: peers)
    }
    compObj["properties"] = .object(mergedProps)
    appendUniqueStrings(
      compObj["required"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      into: &mergedRequired
    )
    if !mergedRequired.isEmpty {
      compObj["required"] = .array(mergedRequired.map(JSONValue.string))
    }
    return .object(compObj)
  }

  private func mergeInheritedProperties(
    from peerTarget: OrderedDictionary<String, JSONValue>,
    intoProps mergedProps: inout OrderedDictionary<String, JSONValue>,
    intoRequired mergedRequired: inout [String]
  ) {
    for (key, val) in peerTarget["properties"]?.objectValue ?? [:] where key != "component" {
      mergedProps[key] = val
    }
    let peerReq = peerTarget["required"]?.arrayValue?.compactMap(\.stringValue) ?? []
    appendUniqueStrings(peerReq.filter { $0 != "component" }, into: &mergedRequired)
  }

  private func appendUniqueStrings(_ items: [String], into target: inout [String]) {
    for item in items where !target.contains(item) {
      target.append(item)
    }
  }

  private func inlinePeerSubschemas(
    in value: JSONValue,
    peers: [PeerCatalogDocument]
  ) -> JSONValue {
    if let obj = value.objectValue {
      if let ref = obj["$ref"]?.stringValue,
        let resolved = resolvePeerPointer(ref: ref, peers: peers)
      {
        return resolved
      }
      var newObj: OrderedDictionary<String, JSONValue> = [:]
      for (k, v) in obj {
        newObj[k] = inlinePeerSubschemas(in: v, peers: peers)
      }
      return .object(newObj)
    }
    if let arr = value.arrayValue {
      return .array(arr.map { inlinePeerSubschemas(in: $0, peers: peers) })
    }
    return value
  }

  private func resolvePeerPointer(
    ref: String,
    peers: [PeerCatalogDocument]
  ) -> JSONValue? {
    let parts = ref.split(separator: "#", maxSplits: 1).map(String.init)
    guard parts.count == 2, !parts[0].isEmpty else { return nil }
    let docRef = parts[0]
    let pointer = parts[1]
    guard let matchedPeer = matchPeerDocument(docRef: docRef, peers: peers) else { return nil }
    return navigateJSONPointer(pointer, in: matchedPeer.document)
  }

  private func matchPeerDocument(
    docRef: String,
    peers: [PeerCatalogDocument]
  ) -> PeerCatalogDocument? {
    if let exact = peers.first(where: { peerMatchesIDOrSuffix($0, docRef: docRef) }) {
      return exact
    }
    let fileName = (docRef as NSString).lastPathComponent
    guard fileName != "catalog.json" else { return nil }
    return peers.first { peer in
      (peer.path as NSString).lastPathComponent == fileName
        || (peer.schemaID.map { ($0 as NSString).lastPathComponent == fileName } ?? false)
    }
  }

  private func peerMatchesIDOrSuffix(_ peer: PeerCatalogDocument, docRef: String) -> Bool {
    guard docRef != "catalog.json" else { return false }
    let candidates = [peer.schemaID, peer.catalogID, peer.path].compactMap { $0 }
    return candidates.contains { candidate in
      candidate == docRef || candidate.hasSuffix("/" + docRef)
    }
  }

  private func navigateJSONPointer(_ pointer: String, in document: JSONValue) -> JSONValue? {
    let segments = pointer.split(separator: "/").map(String.init)
    var current = document
    for segment in segments {
      guard let next = current[segment] else { return nil }
      current = next
    }
    return current
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
    guard
      let schema = (try? Schema(rawSchema: .object(fullObj), context: context))
        ?? (try? Schema(instance: "{}"))
    else { return nil }
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
    guard
      let schema = (try? Schema(rawSchema: argsSchemaJSON, context: context))
        ?? (try? Schema(instance: "{}"))
    else { return nil }
    let retStr = funcValue["returnType"]?.stringValue ?? "any"
    let retType = FunctionReturnType(rawValue: retStr) ?? .any
    let callersStr = funcValue["allowedCallers"]?.stringValue ?? "rendererOnly"
    let callers = AllowedCallers(rawValue: callersStr) ?? .rendererOnly
    let requiresActivation = funcValue["requiresUserActivation"]?.boolValue ?? false
    let api = FunctionAPI(
      name: name,
      returnType: retType,
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
