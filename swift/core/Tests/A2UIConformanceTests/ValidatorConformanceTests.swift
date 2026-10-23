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

private final class ValidatorErrorCaptureHandler: ActionHandling, @unchecked Sendable {
  var capturedErrors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    capturedErrors.append(error)
  }
}

@MainActor
struct ValidatorConformanceTests {
  @Test func validatorConformance() throws {
    try runValidatorSuite(filename: "core/validator_v0_9.yaml", versionPrefix: "v0.9")
  }

  @Test func validatorV10Conformance() throws {
    try runValidatorSuite(filename: "core/validator_v1_0.yaml", versionPrefix: "v1.0")
  }

  private func runValidatorSuite(filename: String, versionPrefix: String?) throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: filename)
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYAML)
    #expect(!testCases.isEmpty, "\(filename) should hold test cases")

    var executedSteps = 0

    for testCase in testCases where matchesSuiteFilter(testCase, versionPrefix: versionPrefix) {
      let targetVersion = resolveTargetVersion(for: testCase, versionPrefix: versionPrefix)
      let config = makeValidationConfig(strictMode: testCase.strictMode, targetVersion: targetVersion)
      let catalogs = try buildCatalogsWithAliases(for: testCase)
      let handler = ValidatorErrorCaptureHandler()
      let processor = MessageProcessor(
        catalogs: catalogs,
        actionHandler: handler,
        validationConfig: config
      )

      executedSteps += try executeValidationSteps(
        for: testCase,
        processor: processor,
        handler: handler
      )
    }

    #expect(executedSteps > 0, "no step of \(filename) was executed")
  }

  private func matchesSuiteFilter(_ testCase: ConformanceTestCase, versionPrefix: String?) -> Bool {
    guard testCase.action == "validate" else { return false }
    guard let versionPrefix else { return true }
    return testCase.protocolVersion == nil || testCase.protocolVersion?.hasPrefix(versionPrefix) == true
  }

  private func resolveTargetVersion(
    for testCase: ConformanceTestCase,
    versionPrefix: String?
  ) -> String {
    if let explicit = testCase.protocolVersion {
      return explicit.hasPrefix("v1.0") ? "v1.0" : explicit
    }
    return versionPrefix == "v1.0" ? "v1.0" : "v0.9.1"
  }

  private func makeValidationConfig(strictMode: Bool, targetVersion: String) -> ValidationConfig {
    if strictMode {
      return ValidationConfig(
        allowOrphanComponents: false,
        allowDanglingReferences: false,
        allowMissingRoot: false,
        targetVersion: targetVersion
      )
    }
    return ValidationConfig(
      allowOrphanComponents: true,
      allowDanglingReferences: true,
      allowMissingRoot: true,
      targetVersion: targetVersion
    )
  }

  private func executeValidationSteps(
    for testCase: ConformanceTestCase,
    processor: MessageProcessor,
    handler: ValidatorErrorCaptureHandler,
    verifyExpectedSurfaces: Bool = false
  ) throws -> Int {
    var executed = 0
    for (stepIndex, step) in testCase.steps.enumerated() {
      guard let payload = step.payload else { continue }
      executed += 1
      clearRecreatedSurfaces(in: payload, on: processor)
      handler.capturedErrors.removeAll()

      if let expectedError = step.expectError ?? testCase.expectError {
        let error = try expectValidationFailure(
          payload: payload,
          processor: processor,
          testName: testCase.name,
          stepIndex: stepIndex
        )
        assertErrorMatches(
          error: error,
          capturedRendererError: handler.capturedErrors.last,
          expected: expectedError,
          testName: testCase.name
        )
      } else {
        try expectValidationSuccess(
          payload: payload,
          processor: processor,
          testCase: testCase,
          step: step,
          stepIndex: stepIndex,
          verifyExpectedSurfaces: verifyExpectedSurfaces
        )
      }
    }
    return executed
  }

  private func expectValidationFailure(
    payload: JSONValue,
    processor: MessageProcessor,
    testName: String,
    stepIndex: Int
  ) throws -> Error {
    var caughtError: Error?
    do {
      try processor.processMessages(payload)
    } catch {
      caughtError = error
    }
    return try #require(
      caughtError,
      "Expected failure for '\(testName)' at step \(stepIndex)"
    )
  }

  private func expectValidationSuccess(
    payload: JSONValue,
    processor: MessageProcessor,
    testCase: ConformanceTestCase,
    step: ConformanceStep,
    stepIndex: Int,
    verifyExpectedSurfaces: Bool
  ) throws {
    do {
      try processor.processMessages(payload)
    } catch {
      Issue.record(
        """
        Expected payload to validate cleanly for '\(testCase.name)' \
        at step \(stepIndex), but caught: \(error)
        """
      )
      return
    }
    if verifyExpectedSurfaces,
      let expectedSurfaces = (step.expect ?? testCase.expect)?["surfaces"]?.objectValue
    {
      try assertReservedKeysSurfaces(
        expectedSurfaces: OrderedDictionary(
          uniqueKeysWithValues: expectedSurfaces.map { ($0.key, $0.value) }
        ),
        processor: processor,
        testName: testCase.name
      )
    }
  }

  private func buildCatalogsWithAliases(for testCase: ConformanceTestCase) throws -> [AnyCatalog] {
    var catalogs = try ConformanceTestHelper.buildCatalogs(for: testCase)
    let expectsCatalogError =
      testCase.expectError?.category == "CatalogError"
      || testCase.steps.contains { $0.expectError?.category == "CatalogError" }
    guard !expectsCatalogError, catalogs.count == 1, let soleCatalog = catalogs.first else {
      return catalogs
    }

    let referencedCatalogIDs = collectReferencedCatalogIDs(
      in: testCase.steps,
      excluding: soleCatalog.id
    )
    for aliasID in referencedCatalogIDs.sorted() {
      catalogs.append(
        Catalog(
          id: aliasID,
          protocolVersion: soleCatalog.protocolVersion,
          components: Array(soleCatalog.components.values),
          functions: Array(soleCatalog.functions.values),
          themeSchema: soleCatalog.themeSchema
        ).eraseToAnyCatalog()
      )
    }
    return catalogs
  }

  private func collectReferencedCatalogIDs(
    in steps: [ConformanceStep],
    excluding defaultID: String
  ) -> Set<String> {
    var referenced: Set<String> = []
    for step in steps {
      guard let payload = step.payload else { continue }
      let messages = payload.arrayValue ?? [payload]
      for message in messages {
        if let catalogID = message.objectValue?["createSurface"]?.objectValue?["catalogId"]?
          .stringValue,
          !catalogID.isEmpty,
          catalogID != defaultID
        {
          referenced.insert(catalogID)
        }
      }
    }
    return referenced
  }

  private func clearRecreatedSurfaces(in payload: JSONValue, on processor: MessageProcessor) {
    let messages = payload.arrayValue ?? [payload]
    var createdInPayload: [String: Int] = [:]
    for message in messages {
      if let surfaceID = message.objectValue?["createSurface"]?.objectValue?["surfaceId"]?
        .stringValue
      {
        createdInPayload[surfaceID, default: 0] += 1
      }
    }
    for (surfaceID, count) in createdInPayload
    where count == 1 && processor.surfaceGroupModel[surfaceID] != nil {
      processor.surfaceGroupModel.removeSurface(id: surfaceID)
    }
  }

  @Test func compositionConstraintsConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/composition_constraints.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)
    #expect(!testCases.isEmpty, "Should find test cases in core/composition_constraints.yaml")

    for testCase in testCases {
      let catalogs = buildCompositionCatalogs(for: testCase)
      let handler = ValidatorErrorCaptureHandler()
      let processor = MessageProcessor(
        catalogs: catalogs,
        actionHandler: handler,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      _ = try executeValidationSteps(
        for: testCase,
        processor: processor,
        handler: handler
      )
    }
  }

  private func buildCompositionCatalogs(for testCase: ConformanceTestCase) -> [AnyCatalog] {
    let v10Catalog = BasicCatalog.makeCatalog(version: .v10)
    var catalogs: [AnyCatalog] = [v10Catalog]
    for aliasId in ["basic", "test-catalog", "https://a2ui.org/basic-catalog"] {
      catalogs.append(
        Catalog(
          id: aliasId,
          protocolVersion: v10Catalog.protocolVersion,
          components: Array(v10Catalog.components.values),
          functions: Array(v10Catalog.functions.values)
        ).eraseToAnyCatalog()
      )
    }
    if let customCatalog = ConformanceTestHelper.buildCatalog(from: testCase.catalogConfiguration) {
      catalogs.append(customCatalog)
    }
    return catalogs
  }

  @Test func reservedKeysConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/reserved_keys.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYAML)
    #expect(!testCases.isEmpty, "Should find test cases in core/reserved_keys.yaml")

    var executed = 0
    for testCase in testCases {
      let catalogs = try buildCatalogsWithAliases(for: testCase)
      let handler = ValidatorErrorCaptureHandler()
      let processor = MessageProcessor(
        catalogs: catalogs,
        actionHandler: handler,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      executed += try executeValidationSteps(
        for: testCase,
        processor: processor,
        handler: handler,
        verifyExpectedSurfaces: true
      )
    }
    #expect(executed == testCases.count, "All cases in reserved_keys.yaml should execute")
  }

  private func assertReservedKeysSurfaces(
    expectedSurfaces: OrderedDictionary<String, JSONValue>,
    processor: MessageProcessor,
    testName: String
  ) throws {
    for (surfaceID, expectedSurface) in expectedSurfaces {
      let surface = try #require(
        processor.surfaceGroupModel[surfaceID],
        "[\(testName)] Expected surface '\(surfaceID)' to exist"
      )
      guard let expectedComps = expectedSurface["components"]?.arrayValue else { continue }
      for expectedComp in expectedComps {
        try assertReservedKeysComponent(expectedComp, on: surface, testName: testName)
      }
    }
  }

  private func assertReservedKeysComponent(
    _ expectedComp: JSONValue,
    on surface: SurfaceViewModel,
    testName: String
  ) throws {
    guard let compObj = expectedComp.objectValue,
      let id = compObj["id"]?.stringValue
    else { return }
    let node = try #require(
      surface.findNode(id: id),
      "[\(testName)] Expected resolved node '\(id)'"
    )
    for (propKey, expectedVal) in compObj where propKey != "id" && propKey != "component" {
      if let binding = node.properties[propKey] as? DataBinding<JSONValue> {
        #expect(
          binding.value == expectedVal,
          "[\(testName)] Property '\(propKey)' mismatch"
        )
      } else if let strBinding = node.properties[propKey] as? DataBinding<String> {
        #expect(
          strBinding.value == expectedVal.stringValue,
          "[\(testName)] Property '\(propKey)' mismatch"
        )
      }
    }
  }

  private func assertErrorMatches(
    error: Error,
    capturedRendererError: RendererError?,
    expected: ConformanceExpectError,
    testName: String
  ) {
    if let category = expected.category {
      assertErrorCategory(error: error, category: category, testName: testName)
    }
    if let expectedCode = expected.code {
      assertErrorCode(
        error: error,
        capturedRendererError: capturedRendererError,
        expectedCode: expectedCode,
        testName: testName
      )
    }
    if let expectedPath = expected.path {
      assertErrorPath(
        error: error,
        capturedRendererError: capturedRendererError,
        expectedPath: expectedPath,
        testName: testName
      )
    }
    if let expectedMessage = expected.message, !expectedMessage.isEmpty {
      assertErrorMessage(error: error, expectedMessage: expectedMessage, testName: testName)
    }
    if let expectedDetails = expected.details {
      assertErrorDetails(error: error, expectedDetails: expectedDetails, testName: testName)
    }
    if let expectedRendererError = expected.rendererError {
      ConformanceTestHelper.assertRendererErrorMatches(
        capturedRendererError,
        expected: expectedRendererError,
        context: testName
      )
    }
  }

  private func assertErrorCategory(error: Error, category: String, testName: String) {
    switch category {
    case "ValidationError":
      #expect(
        error is A2UIValidationError,
        "[\(testName)] Expected A2UIValidationError for '\(category)', got \(type(of: error))"
      )
    case "IntegrityError":
      #expect(
        error is A2UIIntegrityError,
        "[\(testName)] Expected A2UIIntegrityError for '\(category)', got \(type(of: error))"
      )
    case "RecursionError":
      #expect(
        error is A2UIRecursionError,
        "[\(testName)] Expected A2UIRecursionError for '\(category)', got \(type(of: error))"
      )
    case "CatalogError":
      #expect(
        error is A2UICatalogError,
        "[\(testName)] Expected A2UICatalogError for '\(category)', got \(type(of: error))"
      )
    default:
      break
    }
  }

  private func assertErrorCode(
    error: Error,
    capturedRendererError: RendererError?,
    expectedCode: String,
    testName: String
  ) {
    if let valError = error as? A2UIValidationError {
      #expect(
        valError.details.contains(where: { $0.code == expectedCode }),
        "[\(testName)] Expected error code '\(expectedCode)', got \(valError.details)"
      )
    } else if let capturedRendererError {
      let fallback = ConformanceExpectRendererError(
        code: expectedCode,
        surfaceID: nil,
        functionCallID: nil,
        path: nil,
        message: nil
      )
      ConformanceTestHelper.assertRendererErrorMatches(
        capturedRendererError,
        expected: fallback,
        context: testName
      )
    }
  }

  private func assertErrorPath(
    error: Error,
    capturedRendererError: RendererError?,
    expectedPath: String,
    testName: String
  ) {
    if let valError = error as? A2UIValidationError {
      let matches = valError.details.contains { detail in
        detail.path == expectedPath
          || normalizedDetailPath(detail.path) == normalizedDetailPath(expectedPath)
      }
      #expect(
        matches,
        "[\(testName)] Expected error path '\(expectedPath)', got \(valError.details)"
      )
    } else if let capturedRendererError {
      let fallback = ConformanceExpectRendererError(
        code: nil,
        surfaceID: nil,
        functionCallID: nil,
        path: expectedPath,
        message: nil
      )
      ConformanceTestHelper.assertRendererErrorMatches(
        capturedRendererError,
        expected: fallback,
        context: testName
      )
    }
  }

  private func assertErrorMessage(error: Error, expectedMessage: String, testName: String) {
    let description = (error as? (any A2UIError))?.message ?? error.localizedDescription
    let matches = ConformanceTestHelper.messageMatches(description, expected: expectedMessage)
    #expect(
      matches,
      "[\(testName)] Expected error containing '\(expectedMessage)', got '\(description)'"
    )
  }

  private func assertErrorDetails(
    error: Error,
    expectedDetails: [ValidationErrorDetail],
    testName: String
  ) {
    let actualDetails = (error as? A2UIValidationError)?.details ?? []
    for expectedDetail in expectedDetails {
      let found = actualDetails.contains { actualDetail in
        detailMatches(actual: actualDetail, expected: expectedDetail)
      }
      #expect(
        found,
        """
        [\(testName)] Expected detail with path '\(expectedDetail.path)', \
        code '\(expectedDetail.code)', message '\(expectedDetail.message)' in \(actualDetails)
        """
      )
    }
  }

  private func detailMatches(actual: ValidationErrorDetail, expected: ValidationErrorDetail) -> Bool {
    guard actual.code == expected.code,
      detailPathMatches(actual: actual.path, expected: expected.path)
    else {
      return false
    }
    guard !expected.message.isEmpty else { return true }
    return ConformanceTestHelper.messageMatches(actual.message, expected: expected.message)
  }

  private func detailPathMatches(actual: String, expected: String) -> Bool {
    let normActual = normalizedDetailPath(actual)
    let normExpected = normalizedDetailPath(expected)
    if normActual == normExpected {
      return true
    }
    // Component validation prefixes detail paths with `/components/<index>`, whereas some
    // component-scoped expectations specify paths relative to the component object.
    let parts = normActual.split(separator: ".", maxSplits: 2, omittingEmptySubsequences: false)
    if parts.count == 3, parts[0] == "components", Int(parts[1]) != nil {
      return String(parts[2]) == normExpected
    }
    return false
  }

  /// Converts a JSON Pointer such as `/children/0` to the dotted form `children.0` that the
  /// suites use, so that schema error locations compare equal to envelope error paths.
  private func normalizedDetailPath(_ path: String) -> String {
    guard path.hasPrefix("/") else { return path }
    return path.dropFirst().replacingOccurrences(of: "/", with: ".")
  }
}
