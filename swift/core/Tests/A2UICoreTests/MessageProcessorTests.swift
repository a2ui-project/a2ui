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
import OrderedJSON
import Testing

struct MessageParserTests {

  @Test func parseValidCreateSurface() throws {
    let parser = MessageParser()
    let json = """
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "default"
        }
      }
      """
    let msg = try parser.parse(jsonString: json)
    if case .createSurface(let create) = msg {
      #expect(create.surfaceID == "s1")
      #expect(create.catalogID == "default")
    } else {
      Issue.record("Expected .createSurface")
    }
  }

  @Test func parseValidUpdateComponents() throws {
    let parser = MessageParser()
    let json = """
      {
        "version": "v0.9.1",
        "updateComponents": {
          "surfaceId": "s1",
          "components": []
        }
      }
      """
    let msg = try parser.parse(jsonString: json)
    if case .updateComponents(let update) = msg {
      #expect(update.surfaceID == "s1")
    } else {
      Issue.record("Expected .updateComponents")
    }
  }

  @Test func parseInvalidJSONThrows() throws {
    let parser = MessageParser()
    #expect(throws: MessageParseError.self) {
      try parser.parse(jsonString: "not valid json")
    }
  }

  @Test func parseEmptyObjectThrows() throws {
    let parser = MessageParser()
    #expect(throws: MessageParseError.self) {
      try parser.parse(jsonString: "{}")
    }
  }

  @Test func decodeFromData() throws {
    let parser = MessageParser()
    let json = try #require(
      """
      {
        "version": "v0.9.1",
        "deleteSurface": {
          "surfaceId": "s1"
        }
      }
      """.data(using: .utf8)
    )
    let msg = try parser.decode(jsonData: json)
    if case .deleteSurface(let delete) = msg {
      #expect(delete.surfaceID == "s1")
    } else {
      Issue.record("Expected .deleteSurface")
    }
  }
}

@MainActor
struct MessageProcessorTests {

  // MARK: - Setup

  private let parser = MessageParser()

  private func parse(_ json: String) throws -> AgentToRendererMessage {
    try parser.parse(jsonString: json)
  }

  private func makeProcessor() throws -> (MessageProcessor, TestProcessorActionHandler) {
    let handler = TestProcessorActionHandler()
    let catalog = try makeMessageProcessorTestCatalog()
    let processor = MessageProcessor(
      catalogs: [catalog],
      actionHandler: handler
    )
    return (processor, handler)
  }

  // MARK: - Create Surface

  @Test func processCreateSurfaceCreatesSurface() throws {
    let (processor, _) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """))
    let surface = try #require(processor.surfaceGroupModel.surfacesMap["s1"])
    #expect(surface.surfaceID == "s1")
    #expect(surface.defaultCatalogID == "default")
    #expect(surface.componentsModel.components.isEmpty)
  }

  @Test func processCreateSurfaceWithUnknownCatalogDispatchesError() throws {
    let (processor, handler) = try makeProcessor()
    let message = try parse(
      """
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "unknown"
        }
      }
      """)
    processor.process(message: message)
    #expect(processor.surfaceGroupModel.surfacesMap["s1"] == nil)
    #expect(handler.capturedErrors.count == 1)
  }

  @Test func processCreateSurfaceWithValidThemeAgainstThemeSchemaPasses() throws {
    let themeSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "primaryColor": { "type": "string" },
            "fontSize": { "type": "number" }
          },
          "required": ["primaryColor"]
        }
        """
    )
    let catalog = AnyCatalog(
      id: "themed-cat",
      components: [],
      themeSchema: themeSchema
    )
    let handler = TestProcessorActionHandler()
    let processor = MessageProcessor(catalogs: [catalog], actionHandler: handler)

    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "themed-cat",
            "theme": {
              "primaryColor": "#00BFFF",
              "fontSize": 14
            }
          }
        }
        """))

    let surface = try #require(processor.surfaceGroupModel.surfacesMap["s1"])
    #expect(surface.surfaceID == "s1")
    #expect(surface.theme?["primaryColor"]?.stringValue == "#00BFFF")
    #expect(surface.theme?["fontSize"]?.doubleValue == 14.0)
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func processCreateSurfaceWithInvalidThemeAgainstThemeSchemaDispatchesError() throws {
    let themeSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "primaryColor": { "type": "string" }
          },
          "required": ["primaryColor"]
        }
        """
    )
    let catalog = AnyCatalog(
      id: "themed-cat",
      components: [],
      themeSchema: themeSchema
    )
    let handler = TestProcessorActionHandler()
    let processor = MessageProcessor(catalogs: [catalog], actionHandler: handler)

    let message = try parse(
      """
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "themed-cat",
          "theme": {
            "primaryColor": 123
          }
        }
      }
      """)

    processor.process(message: message)

    #expect(processor.surfaceGroupModel.surfacesMap["s1"] == nil)
    #expect(handler.capturedErrors.count == 1)
    if case .validationFailed(let error) = handler.capturedErrors.first {
      #expect(error.surfaceID == "s1")
      #expect(error.path == "/theme/primaryColor")
    } else {
      Issue.record("Expected .validationFailed captured error")
    }
  }

  @Test func processCreateSurfaceWithValidThemeWhenThemeSchemaIsNilPasses() throws {
    let (processor, handler) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default",
            "theme": {
              "color": "blue"
            }
          }
        }
        """))
    let surface = try #require(processor.surfaceGroupModel.surfacesMap["s1"])
    #expect(surface.surfaceID == "s1")
    #expect(surface.theme?["color"]?.stringValue == "blue")
    #expect(handler.capturedErrors.isEmpty)
  }

  // MARK: - Update Components

  @Test func processUpdateComponents() throws {
    let (processor, _) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """))
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "updateComponents": {
            "surfaceId": "s1",
            "components": [
              {
                "id": "root",
                "component": "text",
                "text": "Hello"
              }
            ]
          }
        }
        """))
    let vm = try #require(processor.surfaceGroupModel.surfacesMap["s1"])
    let root = try #require(vm.componentsModel.components["root"])
    #expect(root.id == "root")
    #expect(root.type == "text")
    #expect(root.properties["text"]?.stringValue == "Hello")
  }

  @Test func processUpdateComponentsValidBatch() throws {
    let (processor, handler) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """))
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "updateComponents": {
            "surfaceId": "s1",
            "components": [
              {
                "id": "c1",
                "component": "text",
                "text": "First"
              },
              {
                "id": "c2",
                "component": "text",
                "text": "Second"
              }
            ]
          }
        }
        """))
    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    let components = vm?.componentsModel.components
    #expect(components?.count == 2)
    #expect(components?["c1"]?.properties["text"]?.stringValue == "First")
    #expect(components?["c2"]?.properties["text"]?.stringValue == "Second")
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func processUpdateComponentsAtomicFailure() throws {
    let (processor, handler) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """))
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "updateComponents": {
            "surfaceId": "s1",
            "components": [
              {
                "id": "c1",
                "component": "text",
                "text": "First"
              },
              {
                "id": "c2",
                "component": "text",
                "text": 12345
              }
            ]
          }
        }
        """))
    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    let components = vm?.componentsModel.components
    #expect(components?.isEmpty == true)
    #expect(components?["c1"] == nil)
    #expect(handler.capturedErrors.count == 1)
  }

  @Test func processUpdateComponentsForMissingSurfaceDispatchesError() throws {
    let (processor, handler) = try makeProcessor()
    let message = try parse(
      """
      {
        "version": "v0.9.1",
        "updateComponents": {
          "surfaceId": "missing",
          "components": []
        }
      }
      """)
    processor.process(message: message)
    #expect(handler.capturedErrors.count == 1)
  }

  // MARK: - Update Data Model

  @Test func processUpdateDataModel() throws {
    let (processor, _) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """))
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "updateDataModel": {
            "surfaceId": "s1",
            "path": "/user/name",
            "value": "Alice"
          }
        }
        """))
    let vm = processor.surfaceGroupModel.surfacesMap["s1"]
    #expect(vm?.dataModel.get("/user/name")?.stringValue == "Alice")
  }

  // MARK: - Delete Surface

  @Test func processDeleteSurface() throws {
    let (processor, _) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """))
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "deleteSurface": {
            "surfaceId": "s1"
          }
        }
        """))
    #expect(processor.surfaceGroupModel.surfacesMap["s1"] == nil)
  }

  @Test func processDeleteSurfaceForMissingSurfaceDispatchesError() throws {
    let (processor, handler) = try makeProcessor()
    let message = try parse(
      """
      {
        "version": "v0.9.1",
        "deleteSurface": {
          "surfaceId": "missing"
        }
      }
      """)
    processor.process(message: message)
    #expect(handler.capturedErrors.count == 1)
  }

  // MARK: - Error Handling & Multiple Messages

  @Test func processDuplicateSurfaceDispatchesErrorToHandler() throws {
    let (processor, handler) = try makeProcessor()
    let message = try parse(
      """
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "default"
        }
      }
      """)
    processor.process(message: message)
    processor.process(message: message)
    #expect(handler.capturedErrors.count == 1)
  }

  @Test func processMessagesDispatchesErrorsAndContinues() throws {
    let (processor, handler) = try makeProcessor()
    let msg1 = try parse(
      """
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "unknown"
        }
      }
      """)
    let msg2 = try parse(
      """
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s2",
          "catalogId": "default"
        }
      }
      """)
    processor.process(messages: [msg1, msg2])
    #expect(handler.capturedErrors.count == 1)
    let s2 = try #require(processor.surfaceGroupModel.surfacesMap["s2"])
    #expect(s2.surfaceID == "s2")
    #expect(processor.surfaceGroupModel.surfacesMap["s1"] == nil)
  }

  // MARK: - Surface Management

  @Test func groupAllSurfacesReturnsAllActiveSurfaces() throws {
    let (processor, _) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """))
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s2",
            "catalogId": "default"
          }
        }
        """))
    let surfaces = processor.surfaceGroupModel.surfacesMap
    #expect(surfaces.count == 2)
    #expect(surfaces["s1"]?.surfaceID == "s1")
    #expect(surfaces["s2"]?.surfaceID == "s2")
  }

  @Test func groupSurfaceReturnsNilForUnknownID() throws {
    let (processor, _) = try makeProcessor()
    #expect(processor.surfaceGroupModel.surfacesMap["unknown"] == nil)
  }

  // MARK: - sendDataModel

  @Test func processCreateSurfaceWithSendDataModelSetsFlag() throws {
    let (processor, _) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default",
            "sendDataModel": true
          }
        }
        """))
    let dataModel = try #require(try processor.getRendererDataModel())
    #expect(dataModel["version"]?.stringValue == "v0.9.1")
    #expect(dataModel["surfaces"]?["s1"]?.objectValue != nil)
  }

  @Test func processCreateSurfaceWithoutSendDataModelDoesNotSetFlag() throws {
    let (processor, _) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """))
    #expect(try processor.getRendererDataModel() == nil)
  }

  @Test func getRendererDataModelMultiVersionRequiresExplicitVersion() throws {
    let (processor, _) = try makeProcessor()
    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default",
            "sendDataModel": true
          }
        }
        """))
    processor.process(
      message: try parse(
        """
        {
          "version": "v1.0",
          "createSurface": {
            "surfaceId": "s2",
            "catalogId": "default",
            "sendDataModel": true
          }
        }
        """))

    #expect(throws: A2UIValidationError.self) {
      _ = try processor.getRendererDataModel()
    }

    let v091Model = try #require(try processor.getRendererDataModel(version: .v091))
    #expect(v091Model["version"]?.stringValue == "v0.9.1")
    #expect(v091Model["surfaces"]?["s1"] != nil)
    #expect(v091Model["surfaces"]?["s2"] == nil)

    let v10Model = try #require(try processor.getRendererDataModel(version: .v10))
    #expect(v10Model["version"]?.stringValue == "v1.0")
    #expect(v10Model["surfaces"]?["s1"] == nil)
    #expect(v10Model["surfaces"]?["s2"] != nil)
  }

  @Test func incompatibleCatalogVersionRejectedOnSurfaceCreation() throws {
    let v09Catalog = Catalog(
      id: "cat-v09",
      protocolVersion: .v091,
      components: [
        AnyComponentAPI(name: "Text", schema: try Schema(instance: "{\"type\": \"object\"}"))
      ]
    )
    let handler = TestProcessorActionHandler()
    let processor = MessageProcessor(catalogs: [v09Catalog], actionHandler: handler)
    processor.process(
      message: try parse(
        """
        {
          "version": "v1.0",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "cat-v09"
          }
        }
        """))
    #expect(processor.surfaceGroupModel["s1"] == nil)
    #expect(handler.capturedErrors.count == 1)
  }

  // MARK: - getRendererCapabilities

  @Test func getRendererCapabilitiesReturnsSupportedCatalogIDs() throws {
    let (processor, _) = try makeProcessor()
    let caps = try processor.getRendererCapabilities(
      options: MessageProcessor.CapabilitiesOptions(protocolVersion: .v091)
    )
    #expect(caps["v0.9.1"]?["supportedCatalogIds"]?.arrayValue?.first?.stringValue == "default")
  }

  @Test func getRendererCapabilitiesThrowsForEmptyVersions() throws {
    let (processor, _) = try makeProcessor()
    #expect(throws: A2UIValidationError.self) {
      _ = try processor.getRendererCapabilities(
        options: MessageProcessor.CapabilitiesOptions(versions: [])
      )
    }
  }

  @Test func getRendererCapabilitiesIncludesInlineCatalogs() throws {
    let (processor, _) = try makeProcessor()
    let caps = try processor.getRendererCapabilities(
      options: MessageProcessor.CapabilitiesOptions(
        protocolVersion: .v091,
        includeInlineCatalogs: true
      )
    )
    let inlineCatalogs = caps["v0.9.1"]?["inlineCatalogs"]?.arrayValue
    #expect(inlineCatalogs?.count == 1)
    let firstCatalog = try #require(inlineCatalogs?.first)
    #expect(firstCatalog["catalogId"]?.stringValue == "default")
    let textComponent = try #require(firstCatalog["components"]?["text"])
    #expect(textComponent.objectValue != nil)
  }

  @Test func getRendererCapabilitiesTransformsRefDescriptions() throws {
    let customSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "title": {
              "type": "string",
              "description": "REF:common_types.json#/$defs/DynamicString|The title"
            }
          }
        }
        """
    )
    let catalog = Catalog(
      id: "cat-ref",
      components: [AnyComponentAPI(name: "Custom", schema: customSchema)]
    )
    let processor = MessageProcessor(catalogs: [catalog])
    let caps = try processor.getRendererCapabilities(
      options: MessageProcessor.CapabilitiesOptions(
        protocolVersion: .v091,
        includeInlineCatalogs: true
      )
    )

    let inlineCatalog = caps["v0.9.1"]?["inlineCatalogs"]?.arrayValue?.first
    let customComponent = inlineCatalog?["components"]?["Custom"]
    let titleProp = customComponent?["allOf/1/properties/title"]

    #expect(titleProp?["$ref"]?.stringValue == "common_types.json#/$defs/DynamicString")
    #expect(titleProp?["description"]?.stringValue == "The title")
    #expect(titleProp?["type"] == nil)
  }

  @Test func getRendererCapabilitiesGeneratesFunctionsAndThemeSchema() throws {
    let funcSchema = try Schema(
      instance: """
        {
          "type": "object",
          "description": "Adds two numbers",
          "properties": {
            "a": { "type": "number" },
            "b": { "type": "number" }
          }
        }
        """
    )

    let addFunc = TestAddFunction(schema: funcSchema)

    let themeSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "primaryColor": {
              "type": "string",
              "description": "REF:common_types.json#/$defs/Color|The main color"
            }
          }
        }
        """
    )

    let textSchema = try Schema(instance: "{\"type\": \"object\"}")
    let catalog = Catalog(
      id: "cat-full",
      components: [AnyComponentAPI(name: "Button", schema: textSchema)],
      functions: [addFunc],
      themeSchema: themeSchema
    )
    let processor = MessageProcessor(catalogs: [catalog])
    let caps = try processor.getRendererCapabilities(
      options: MessageProcessor.CapabilitiesOptions(
        versions: [.v091, .v10],
        includeInlineCatalogs: true
      )
    )

    let inlineCatalogV091 = caps["v0.9.1"]?["inlineCatalogs"]?.arrayValue?.first
    #expect(inlineCatalogV091?["catalogId"]?.stringValue == "cat-full")

    let functionsV091 = inlineCatalogV091?["functions"]?.arrayValue
    #expect(functionsV091?.count == 1)
    #expect(functionsV091?.first?["name"]?.stringValue == "add")
    #expect(functionsV091?.first?["returnType"]?.stringValue == "number")
    #expect(functionsV091?.first?["description"]?.stringValue == "Adds two numbers")

    let theme = inlineCatalogV091?["theme"]
    #expect(theme?["primaryColor"]?["$ref"]?.stringValue == "common_types.json#/$defs/Color")
    #expect(theme?["primaryColor"]?["description"]?.stringValue == "The main color")

    let inlineCatalogV10 = caps["v1.0"]?["inlineCatalogs"]?.arrayValue?.first
    #expect(inlineCatalogV10?["catalogId"]?.stringValue == "cat-full")
    let functionsV10 = inlineCatalogV10?["functions"]?.objectValue
    #expect(functionsV10?["add"]?["returnType"]?.stringValue == "number")
    #expect(functionsV10?["add"]?["description"]?.stringValue == "Adds two numbers")
  }

  // MARK: - RPC DataContext, Outbound Transport & Lifecycle

  @Test func callRendererFunctionResolvesArgsAgainstActiveSurfaceDataModel() async throws {
    let echoSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "text": { "type": "string" }
          }
        }
        """
    )
    let echoFunc = TestEchoFunction(schema: echoSchema)
    let catalog = Catalog(
      id: "default",
      protocolVersion: .v10,
      components: [
        AnyComponentAPI(name: "Text", schema: try Schema(instance: "{\"type\": \"object\"}"))
      ],
      functions: [echoFunc]
    )
    let processor = MessageProcessor(catalogs: [catalog])
    var capturedOutbound: [RendererToAgentMessage] = []
    processor.outboundListener = { msg in
      MainActor.assumeIsolated {
        capturedOutbound.append(msg)
      }
    }

    processor.process(
      message: try parse(
        """
        {
          "version": "v1.0",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """))
    processor.process(
      message: try parse(
        """
        {
          "version": "v1.0",
          "updateDataModel": {
            "surfaceId": "s1",
            "path": "/user/name",
            "value": "Alice"
          }
        }
        """))
    processor.process(
      message: try parse(
        """
        {
          "version": "v1.0",
          "callRendererFunction": {
            "functionCallId": "rpc-1",
            "callFunction": {
              "call": "echo",
              "catalogId": "default",
              "args": {
                "text": { "path": "/user/name" }
              }
            }
          }
        }
        """))

    try await Task.sleep(nanoseconds: 20_000_000)
    #expect(capturedOutbound.count == 1)
    if case .rendererFunctionResponse(let resp) = capturedOutbound.first {
      #expect(resp.functionCallID == "rpc-1")
      #expect(resp.value == .string("Alice"))
    } else {
      Issue.record("Expected .rendererFunctionResponse")
    }
  }

  @Test func outboundListenerReceivesSurfaceErrorsAndDisposeClearsSurfaces() throws {
    let (processor, handler) = try makeProcessor()
    var capturedOutbound: [RendererToAgentMessage] = []
    processor.outboundListener = { msg in
      MainActor.assumeIsolated {
        capturedOutbound.append(msg)
      }
    }

    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "unknown-catalog"
          }
        }
        """))

    #expect(handler.capturedErrors.count == 1)
    #expect(capturedOutbound.count == 1)
    if case .error = capturedOutbound.first {
      // Expected .error forwarded to outboundListener
    } else {
      Issue.record("Expected .error forwarded to outboundListener")
    }

    processor.process(
      message: try parse(
        """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s2",
            "catalogId": "default"
          }
        }
        """))
    #expect(processor.surfaceGroupModel["s2"] != nil)
    processor.dispose()
    #expect(processor.surfaceGroupModel["s2"] == nil)
  }
}

private struct TestAddFunction: FunctionImplementation {
  let api: FunctionAPI

  init(schema: Schema) {
    self.api = FunctionAPI(name: "add", returnType: .number, schema: schema)
  }

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    .null
  }
}

private struct TestEchoFunction: FunctionImplementation {
  let api: FunctionAPI

  init(schema: Schema) {
    self.api = FunctionAPI(
      name: "echo",
      returnType: .string,
      schema: schema,
      allowedCallers: .rendererOrAgent
    )
  }

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    arguments["text"] ?? .null
  }
}
