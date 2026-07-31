// Copyright 2026 Google LLC
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

  @Test func parseInvalidJsonThrows() throws {
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

struct MessageProcessorTests {

  // MARK: - Setup

  private func makeProcessor() throws -> (MessageProcessor, TestProcessorActionHandler) {
    let handler = TestProcessorActionHandler()
    let catalog = try makeMessageProcessorTestCatalog()
    let processor = MessageProcessor(
      catalogs: ["default": catalog],
      actionHandler: handler
    )
    return (processor, handler)
  }

  // MARK: - Create Surface

  @Test func processCreateSurfaceCreatesSurface() throws {
    let (processor, _) = try makeProcessor()
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """)
    #expect(processor.surfaceGroupModel.surfaces["s1"] != nil)
  }

  @Test func processCreateSurfaceWithUnknownCatalogThrows() throws {
    let (processor, handler) = try makeProcessor()
    #expect(throws: GenericError.self) {
      try processor.process(
        line: """
          {
            "version": "v0.9.1",
            "createSurface": {
              "surfaceId": "s1",
              "catalogId": "unknown"
            }
          }
          """)
    }
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func processCreateSurfaceWithTheme() throws {
    let (processor, _) = try makeProcessor()
    try processor.process(
      line: """
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
        """)
    let surface = processor.surfaceGroupModel.surfaces["s1"]
    #expect(surface != nil)
    #expect(surface?.theme != nil)
  }

  // MARK: - Update Components

  @Test func processUpdateComponents() throws {
    let (processor, _) = try makeProcessor()
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """)
    try processor.process(
      line: """
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
        """)
    let vm = processor.surfaceGroupModel.surfaces["s1"]
    let components = vm?.componentsModel.components
    #expect(components?["root"] != nil)
  }

  @Test func processUpdateComponentsForMissingSurfaceThrows() throws {
    let (processor, handler) = try makeProcessor()
    #expect(throws: GenericError.self) {
      try processor.process(
        line: """
          {
            "version": "v0.9.1",
            "updateComponents": {
              "surfaceId": "missing",
              "components": []
            }
          }
          """)
    }
    #expect(handler.capturedErrors.isEmpty)
  }

  // MARK: - Update Data Model

  @Test func processUpdateDataModel() throws {
    let (processor, _) = try makeProcessor()
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """)
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "updateDataModel": {
            "surfaceId": "s1",
            "path": "/user/name",
            "value": "Alice"
          }
        }
        """)
    let vm = processor.surfaceGroupModel.surfaces["s1"]
    #expect(vm?.dataModel.get("/user/name")?.stringValue == "Alice")
  }

  // MARK: - Delete Surface

  @Test func processDeleteSurface() throws {
    let (processor, _) = try makeProcessor()
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """)
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "deleteSurface": {
            "surfaceId": "s1"
          }
        }
        """)
    #expect(processor.surfaceGroupModel.surfaces["s1"] == nil)
  }

  @Test func processDeleteSurfaceForMissingSurfaceThrows() throws {
    let (processor, handler) = try makeProcessor()
    #expect(throws: GenericError.self) {
      try processor.process(
        line: """
          {
            "version": "v0.9.1",
            "deleteSurface": {
              "surfaceId": "missing"
            }
          }
          """)
    }
    #expect(handler.capturedErrors.isEmpty)
  }

  // MARK: - Error Handling

  @Test func processInvalidJsonRoutesError() throws {
    let (processor, handler) = try makeProcessor()
    #expect(throws: MessageParseError.self) {
      try processor.process(line: "not valid json")
    }
    #expect(handler.capturedErrors.count == 1)
  }

  // MARK: - Surface Management

  @Test func groupAllSurfacesReturnsAllActiveSurfaces() throws {
    let (processor, _) = try makeProcessor()
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """)
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s2",
            "catalogId": "default"
          }
        }
        """)
    let surfaces = processor.surfaceGroupModel.surfaces
    #expect(surfaces.count == 2)
    #expect(surfaces["s1"] != nil)
    #expect(surfaces["s2"] != nil)
  }

  @Test func groupSurfaceReturnsNilForUnknownID() throws {
    let (processor, _) = try makeProcessor()
    #expect(processor.surfaceGroupModel.surfaces["unknown"] == nil)
  }

  // MARK: - sendDataModel

  @Test func processCreateSurfaceWithSendDataModelSetsFlag() throws {
    let (processor, _) = try makeProcessor()
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default",
            "sendDataModel": true
          }
        }
        """)
    let dataModel = processor.getClientDataModel()
    #expect(dataModel != nil)
  }

  @Test func processCreateSurfaceWithoutSendDataModelDoesNotSetFlag() throws {
    let (processor, _) = try makeProcessor()
    try processor.process(
      line: """
        {
          "version": "v0.9.1",
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """)
    #expect(processor.getClientDataModel() == nil)
  }
}
