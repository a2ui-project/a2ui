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
  @Test func messageProcessorV09Conformance() throws {
    try runMessageProcessorSuite(
      filename: "core/message_processor_v0_9.yaml",
      defaultVersion: "v0.9"
    )
  }

  @Test func messageProcessorV10Conformance() throws {
    try runMessageProcessorSuite(
      filename: "core/message_processor_v1_0.yaml",
      defaultVersion: "v1.0"
    )
  }

  private func runMessageProcessorSuite(
    filename: String,
    defaultVersion: String
  ) throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: filename)
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "\(filename) should hold test cases")

    var executed = 0

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let action = testCase["action"] as? String ?? "process_messages"

      switch action {
      case "process_messages", "validate":
        try runProcessMessagesCase(
          testCase,
          name: name,
          defaultVersion: defaultVersion
        )
        executed += 1
      case "get_renderer_data_model":
        try runGetRendererDataModelCase(
          testCase,
          name: name,
          defaultVersion: defaultVersion
        )
        executed += 1
      case "get_renderer_capabilities":
        try runGetRendererCapabilitiesCase(
          testCase,
          name: name,
          defaultVersion: defaultVersion
        )
        executed += 1
      default:
        continue
      }
    }

    #expect(executed > 0, "no case of \(filename) was executed")
  }

  private func buildProcessorCatalogs(
    from testCase: [String: Any],
    defaultVersion: String
  ) throws -> [AnyCatalog] {
    let explicitVer = testCase["protocolVersion"] as? String
    let pVer = explicitVer ?? defaultVersion
    let action = testCase["action"] as? String ?? "process_messages"
    let commonTypes = try? ConformanceTestHelper.commonTypesSchema(forProtocolVersion: pVer)

    var catalogs: [AnyCatalog] = []

    if let catalogList = testCase["catalogs"] as? [[String: Any]] {
      let openSchema = try Schema(instance: "{\"type\": \"object\"}")
      let containerSchema = try Schema(
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
      catalogs = catalogList.map { dict in
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
    } else {
      var catalogPaths = testCase["catalogPaths"] as? [String] ?? []
      if let catalogPath = testCase["catalogPath"] as? String {
        catalogPaths.append(catalogPath)
      }
      if !catalogPaths.isEmpty {
        catalogs = try catalogPaths.map { path in
          ConformanceTestHelper.buildCatalog(
            catalogSchema: try ConformanceTestHelper.loadRepositoryJSON(path: path),
            commonTypes: commonTypes,
            protocolVersion: explicitVer
          )
        }
      }
    }

    if catalogs.isEmpty {
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
      let containerSchema = try Schema(
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
      catalogs = [
        Catalog(
          id: "basic",
          protocolVersion: pVer,
          components: [
            AnyComponentAPI(name: "Text", schema: textSchema),
            AnyComponentAPI(name: "Container", schema: containerSchema),
            AnyComponentAPI(name: "Column", schema: containerSchema),
          ]
        )
      ]
    }

    if testCase["catalogs"] == nil {
      let openSchema = try Schema(instance: "{\"type\": \"object\"}")
      let containerSchema = try Schema(
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
      for i in 0..<catalogs.count {
        var comps = catalogs[i].components
        comps["Button"] = AnyComponentAPI(name: "Button", schema: openSchema)
        comps["Label"] = AnyComponentAPI(name: "Label", schema: openSchema)
        if comps["Text"] == nil {
          comps["Text"] = AnyComponentAPI(name: "Text", schema: openSchema)
        }
        if comps["Column"] == nil {
          comps["Column"] = AnyComponentAPI(name: "Column", schema: containerSchema)
        }
        catalogs[i] = Catalog(
          id: catalogs[i].id,
          protocolVersion: catalogs[i].protocolVersion ?? pVer,
          components: comps.map { $0.value },
          functions: Array(catalogs[i].functions.values),
          themeSchema: catalogs[i].themeSchema
        )
      }
    }

    var rawMessages = extractRawMessages(from: testCase)
    if let steps = testCase["steps"] as? [[String: Any]] {
      for step in steps {
        rawMessages.append(contentsOf: extractRawMessages(from: step))
      }
    }
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

    let existingIDs = Set(catalogs.map { $0.id })
    for neededID in neededIDs where !existingIDs.contains(neededID) {
      if let base = catalogs.first {
        catalogs.append(
          Catalog(
            id: neededID,
            protocolVersion: base.protocolVersion ?? pVer,
            components: base.components.map { $0.value },
            functions: Array(base.functions.values),
            themeSchema: base.themeSchema
          )
        )
      }
    }

    return catalogs
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

  private func decodeMessages(from rawMessages: [[String: Any]]) throws -> [AgentToRendererMessage]
  {
    let parser = MessageParser()
    return try rawMessages.map { dict in
      let jsonVal = ConformanceTestHelper.toJSONValue(dict)
      let data = try JSONEncoder().encode(jsonVal)
      return try parser.decode(jsonData: data)
    }
  }

  private func runProcessMessagesCase(
    _ testCase: [String: Any],
    name: String,
    defaultVersion: String
  ) throws {
    let catalogs = try buildProcessorCatalogs(from: testCase, defaultVersion: defaultVersion)
    let strictMode = testCase["strictMode"] as? Bool ?? false
    let handler = ConformanceActionCaptureHandler()
    let processor = MessageProcessor(
      catalogs: catalogs,
      actionHandler: handler,
      validationConfig: strictMode ? .strict : .relaxed
    )

    let steps: [[String: Any]]
    if let stepList = testCase["steps"] as? [[String: Any]] {
      steps = stepList
    } else {
      steps = [testCase]
    }

    for step in steps {
      if let expectError = step["expectError"] as? [String: Any] {
        let payload = ConformanceTestHelper.toJSONValue(step["messages"] ?? [:])
        do {
          try processor.processMessages(payload)
          Issue.record("[\(name)] Expected error to be thrown for invalid message")
        } catch {
          if let category = expectError["category"] as? String {
            switch category {
            case "RecursionError":
              #expect(
                error is A2UIRecursionError, "[\(name)] Expected RecursionError, got \(error)")
            case "IntegrityError":
              #expect(
                error is A2UIIntegrityError || error is A2UIRecursionError,
                "[\(name)] Expected IntegrityError, got \(error)"
              )
            case "CatalogError":
              #expect(error is A2UICatalogError, "[\(name)] Expected CatalogError, got \(error)")
            case "ValidationError":
              #expect(
                error is A2UIValidationError, "[\(name)] Expected ValidationError, got \(error)")
            default:
              break
            }
          }
        }
        continue
      }

      let payload = ConformanceTestHelper.toJSONValue(step["messages"] ?? [:])
      try processor.processMessages(payload)
      #expect(
        handler.capturedErrors.isEmpty, "[\(name)] Unexpected errors: \(handler.capturedErrors)")

      let expectedDict = (step["expect"] as? [String: Any]) ?? [:]
      let expectedSurfaces =
        (expectedDict["surfaces"] as? [String: Any])
        ?? (step["expectedSurfaces"] as? [String: Any])
      try verifyExpectedSurfaces(expectedSurfaces, on: processor, name: name)
    }
  }

  private func verifyExpectedSurfaces(
    _ expectedSurfaces: [String: Any]?,
    on processor: MessageProcessor,
    name: String
  ) throws {

    if let expectedSurfaces {
      for (surfaceID, rawExpected) in expectedSurfaces {
        if rawExpected is NSNull {
          #expect(
            processor.surfaceGroupModel.surfacesMap[surfaceID] == nil,
            "[\(name)] Expected surface '\(surfaceID)' to be deleted"
          )
          continue
        }
        guard let expectedSurfaceDict = rawExpected as? [String: Any] else { continue }
        if expectedSurfaceDict["exists"] as? Bool == false {
          #expect(
            processor.surfaceGroupModel.surfacesMap[surfaceID] == nil,
            "[\(name)] Expected surface '\(surfaceID)' to be deleted"
          )
          continue
        }
        let surface = try #require(
          processor.surfaceGroupModel.surfacesMap[surfaceID],
          "[\(name)] Expected surface '\(surfaceID)' to exist"
        )
        if let expectedDataModel = expectedSurfaceDict["dataModel"] {
          #expect(
            surface.dataModel.data == ConformanceTestHelper.toJSONValue(expectedDataModel),
            "[\(name)] DataModel mismatch on surface '\(surfaceID)'"
          )
        }
        if let expectedComponents = expectedSurfaceDict["components"] {
          if let compDict = expectedComponents as? [String: Any] {
            #expect(
              surface.componentsModel.components.count == compDict.count,
              "[\(name)] Component count mismatch on surface '\(surfaceID)'"
            )
          } else if let compList = expectedComponents as? [Any] {
            #expect(
              surface.componentsModel.components.count == compList.count,
              "[\(name)] Component count mismatch on surface '\(surfaceID)'"
            )
          }
        }
        if let expectedTheme = expectedSurfaceDict["theme"] {
          let actualThemeValue: JSONValue =
            surface.theme.map { dict in
              var ordered = OrderedDictionary<String, JSONValue>()
              for (k, v) in dict {
                ordered[k] = v
              }
              return .object(ordered)
            } ?? .null
          #expect(
            actualThemeValue == ConformanceTestHelper.toJSONValue(expectedTheme),
            "[\(name)] Theme mismatch on surface '\(surfaceID)'"
          )
        }
        if let expectedSendDataModel = expectedSurfaceDict["sendDataModel"] as? Bool {
          #expect(
            surface.sendDataModel == expectedSendDataModel,
            "[\(name)] sendDataModel mismatch on surface '\(surfaceID)'"
          )
        }
      }
    }
  }

  private func runGetRendererDataModelCase(
    _ testCase: [String: Any],
    name: String,
    defaultVersion: String
  ) throws {
    let catalogs = try buildProcessorCatalogs(from: testCase, defaultVersion: defaultVersion)
    let processor = MessageProcessor(catalogs: catalogs)
    let rawMessages = extractRawMessages(from: testCase)
    let messages = try decodeMessages(from: rawMessages)
    processor.process(messages: messages)

    let actual = try processor.getRendererDataModel()
    let expectedDict =
      (testCase["expect"] as? [String: Any])
      ?? (testCase["expectedDataModel"] as? [String: Any])
    if let expectedSurfaces = expectedDict?["surfaces"] {
      #expect(
        actual?["surfaces"] == ConformanceTestHelper.toJSONValue(expectedSurfaces),
        "[\(name)] Expected renderer data model \(expectedSurfaces), got \(String(describing: actual))"
      )
    } else {
      #expect(
        actual == nil,
        "[\(name)] Expected nil renderer data model, got \(String(describing: actual))")
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
    let includeInline = args["includeInlineCatalogs"] as? Bool ?? false
    let versionStr = args["version"] as? String ?? "v0.9.1"
    let protocolVersion = A2UIProtocolVersion(rawValue: versionStr) ?? .v091
    let caps = try processor.getRendererCapabilities(
      options: MessageProcessor.CapabilitiesOptions(
        protocolVersion: protocolVersion,
        includeInlineCatalogs: includeInline
      )
    )
    let expectedDict =
      (testCase["expect"] as? [String: Any])
      ?? (testCase["expectedCapabilities"] as? [String: Any])
      ?? [:]
    let expectedVersion =
      (expectedDict[versionStr] as? [String: Any])
      ?? (expectedDict[protocolVersion.rawValue] as? [String: Any])
      ?? (expectedDict["v0.9"] as? [String: Any])
    if let expectedVersion {
      if let expectedIDs = expectedVersion["supportedCatalogIds"] {
        #expect(
          caps[protocolVersion.rawValue]?["supportedCatalogIds"]
            == ConformanceTestHelper.toJSONValue(expectedIDs),
          "[\(name)] Supported catalog IDs mismatch"
        )
      }
      if let expectedInline = expectedVersion["inlineCatalogs"] {
        #expect(
          caps[protocolVersion.rawValue]?["inlineCatalogs"]
            == ConformanceTestHelper.toJSONValue(expectedInline),
          "[\(name)] Inline catalogs mismatch"
        )
      }
    }
  }
}
