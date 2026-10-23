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
import Yams

private final class ExtendedStackResultBox<T>: @unchecked Sendable {
  var result: Result<T, Error>?
}

/// Concrete `FunctionImplementation` for conformance testing.
public struct ConformanceFunctionImplementation: FunctionImplementation, Sendable {
  public let api: FunctionAPI

  public init(api: FunctionAPI) {
    self.api = api
  }

  @MainActor
  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    .null
  }
}

/// Test helper providing repository path resolution, YAML/JSON loading, and catalog setup.
public enum ConformanceTestHelper {
  /// Resolves the repository root URL using `#filePath` or `A2UI_CONFORMANCE_DIR`.
  public static var repoRoot: URL {
    if let environmentDirectory = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_DIR"],
      !environmentDirectory.isEmpty
    {
      let url = URL(fileURLWithPath: environmentDirectory)
      if url.lastPathComponent == "conformance" {
        return url.deletingLastPathComponent()
      }
      return url
    }

    let thisFile = URL(fileURLWithPath: #filePath)
    // #filePath -> A2UIConformanceTests -> Tests -> core -> swift -> repoRoot
    return
      thisFile
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  /// URL to the `conformance/` directory.
  public static var conformanceDirectory: URL {
    if let environmentDirectory = ProcessInfo.processInfo.environment["A2UI_CONFORMANCE_DIR"],
      !environmentDirectory.isEmpty
    {
      let url = URL(fileURLWithPath: environmentDirectory)
      if url.lastPathComponent == "conformance" {
        return url
      }
      return url.appendingPathComponent("conformance")
    }
    return repoRoot.appendingPathComponent("conformance")
  }

  /// Loads and decodes a YAML file relative to the `conformance/` directory.
  public static func loadYAML(filename: String) throws -> Any {
    let fileURL = conformanceDirectory.appendingPathComponent(filename)
    let yamlString = try String(contentsOf: fileURL, encoding: .utf8)
    return try runWithExtendedStack(size: 8 * 1024 * 1024) {
      guard let loaded = try Yams.load(yaml: yamlString) else {
        throw A2UIValidationError("Failed to parse YAML from \(filename)")
      }
      return loaded
    }
  }

  /// Runs a closure on a dedicated thread with an explicitly expanded stack size (default 8 MB).
  ///
  /// This prevents stack exhaustion during deep recursive operations, such as parsing
  /// 100-level recursive YAML mappings with Yams/libyaml on macOS where SPM worker threads
  /// default to 512 KB.
  public static func runWithExtendedStack<T>(
    size: Int = 8 * 1024 * 1024,
    _ body: @escaping @Sendable () throws -> T
  ) throws -> T {
    let box = ExtendedStackResultBox<T>()
    let semaphore = DispatchSemaphore(value: 0)
    let thread = Thread {
      box.result = Result { try body() }
      semaphore.signal()
    }
    thread.stackSize = size
    thread.start()
    semaphore.wait()
    guard let result = box.result else {
      throw A2UIValidationError("Thread terminated without result")
    }
    return try result.get()
  }

  /// Loads and decodes a JSON file relative to the `conformance/` directory.
  public static func loadJSON(filename: String) throws -> JSONValue {
    let fileURL = conformanceDirectory.appendingPathComponent(filename)
    let data = try Data(contentsOf: fileURL)
    return try JSONValue.parse(data)
  }

  /// Loads and decodes a JSON file relative to the repository root.
  ///
  /// Suite fields such as `catalogPaths` hold repository-relative paths.
  public static func loadRepositoryJSON(path: String) throws -> JSONValue {
    let data = try Data(contentsOf: repoRoot.appendingPathComponent(path))
    return try JSONValue.parse(data)
  }

  /// Builds the catalogs that a test case declares.
  ///
  /// An inline `catalog` object takes precedence. Otherwise, one catalog is built for each
  /// entry of `catalogPaths`, together with the `common_types.json` file of the same
  /// specification version.
  public static func buildCatalogs(for testCase: ConformanceTestCase) throws -> [AnyCatalog] {
    if let inlineCatalog = testCase.inlineCatalog {
      let version =
        testCase.protocolVersion
        ?? inlineCatalog["protocolVersion"]?.stringValue
        ?? inlineCatalog["protocol_version"]?.stringValue
        ?? "v0.9"
      let commonTypes = try? commonTypesSchema(
        forProtocolVersion: version
      )
      var catalogs: [AnyCatalog] = []
      if inlineCatalog["components"] != nil || inlineCatalog["functions"] != nil
        || inlineCatalog["theme"] != nil
      {
        catalogs.append(
          buildCatalog(
            catalogSchema: inlineCatalog,
            commonTypes: commonTypes,
            protocolVersion: version
          )
        )
      }
      if inlineCatalog["components"] == nil {
        let basicVersion: A2UIProtocolVersion =
          (version.hasPrefix("v1") || version.hasPrefix("1")) ? .v10 : .v091
        catalogs.append(contentsOf: basicCatalogs(for: basicVersion))
      }
      return catalogs
    }
    return try testCase.catalogPaths.map { path in
      buildCatalog(
        catalogSchema: try loadRepositoryJSON(path: path),
        commonTypes: try commonTypesSchema(forCatalogPath: path),
        protocolVersion: testCase.protocolVersion
      )
    }
  }

  /// Returns the basic catalog for the given protocol version with `id: "basic"`
  /// for conformance test cases that reference `"basic"` or omit `catalogId`.
  public static func basicCatalogs(for version: A2UIProtocolVersion = .v10) -> [AnyCatalog] {
    let canonical = BasicCatalog.makeCatalog(version: version)
    let shorthand = Catalog(
      id: "basic",
      protocolVersion: version,
      components: Array(canonical.components.values),
      functions: Array(canonical.functions.values),
      themeSchema: canonical.themeSchema
    )
    return [shorthand]
  }

  /// Finds the `common_types.json` schema for a given protocol version.
  public static func commonTypesSchema(forProtocolVersion version: String) throws -> JSONValue? {
    let subpath = version.hasPrefix("v1") ? "v1_0" : (version.hasPrefix("v0.8") ? "v0_8" : "v0_9")
    let fileURL = repoRoot.appendingPathComponent("specification/\(subpath)/json/common_types.json")
    guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
    return try JSONValue.parse(try Data(contentsOf: fileURL))
  }

  /// Finds the `common_types.json` schema that a catalog file references.
  ///
  /// Specification catalogs live at `specification/<version>/catalogs/<name>/catalog.json`,
  /// and their common types at `specification/<version>/json/common_types.json`.
  public static func commonTypesSchema(forCatalogPath path: String) throws -> JSONValue? {
    let catalogDirectory = repoRoot.appendingPathComponent(path).deletingLastPathComponent()
    var candidates = [
      catalogDirectory.appendingPathComponent("common_types.json"),
      catalogDirectory
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("json/common_types.json"),
    ]
    if path.contains("/v1/") {
      candidates.append(
        repoRoot.appendingPathComponent("specification/v1_0/json/common_types.json"))
    }
    guard
      let commonTypesURL = candidates.first(where: {
        FileManager.default.fileExists(atPath: $0.path)
      })
    else {
      return nil
    }
    return try JSONValue.parse(try Data(contentsOf: commonTypesURL))
  }

  /// Builds a `Catalog` from a catalog schema and an optional common types schema.
  public static func buildCatalog(
    catalogSchema: JSONValue,
    commonTypes: JSONValue?,
    protocolVersion: String? = nil
  ) -> AnyCatalog {
    let (remoteSchemas, allDefinitions) = collectSchemaContextInputs(
      catalogSchema: catalogSchema,
      commonTypes: commonTypes
    )
    let context = Context(dialect: .draft2020_12, remoteSchema: remoteSchemas)
    let components = buildComponentsFromCatalogSchema(
      catalogSchema,
      allDefinitions: allDefinitions,
      context: context
    )
    let resolvedProtocolVersion =
      catalogSchema["protocolVersion"]?.stringValue
      ?? catalogSchema["protocol_version"]?.stringValue
      ?? protocolVersion
    let functions = buildFunctionsFromCatalogSchema(
      catalogSchema,
      resolvedProtocolVersion: resolvedProtocolVersion,
      context: context
    )
    let themeSchema: Schema? = (catalogSchema["theme"] ?? catalogSchema["$defs"]?["theme"])
      .flatMap { try? Schema(rawSchema: $0, context: context) }
    let catalogID = catalogSchema["catalogId"]?.stringValue ?? "test_catalog"
    return Catalog(
      id: catalogID,
      protocolVersion: resolvedProtocolVersion,
      components: components,
      functions: functions,
      themeSchema: themeSchema
    )
  }

  private static func collectSchemaContextInputs(
    catalogSchema: JSONValue,
    commonTypes: JSONValue?
  ) -> ([String: JSONValue], OrderedDictionary<String, JSONValue>) {
    var allDefinitions: OrderedDictionary<String, JSONValue> = [:]
    var remoteSchemas = A2UICommonSchema.allSchemas

    if let commonTypes {
      if let identifierString = commonTypes["$id"]?.stringValue {
        remoteSchemas[identifierString] = commonTypes
      }
      remoteSchemas["common_types.json"] = commonTypes
      remoteSchemas["https://swift-json-schema.invalid/common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/specification/v0_9/common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/schemas/v0_9_1/common.json"] = commonTypes
      for (key, definition) in commonTypes["$defs"]?.objectValue ?? [:] {
        allDefinitions[key] = definition
      }
    }
    for (key, definition) in catalogSchema["$defs"]?.objectValue ?? [:]
    where key != "anyComponent" && key != "anyFunction" {
      allDefinitions[key] = definition
    }
    return (remoteSchemas, allDefinitions)
  }

  private static func buildComponentsFromCatalogSchema(
    _ catalogSchema: JSONValue,
    allDefinitions: OrderedDictionary<String, JSONValue>,
    context: Context
  ) -> [AnyComponentAPI] {
    if let compObj = catalogSchema["components"]?.objectValue {
      return compObj.compactMap { componentName, componentSchemaValue in
        buildComponentAPI(
          name: componentName,
          schemaValue: componentSchemaValue,
          allDefinitions: allDefinitions,
          context: context,
          fallbackEmpty: false
        )
      }
    }
    if let compArray = catalogSchema["components"]?.arrayValue {
      return compArray.compactMap { compVal in
        guard let name = compVal["name"]?.stringValue else { return nil }
        let rawSchema = compVal["schema"] ?? .object(["type": .string("object")])
        return buildComponentAPI(
          name: name,
          schemaValue: rawSchema,
          allDefinitions: allDefinitions,
          context: context,
          fallbackEmpty: false
        )
      }
    }
    return []
  }

  private static func buildComponentAPI(
    name: String,
    schemaValue: JSONValue,
    allDefinitions: OrderedDictionary<String, JSONValue>,
    context: Context,
    fallbackEmpty: Bool
  ) -> AnyComponentAPI? {
    var fullComponentObject = schemaValue.objectValue ?? [:]
    if !allDefinitions.isEmpty {
      var componentDefinitions = fullComponentObject["$defs"]?.objectValue ?? [:]
      for (key, definition) in allDefinitions where componentDefinitions[key] == nil {
        componentDefinitions[key] = definition
      }
      fullComponentObject["$defs"] = .object(componentDefinitions)
    }
    let allowedParents = schemaValue["allowedParents"]?.arrayValue?.compactMap(\.stringValue)
    let allowedChildren = schemaValue["allowedChildren"]?.arrayValue?.compactMap(\.stringValue)
    let builtSchema = try? Schema(rawSchema: .object(fullComponentObject), context: context)
    guard let schema = builtSchema ?? (fallbackEmpty ? (try? Schema(instance: "{}")) : nil) else {
      return nil
    }
    return AnyComponentAPI(
      name: name,
      schema: schema,
      allowedParents: allowedParents,
      allowedChildren: allowedChildren
    )
  }

  private static func buildFunctionsFromCatalogSchema(
    _ catalogSchema: JSONValue,
    resolvedProtocolVersion: String?,
    context: Context
  ) -> [any FunctionImplementation] {
    var functions: [any FunctionImplementation] = []
    if catalogSchema["$schema"] != nil {
      let isV10 = resolvedProtocolVersion == "v1.0" || resolvedProtocolVersion == "1.0"
      functions = isV10 ? BasicFunctions.v10Functions : BasicFunctions.v09Functions
    }
    if let funcObj = catalogSchema["functions"]?.objectValue {
      appendObjectFunctions(funcObj, context: context, into: &functions)
    } else if let funcArray = catalogSchema["functions"]?.arrayValue {
      appendArrayFunctions(funcArray, context: context, into: &functions)
    }
    return functions
  }

  private static func appendObjectFunctions(
    _ funcObj: OrderedDictionary<String, JSONValue>,
    context: Context,
    into functions: inout [any FunctionImplementation]
  ) {
    for (funcName, funcVal) in funcObj
    where !functions.contains(where: { $0.api.name == funcName }) {
      guard
        let paramObj =
          funcVal["parameters"]?.objectValue
          ?? funcVal["properties"]?["args"]?.objectValue
      else { continue }
      let returnTypeStr = funcVal["returnType"]?.stringValue ?? "any"
      let retType = FunctionReturnType(rawValue: returnTypeStr) ?? .any
      if let schema = try? Schema(rawSchema: .object(paramObj), context: context) {
        let api = FunctionAPI(name: funcName, returnType: retType, schema: schema)
        functions.append(ConformanceFunctionImplementation(api: api))
      }
    }
  }

  private static func appendArrayFunctions(
    _ funcArray: [JSONValue],
    context: Context,
    into functions: inout [any FunctionImplementation]
  ) {
    for funcVal in funcArray {
      guard let name = funcVal["name"]?.stringValue else { continue }
      let returnTypeStr = funcVal["returnType"]?.stringValue ?? "any"
      let retType = FunctionReturnType(rawValue: returnTypeStr) ?? .any
      let paramObj = funcVal["parameters"]?.objectValue ?? [:]
      if let schema = try? Schema(rawSchema: .object(paramObj), context: context) {
        let api = FunctionAPI(name: name, returnType: retType, schema: schema)
        functions.append(ConformanceFunctionImplementation(api: api))
      }
    }
  }

  /// Builds a `Catalog` from a test case catalog configuration dictionary.
  public static func buildCatalog(
    from catalogConfiguration: [String: JSONValue]?
  ) -> AnyCatalog? {
    guard let catalogConfiguration else { return nil }
    let protocolVersion =
      catalogConfiguration["protocolVersion"]?.stringValue
      ?? catalogConfiguration["protocol_version"]?.stringValue

    var allDefinitions: OrderedDictionary<String, JSONValue> = [:]
    var remoteSchemas = A2UICommonSchema.allSchemas

    loadCommonTypesDefinitions(
      from: catalogConfiguration,
      remoteSchemas: &remoteSchemas,
      allDefinitions: &allDefinitions
    )

    guard
      let catalogSchemaJSON = loadCatalogDefinitions(
        from: catalogConfiguration,
        allDefinitions: &allDefinitions
      )
    else {
      return nil
    }

    let context = Context(dialect: .draft2020_12, remoteSchema: remoteSchemas)
    let catalogID =
      catalogSchemaJSON["catalogId"]?.stringValue
      ?? catalogConfiguration["catalogId"]?.stringValue
      ?? "test_catalog"

    let components: [AnyComponentAPI] =
      (catalogSchemaJSON["components"]?.objectValue ?? [:]).compactMap { name, val in
        buildComponentAPI(
          name: name,
          schemaValue: val,
          allDefinitions: allDefinitions,
          context: context,
          fallbackEmpty: true
        )
      }

    let isV10 = protocolVersion == "v1.0" || protocolVersion == "1.0"
    let functions = isV10 ? BasicFunctions.v10Functions : BasicFunctions.v09Functions
    let themeSchema: Schema? = catalogSchemaJSON["theme"].flatMap {
      try? Schema(rawSchema: $0, context: context)
    }

    return Catalog(
      id: catalogID,
      protocolVersion: protocolVersion,
      components: components,
      functions: functions,
      themeSchema: themeSchema
    )
  }

  private static func loadCommonTypesDefinitions(
    from catalogConfiguration: [String: JSONValue],
    remoteSchemas: inout [String: JSONValue],
    allDefinitions: inout OrderedDictionary<String, JSONValue>
  ) {
    guard
      let commonTypesValue = catalogConfiguration["common_types_schema"]
        ?? catalogConfiguration["commonTypesSchema"]
    else { return }

    var commonTypesJSON: JSONValue?
    if let pathString = commonTypesValue.stringValue {
      commonTypesJSON = try? loadJSON(filename: pathString)
    } else if commonTypesValue.objectValue != nil {
      commonTypesJSON = commonTypesValue
    }

    if let commonTypes = commonTypesJSON {
      if let identifierString = commonTypes["$id"]?.stringValue {
        remoteSchemas[identifierString] = commonTypes
      }
      remoteSchemas["common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/specification/v0_9/common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/specification/v0_9_1/common_types.json"] = commonTypes
      remoteSchemas["https://a2ui.org/specification/v1_0/common_types.json"] = commonTypes
    }

    if let definitions = commonTypesJSON?["$defs"]?.objectValue {
      for (key, definition) in definitions {
        allDefinitions[key] = definition
      }
    }
  }

  private static func loadCatalogDefinitions(
    from catalogConfiguration: [String: JSONValue],
    allDefinitions: inout OrderedDictionary<String, JSONValue>
  ) -> JSONValue? {
    var catalogSchemaValue: JSONValue? =
      catalogConfiguration["catalog_schema"]
      ?? catalogConfiguration["catalogSchema"]
      ?? catalogConfiguration["catalog"]
    if catalogSchemaValue == nil,
      catalogConfiguration["components"] != nil || catalogConfiguration["theme"] != nil
    {
      catalogSchemaValue = .object(OrderedDictionary(uniqueKeysWithValues: catalogConfiguration))
    }
    guard let catalogSchemaValue else { return nil }

    var catalogSchemaJSON: JSONValue?
    if let pathString = catalogSchemaValue.stringValue {
      catalogSchemaJSON = try? loadJSON(filename: pathString)
    } else if catalogSchemaValue.objectValue != nil {
      catalogSchemaJSON = catalogSchemaValue
    }

    if let definitions = catalogSchemaJSON?["$defs"]?.objectValue {
      for (key, definition) in definitions {
        allDefinitions[key] = definition
      }
    }

    return catalogSchemaJSON
  }

  /// Recursively converts arbitrary YAML data (`[String: Any]`, `[Any]`, primitives)
  /// to `JSONValue`.
  public static func toJSONValue(_ value: Any) -> JSONValue {
    switch value {
    case let stringValue as String:
      return .string(stringValue)
    case let booleanValue as Bool:
      return .boolean(booleanValue)
    case let integerValue as Int:
      return .integer(integerValue)
    case let doubleValue as Double:
      return .number(doubleValue)
    case let dictionary as [String: Any]:
      var orderedDictionary: OrderedDictionary<String, JSONValue> = [:]
      for key in dictionary.keys.sorted() {
        if let propertyValue = dictionary[key] {
          orderedDictionary[key] = toJSONValue(propertyValue)
        }
      }
      return .object(orderedDictionary)
    case let array as [Any]:
      return .array(array.map { toJSONValue($0) })
    case is NSNull:
      return .null
    default:
      return .null
    }
  }

  /// Extracts test cases from a loaded YAML object.
  public static func parseTestCases(from loadedYAML: Any) -> [ConformanceTestCase] {
    guard let array = loadedYAML as? [[String: Any]] else { return [] }
    return array.compactMap(parseSingleTestCase)
  }

  private static func parseSingleTestCase(_ dictionary: [String: Any]) -> ConformanceTestCase? {
    guard let name = (dictionary["name"] ?? dictionary["description"]) as? String else {
      return nil
    }
    let description = dictionary["description"] as? String
    let catalogConfiguration = (dictionary["catalog"] as? [String: Any]).map {
      toJSONValue($0).dictionaryValue ?? [:]
    }
    let action = dictionary["action"] as? String
    let protocolVersion = dictionary["protocolVersion"] as? String
    let strictMode = dictionary["strictMode"] as? Bool ?? false
    var catalogPaths = dictionary["catalogPaths"] as? [String] ?? []
    if let catalogPath = dictionary["catalogPath"] as? String {
      catalogPaths.append(catalogPath)
    }
    let inlineCatalog = (dictionary["catalog"] as? [String: Any]).map { toJSONValue($0) }
    let expectError = parseExpectError(dictionary["expect_error"] ?? dictionary["expectError"])
    let payload = (dictionary["payload"] ?? dictionary["messages"]).map { toJSONValue($0) }
    let args = (dictionary["args"] as? [String: Any]).map {
      toJSONValue($0).dictionaryValue ?? [:]
    }
    let expect = (dictionary["expect"] as? [String: Any]).map { toJSONValue($0) }
    let assertions = (dictionary["assertions"] as? [String: Any]).map {
      toJSONValue($0).dictionaryValue ?? [:]
    }
    let surface = (dictionary["surface"] as? [String: Any]).map {
      toJSONValue($0).dictionaryValue ?? [:]
    }
    let steps = parseSteps(
      from: dictionary,
      defaultPayload: payload,
      defaultExpectError: expectError,
      defaultExpect: expect
    )

    return ConformanceTestCase(
      name: name,
      description: description,
      catalogConfiguration: catalogConfiguration,
      action: action,
      protocolVersion: protocolVersion,
      strictMode: strictMode,
      catalogPaths: catalogPaths,
      inlineCatalog: inlineCatalog,
      payload: payload,
      args: args,
      steps: steps,
      expectError: expectError,
      expect: expect,
      assertions: assertions,
      surface: surface
    )
  }

  private static func parseSteps(
    from dictionary: [String: Any],
    defaultPayload: JSONValue?,
    defaultExpectError: ConformanceExpectError?,
    defaultExpect: JSONValue?
  ) -> [ConformanceStep] {
    let stepDicts =
      (dictionary["steps"] as? [[String: Any]])
      ?? (dictionary["validate"] as? [[String: Any]])
    if let stepDicts {
      return stepDicts.map { stepDictionary in
        let stepPayload = (stepDictionary["payload"] ?? stepDictionary["messages"]).map {
          toJSONValue($0)
        }
        let stepError =
          parseExpectError(stepDictionary["expect_error"] ?? stepDictionary["expectError"])
          ?? defaultExpectError
        let stepExpect =
          (stepDictionary["expect"] as? [String: Any]).map { toJSONValue($0) } ?? defaultExpect
        return ConformanceStep(payload: stepPayload, expectError: stepError, expect: stepExpect)
      }
    }
    if let defaultPayload {
      return [
        ConformanceStep(
          payload: defaultPayload,
          expectError: defaultExpectError,
          expect: defaultExpect
        )
      ]
    }
    return []
  }

  public static func parseExpectError(_ errorObject: Any?) -> ConformanceExpectError? {
    guard let errorObject else { return nil }
    if let message = errorObject as? String {
      return ConformanceExpectError(message: message)
    }
    guard let dictionary = errorObject as? [String: Any] else { return nil }
    let category =
      (dictionary["category"] ?? dictionary["type"] ?? dictionary["errorType"]) as? String
    let code = dictionary["code"] as? String
    let surfaceID = (dictionary["surfaceId"] ?? dictionary["surface_id"]) as? String
    let functionCallID =
      (dictionary["functionCallId"] ?? dictionary["function_call_id"]) as? String
    let path = dictionary["path"] as? String
    let message =
      (dictionary["message"] ?? dictionary["message_contains"] ?? dictionary["messageContains"])
      as? String
    let details = parseErrorDetails(dictionary["details"])
    let rendererError = parseRendererError(
      dictionary["rendererError"] ?? dictionary["renderer_error"]
    )
    return ConformanceExpectError(
      category: category,
      code: code,
      surfaceID: surfaceID,
      functionCallID: functionCallID,
      path: path,
      message: message,
      details: details,
      rendererError: rendererError
    )
  }

  private static func parseErrorDetails(_ rawDetails: Any?) -> [A2UIErrorDetail]? {
    guard let detailsArray = rawDetails as? [[String: Any]] else { return nil }
    return detailsArray.compactMap { detailDictionary in
      guard let path = detailDictionary["path"] as? String,
        let code = detailDictionary["code"] as? String
      else {
        return nil
      }
      return A2UIErrorDetail(
        path: path,
        code: code,
        message: detailDictionary["message"] as? String ?? ""
      )
    }
  }

  public static func parseRendererError(_ rawRendererError: Any?) -> ConformanceExpectRendererError? {
    guard let dict = rawRendererError as? [String: Any] else { return nil }
    let code = dict["code"] as? String
    let surfaceID = (dict["surfaceId"] ?? dict["surface_id"]) as? String
    let surfaceIDIsNil =
      dict.keys.contains("surfaceId") && (dict["surfaceId"] == nil || dict["surfaceId"] is NSNull)
    let functionCallID = (dict["functionCallId"] ?? dict["function_call_id"]) as? String
    let path = dict["path"] as? String
    let message =
      (dict["message"] ?? dict["message_contains"] ?? dict["messageContains"]) as? String
    return ConformanceExpectRendererError(
      code: code,
      surfaceID: surfaceID,
      surfaceIDIsNil: surfaceIDIsNil,
      functionCallID: functionCallID,
      path: path,
      message: message
    )
  }

  /// Verifies that a captured `RendererError` matches the expected `rendererError` specification.
  public static func assertRendererErrorMatches(
    _ actual: RendererError?,
    expected: ConformanceExpectRendererError,
    context: String
  ) {
    guard let actual else {
      Issue.record("[\(context)] Expected RendererError to be reported, got nil")
      return
    }
    let fields = extractRendererErrorFields(actual)
    if let expectedCode = expected.code {
      #expect(
        fields.code == expectedCode,
        "[\(context)] Expected rendererError.code '\(expectedCode)', got '\(fields.code)'"
      )
    }
    if expected.surfaceIDIsNil {
      #expect(
        fields.surfaceID == nil || fields.surfaceID == "",
        "[\(context)] Expected rendererError.surfaceId nil, got '\(String(describing: fields.surfaceID))'"
      )
    } else if let expectedSurfaceID = expected.surfaceID {
      #expect(
        fields.surfaceID == expectedSurfaceID,
        "[\(context)] Expected rendererError.surfaceId '\(expectedSurfaceID)', got '\(String(describing: fields.surfaceID))'"
      )
    }
    if let expectedFunctionCallID = expected.functionCallID {
      #expect(
        fields.functionCallID == expectedFunctionCallID,
        "[\(context)] Expected rendererError.functionCallId '\(expectedFunctionCallID)', got '\(String(describing: fields.functionCallID))'"
      )
    }
    if let expectedPath = expected.path {
      #expect(
        fields.path == expectedPath,
        "[\(context)] Expected rendererError.path '\(expectedPath)', got '\(String(describing: fields.path))'"
      )
    }
    if let expectedMessage = expected.message, !expectedMessage.isEmpty {
      #expect(
        messageMatches(fields.message, expected: expectedMessage),
        "[\(context)] Expected rendererError.message containing '\(expectedMessage)', got '\(fields.message)'"
      )
    }
  }

  private static func extractRendererErrorFields(
    _ error: RendererError
  ) -> (
    code: String,
    surfaceID: String?,
    functionCallID: String?,
    path: String?,
    message: String
  ) {
    switch error {
    case .validationFailed(let valError):
      return (
        valError.code.rawValue,
        valError.surfaceID,
        nil,
        valError.path,
        valError.message
      )
    case .generic(let genError):
      return (
        genError.code,
        genError.surfaceID,
        genError.functionCallID,
        nil,
        genError.message
      )
    }
  }

  public static func messageMatches(_ actual: String, expected: String) -> Bool {
    if actual.localizedStandardContains(expected)
      || actual.contains(expected)
      || actual.range(of: expected, options: .regularExpression) != nil
    {
      return true
    }
    if expected.contains("is not of type")
      && (actual.contains("type") || actual.contains("Expected type"))
    {
      return true
    }
    return false
  }
}

/// A parsed test case from a conformance YAML suite.
public struct ConformanceTestCase: Sendable {
  public let name: String
  public let description: String?
  public let catalogConfiguration: [String: JSONValue]?
  public let action: String?
  /// The protocol version the case targets, for example `"v0.9"`.
  public let protocolVersion: String?
  /// Whether the case requires strict topology validation (`strictMode: true`).
  public let strictMode: Bool
  /// Repository-relative catalog schema paths (`catalogPaths`, or a single `catalogPath`).
  public let catalogPaths: [String]
  /// An inline catalog schema (`catalog`), used instead of `catalogPaths` when present.
  public let inlineCatalog: JSONValue?
  public let payload: JSONValue?
  public let args: [String: JSONValue]?
  public let steps: [ConformanceStep]
  public let expectError: ConformanceExpectError?
  public let expect: JSONValue?
  public let assertions: [String: JSONValue]?
  public let surface: [String: JSONValue]?

  public init(
    name: String,
    description: String? = nil,
    catalogConfiguration: [String: JSONValue]? = nil,
    action: String? = nil,
    protocolVersion: String? = nil,
    strictMode: Bool = false,
    catalogPaths: [String] = [],
    inlineCatalog: JSONValue? = nil,
    payload: JSONValue? = nil,
    args: [String: JSONValue]? = nil,
    steps: [ConformanceStep] = [],
    expectError: ConformanceExpectError? = nil,
    expect: JSONValue? = nil,
    assertions: [String: JSONValue]? = nil,
    surface: [String: JSONValue]? = nil
  ) {
    self.name = name
    self.description = description
    self.catalogConfiguration = catalogConfiguration
    self.action = action
    self.protocolVersion = protocolVersion
    self.strictMode = strictMode
    self.catalogPaths = catalogPaths
    self.inlineCatalog = inlineCatalog
    self.payload = payload
    self.args = args
    self.steps = steps
    self.expectError = expectError
    self.expect = expect
    self.assertions = assertions
    self.surface = surface
  }
}

/// An individual execution step within a conformance test case.
public struct ConformanceStep: Sendable {
  public let payload: JSONValue?
  public let expectError: ConformanceExpectError?
  public let expect: JSONValue?

  public init(
    payload: JSONValue? = nil,
    expectError: ConformanceExpectError? = nil,
    expect: JSONValue? = nil
  ) {
    self.payload = payload
    self.expectError = expectError
    self.expect = expect
  }
}

/// Expected renderer-to-agent error structure in conformance YAML suites.
public struct ConformanceExpectRendererError: Sendable {
  public let code: String?
  public let surfaceID: String?
  public let surfaceIDIsNil: Bool
  public let functionCallID: String?
  public let path: String?
  public let message: String?

  public init(
    code: String? = nil,
    surfaceID: String? = nil,
    surfaceIDIsNil: Bool = false,
    functionCallID: String? = nil,
    path: String? = nil,
    message: String? = nil
  ) {
    self.code = code
    self.surfaceID = surfaceID
    self.surfaceIDIsNil = surfaceIDIsNil
    self.functionCallID = functionCallID
    self.path = path
    self.message = message
  }
}

/// Expected error specifications for conformance assertions.
public struct ConformanceExpectError: Sendable {
  public let category: String?
  public let code: String?
  public let surfaceID: String?
  public let functionCallID: String?
  public let path: String?
  public let message: String?
  public let details: [A2UIErrorDetail]?
  public let rendererError: ConformanceExpectRendererError?

  public init(
    category: String? = nil,
    code: String? = nil,
    surfaceID: String? = nil,
    functionCallID: String? = nil,
    path: String? = nil,
    message: String? = nil,
    details: [A2UIErrorDetail]? = nil,
    rendererError: ConformanceExpectRendererError? = nil
  ) {
    self.category = category
    self.code = code
    self.surfaceID = surfaceID
    self.functionCallID = functionCallID
    self.path = path
    self.message = message
    self.details = details
    self.rendererError = rendererError
  }
}

extension ConformanceTestHelper {
  public static func parsePayload(_ payload: JSONValue) throws -> [AgentToRendererMessage] {
    let data = try JSONEncoder().encode(payload)
    let decoder = JSONDecoder()
    if let list = try? decoder.decode([AgentToRendererMessage].self, from: data) {
      return list
    }
    let single = try decoder.decode(AgentToRendererMessage.self, from: data)
    return [single]
  }
}

@MainActor
extension SurfaceViewModel {
  func findNode(id: String) -> A2UICore.Node? {
    guard let root = rootNode else { return nil }
    return findNodeInTree(node: root, targetID: id)
  }

  private func findNodeInTree(node: A2UICore.Node, targetID: String) -> A2UICore.Node? {
    if node.id == targetID { return node }
    for property in node.properties.values {
      if let childNode = property as? A2UICore.Node,
        let found = findNodeInTree(node: childNode, targetID: targetID)
      {
        return found
      }
      if let childList = property as? [A2UICore.Node] {
        for child in childList {
          if let found = findNodeInTree(node: child, targetID: targetID) {
            return found
          }
        }
      }
    }
    return nil
  }
}
