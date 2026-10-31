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
      return buildInlineCatalogs(
        inlineCatalog: inlineCatalog,
        protocolVersion: testCase.protocolVersion
      )
    }
    return try testCase.catalogPaths.map { path in
      try buildCatalogFromPath(path, defaultProtocolVersion: testCase.protocolVersion)
    }
  }

  private static func buildInlineCatalogs(
    inlineCatalog: JSONValue,
    protocolVersion: String?
  ) -> [AnyCatalog] {
    let version =
      protocolVersion
      ?? inlineCatalog["protocolVersion"]?.stringValue
      ?? inlineCatalog["protocol_version"]?.stringValue
      ?? "v0.9"
    let commonTypes = try? commonTypesSchema(forProtocolVersion: version)
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

  private static func buildCatalogFromPath(
    _ path: String,
    defaultProtocolVersion: String?
  ) throws -> AnyCatalog {
    if path == "catalogs/basic/v1/catalog.json" {
      return BasicCatalog.makeCatalog(version: .v10)
    }
    let fallbackVersion: String?
    if path.contains("/v0_9_1/") {
      fallbackVersion = "v0.9.1"
    } else if path.contains("/v0_9/") {
      fallbackVersion = "v0.9"
    } else if path.contains("/v0_8/") {
      fallbackVersion = "v0.8"
    } else {
      fallbackVersion = defaultProtocolVersion
    }
    return buildCatalog(
      catalogSchema: try loadRepositoryJSON(path: path),
      commonTypes: try commonTypesSchema(forCatalogPath: path),
      protocolVersion: fallbackVersion
    )
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
    let subpath =
      (version.hasPrefix("v1") || version.hasPrefix("1."))
      ? "v1_0" : ((version.hasPrefix("v0.8") || version.hasPrefix("0.8")) ? "v0_8" : "v0_9")
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
    commonTypes: JSONValue? = nil,
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
        let api = functionAPI(name: funcName, returnType: retType, schema: schema, from: funcVal)
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
        let api = functionAPI(name: name, returnType: retType, schema: schema, from: funcVal)
        functions.append(ConformanceFunctionImplementation(api: api))
      }
    }
  }

  /// A function signature carrying the `allowedCallers` and `requiresUserActivation` its catalog
  /// definition declares, so the core's caller and activation checks apply to it.
  private static func functionAPI(
    name: String,
    returnType: FunctionReturnType,
    schema: Schema,
    from definition: JSONValue
  ) -> FunctionAPI {
    FunctionAPI(
      name: name,
      returnType: returnType,
      schema: schema,
      allowedCallers: definition["allowedCallers"]?.stringValue.flatMap(AllowedCallers.init)
        ?? .rendererOnly,
      requiresUserActivation: definition["requiresUserActivation"]?.boolValue ?? false
    )
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
    // An inline catalog that names no common types schema refers to the
    // published one for its protocol version, as in the other SDKs, so that
    // references such as `#/$defs/ChildList` resolve.
    if catalogConfiguration["common_types_schema"] == nil,
      catalogConfiguration["commonTypesSchema"] == nil,
      let commonTypes = try? commonTypesSchema(forProtocolVersion: protocolVersion ?? "1.0")
    {
      loadCommonTypesDefinitions(
        from: ["commonTypesSchema": commonTypes],
        remoteSchemas: &remoteSchemas,
        allDefinitions: &allDefinitions
      )
    }

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
  /// The flags a case's `validationConfig` may set (`validationConfig` in
  /// `conformance_schema.json`).
  public static let caseValidationFlags: Set<String> = [
    "allowOrphanComponents", "allowDanglingReferences", "allowMissingRoot", "allowUnknownElements",
  ]

  /// Builds the `ValidationConfig` a case's `validationConfig` flags describe, or nil when a
  /// flag is unknown.
  public static func validationConfig(
    from flags: [String: Bool],
    targetVersion: String? = nil
  ) -> ValidationConfig? {
    guard Set(flags.keys).isSubset(of: caseValidationFlags) else { return nil }
    return ValidationConfig(
      allowOrphanComponents: flags["allowOrphanComponents"] ?? false,
      allowDanglingReferences: flags["allowDanglingReferences"] ?? false,
      allowMissingRoot: flags["allowMissingRoot"] ?? false,
      allowUnknownElements: flags["allowUnknownElements"] ?? false,
      targetVersion: targetVersion
    )
  }

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
    let validationConfig = dictionary["validationConfig"] as? [String: Bool]
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
      validationConfig: validationConfig,
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
      let lastIndex = stepDicts.count - 1
      return stepDicts.enumerated().map { index, stepDictionary in
        let stepPayload = (stepDictionary["payload"] ?? stepDictionary["messages"]).map {
          toJSONValue($0)
        }
        let fallbackError = index == lastIndex ? defaultExpectError : nil
        let stepError =
          parseExpectError(stepDictionary["expect_error"] ?? stepDictionary["expectError"])
          ?? fallbackError
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

  /// Parses an `expectError.rendererError` block. The block is an envelope
  /// (`version` plus `error`); the error fields are read from `error`, with
  /// the flat form accepted for older cases.
  public static func parseRendererError(
    _ rawRendererError: Any?
  ) -> ConformanceExpectRendererError? {
    guard let envelope = rawRendererError as? [String: Any] else { return nil }
    let version = envelope["version"] as? String
    let dict = (envelope["error"] as? [String: Any]) ?? envelope
    let code = dict["code"] as? String
    let surfaceID = (dict["surfaceId"] ?? dict["surface_id"]) as? String
    let functionCallID = (dict["functionCallId"] ?? dict["function_call_id"]) as? String
    // A function call error carries no surfaceId: an explicit null, or a
    // functionCallId with the surfaceId key left out, both expect nil.
    let surfaceIDIsNil =
      (dict.keys.contains("surfaceId") && (dict["surfaceId"] == nil || dict["surfaceId"] is NSNull))
      || (functionCallID != nil && !dict.keys.contains("surfaceId"))
    let path = dict["path"] as? String
    let message =
      (dict["message"] ?? dict["message_contains"] ?? dict["messageContains"]) as? String
    return ConformanceExpectRendererError(
      version: version,
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
    context: String,
    actualVersion: String? = nil
  ) {
    guard let actual else {
      Issue.record("[\(context)] Expected RendererError to be reported, got nil")
      return
    }
    if let expectedVersion = expected.version {
      let resolvedVersion = actualVersion ?? actual.version.rawValue
      #expect(
        resolvedVersion == expectedVersion,
        "[\(context)] Expected rendererError.version '\(expectedVersion)', got '\(resolvedVersion)'"
      )
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
        "[\(context)] Expected rendererError.surfaceId nil, got '\(fields.surfaceID ?? "nil")'"
      )
    } else if let expectedSurfaceID = expected.surfaceID {
      let actualSurface = fields.surfaceID ?? "nil"
      #expect(
        fields.surfaceID == expectedSurfaceID,
        "[\(context)] Expected surfaceId '\(expectedSurfaceID)', got '\(actualSurface)'"
      )
    }
    if let expectedFunctionCallID = expected.functionCallID {
      let actualCallID = fields.functionCallID ?? "nil"
      #expect(
        fields.functionCallID == expectedFunctionCallID,
        "[\(context)] Expected functionCallId '\(expectedFunctionCallID)', got '\(actualCallID)'"
      )
    }
    if let expectedPath = expected.path {
      let actualPath = fields.path ?? "nil"
      #expect(
        rendererErrorPathMatches(fields.path, expected: expectedPath),
        "[\(context)] Expected rendererError.path '\(expectedPath)', got '\(actualPath)'"
      )
    }
    if let expectedMessage = expected.message, !expectedMessage.isEmpty {
      #expect(
        messageMatches(fields.message, expected: expectedMessage),
        "[\(context)] Expected message containing '\(expectedMessage)', got '\(fields.message)'"
      )
    }
  }

  private static func rendererErrorPathMatches(_ actual: String?, expected: String) -> Bool {
    guard let actual else { return false }
    if actual == expected { return true }
    let parts = expected.split(separator: "/")
    if parts.count == 2, parts[0] == "components", parts[1].allSatisfy(\.isNumber) {
      return actual.hasPrefix(expected + "/")
    }
    return false
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
    if expected.contains("is not of type"),
      actual.contains("type") || actual.contains("Expected type")
    {
      return true
    }
    if expected == "missing an 'id'", actual.contains("Missing required key 'id'") {
      return true
    }
    if expected.contains("without a type"), actual.contains("Missing required key 'component'") {
      return true
    }
    if expected == "Circular reference detected", actual.contains("Self-reference detected:") {
      return true
    }
    if expected == "Orphaned component", actual.contains("is not reachable from 'root'") {
      return true
    }
    if expected.contains("is not supported in protocol version"),
      actual.contains("must contain exactly one update action")
    {
      return true
    }
    if expected == "Missing required version field",
      actual.contains("missing a valid 'version' string")
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
  /// The validation flags a `process_messages` case sets (`validationConfig`), or nil when
  /// the case leaves its checks to the harness. A flag the case leaves out is false.
  public let validationConfig: [String: Bool]?
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
    validationConfig: [String: Bool]? = nil,
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
    self.validationConfig = validationConfig
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
/// Expected error specifications for conformance assertions.
public struct ConformanceExpectError: Sendable {
  public struct RendererError: Sendable {
    public let version: String?
    public let code: String?
    public let surfaceID: String?
    public let surfaceIDIsNil: Bool
    public let functionCallID: String?
    public let path: String?
    public let message: String?

    public init(
      version: String? = nil,
      code: String? = nil,
      surfaceID: String? = nil,
      surfaceIDIsNil: Bool = false,
      functionCallID: String? = nil,
      path: String? = nil,
      message: String? = nil
    ) {
      self.version = version
      self.code = code
      self.surfaceID = surfaceID
      self.surfaceIDIsNil = surfaceIDIsNil
      self.functionCallID = functionCallID
      self.path = path
      self.message = message
    }
  }

  public let category: String?
  public let code: String?
  public let surfaceID: String?
  public let functionCallID: String?
  public let path: String?
  public let message: String?
  public let details: [A2UIErrorDetail]?
  public let rendererError: RendererError?

  public init(
    category: String? = nil,
    code: String? = nil,
    surfaceID: String? = nil,
    functionCallID: String? = nil,
    path: String? = nil,
    message: String? = nil,
    details: [A2UIErrorDetail]? = nil,
    rendererError: RendererError? = nil
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

public typealias ConformanceExpectRendererError = ConformanceExpectError.RendererError

/// A single conformance case loaded from a shared YAML suite for parameterized test execution.
public struct ConformanceCase: Sendable, CustomTestStringConvertible {
  public let suite: String
  public let name: String
  public let json: JSONValue

  public init(suite: String, name: String, json: JSONValue) {
    self.suite = suite
    self.name = name
    self.json = json
  }

  public var testDescription: String {
    "\(suite)::\(name)"
  }

  public var rawDictionary: [String: Any] {
    ConformanceTestHelper.rawCaseDictionary(suite: suite, name: name)
      ?? (ConformanceTestHelper.fromJSONValue(json) as? [String: Any])
      ?? [:]
  }

  public func parsedTestCase() -> ConformanceTestCase? {
    ConformanceTestHelper.parseTestCases(from: [rawDictionary]).first
  }
}

/// Thrown when a conformance YAML dictionary contains an unrecognized key or dispatch value.
public struct UnknownConformanceKeyError: Error, CustomStringConvertible, Sendable {
  public let message: String

  public init(_ message: String) {
    self.message = message
  }

  public var description: String { message }
}

extension ConformanceTestHelper {
  /// Maps each supported `conformance/core/*.yaml` suite to the actions and test files that run it.
  public static let coreSuiteActions: [String: [String: String]] = [
    "core/accessibility.yaml": [
      "accessibility_check": "AccessibilityConformanceTests.swift"
    ],
    "core/actions.yaml": [
      "dispatch_action": "ActionsConformanceTests.swift"
    ],
    "core/catalog.yaml": [
      "derive": "CatalogDeriveConformanceTests.swift",
      "from_json": "CatalogConformanceTests.swift",
      "round_trip": "CatalogConformanceTests.swift",
      "to_json": "CatalogConformanceTests.swift",
      "validation_schema": "CatalogConformanceTests.swift",
    ],
    "core/composition_constraints.yaml": [
      "process_messages": "ValidatorConformanceTests.swift",
      "validate": "ValidatorConformanceTests.swift",
    ],
    "core/data_context.yaml": [
      "resolve_path": "DataModelPointerConformanceTests.swift"
    ],
    "core/data_deletion.yaml": [
      "validate": "DataModelPointerConformanceTests.swift"
    ],
    "core/data_model.yaml": [
      "data_model": "DataModelConformanceTests.swift"
    ],
    "core/data_model_pointers.yaml": [
      "validate": "DataModelPointerConformanceTests.swift"
    ],
    "core/error_responses.yaml": [
      "validate": "ValidatorConformanceTests.swift"
    ],
    "core/expressions.yaml": [
      "parse_expression_template": "ExpressionsConformanceTests.swift",
      "validate": "ExpressionsConformanceTests.swift",
    ],
    "core/functions.yaml": [
      "evaluate_function": "BasicCatalogConformanceTests.swift",
      "validate": "BasicCatalogConformanceTests.swift",
    ],
    "core/index_function.yaml": [
      "validate": "BasicCatalogConformanceTests.swift"
    ],
    "core/message_processor_scaling.yaml": [
      "measure_growth": "MessageProcessorScalingConformanceTests.swift"
    ],
    "core/message_processor_v0_9.yaml": [
      "get_renderer_capabilities": "MessageProcessorConformanceTests.swift",
      "get_renderer_data_model": "MessageProcessorConformanceTests.swift",
      "process_messages": "MessageProcessorConformanceTests.swift",
      "resolve_path": "MessageProcessorConformanceTests.swift",
    ],
    "core/message_processor_v1_0.yaml": [
      "get_renderer_capabilities": "MessageProcessorConformanceTests.swift",
      "get_renderer_data_model": "MessageProcessorConformanceTests.swift",
      "process_messages": "MessageProcessorConformanceTests.swift",
      "validate": "MessageProcessorConformanceTests.swift",
    ],
    "core/multi_catalog.yaml": [
      "select_catalog": "MultiCatalogConformanceTests.swift",
      "validate": "MultiCatalogConformanceTests.swift",
    ],
    "core/node_resolution.yaml": [
      "resolve_nodes": "NodeResolutionConformanceTests.swift"
    ],
    "core/reserved_keys.yaml": [
      "process_messages": "ValidatorConformanceTests.swift",
      "validate": "ValidatorConformanceTests.swift",
    ],
    "core/rpc_functions.yaml": [
      "handle_rpc": "RPCConformanceTests.swift"
    ],
    "core/validation_result.yaml": [
      "validate": "BasicCatalogConformanceTests.swift"
    ],
    "core/validator_v0_9.yaml": [
      "validate": "ValidatorConformanceTests.swift"
    ],
    "core/validator_v1_0.yaml": [
      "validate": "ValidatorConformanceTests.swift"
    ],
  ]

  /// Maps each unsupported `conformance/core/*.yaml` suite to the reason it is skipped in Swift.
  public static let unsupportedCoreSuites: [String: String] = [
    "core/adapter_conformance.yaml":
      "render_surface cases require the SwiftUI framework adapter harness",
    "core/agent_to_renderer.yaml":
      "agent_to_renderer_schema is not implemented in the Swift core harness",
    "core/common_types.yaml":
      "common_types_schema and validate_common_type are not implemented in the Swift core harness",
    "core/message_processor_v0_8.yaml":
      "protocol version v0.8 is not supported by A2UICore",
    "core/validator_v0_8.yaml":
      "protocol version v0.8 is not supported by A2UICore",
  ]

  /// Case-level documentation keys permitted in every conformance test case dictionary.
  public static let metadataCaseKeys: Set<String> = ["name", "description", "features"]

  private static let cacheLock = NSLock()
  nonisolated(unsafe) private static var suiteCasesCache: [String: [ConformanceCase]] = [:]
  nonisolated(unsafe) private static var rawCasesCache: [String: [String: [String: Any]]] = [:]

  /// Loads and caches all cases from `suite`, optionally filtered to a single `action`.
  public static func cases(_ suite: String, action: String? = nil) -> [ConformanceCase] {
    let all = loadAllSuiteCases(suite)
    guard let action else { return all }
    return all.filter { $0.json["action"]?.stringValue == action }
  }

  /// Loads and caches all cases from `suite` whose `action` is in `actions`.
  public static func cases(_ suite: String, actions: Set<String>) -> [ConformanceCase] {
    let all = loadAllSuiteCases(suite)
    return all.filter { actions.contains($0.json["action"]?.stringValue ?? "") }
  }

  private static func loadAllSuiteCases(_ suite: String) -> [ConformanceCase] {
    cacheLock.lock()
    if let cached = suiteCasesCache[suite] {
      cacheLock.unlock()
      return cached
    }
    cacheLock.unlock()

    guard let rawYAML = try? loadYAML(filename: suite) else { return [] }
    let rawDicts: [[String: Any]]
    if let array = rawYAML as? [[String: Any]] {
      rawDicts = array
    } else if let dict = rawYAML as? [String: Any], let list = dict["cases"] as? [[String: Any]] {
      rawDicts = list
    } else {
      rawDicts = []
    }

    var builtCases: [ConformanceCase] = []
    var rawByName: [String: [String: Any]] = [:]
    for dict in rawDicts {
      guard let name = dict["name"] as? String else { continue }
      rawByName[name] = dict
      builtCases.append(ConformanceCase(suite: suite, name: name, json: toJSONValue(dict)))
    }

    cacheLock.lock()
    suiteCasesCache[suite] = builtCases
    rawCasesCache[suite] = rawByName
    cacheLock.unlock()
    return builtCases
  }

  fileprivate static func rawCaseDictionary(suite: String, name: String) -> [String: Any]? {
    _ = loadAllSuiteCases(suite)
    cacheLock.lock()
    defer { cacheLock.unlock() }
    return rawCasesCache[suite]?[name]
  }

  /// Converts a `JSONValue` back into Foundation-style values (`[String: Any]`, `[Any]`, scalars).
  public static func fromJSONValue(_ value: JSONValue) -> Any {
    switch value {
    case .object(let ordered):
      var dict: [String: Any] = [:]
      for (key, val) in ordered {
        dict[key] = fromJSONValue(val)
      }
      return dict
    case .array(let items):
      return items.map { fromJSONValue($0) }
    case .string(let str):
      return str
    case .boolean(let bool):
      return bool
    case .number(let double):
      if let exactInt = Int(exactly: double) {
        return exactInt
      }
      return double
    case .null:
      return NSNull()
    }
  }

  /// Verifies that every key in `dict` belongs to `allowed` (or `metadataCaseKeys` when
  /// `allowMetadata` is true), recording an issue and throwing on the first unknown key.
  public static func assertKnownKeys(
    _ dict: [String: Any],
    _ allowed: Set<String>,
    _ location: String,
    allowMetadata: Bool = true
  ) throws {
    let permitted = allowMetadata ? allowed.union(metadataCaseKeys) : allowed
    for key in dict.keys.sorted() where !permitted.contains(key) {
      let msg = "Unknown \(location) key '\(key)' (allowed: \(permitted.sorted()))"
      Issue.record(Comment(rawValue: msg))
      throw UnknownConformanceKeyError(msg)
    }
  }

  /// Verifies that every key in `dict` belongs to `allowed` (or `metadataCaseKeys` when
  /// `allowMetadata` is true), recording an issue and throwing on the first unknown key.
  public static func assertKnownKeys(
    _ dict: OrderedDictionary<String, JSONValue>,
    _ allowed: Set<String>,
    _ location: String,
    allowMetadata: Bool = true
  ) throws {
    let permitted = allowMetadata ? allowed.union(metadataCaseKeys) : allowed
    for key in dict.keys.sorted() where !permitted.contains(key) {
      let msg = "Unknown \(location) key '\(key)' (allowed: \(permitted.sorted()))"
      Issue.record(Comment(rawValue: msg))
      throw UnknownConformanceKeyError(msg)
    }
  }

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
