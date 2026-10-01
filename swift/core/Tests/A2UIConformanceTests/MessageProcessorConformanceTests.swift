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
  var capturedErrors: [ClientServerError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: ClientServerError, from surfaceID: String) {
    capturedErrors.append(error)
  }
}

/// Runs the shared `conformance/core/message_processor_v0_9.yaml` suite.
@MainActor
struct MessageProcessorConformanceTests {
  @Test func messageProcessorV09Conformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/message_processor_v0_9.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/message_processor_v0_9.yaml should hold test cases")

    var executed = 0

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let action = testCase["action"] as? String ?? "process_messages"

      switch action {
      case "process_messages":
        try runProcessMessagesCase(testCase, name: name)
        executed += 1
      case "get_renderer_data_model":
        try runGetRendererDataModelCase(testCase, name: name)
        executed += 1
      case "get_renderer_capabilities":
        try runGetRendererCapabilitiesCase(testCase, name: name)
        executed += 1
      default:
        continue
      }
    }

    #expect(executed > 0, "no case of core/message_processor_v0_9.yaml was executed")
  }

  private func buildProcessorCatalogs(from testCase: [String: Any]) throws -> [AnyCatalog] {
    let pVer = (testCase["protocolVersion"] as? String) ?? "v0.9"
    let commonTypes = try? ConformanceTestHelper.commonTypesSchema(forProtocolVersion: pVer)

    var catalogs: [AnyCatalog] = []

    if let catalogList = testCase["catalogs"] as? [[String: Any]] {
      catalogs = catalogList.map { dict in
        ConformanceTestHelper.buildCatalog(
          catalogSchema: ConformanceTestHelper.toJSONValue(dict),
          commonTypes: commonTypes
        )
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
            commonTypes: commonTypes
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
                "items": { "type": "string" }
              }
            }
          }
          """
      )
      catalogs = [
        Catalog(
          id: "basic",
          components: [
            AnyComponentAPI(name: "Text", schema: textSchema),
            AnyComponentAPI(name: "Container", schema: containerSchema),
          ]
        )
      ]
    }

    let openSchema = try Schema(instance: "{\"type\": \"object\"}")
    for i in 0..<catalogs.count {
      var comps = catalogs[i].components
      comps["Button"] = AnyComponentAPI(name: "Button", schema: openSchema)
      comps["Label"] = AnyComponentAPI(name: "Label", schema: openSchema)
      if comps["Text"] == nil {
        comps["Text"] = AnyComponentAPI(name: "Text", schema: openSchema)
      }
      catalogs[i] = Catalog(
        id: catalogs[i].id,
        components: comps.map { $0.value },
        themeSchema: catalogs[i].themeSchema
      )
    }

    let rawMessages = extractRawMessages(from: testCase)
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
            components: base.components.map { $0.value },
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

  private func decodeMessages(from rawMessages: [[String: Any]]) throws -> [ServerToClientMessage] {
    let parser = MessageParser()
    return try rawMessages.map { dict in
      let jsonVal = ConformanceTestHelper.toJSONValue(dict)
      let data = try JSONEncoder().encode(jsonVal)
      return try parser.decode(jsonData: data)
    }
  }

  private func runProcessMessagesCase(_ testCase: [String: Any], name: String) throws {
    let catalogs = try buildProcessorCatalogs(from: testCase)
    let strictMode = testCase["strictMode"] as? Bool ?? false
    let handler = ConformanceActionCaptureHandler()
    let processor = MessageProcessor(
      catalogs: catalogs,
      actionHandler: handler,
      validationConfig: strictMode ? .strict : .relaxed
    )

    let rawMessages = extractRawMessages(from: testCase)
    if testCase["expectError"] != nil {
      do {
        let messages = try decodeMessages(from: rawMessages)
        processor.process(messages: messages)
        #expect(
          !handler.capturedErrors.isEmpty,
          "[\(name)] Expected error to be dispatched for invalid message"
        )
      } catch {
        // Parse-time envelope errors are thrown by MessageParser.decode
      }
      return
    }

    let messages = try decodeMessages(from: rawMessages)
    processor.process(messages: messages)
    #expect(handler.capturedErrors.isEmpty, "[\(name)] Unexpected errors: \(handler.capturedErrors)")

    let expectedDict = (testCase["expect"] as? [String: Any]) ?? [:]
    let expectedSurfaces =
      (expectedDict["surfaces"] as? [String: Any])
      ?? (testCase["expectedSurfaces"] as? [String: Any])

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

  private func runGetRendererDataModelCase(_ testCase: [String: Any], name: String) throws {
    let catalogs = try buildProcessorCatalogs(from: testCase)
    let processor = MessageProcessor(catalogs: catalogs)
    let rawMessages = extractRawMessages(from: testCase)
    let messages = try decodeMessages(from: rawMessages)
    processor.process(messages: messages)

    let actual = processor.getRendererDataModel()
    let expectedDict = (testCase["expect"] as? [String: Any]) ?? (testCase["expectedDataModel"] as? [String: Any])
    if let expectedSurfaces = expectedDict?["surfaces"] {
      #expect(
        actual == ConformanceTestHelper.toJSONValue(expectedSurfaces),
        "[\(name)] Expected renderer data model \(expectedSurfaces), got \(String(describing: actual))"
      )
    } else {
      #expect(actual == nil, "[\(name)] Expected nil renderer data model, got \(String(describing: actual))")
    }
  }

  private func runGetRendererCapabilitiesCase(_ testCase: [String: Any], name: String) throws {
    let catalogs = try buildProcessorCatalogs(from: testCase)
    let processor = MessageProcessor(catalogs: catalogs)
    let args = testCase["args"] as? [String: Any] ?? [:]
    let includeInline = args["includeInlineCatalogs"] as? Bool ?? false
    let version = args["version"] as? String ?? "v0.9"
    let caps = processor.getRendererCapabilities(
      options: MessageProcessor.CapabilitiesOptions(
        includeInlineCatalogs: includeInline,
        version: version
      )
    )
    let expectedDict =
      (testCase["expect"] as? [String: Any])
      ?? (testCase["expectedCapabilities"] as? [String: Any])
      ?? [:]
    let expectedVersion =
      (expectedDict[version] as? [String: Any])
      ?? (expectedDict["v0.9"] as? [String: Any])
    if let expectedVersion {
      if let expectedIDs = expectedVersion["supportedCatalogIds"] {
        #expect(
          caps[version]?["supportedCatalogIds"] == ConformanceTestHelper.toJSONValue(expectedIDs),
          "[\(name)] Supported catalog IDs mismatch"
        )
      }
      if let expectedInline = expectedVersion["inlineCatalogs"] {
        #expect(
          caps[version]?["inlineCatalogs"] == ConformanceTestHelper.toJSONValue(expectedInline),
          "[\(name)] Inline catalogs mismatch"
        )
      }
    }
  }
}
