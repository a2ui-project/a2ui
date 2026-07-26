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

struct ClientToServerMessageTests {

  // MARK: - Decoding

  @Test func decodeValidAction() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "action": {
          "name": "submit",
          "surfaceId": "main",
          "sourceComponentId": "btn_submit",
          "timestamp": "2023-10-27T10:00:00Z",
          "context": {"foo": "bar"}
        }
      }
      """.data(using: .utf8))
    let message = try JSONDecoder().decode(
      ClientToServerMessage.self, from: json
    )
    if case .action(let action) = message {
      #expect(action.name == "submit")
      #expect(action.surfaceID == "main")
      #expect(action.sourceComponentID == "btn_submit")
      #expect(action.timestamp == "2023-10-27T10:00:00Z")
      #expect(action.context["foo"]?.stringValue == "bar")
    } else {
      Issue.record("Expected .action message")
    }
  }

  @Test func decodeValidActionWithEmptyContext() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "action": {
          "name": "click",
          "surfaceId": "main",
          "sourceComponentId": "btn",
          "timestamp": "2024-01-15T12:30:00Z",
          "context": {}
        }
      }
      """.data(using: .utf8))
    let message = try JSONDecoder().decode(
      ClientToServerMessage.self, from: json
    )
    if case .action(let action) = message {
      #expect(action.name == "click")
      #expect(action.context.isEmpty)
    } else {
      Issue.record("Expected .action message")
    }
  }

  @Test func decodeValidError() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "error": {
          "code": "VALIDATION_FAILED",
          "surfaceId": "surface-1",
          "path": "/components/0",
          "message": "Missing required property"
        }
      }
      """.data(using: .utf8))
    let message = try JSONDecoder().decode(
      ClientToServerMessage.self, from: json
    )
    if case .error(let error) = message {
      if case .validationFailed(let validation) = error {
        #expect(validation.surfaceID == "surface-1")
        #expect(validation.path == "/components/0")
        #expect(validation.message == "Missing required property")
      } else {
        Issue.record("Expected .validationFailed error")
      }
    } else {
      Issue.record("Expected .error message")
    }
  }

  @Test func decodeRejectsUnsupportedVersion() throws {
    let json = try #require(
      """
      {"version": "v2.0", "action": {"name": "x", "surfaceId": "s", \
      "sourceComponentId": "c", "timestamp": "t", "context": {}}}
      """.data(using: .utf8)
    )
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(ClientToServerMessage.self, from: json)
    }
  }

  @Test func decodeRejectsMissingActionAndError() throws {
    let json = try #require(
      "{\"version\": \"v0.9.1\"}".data(using: .utf8)
    )
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(ClientToServerMessage.self, from: json)
    }
  }

  @Test func decodeRejectsActionMissingRequiredField() throws {
    let json = try #require("""
      {
        "version": "v0.9.1",
        "action": {
          "name": "submit",
          "surfaceId": "main"
        }
      }
      """.data(using: .utf8))
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(ClientToServerMessage.self, from: json)
    }
  }

  @Test func decodeAcceptsVersion09() throws {
    let json = try #require(
      """
      {"version": "v0.9", "action": {"name": "click", "surfaceId": "s", \
      "sourceComponentId": "c", "timestamp": "t", "context": {}}}
      """.data(using: .utf8)
    )
    let message = try JSONDecoder().decode(
      ClientToServerMessage.self, from: json
    )
    if case .action(let action) = message {
      #expect(action.name == "click")
    }
  }

  // MARK: - Encoding

  @Test func encodeActionRoundTrip() throws {
    let action = ClientAction(
      name: "submit",
      surfaceID: "main",
      sourceComponentID: "btn_submit",
      timestamp: "2023-10-27T10:00:00Z",
      context: ["foo": .string("bar")]
    )
    let message = ClientToServerMessage.action(action)
    let data = try JSONEncoder().encode(message)
    let decoded = try JSONDecoder().decode(
      ClientToServerMessage.self, from: data
    )
    #expect(decoded == message)
  }

  @Test func encodeValidationError() throws {
    let error = ClientServerError.validationFailed(
      ValidationFailedError(
        surfaceID: "surface-1",
        path: "/components/0",
        message: "Missing required property"
      )
    )
    let message = ClientToServerMessage.error(error)
    let data = try JSONEncoder().encode(message)
    let decoded = try JSONDecoder().decode(
      ClientToServerMessage.self, from: data
    )
    #expect(decoded == message)
  }

  @Test func encodeAlwaysUsesV091Version() throws {
    let action = ClientAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:]
    )
    let message = ClientToServerMessage.action(action)
    let data = try JSONEncoder().encode(message)
    let json = try #require(String(data: data, encoding: .utf8))
    #expect(json.contains("\"version\":\"v0.9.1\""))
  }

  @Test func encodeProducesFlatActionPayload() throws {
    let action = ClientAction(
      name: "submit",
      surfaceID: "main",
      sourceComponentID: "btn_submit",
      timestamp: "2023-10-27T10:00:00Z",
      context: ["foo": .string("bar")]
    )
    let message = ClientToServerMessage.action(action)
    let data = try JSONEncoder().encode(message)
    let json = try #require(String(data: data, encoding: .utf8))
    // Verify flat keys are present
    #expect(json.contains("\"name\":\"submit\""))
    #expect(json.contains("\"surfaceId\":\"main\""))
    #expect(json.contains("\"sourceComponentId\":\"btn_submit\""))
    #expect(json.contains("\"timestamp\":\"2023-10-27T10:00:00Z\""))
    #expect(json.contains("\"context\""))
    // Verify nested event/call keys are absent
    #expect(!json.contains("\"event\""))
    #expect(!json.contains("\"call\""))
    #expect(!json.contains("\"args\""))
  }

  // MARK: - ClientAction Equality

  @Test func clientActionsEqualByAllFields() {
    let a = ClientAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: ["key": .string("val")]
    )
    let b = ClientAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: ["key": .string("val")]
    )
    #expect(a == b)
  }

  @Test func clientActionsNotEqualByDifferentName() {
    let a = ClientAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:]
    )
    let b = ClientAction(
      name: "submit",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:]
    )
    #expect(a != b)
  }
}
