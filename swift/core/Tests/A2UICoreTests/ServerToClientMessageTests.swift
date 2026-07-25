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
import Foundation
import OrderedJSON
import Testing

struct ServerToClientMessageTests {

  // MARK: - Decoding

  @Test func decodeCreateSurface() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "default"
        }
      }
      """.data(using: .utf8))
    let msg = try JSONDecoder().decode(
      ServerToClientMessage.self, from: json
    )
    if case .createSurface(let create) = msg {
      #expect(create.surfaceID == "s1")
      #expect(create.catalogID == "default")
      #expect(create.shouldSendDataModel == false)
    } else {
      Issue.record("Expected .createSurface")
    }
  }

  @Test func decodeCreateSurfaceWithSendDataModel() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "createSurface": {
          "surfaceId": "s1",
          "catalogId": "default",
          "sendDataModel": true
        }
      }
      """.data(using: .utf8))
    let msg = try JSONDecoder().decode(
      ServerToClientMessage.self, from: json
    )
    if case .createSurface(let create) = msg {
      #expect(create.shouldSendDataModel == true)
    }
  }

  @Test func decodeUpdateComponents() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "updateComponents": {
          "surfaceId": "s1",
          "components": [
            {"id": "btn1", "type": "button"}
          ]
        }
      }
      """.data(using: .utf8))
    let msg = try JSONDecoder().decode(
      ServerToClientMessage.self, from: json
    )
    if case .updateComponents(let update) = msg {
      #expect(update.surfaceID == "s1")
      #expect(update.components.count == 1)
      #expect(update.components[0]["id"]?.stringValue == "btn1")
    } else {
      Issue.record("Expected .updateComponents")
    }
  }

  @Test func decodeUpdateDataModel() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "updateDataModel": {
          "surfaceId": "s1",
          "path": "/user/name",
          "value": "Alice"
        }
      }
      """.data(using: .utf8))
    let msg = try JSONDecoder().decode(
      ServerToClientMessage.self, from: json
    )
    if case .updateDataModel(let update) = msg {
      #expect(update.surfaceID == "s1")
      #expect(update.path == "/user/name")
      #expect(update.value?.stringValue == "Alice")
    } else {
      Issue.record("Expected .updateDataModel")
    }
  }

  @Test func decodeUpdateDataModelDefaultsToRootPath() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "updateDataModel": {
          "surfaceId": "s1",
          "value": {"name": "Alice"}
        }
      }
      """.data(using: .utf8))
    let msg = try JSONDecoder().decode(
      ServerToClientMessage.self, from: json
    )
    if case .updateDataModel(let update) = msg {
      #expect(update.path == "/")
    }
  }

  @Test func decodeDeleteSurface() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "deleteSurface": {
          "surfaceId": "s1"
        }
      }
      """.data(using: .utf8))
    let msg = try JSONDecoder().decode(
      ServerToClientMessage.self, from: json
    )
    if case .deleteSurface(let delete) = msg {
      #expect(delete.surfaceID == "s1")
    } else {
      Issue.record("Expected .deleteSurface")
    }
  }

  @Test func decodeRejectsEmptyMessage() throws {
    let json = try #require("{}".data(using: .utf8))
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(ServerToClientMessage.self, from: json)
    }
  }

  @Test func decodeRejectsMissingVersion() throws {
    let json = try #require(
      """
      {"createSurface": {"surfaceId": "s1", "catalogId": "default"}}
      """.data(using: .utf8)
    )
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(ServerToClientMessage.self, from: json)
    }
  }

  @Test func decodeRejectsUnsupportedVersion() throws {
    let json = try #require("""
      {
        "version": "v2.0",
        "createSurface": {"surfaceId": "s1", "catalogId": "default"}
      }
      """.data(using: .utf8))
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(ServerToClientMessage.self, from: json)
    }
  }

  @Test func decodeAcceptsVersion09() throws {
    let json = try #require("""
      {
        "version": "v0.9",
        "createSurface": {"surfaceId": "s1", "catalogId": "default"}
      }
      """.data(using: .utf8))
    let msg = try JSONDecoder().decode(
      ServerToClientMessage.self, from: json
    )
    if case .createSurface(let create) = msg {
      #expect(create.surfaceID == "s1")
    }
  }

  // MARK: - Encoding Round-Trip

  @Test func encodeDecodeRoundTripCreateSurface() throws {
    let original = ServerToClientMessage.createSurface(
      CreateSurfaceMessage(
        surfaceID: "s1",
        catalogID: "default",
        theme: ["primary": "blue"],
        shouldSendDataModel: true
      )
    )
    let data = try JSONEncoder().encode(original)
    let decoded = try JSONDecoder().decode(
      ServerToClientMessage.self, from: data
    )
    #expect(decoded == original)
  }

  @Test func encodeDecodeRoundTripUpdateComponents() throws {
    let original = ServerToClientMessage.updateComponents(
      UpdateComponentsMessage(
        surfaceID: "s1",
        components: [
          ["id": "btn1", "type": "button"],
          ["id": "txt1", "type": "text"],
        ]
      )
    )
    let data = try JSONEncoder().encode(original)
    let decoded = try JSONDecoder().decode(
      ServerToClientMessage.self, from: data
    )
    #expect(decoded == original)
  }

  @Test func encodeDecodeRoundTripDeleteSurface() throws {
    let original = ServerToClientMessage.deleteSurface(
      DeleteSurfaceMessage(surfaceID: "s1")
    )
    let data = try JSONEncoder().encode(original)
    let decoded = try JSONDecoder().decode(
      ServerToClientMessage.self, from: data
    )
    #expect(decoded == original)
  }

  @Test func encodeAlwaysIncludesVersionV091() throws {
    let original = ServerToClientMessage.deleteSurface(
      DeleteSurfaceMessage(surfaceID: "s1")
    )
    let data = try JSONEncoder().encode(original)
    let json = try #require(String(data: data, encoding: .utf8))
    #expect(json.contains("\"version\":\"v0.9.1\""))
  }
}
