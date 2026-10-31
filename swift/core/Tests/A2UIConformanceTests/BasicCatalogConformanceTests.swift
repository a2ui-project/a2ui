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
import OrderedCollections
import OrderedJSON
import Testing

@MainActor
private final class ConformanceMockFunctionHandler: FunctionHandler {
  private let functionsMap: [String: any FunctionImplementation]

  init(
    functionsMap: [String: any FunctionImplementation] = Dictionary(
      uniqueKeysWithValues: BasicFunctions.allFunctions.map { ($0.api.name, $0) }
    )
  ) {
    self.functionsMap = functionsMap
  }

  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    functionsMap[named]
  }
}

@MainActor
struct BasicCatalogConformanceTests {
  private static let knownEvaluateFunctionCaseKeys: Set<String> = [
    "action",
    "args",
    "catalogId",
    "catalogPaths",
    "dataModel",
    "expect",
    "expectError",
    "function",
    "protocolVersion",
    "surface",
  ]

  private static let knownValidateCaseKeys: Set<String> = [
    "action",
    "catalog",
    "expect",
    "steps",
  ]

  private static let knownValidateStepKeys: Set<String> = [
    "expect",
    "expectError",
    "payload",
  ]

  private static let knownExpectErrorKeys: Set<String> = [
    "category",
    "message",
  ]

  private static let knownComponentExpectKeys: Set<String> = [
    "component",
    "text",
  ]

  private static let knownValidationResultSurfaceKeys: Set<String> = [
    "isValid",
    "validationErrors",
    "validationResult",
    "validationResults",
  ]

  private let functionHandler = ConformanceMockFunctionHandler()
  /// Handlers holding each protocol version's Basic Catalog functions. Stored here because
  /// `DataContext` keeps its function handler weakly.
  private let versionedFunctionHandlers = Dictionary(
    uniqueKeysWithValues: A2UIProtocolVersion.allCases.map {
      (
        $0,
        ConformanceMockFunctionHandler(
          functionsMap: BasicCatalog.makeCatalog(version: $0).functions)
      )
    }
  )

  @Test func formatStringAndExpressionParser() throws {
    let dataModel = DataModel(
      initial: .object([
        "user": .object([
          "firstName": .string("Alice"),
          "age": .integer(30),
        ])
      ])
    )

    let parsed = try ExpressionParser().parse("Hello ${/user/firstName}, age is ${/user/age}!")
    #expect(parsed.count == 5)

    let formatStringFunction = FormatStringFunction()
    let context = DataContext(dataModel: dataModel, path: "", functionHandler: functionHandler)

    let result = try formatStringFunction.evaluate(
      arguments: [
        "value": .string("Welcome ${/user/firstName}, you are ${/user/age} years old.")
      ],
      context: context
    )

    #expect(result == .string("Welcome Alice, you are 30 years old."))
  }

  @Test(arguments: ConformanceTestHelper.cases("core/functions.yaml", action: "evaluate_function"))
  func evaluateFunctionConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      let testCase = conformanceCase.rawDictionary
      try ConformanceTestHelper.assertKnownKeys(
        testCase,
        Self.knownEvaluateFunctionCaseKeys,
        "functions.yaml evaluate_function case '\(conformanceCase.name)'"
      )
      if let surfaceDict = testCase["surface"] as? [String: Any] {
        try runSurfaceEvaluateFunctionCase(testCase, surfaceDict: surfaceDict)
      } else {
        try runDirectEvaluateFunctionCase(testCase)
      }
    }
  }

  private func runDirectEvaluateFunctionCase(_ testCase: [String: Any]) throws {
    guard let name = testCase["name"] as? String,
      let funcName = testCase["function"] as? String
    else {
      return
    }

    let protocolVersion = try resolveCaseProtocolVersion(testCase, name: name)
    let functionsMap = BasicCatalog.makeCatalog(version: protocolVersion).functions
    guard let fn = functionsMap[funcName] else {
      Issue.record("\(name): function '\(funcName)' not found for \(protocolVersion.rawValue)")
      return
    }

    let context = try buildDirectDataContext(for: testCase, protocolVersion: protocolVersion)
    let swiftArgs = buildFunctionArgs(from: testCase)

    if let expectError = (testCase["expectError"] ?? testCase["expect_error"]) as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectError,
        Self.knownExpectErrorKeys,
        "functions.yaml expectError in '\(name)'",
        allowMetadata: false
      )
      assertDirectFunctionError(
        fn: fn,
        args: swiftArgs,
        context: context,
        expectError: expectError,
        name: name
      )
    } else {
      assertDirectFunctionSuccess(
        fn: fn,
        args: swiftArgs,
        context: context,
        testCase: testCase,
        name: name
      )
    }
  }

  private func resolveCaseProtocolVersion(
    _ testCase: [String: Any],
    name: String
  ) throws -> A2UIProtocolVersion {
    let catalogVersion = (testCase["catalog"] as? [String: Any])?["protocolVersion"] as? String
    let rawVersion = (testCase["protocolVersion"] as? String) ?? catalogVersion ?? "v0.9"
    return try #require(
      A2UIProtocolVersion(lenientRawValue: rawVersion),
      "\(name): unsupported protocol version \(rawVersion)"
    )
  }

  private func buildDirectDataContext(
    for testCase: [String: Any],
    protocolVersion: A2UIProtocolVersion
  ) throws -> DataContext {
    let dataModelDict: JSONValue =
      (testCase["dataModel"] ?? testCase["data_model"]).map {
        ConformanceTestHelper.toJSONValue($0)
      } ?? .object([:])
    let model = DataModel(initial: dataModelDict)
    let versionedHandler = try #require(versionedFunctionHandlers[protocolVersion])
    return DataContext(
      dataModel: model,
      path: "/",
      functionHandler: versionedHandler,
      protocolVersion: protocolVersion
    )
  }

  private func buildFunctionArgs(from testCase: [String: Any]) -> [String: JSONValue] {
    let rawArgs = (testCase["args"] as? [String: Any]) ?? [:]
    var swiftArgs: [String: JSONValue] = [:]
    for (key, value) in rawArgs {
      swiftArgs[key] = ConformanceTestHelper.toJSONValue(value)
    }
    return swiftArgs
  }

  private func assertDirectFunctionError(
    fn: any FunctionImplementation,
    args: [String: JSONValue],
    context: DataContext,
    expectError: [String: Any],
    name: String
  ) {
    do {
      _ = try fn.evaluate(arguments: args, context: context)
      Issue.record("\(name): expected error but succeeded")
    } catch is FunctionError {
      if let expectedCategory = expectError["category"] as? String {
        #expect(
          expectedCategory == "ExpressionError" || expectedCategory == "ValidationError",
          "\(name): unexpected expectedCategory \(expectedCategory)"
        )
      }
    } catch {
      Issue.record("\(name): threw unexpected non-function error: \(error)")
    }
  }

  private func assertDirectFunctionSuccess(
    fn: any FunctionImplementation,
    args: [String: JSONValue],
    context: DataContext,
    testCase: [String: Any],
    name: String
  ) {
    do {
      let actual = try fn.evaluate(arguments: args, context: context)
      if let expectedRaw = testCase["expect"] {
        let expected = ConformanceTestHelper.toJSONValue(expectedRaw)
        #expect(actual == expected, "\(name): got \(actual), expected \(expected)")
      }
    } catch {
      Issue.record("\(name): threw unexpected error \(error)")
    }
  }

  private func runSurfaceEvaluateFunctionCase(
    _ testCase: [String: Any],
    surfaceDict: [String: Any]
  ) throws {
    guard let name = testCase["name"] as? String,
      let funcName = testCase["function"] as? String
    else {
      return
    }
    let protocolVersion = try resolveCaseProtocolVersion(testCase, name: name)
    let catalogs = try loadSurfaceFunctionCatalogs(from: testCase, defaultVersion: protocolVersion)
    let errorHandler = IndexConformanceErrorHandler()
    let surface = SurfaceViewModel(
      surfaceID: (surfaceDict["surfaceId"] as? String) ?? "s",
      catalogs: catalogs,
      defaultCatalogID: surfaceDict["catalogId"] as? String,
      actionHandler: errorHandler,
      protocolVersion: protocolVersion
    )
    let context = DataContext(
      dataModel: surface.dataModel,
      path: "/",
      functionHandler: surface,
      protocolVersion: protocolVersion
    )
    let callExpr = buildCallExpression(
      funcName: funcName,
      testCase: testCase,
      protocolVersion: protocolVersion
    )
    let actual = context.resolveDynamicValue(callExpr)

    if let expectError = (testCase["expectError"] ?? testCase["expect_error"]) as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectError,
        Self.knownExpectErrorKeys,
        "functions.yaml surface expectError in '\(name)'",
        allowMetadata: false
      )
      assertSurfaceFunctionError(
        capturedErrors: errorHandler.capturedErrors,
        expectError: expectError,
        name: name
      )
    } else {
      #expect(
        errorHandler.capturedErrors.isEmpty,
        "\(name): unexpected surface errors \(errorHandler.capturedErrors)"
      )
      if let expectedRaw = testCase["expect"] {
        let expected = ConformanceTestHelper.toJSONValue(expectedRaw)
        #expect(actual == expected, "\(name): got \(actual), expected \(expected)")
      }
    }
  }

  private func loadSurfaceFunctionCatalogs(
    from testCase: [String: Any],
    defaultVersion: A2UIProtocolVersion
  ) throws -> [AnyCatalog] {
    let paths = (testCase["catalogPaths"] as? [String]) ?? []
    return try paths.map { path in
      let catalogSchema = try ConformanceTestHelper.loadRepositoryJSON(path: path)
      let catalogID = catalogSchema["catalogId"]?.stringValue ?? path
      if path.contains("basic") {
        let ver: A2UIProtocolVersion =
          path.contains("v0_9_1") ? .v091 : (path.contains("v0_9") ? .v09 : .v10)
        let basic = BasicCatalog.makeCatalog(version: ver)
        return Catalog(
          id: catalogID,
          protocolVersion: ver.rawValue,
          components: Array(basic.components.values),
          functions: Array(basic.functions.values)
        ).eraseToAnyCatalog()
      }
      return ConformanceTestHelper.buildCatalog(
        catalogSchema: catalogSchema,
        protocolVersion: defaultVersion.rawValue
      )
    }
  }

  private func buildCallExpression(
    funcName: String,
    testCase: [String: Any],
    protocolVersion: A2UIProtocolVersion
  ) -> JSONValue {
    let callKey = protocolVersion.isAtLeastV10 ? "@call" : "call"
    var callDict: OrderedDictionary<String, JSONValue> = [
      callKey: .string(funcName)
    ]
    if let catalogID = testCase["catalogId"] as? String {
      callDict["catalogId"] = .string(catalogID)
    }
    if let rawArgs = testCase["args"] {
      callDict["args"] = ConformanceTestHelper.toJSONValue(rawArgs)
    }
    return .object(callDict)
  }

  private func assertSurfaceFunctionError(
    capturedErrors: [RendererError],
    expectError: [String: Any],
    name: String
  ) {
    #expect(!capturedErrors.isEmpty, "\(name): expected surface function evaluation error")
    guard let expectedMessage = expectError["message"] as? String, !expectedMessage.isEmpty else {
      return
    }
    let matches = capturedErrors.contains { err in
      let msg: String
      switch err {
      case .validationFailed(let v): msg = v.message
      case .generic(let g): msg = g.message
      }
      return ConformanceTestHelper.messageMatches(msg, expected: expectedMessage)
    }
    #expect(
      matches,
      "\(name): expected error containing '\(expectedMessage)', got \(capturedErrors)"
    )
  }

  @Test(arguments: ConformanceTestHelper.cases("core/functions.yaml", action: "validate"))
  func functionsValidateConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      try runValidatedCatalogCase(conformanceCase, suiteName: "functions.yaml")
    }
  }

  @Test(arguments: ConformanceTestHelper.cases("core/index_function.yaml", action: "validate"))
  func indexFunctionConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      try runValidatedCatalogCase(conformanceCase, suiteName: "index_function.yaml")
    }
  }

  private func runValidatedCatalogCase(
    _ conformanceCase: ConformanceCase,
    suiteName: String
  ) throws {
    let rawDict = conformanceCase.rawDictionary
    try ConformanceTestHelper.assertKnownKeys(
      rawDict,
      Self.knownValidateCaseKeys,
      "\(suiteName) case '\(conformanceCase.name)'"
    )
    if let steps = rawDict["steps"] as? [[String: Any]] {
      for step in steps {
        try ConformanceTestHelper.assertKnownKeys(
          step,
          Self.knownValidateStepKeys,
          "\(suiteName) step in '\(conformanceCase.name)'",
          allowMetadata: false
        )
        if let errDict = step["expectError"] as? [String: Any] {
          try ConformanceTestHelper.assertKnownKeys(
            errDict,
            Self.knownExpectErrorKeys,
            "\(suiteName) step.expectError in '\(conformanceCase.name)'",
            allowMetadata: false
          )
        }
      }
    }
    let testCase = try #require(
      conformanceCase.parsedTestCase(),
      "[\(conformanceCase.name)] Could not parse test case"
    )
    let errorHandler = IndexConformanceErrorHandler()
    let processor = MessageProcessor(
      catalogs: ConformanceTestHelper.basicCatalogs(for: .v10),
      actionHandler: errorHandler,
      validationConfig: ValidationConfig(targetVersion: "1.0")
    )

    for step in testCase.steps {
      guard let payload = step.payload else { continue }
      try executeIndexStep(
        step: step,
        payload: payload,
        testCase: testCase,
        processor: processor,
        errorHandler: errorHandler
      )
    }
  }

  private func executeIndexStep(
    step: ConformanceStep,
    payload: JSONValue,
    testCase: ConformanceTestCase,
    processor: MessageProcessor,
    errorHandler: IndexConformanceErrorHandler
  ) throws {
    if let expectedError = step.expectError {
      errorHandler.capturedErrors.removeAll()
      var caughtError: Error?
      do {
        try processor.processMessages(payload)
      } catch {
        caughtError = error
      }
      assertIndexStepError(
        capturedErrors: errorHandler.capturedErrors,
        caughtError: caughtError,
        expectedError: expectedError,
        testName: testCase.name
      )
      return
    }

    try processor.processMessages(payload)
    guard let expectObj = testCase.expect?.objectValue else { return }
    try ConformanceTestHelper.assertKnownKeys(
      expectObj,
      ["surfaces"],
      "expect in '\(testCase.name)'",
      allowMetadata: false
    )
    guard let expectSurfaces = expectObj["surfaces"]?.objectValue else { return }
    try assertIndexSurfaces(
      OrderedDictionary(uniqueKeysWithValues: expectSurfaces.map { ($0.key, $0.value) }),
      processor: processor,
      testName: testCase.name
    )
  }

  private func assertIndexStepError(
    capturedErrors: [RendererError],
    caughtError: Error?,
    expectedError: ConformanceExpectError,
    testName: String
  ) {
    let caughtErrorMessage =
      (caughtError as? (any A2UIError))?.message ?? caughtError?.localizedDescription
    let errorMessages =
      capturedErrors.map { err -> String in
        switch err {
        case .validationFailed(let v): return v.message
        case .generic(let g): return g.message
        }
      } + (caughtErrorMessage.map { [$0] } ?? [])

    #expect(
      !errorMessages.isEmpty,
      "Expected error for \(testName), but processing succeeded without error"
    )
    if let expectedCategory = expectedError.category, expectedCategory == "ValidationError",
      let caughtError
    {
      #expect(
        caughtError is A2UIValidationError,
        "[\(testName)] Expected A2UIValidationError, got \(type(of: caughtError))"
      )
    }
    if let expectedMessage = expectedError.message {
      #expect(
        errorMessages.contains(where: { $0.contains(expectedMessage) }),
        "Expected error containing '\(expectedMessage)' in \(testName), got \(errorMessages)"
      )
    }
  }

  private func assertIndexSurfaces(
    _ expectSurfaces: OrderedDictionary<String, JSONValue>,
    processor: MessageProcessor,
    testName: String
  ) throws {
    for (surfaceID, expectedSurface) in expectSurfaces {
      if let surfObj = expectedSurface.objectValue {
        try ConformanceTestHelper.assertKnownKeys(
          surfObj,
          ["components"],
          "expect.surfaces.\(surfaceID) in '\(testName)'",
          allowMetadata: false
        )
      }
      guard let surface = processor.surfaceGroupModel[surfaceID] else {
        Issue.record("Expected surface '\(surfaceID)' to exist")
        continue
      }
      guard let expectedComponents = expectedSurface["components"]?.objectValue else { continue }
      for (compID, compExpected) in expectedComponents {
        try assertIndexSurfaceComponent(
          compID: compID,
          compExpected: compExpected,
          surface: surface,
          surfaceID: surfaceID,
          testName: testName
        )
      }
    }
  }

  private func assertIndexSurfaceComponent(
    compID: String,
    compExpected: JSONValue,
    surface: SurfaceViewModel,
    surfaceID: String,
    testName: String
  ) throws {
    if let compObj = compExpected.objectValue {
      try ConformanceTestHelper.assertKnownKeys(
        compObj,
        Self.knownComponentExpectKeys,
        "expect.surfaces.\(surfaceID).components.\(compID) in '\(testName)'",
        allowMetadata: false
      )
    }
    let node = surface.findNode(id: compID)
    if let expectedComponent = compExpected["component"]?.stringValue {
      #expect(
        node?.type == expectedComponent,
        "[\(testName)] Expected node \(compID).type == '\(expectedComponent)'"
      )
    }
    let expectedText =
      compExpected["text"]?.stringValue
      ?? compExpected["text"]?.boolValue.map { $0 ? "true" : "false" }
    if let expectedText {
      #expect(
        node?.string(for: "text") == expectedText,
        "[\(testName)] Expected node \(compID).text == '\(expectedText)'"
      )
    }
  }

  @Test(arguments: ConformanceTestHelper.cases("core/validation_result.yaml", action: "validate"))
  func validationResultConformance(_ conformanceCase: ConformanceCase) throws {
    try ConformanceManifest.run(conformanceCase) {
      try runValidationResultCase(conformanceCase)
    }
  }

  private func runValidationResultCase(_ conformanceCase: ConformanceCase) throws {
    let rawDict = conformanceCase.rawDictionary
    try ConformanceTestHelper.assertKnownKeys(
      rawDict,
      Self.knownValidateCaseKeys,
      "validation_result.yaml case '\(conformanceCase.name)'"
    )
    if let steps = rawDict["steps"] as? [[String: Any]] {
      for step in steps {
        try ConformanceTestHelper.assertKnownKeys(
          step,
          Self.knownValidateStepKeys,
          "validation_result.yaml step in '\(conformanceCase.name)'",
          allowMetadata: false
        )
      }
    }
    let testCase = try #require(
      conformanceCase.parsedTestCase(),
      "[\(conformanceCase.name)] Could not parse validation_result case"
    )
    let processor = MessageProcessor(
      catalogs: ConformanceTestHelper.basicCatalogs(for: .v10),
      validationConfig: ValidationConfig(targetVersion: "1.0")
    )

    for step in testCase.steps {
      guard let payload = step.payload else { continue }
      let messages = try ConformanceTestHelper.parsePayload(payload)
      processor.process(messages: messages)
      if let stepExpectSurfaces = step.expect?["surfaces"]?.objectValue {
        try assertValidationResultSurfaces(
          OrderedDictionary(
            uniqueKeysWithValues: stepExpectSurfaces.map { ($0.key, $0.value) }
          ),
          processor: processor,
          testName: testCase.name
        )
      }
    }

    if let caseExpectSurfaces = testCase.expect?["surfaces"]?.objectValue {
      try assertValidationResultSurfaces(
        OrderedDictionary(uniqueKeysWithValues: caseExpectSurfaces.map { ($0.key, $0.value) }),
        processor: processor,
        testName: testCase.name
      )
    }
  }

  private func assertValidationResultSurfaces(
    _ expectSurfaces: OrderedDictionary<String, JSONValue>,
    processor: MessageProcessor,
    testName: String
  ) throws {
    for (surfaceID, expectedSurface) in expectSurfaces {
      if let surfObj = expectedSurface.objectValue {
        try ConformanceTestHelper.assertKnownKeys(
          surfObj,
          Self.knownValidationResultSurfaceKeys,
          "validation_result.yaml expect.surfaces.\(surfaceID) in '\(testName)'",
          allowMetadata: false
        )
      }
      guard let surface = processor.surfaceGroupModel[surfaceID] else {
        Issue.record("[\(testName)] Expected surface '\(surfaceID)' to exist")
        continue
      }
      assertSurfaceIsValid(expectedSurface, on: surface, testName: testName)
      assertSurfaceValidationErrors(expectedSurface, on: surface, testName: testName)
      assertSurfaceValidationResults(expectedSurface, on: surface, testName: testName)
      assertSurfaceSingleValidationResult(expectedSurface, on: surface, testName: testName)
    }
  }

  private func assertSurfaceIsValid(
    _ expectedSurface: JSONValue,
    on surface: SurfaceViewModel,
    testName: String
  ) {
    guard let expectedIsValid = expectedSurface["isValid"]?.objectValue else { return }
    for (nodeID, expectedVal) in expectedIsValid {
      guard let expectedBool = expectedVal.boolValue else { continue }
      let node = surface.findNode(id: nodeID)
      #expect(
        node?.isValid == expectedBool,
        """
        [\(testName)] Expected node \(nodeID).isValid == \(expectedBool), \
        got \(String(describing: node?.isValid))
        """
      )
    }
  }

  private func assertSurfaceValidationErrors(
    _ expectedSurface: JSONValue,
    on surface: SurfaceViewModel,
    testName: String
  ) {
    guard let expectedErrorsMap = expectedSurface["validationErrors"]?.objectValue else { return }
    for (nodeID, expectedListVal) in expectedErrorsMap {
      guard let expectedArray = expectedListVal.arrayValue else { continue }
      let expectedStrings = expectedArray.compactMap(\.stringValue)
      let node = surface.findNode(id: nodeID)
      #expect(
        node?.validationErrors == expectedStrings,
        """
        [\(testName)] Expected node \(nodeID).validationErrors == \(expectedStrings), \
        got \(String(describing: node?.validationErrors))
        """
      )
    }
  }

  private func assertSurfaceValidationResults(
    _ expectedSurface: JSONValue,
    on surface: SurfaceViewModel,
    testName: String
  ) {
    guard let expectedResultsMap = expectedSurface["validationResults"]?.objectValue else { return }
    for (nodeID, expectedListVal) in expectedResultsMap {
      guard let expectedArray = expectedListVal.arrayValue else { continue }
      let actualResults = surface.findNode(id: nodeID)?.validationResults ?? []
      #expect(
        actualResults.count == expectedArray.count,
        """
        [\(testName)] Expected \(expectedArray.count) validationResults on \(nodeID), \
        got \(actualResults.count)
        """
      )
      for (actualRes, expectedObjVal) in zip(actualResults, expectedArray) {
        assertSingleValidationResultMatches(
          actual: actualRes,
          expected: expectedObjVal,
          nodeID: nodeID,
          testName: testName
        )
      }
    }
  }

  private func assertSurfaceSingleValidationResult(
    _ expectedSurface: JSONValue,
    on surface: SurfaceViewModel,
    testName: String
  ) {
    guard let expectedVR = expectedSurface["validationResult"]?.objectValue else { return }
    for (nodeID, expectedCheck) in expectedVR {
      let node = surface.findNode(id: nodeID)
      let expectedValid = expectedCheck["valid"]?.boolValue ?? true
      #expect(
        node?.isValid == expectedValid,
        "[\(testName)] Expected node \(nodeID).isValid == \(expectedValid)"
      )
      if let firstRes = node?.validationResults.first {
        assertSingleValidationResultMatches(
          actual: firstRes,
          expected: expectedCheck,
          nodeID: nodeID,
          testName: testName
        )
      }
    }
  }

  private func assertSingleValidationResultMatches(
    actual: ValidationResult,
    expected: JSONValue,
    nodeID: String,
    testName: String
  ) {
    if let expValid = expected["valid"]?.boolValue {
      #expect(actual.valid == expValid, "[\(testName)] \(nodeID) valid mismatch")
    }
    if let expCode = expected["code"]?.stringValue {
      #expect(actual.code == expCode, "[\(testName)] \(nodeID) code mismatch")
    }
    if let expMsg = expected["message"]?.stringValue {
      #expect(actual.message == expMsg, "[\(testName)] \(nodeID) message mismatch")
    }
    if let expSeverity = expected["severity"]?.stringValue {
      #expect(
        actual.severity?.rawValue == expSeverity,
        """
        [\(testName)] \(nodeID) severity mismatch: expected \(expSeverity), \
        got \(String(describing: actual.severity?.rawValue))
        """
      )
    }
  }
}

private final class IndexConformanceErrorHandler: ActionHandling, @unchecked Sendable {
  var capturedErrors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    capturedErrors.append(error)
  }
}
