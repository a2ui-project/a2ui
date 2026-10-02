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
import Foundation
import OrderedJSON
import Testing

struct ServerToClientMessageTests {

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
