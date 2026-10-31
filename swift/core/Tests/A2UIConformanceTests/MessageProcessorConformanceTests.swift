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
import OrderedCollections
import OrderedJSON
import Testing

private final class ConformanceActionCaptureHandler: ActionHandling,
  @unchecked Sendable
{
  var capturedErrors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    capturedErrors.append(error)
  }
}

/// Runs the shared `conformance/core/message_processor_v0_9.yaml` and
/// `conformance/core/message_processor_v1_0.yaml` suites.
@MainActor
struct MessageProcessorConformanceTests {
  /// `process_messages` cases whose payload is accepted but reports an error when it renders.
  static let expectedRuntimeErrors: [String: ExpectedRuntimeError] = [
    "test_v10_call_to_undeclared_function_without_strict_mode_accepted": ExpectedRuntimeError(
      code: "EXPRESSION_ERROR",
      surfaceID: "s",
      messageContains: "notAFunction"
    )
  ]

  /// Cases of the optional agent_renderer_app feature
  /// (blueprints/features/agent_renderer_app.blueprint.md), which passes a validation config to
  /// one call. This SDK has no agent, so it does not implement the feature.
  static let skippedCases: [String: String] = [
    "test_v10_call_validation_config_relaxes_strict_processor":
      "per-call validationConfig is part of the optional agent_renderer_app feature",
    "test_v10_call_validation_config_tightens_permissive_processor":
      "per-call validationConfig is part of the optional agent_renderer_app feature",
    "test_v10_call_validation_config_leaves_out_rules_as_strict":
      "per-call validationConfig is part of the optional agent_renderer_app feature",
  ]

  private static let knownCaseKeys: Set<String> = [
    "action",
    "args",
    "catalogPath",
    "catalogPaths",
    "catalogs",
    "expect",
    "expectError",
    "messages",
    "protocolVersion",
    "steps",
    "strictMode",
    "validationConfig",
  ]

  private static let knownStepKeys: Set<String> = [
    "expect",
    "expectError",
    "messages",
    "validationConfig",
  ]

  private static let knownExpectErrorKeys: Set<String> = [
    "category",
    "message",
    "rendererError",
    "surfaceId",
  ]

  private static let knownSurfaceExpectKeys: Set<String> = [
    "components",
    "dataModel",
    "defaultCatalogId",
    "exists",
    "metadata",
    "sendDataModel",
    "theme",
  ]

  private static let knownDataModelArgsKeys: Set<String> = [
    "version"
  ]

  private static let knownCapabilitiesArgsKeys: Set<String> = [
    "componentEnvelopeRef",
    "includeInlineCatalogs",
    "version",
    "versions",
  ]

  private static let knownResolvePathArgsKeys: Set<String> = [
    "contextPath",
    "path",
  ]

  /// A runtime error a case expects rendering to report through the action handler.
  struct ExpectedRuntimeError {
    let code: String
    let surfaceID: String
    let messageContains: String
  }

  @Test(arguments: ConformanceTestHelper.cases("core/message_processor_v0_9.yaml"))
  func messageProcessorV09Conformance(_ conformanceCase: ConformanceCase) throws {
    try runSingleMessageProcessorCase(conformanceCase, defaultVersion: "v0.9")
  }

  @Test(arguments: ConformanceTestHelper.cases("core/message_processor_v1_0.yaml"))
  func messageProcessorV10Conformance(_ conformanceCase: ConformanceCase) throws {
    try runSingleMessageProcessorCase(conformanceCase, defaultVersion: "1.0")
  }

  private func runSingleMessageProcessorCase(
    _ conformanceCase: ConformanceCase,
    defaultVersion: String
  ) throws {
    let skippedReason = Self.skippedCases[conformanceCase.name]
    try ConformanceManifest.run(conformanceCase, skippedReason: skippedReason) {
      try dispatchMessageProcessorCase(
        conformanceCase.rawDictionary,
        name: conformanceCase.name,
        defaultVersion: defaultVersion
      )
    }
  }

  private func dispatchMessageProcessorCase(
    _ testCase: [String: Any],
    name: String,
    defaultVersion: String
  ) throws {
    try ConformanceTestHelper.assertKnownKeys(
      testCase,
      Self.knownCaseKeys,
      "message_processor case '\(name)'"
    )
    let action = testCase["action"] as? String ?? ""
    switch action {
    case "process_messages", "validate":
      try runProcessMessagesCase(
        testCase,
        name: name,
        defaultVersion: defaultVersion
      )
    case "get_renderer_data_model":
      try runGetRendererDataModelCase(
        testCase,
        name: name,
        defaultVersion: defaultVersion
      )
    case "get_renderer_capabilities":
      try runGetRendererCapabilitiesCase(
        testCase,
        name: name,
        defaultVersion: defaultVersion
      )
    case "resolve_path":
      try runResolvePathCase(testCase, name: name)
    default:
      throw UnknownConformanceKeyError("[\(name)] Unknown message_processor action '\(action)'")
    }
  }

  private func runResolvePathCase(_ testCase: [String: Any], name: String) throws {
    let args = testCase["args"] as? [String: Any] ?? [:]
    try ConformanceTestHelper.assertKnownKeys(
      args,
      Self.knownResolvePathArgsKeys,
      "message_processor resolve_path args in '\(name)'",
      allowMetadata: false
    )
    let path = args["path"] as? String ?? ""
    let contextPath = args["contextPath"] as? String ?? ""
    let actual = JSONValue.absolutePath(for: path, in: contextPath)
    if let expected = testCase["expect"] as? String {
      #expect(actual == expected, "[\(name)] Expected resolved path '\(expected)', got '\(actual)'")
    }
  }

  private func buildProcessorCatalogs(
    from testCase: [String: Any],
    defaultVersion: String
  ) throws -> [AnyCatalog] {
    let explicitVer = testCase["protocolVersion"] as? String
    let pVer = explicitVer ?? defaultVersion
    let action = testCase["action"] as? String ?? "process_messages"
    let commonTypes = try? ConformanceTestHelper.commonTypesSchema(forProtocolVersion: pVer)

    var catalogs = try loadPathCatalogs(
      from: testCase,
      explicitVersion: explicitVer,
      defaultVersion: pVer,
      commonTypes: commonTypes
    )

    if let catalogList = testCase["catalogs"] as? [[String: Any]] {
      let inlineCatalogs = try buildInlineProcessorCatalogs(
        from: catalogList,
        action: action,
        commonTypes: commonTypes
      )
      catalogs.append(contentsOf: inlineCatalogs)
    }

    if catalogs.isEmpty {
      catalogs = [try makeDefaultBasicCatalog(protocolVersion: pVer)]
    }

    if testCase["catalogs"] == nil {
      try augmentCatalogsWithFallbackComponents(&catalogs, defaultVersion: pVer)
    }

    appendMissingReferencedCatalogAliases(&catalogs, from: testCase, defaultVersion: pVer)
    return catalogs
  }

  private func loadPathCatalogs(
    from testCase: [String: Any],
    explicitVersion: String?,
    defaultVersion: String,
    commonTypes: JSONValue?
  ) throws -> [AnyCatalog] {
    var catalogPaths = testCase["catalogPaths"] as? [String] ?? []
    if let catalogPath = testCase["catalogPath"] as? String {
      catalogPaths.append(catalogPath)
    }
    return try catalogPaths.map { path in
      let catalogSchema = try ConformanceTestHelper.loadRepositoryJSON(path: path)
      let pathVersion = inferPathCatalogVersion(
        catalogSchema: catalogSchema,
        path: path,
        explicitVersion: explicitVersion
      )
      let pathCommonTypes =
        (try? ConformanceTestHelper.commonTypesSchema(
          forProtocolVersion: pathVersion ?? defaultVersion
        )) ?? commonTypes
      return ConformanceTestHelper.buildCatalog(
        catalogSchema: catalogSchema,
        commonTypes: pathCommonTypes,
        protocolVersion: pathVersion
      )
    }
  }

  private func inferPathCatalogVersion(
    catalogSchema: JSONValue,
    path: String,
    explicitVersion: String?
  ) -> String? {
    if let declaredVersion = catalogSchema["protocolVersion"]?.stringValue {
      return A2UIProtocolVersion(lenientRawValue: declaredVersion)?.rawValue ?? declaredVersion
    }
    if path.contains("v0_9_1") { return "v0.9.1" }
    if path.contains("v0_9") { return "v0.9" }
    return explicitVersion
  }

  private func buildInlineProcessorCatalogs(
    from catalogList: [[String: Any]],
    action: String,
    commonTypes: JSONValue?
  ) throws -> [AnyCatalog] {
    let openSchema = try Schema(instance: "{\"type\": \"object\"}")
    let containerSchema = try makeContainerSchema()
    return catalogList.map { dict in
      let built = ConformanceTestHelper.buildCatalog(
        catalogSchema: ConformanceTestHelper.toJSONValue(dict),
        commonTypes: commonTypes
      )
      if action != "get_renderer_capabilities"
        && dict["components"] == nil
        && dict["functions"] == nil
        && dict["theme"] == nil
      {
        return Catalog(
          id: built.id,
          protocolVersion: built.protocolVersion,
          components: [
            AnyComponentAPI(name: "Column", schema: containerSchema),
            AnyComponentAPI(name: "Container", schema: containerSchema),
            AnyComponentAPI(name: "Button", schema: openSchema),
            AnyComponentAPI(name: "Text", schema: openSchema),
            AnyComponentAPI(name: "Label", schema: openSchema),
            AnyComponentAPI(name: "PieChart", schema: openSchema),
          ],
          functions: Array(built.functions.values),
          themeSchema: built.themeSchema
        )
      }
      return built
    }
  }

  private func makeDefaultBasicCatalog(protocolVersion: String) throws -> AnyCatalog {
    let textSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "text": { "type": "string" }
          }
        }
        """
    )
    let containerSchema = try makeContainerSchema()
    return Catalog(
      id: "basic",
      protocolVersion: protocolVersion,
      components: [
        AnyComponentAPI(name: "Text", schema: textSchema),
        AnyComponentAPI(name: "Container", schema: containerSchema),
        AnyComponentAPI(name: "Column", schema: containerSchema),
      ]
    )
  }

  private func makeContainerSchema() throws -> Schema {
    try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "children": {
              "type": "array",
              "description": "REF:common_types.json#/$defs/ChildList",
              "items": { "type": "string" }
            }
          }
        }
        """
    )
  }

  private func augmentCatalogsWithFallbackComponents(
    _ catalogs: inout [AnyCatalog],
    defaultVersion: String
  ) throws {
    let openSchema = try Schema(instance: "{\"type\": \"object\"}")
    let containerSchema = try makeContainerSchema()
    for index in 0..<catalogs.count {
      var comps = catalogs[index].components
      comps["Button"] = AnyComponentAPI(name: "Button", schema: openSchema)
      comps["Label"] = AnyComponentAPI(name: "Label", schema: openSchema)
      if comps["Text"] == nil {
        comps["Text"] = AnyComponentAPI(name: "Text", schema: openSchema)
      }
      if comps["Column"] == nil {
        comps["Column"] = AnyComponentAPI(name: "Column", schema: containerSchema)
      }
      catalogs[index] = Catalog(
        id: catalogs[index].id,
        protocolVersion: catalogs[index].protocolVersion ?? defaultVersion,
        components: comps.map { $0.value },
        functions: Array(catalogs[index].functions.values),
        themeSchema: catalogs[index].themeSchema
      )
    }
  }

  private func appendMissingReferencedCatalogAliases(
    _ catalogs: inout [AnyCatalog],
    from testCase: [String: Any],
    defaultVersion: String
  ) {
    var rawMessages = extractRawMessages(from: testCase)
    if let steps = testCase["steps"] as? [[String: Any]] {
      for step in steps {
        rawMessages.append(contentsOf: extractRawMessages(from: step))
      }
    }
    let neededIDs = collectNeededCatalogIDs(from: rawMessages)
    let existingIDs = Set(catalogs.map { $0.id })
    guard let base = catalogs.first else { return }
    for neededID in neededIDs where !existingIDs.contains(neededID) {
      catalogs.append(
        Catalog(
          id: neededID,
          protocolVersion: base.protocolVersion ?? defaultVersion,
          components: base.components.map { $0.value },
          functions: Array(base.functions.values),
          themeSchema: base.themeSchema
        )
      )
    }
  }

  private func collectNeededCatalogIDs(from rawMessages: [[String: Any]]) -> Set<String> {
    var neededIDs = Set<String>()
    for msg in rawMessages {
      if let create = msg["createSurface"] as? [String: Any],
        let cId = create["catalogId"] as? String,
        cId != "unknown-catalog"
      {
        neededIDs.insert(cId)
      }
      if let begin = msg["beginRendering"] as? [String: Any],
        let cId = begin["catalogId"] as? String,
        cId != "unknown-catalog"
      {
        neededIDs.insert(cId)
      }
    }
    return neededIDs
  }

  private func extractRawMessages(from testCase: [String: Any]) -> [[String: Any]] {
    if let msgList = testCase["messages"] as? [[String: Any]] {
      return msgList
    }
    if let msgDict = testCase["messages"] as? [String: Any] {
      if let wrappedList = msgDict["messages"] as? [[String: Any]] {
        return wrappedList
      }
      return [msgDict]
    }
    return []
  }

  private func runProcessMessagesCase(
    _ testCase: [String: Any],
    name: String,
    defaultVersion: String
  ) throws {
    let catalogs = try buildProcessorCatalogs(from: testCase, defaultVersion: defaultVersion)
    // A case's `validationConfig` sets its checks; without one, `strictMode` decides.
    let strictMode = testCase["strictMode"] as? Bool ?? false
    let validationConfig: ValidationConfig
    if let flags = testCase["validationConfig"] as? [String: Bool] {
      validationConfig = try #require(
        ConformanceTestHelper.validationConfig(from: flags),
        "[\(name)] Unknown validationConfig flags \(flags.keys.sorted())"
      )
    } else {
      validationConfig = strictMode ? .strict : .relaxed
    }
    let handler = ConformanceActionCaptureHandler()
    let processor = MessageProcessor(
      catalogs: catalogs,
      actionHandler: handler,
      validationConfig: validationConfig
    )
    let expectedRuntimeError = Self.expectedRuntimeErrors[name]
    let explicitSteps = testCase["steps"] as? [[String: Any]]
    if let explicitSteps {
      for step in explicitSteps {
        try ConformanceTestHelper.assertKnownKeys(
          step,
          Self.knownStepKeys,
          "message_processor step in '\(name)'",
          allowMetadata: false
        )
      }
    }
    let steps = explicitSteps ?? [testCase]

    for step in steps {
      try executeProcessMessagesStep(
        step,
        processor: processor,
        handler: handler,
        expectedRuntimeError: expectedRuntimeError,
        name: name
      )
    }
  }

  private func executeProcessMessagesStep(
    _ step: [String: Any],
    processor: MessageProcessor,
    handler: ConformanceActionCaptureHandler,
    expectedRuntimeError: ConformanceExpectRendererError?,
    name: String
  ) throws {
    let payload = ConformanceTestHelper.toJSONValue(step["messages"] ?? [:])
    handler.capturedErrors.removeAll()

    if let expectError = step["expectError"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectError,
        Self.knownExpectErrorKeys,
        "message_processor expectError in '\(name)'",
        allowMetadata: false
      )
      assertStepError(
        payload: payload,
        expectError: expectError,
        processor: processor,
        handler: handler,
        name: name
      )
      return
    }

    try processor.processMessages(payload)
    assertStepRuntimeErrors(
      capturedErrors: handler.capturedErrors,
      expected: expectedRuntimeError,
      name: name
    )

    if let expectedDict = step["expect"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectedDict,
        ["surfaces"],
        "message_processor expect in '\(name)'",
        allowMetadata: false
      )
    }
    let expectedDict = (step["expect"] as? [String: Any]) ?? [:]
    let expectedSurfaces =
      (expectedDict["surfaces"] as? [String: Any])
      ?? (step["expectedSurfaces"] as? [String: Any])
    try verifyExpectedSurfaces(expectedSurfaces, on: processor, name: name)
  }

  private func assertStepError(
    payload: JSONValue,
    expectError: [String: Any],
    processor: MessageProcessor,
    handler: ConformanceActionCaptureHandler,
    name: String
  ) {
    do {
      try processor.processMessages(payload)
      Issue.record("[\(name)] Expected error to be thrown for invalid message")
    } catch {
      assertProcessErrorCategory(error: error, expectError: expectError, name: name)
      if let expectedMessage = expectError["message"] as? String, !expectedMessage.isEmpty {
        let description = (error as? (any A2UIError))?.message ?? error.localizedDescription
        #expect(
          ConformanceTestHelper.messageMatches(description, expected: expectedMessage),
          "[\(name)] Expected error message containing '\(expectedMessage)', got '\(description)'"
        )
      }
      if let rendererErr = ConformanceTestHelper.parseRendererError(expectError["rendererError"]) {
        ConformanceTestHelper.assertRendererErrorMatches(
          handler.capturedErrors.last,
          expected: rendererErr,
          context: name
        )
      }
    }
  }

  private func assertProcessErrorCategory(
    error: Error,
    expectError: [String: Any],
    name: String
  ) {
    guard let category = expectError["category"] as? String else { return }
    switch category {
    case "RecursionError":
      #expect(error is A2UIRecursionError, "[\(name)] Expected RecursionError, got \(error)")
    case "IntegrityError":
      #expect(
        error is A2UIIntegrityError || error is A2UIRecursionError,
        "[\(name)] Expected IntegrityError, got \(error)"
      )
    case "CatalogError":
      #expect(error is A2UICatalogError, "[\(name)] Expected CatalogError, got \(error)")
    case "ValidationError":
      #expect(error is A2UIValidationError, "[\(name)] Expected ValidationError, got \(error)")
    default:
      Issue.record("[\(name)] Unknown error category '\(category)'")
    }
  }

  private func assertStepRuntimeErrors(
    capturedErrors: [RendererError],
    expected: ExpectedRuntimeError?,
    name: String
  ) {
    if let expected {
      #expect(
        !capturedErrors.isEmpty,
        "[\(name)] Expected a runtime error from rendering the accepted payload"
      )
      for error in capturedErrors {
        guard case .generic(let generic) = error else {
          Issue.record("[\(name)] Expected a generic runtime error, got \(error)")
          continue
        }
        #expect(generic.code == expected.code, "[\(name)] Expected code \(expected.code)")
        #expect(generic.surfaceID == expected.surfaceID, "[\(name)] Unexpected surface")
        #expect(
          generic.message.contains(expected.messageContains),
          "[\(name)] Unexpected message: \(generic.message)"
        )
      }
    } else {
      #expect(capturedErrors.isEmpty, "[\(name)] Unexpected errors: \(capturedErrors)")
    }
  }

  private func verifyExpectedSurfaces(
    _ expectedSurfaces: [String: Any]?,
    on processor: MessageProcessor,
    name: String
  ) throws {
    guard let expectedSurfaces else { return }
    for (surfaceID, rawExpected) in expectedSurfaces {
      try verifySingleExpectedSurface(
        surfaceID: surfaceID,
        rawExpected: rawExpected,
        on: processor,
        name: name
      )
    }
  }

  private func verifySingleExpectedSurface(
    surfaceID: String,
    rawExpected: Any,
    on processor: MessageProcessor,
    name: String
  ) throws {
    if rawExpected is NSNull {
      #expect(
        processor.surfaceGroupModel.surfacesMap[surfaceID] == nil,
        "[\(name)] Expected surface '\(surfaceID)' to be deleted"
      )
      return
    }
    guard let expectedSurfaceDict = rawExpected as? [String: Any] else { return }
    try ConformanceTestHelper.assertKnownKeys(
      expectedSurfaceDict,
      Self.knownSurfaceExpectKeys,
      "message_processor expect.surfaces.\(surfaceID) in '\(name)'",
      allowMetadata: false
    )
    if expectedSurfaceDict["exists"] as? Bool == false {
      #expect(
        processor.surfaceGroupModel.surfacesMap[surfaceID] == nil,
        "[\(name)] Expected surface '\(surfaceID)' to be deleted"
      )
      return
    }
    let surface = try #require(
      processor.surfaceGroupModel.surfacesMap[surfaceID],
      "[\(name)] Expected surface '\(surfaceID)' to exist"
    )
    verifySurfaceProperties(expectedSurfaceDict, on: surface, surfaceID: surfaceID, name: name)
    if let expectedComponents = expectedSurfaceDict["components"] {
      try verifySurfaceComponents(expectedComponents, on: surface, surfaceID: surfaceID, name: name)
    }
  }

  private func verifySurfaceProperties(
    _ expectedSurfaceDict: [String: Any],
    on surface: SurfaceViewModel,
    surfaceID: String,
    name: String
  ) {
    if let expectedDataModel = expectedSurfaceDict["dataModel"] {
      #expect(
        surface.dataModel.data == ConformanceTestHelper.toJSONValue(expectedDataModel),
        "[\(name)] DataModel mismatch on surface '\(surfaceID)'"
      )
    }
    verifySurfaceMetadataAndTheme(
      expectedSurfaceDict,
      on: surface,
      surfaceID: surfaceID,
      name: name
    )
    if let expectedSendDataModel = expectedSurfaceDict["sendDataModel"] as? Bool {
      #expect(
        surface.sendDataModel == expectedSendDataModel,
        "[\(name)] sendDataModel mismatch on surface '\(surfaceID)'"
      )
    }
    if let rawDefaultCatalogID = expectedSurfaceDict["defaultCatalogId"] {
      if rawDefaultCatalogID is NSNull {
        #expect(surface.defaultCatalogID == nil, "[\(name)] Expected nil defaultCatalogId")
      } else if let expectedDefaultCatalogID = rawDefaultCatalogID as? String {
        #expect(
          surface.defaultCatalogID == expectedDefaultCatalogID,
          "[\(name)] defaultCatalogId mismatch on surface '\(surfaceID)'"
        )
      }
    }
  }

  private func verifySurfaceMetadataAndTheme(
    _ expectedSurfaceDict: [String: Any],
    on surface: SurfaceViewModel,
    surfaceID: String,
    name: String
  ) {
    if expectedSurfaceDict.keys.contains("metadata") {
      let expectedSurfaceMeta =
        expectedSurfaceDict["metadata"].map { ConformanceTestHelper.toJSONValue($0) } ?? .null
      if expectedSurfaceMeta == .null {
        #expect(
          surface.metadata == nil,
          "[\(name)] Expected nil surface metadata on surface '\(surfaceID)'"
        )
      } else {
        let expectedMetaDict = try? MetadataValidator.validate(expectedSurfaceMeta)
        #expect(
          MetadataValidator.areEqual(surface.metadata, expectedMetaDict),
          "[\(name)] Surface metadata mismatch on surface '\(surfaceID)'"
        )
      }
    }
    if let expectedTheme = expectedSurfaceDict["theme"] {
      let actualThemeValue: JSONValue =
        surface.theme.map { dict in
          var ordered = OrderedDictionary<String, JSONValue>()
          for (key, val) in dict {
            ordered[key] = val
          }
          return .object(ordered)
        } ?? .null
      #expect(
        actualThemeValue == ConformanceTestHelper.toJSONValue(expectedTheme),
        "[\(name)] Theme mismatch on surface '\(surfaceID)'"
      )
    }
  }

  private func verifySurfaceComponents(
    _ expectedComponents: Any,
    on surface: SurfaceViewModel,
    surfaceID: String,
    name: String
  ) throws {
    if let compDict = expectedComponents as? [String: Any] {
      #expect(
        surface.componentsModel.components.count == compDict.count,
        "[\(name)] Component count mismatch on surface '\(surfaceID)'"
      )
      for (compID, rawComp) in compDict {
        guard let compObj = rawComp as? [String: Any] else { continue }
        try verifyComponentEntry(compObj, id: compID, on: surface, surfaceID: surfaceID, name: name)
      }
    } else if let compList = expectedComponents as? [Any] {
      #expect(
        surface.componentsModel.components.count == compList.count,
        "[\(name)] Component count mismatch on surface '\(surfaceID)'"
      )
      for rawComp in compList {
        guard let compObj = rawComp as? [String: Any],
          let compID = compObj["id"] as? String
        else { continue }
        try verifyComponentEntry(compObj, id: compID, on: surface, surfaceID: surfaceID, name: name)
      }
    }
  }

  private func verifyComponentEntry(
    _ compObj: [String: Any],
    id: String,
    on surface: SurfaceViewModel,
    surfaceID: String,
    name: String
  ) throws {
    let actualComp = try #require(
      surface.componentsModel.get(id),
      "[\(name)] Expected component '\(id)' on surface '\(surfaceID)'"
    )
    if let expectedType = compObj["component"] as? String {
      #expect(
        actualComp.type == expectedType,
        """
        [\(name)] Component '\(id)' type mismatch: \
        expected '\(expectedType)', got '\(actualComp.type)'
        """
      )
    }
    if let expectedCatalogID = compObj["catalogId"] as? String {
      #expect(
        actualComp.catalogID == expectedCatalogID,
        "[\(name)] Component '\(id)' catalogId mismatch"
      )
    }
    if compObj.keys.contains("metadata") {
      let expectedMeta = compObj["metadata"].map { ConformanceTestHelper.toJSONValue($0) } ?? .null
      if expectedMeta == .null {
        #expect(
          actualComp.metadata == nil,
          "[\(name)] Expected nil component '\(id)' metadata on surface '\(surfaceID)'"
        )
      } else {
        let expectedMetaDict = try? MetadataValidator.validate(expectedMeta)
        #expect(
          MetadataValidator.areEqual(actualComp.metadata, expectedMetaDict),
          "[\(name)] Component '\(id)' metadata mismatch on surface '\(surfaceID)'"
        )
      }
    }
    for (propKey, propVal) in compObj
    where propKey != "id" && propKey != "component" && propKey != "catalogId"
      && propKey != "metadata"
    {
      #expect(
        actualComp.properties[propKey] == ConformanceTestHelper.toJSONValue(propVal),
        "[\(name)] Component '\(id)' property '\(propKey)' mismatch"
      )
    }
  }

  private func runGetRendererDataModelCase(
    _ testCase: [String: Any],
    name: String,
    defaultVersion: String
  ) throws {
    let catalogs = try buildProcessorCatalogs(from: testCase, defaultVersion: defaultVersion)
    let processor = MessageProcessor(catalogs: catalogs)
    if let explicitSteps = testCase["steps"] as? [[String: Any]] {
      for step in explicitSteps {
        try ConformanceTestHelper.assertKnownKeys(
          step,
          Self.knownStepKeys,
          "message_processor get_renderer_data_model step in '\(name)'",
          allowMetadata: false
        )
      }
    }
    let steps = (testCase["steps"] as? [[String: Any]]) ?? [testCase]
    for step in steps {
      let payload = ConformanceTestHelper.toJSONValue(step["messages"] ?? [:])
      try processor.processMessages(payload)
    }

    let args = testCase["args"] as? [String: Any] ?? [:]
    try ConformanceTestHelper.assertKnownKeys(
      args,
      Self.knownDataModelArgsKeys,
      "message_processor get_renderer_data_model args in '\(name)'",
      allowMetadata: false
    )
    let versionStr = args["version"] as? String
    let protocolVersion = versionStr.flatMap { A2UIProtocolVersion(lenientRawValue: $0) }
    let actual = try processor.getRendererDataModel(version: protocolVersion)
    let expectedDict =
      (testCase["expect"] as? [String: Any])
      ?? (testCase["expectedDataModel"] as? [String: Any])
    if let expectedDict {
      try ConformanceTestHelper.assertKnownKeys(
        expectedDict,
        ["surfaces", "version"],
        "message_processor get_renderer_data_model expect in '\(name)'",
        allowMetadata: false
      )
    }
    if let expectedSurfaces = expectedDict?["surfaces"] {
      #expect(
        actual?["surfaces"] == ConformanceTestHelper.toJSONValue(expectedSurfaces),
        """
        [\(name)] Expected renderer data model \(expectedSurfaces), \
        got \(String(describing: actual))
        """
      )
    } else {
      #expect(
        actual == nil,
        "[\(name)] Expected nil renderer data model, got \(String(describing: actual))"
      )
    }
  }

  private func runGetRendererCapabilitiesCase(
    _ testCase: [String: Any],
    name: String,
    defaultVersion: String
  ) throws {
    let catalogs = try buildProcessorCatalogs(from: testCase, defaultVersion: defaultVersion)
    let processor = MessageProcessor(catalogs: catalogs)
    let args = testCase["args"] as? [String: Any] ?? [:]
    try ConformanceTestHelper.assertKnownKeys(
      args,
      Self.knownCapabilitiesArgsKeys,
      "message_processor get_renderer_capabilities args in '\(name)'",
      allowMetadata: false
    )
    let options = buildCapabilitiesOptions(from: args)

    if let expectError = testCase["expectError"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectError,
        Self.knownExpectErrorKeys,
        "message_processor get_renderer_capabilities expectError in '\(name)'",
        allowMetadata: false
      )
      do {
        _ = try processor.getRendererCapabilities(options: options)
        Issue.record("[\(name)] Expected getRendererCapabilities to throw")
      } catch {
        assertProcessErrorCategory(error: error, expectError: expectError, name: name)
      }
      return
    }

    let caps = try processor.getRendererCapabilities(options: options)
    let expectedDict =
      (testCase["expect"] as? [String: Any])
      ?? (testCase["expectedCapabilities"] as? [String: Any])
      ?? [:]
    verifyCapabilitiesOutput(caps, expectedDict: expectedDict, name: name)
  }

  private func buildCapabilitiesOptions(
    from args: [String: Any]
  ) -> MessageProcessor.CapabilitiesOptions {
    let includeInline = args["includeInlineCatalogs"] as? Bool ?? false
    let componentEnvelopeRef = args["componentEnvelopeRef"] as? String
    if let versionStrings = args["versions"] as? [String] {
      let versions = versionStrings.compactMap { A2UIProtocolVersion(lenientRawValue: $0) }
      return MessageProcessor.CapabilitiesOptions(
        versions: versions,
        includeInlineCatalogs: includeInline,
        componentEnvelopeRef: componentEnvelopeRef
      )
    }
    let versionStr = args["version"] as? String ?? "v0.9.1"
    let protocolVersion = A2UIProtocolVersion(lenientRawValue: versionStr) ?? .v091
    return MessageProcessor.CapabilitiesOptions(
      protocolVersion: protocolVersion,
      includeInlineCatalogs: includeInline,
      componentEnvelopeRef: componentEnvelopeRef
    )
  }

  private func verifyCapabilitiesOutput(
    _ caps: JSONValue,
    expectedDict: [String: Any],
    name: String
  ) {
    for (verKey, rawExpectedVer) in expectedDict {
      guard let expectedVersion = rawExpectedVer as? [String: Any] else { continue }
      let normalizedKey = A2UIProtocolVersion(lenientRawValue: verKey)?.rawValue ?? verKey
      let actualVerCaps = caps[verKey] ?? caps[normalizedKey]
      if let expectedIDs = expectedVersion["supportedCatalogIds"] {
        #expect(
          actualVerCaps?["supportedCatalogIds"] == ConformanceTestHelper.toJSONValue(expectedIDs),
          "[\(name)] Supported catalog IDs mismatch for \(verKey)"
        )
      }
      if let expectedInline = expectedVersion["inlineCatalogs"] {
        #expect(
          actualVerCaps?["inlineCatalogs"] == ConformanceTestHelper.toJSONValue(expectedInline),
          "[\(name)] Inline catalogs mismatch for \(verKey)"
        )
      }
    }
  }
}
