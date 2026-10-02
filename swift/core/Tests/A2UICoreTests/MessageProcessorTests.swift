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

  @Test func parseInvalidJSONThrows() throws {
    let parser = MessageParser()
    #expect(throws: MessageParseError.self) {
      try parser.parse(jsonString: "not valid json")
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

  private func parse(_ json: String) throws -> ServerToClientMessage {
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

  // MARK: - Atomic Failure & Error Continuation

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
}
