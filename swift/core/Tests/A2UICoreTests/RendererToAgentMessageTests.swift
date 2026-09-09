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

struct RendererToAgentMessageTests {

  // MARK: - Decoding

  @Test func decodeValidAction() throws {
    let json = try #require(
      """
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
      RendererToAgentMessage.self, from: json
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
    let json = try #require(
      """
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
      RendererToAgentMessage.self, from: json
    )
    if case .action(let action) = message {
      #expect(action.name == "click")
      #expect(action.context.isEmpty)
    } else {
      Issue.record("Expected .action message")
    }
  }

  @Test func decodeValidError() throws {
    let json = try #require(
      """
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
      RendererToAgentMessage.self, from: json
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
      try JSONDecoder().decode(RendererToAgentMessage.self, from: json)
    }
  }

  @Test func decodeRejectsMissingActionAndError() throws {
    let json = try #require(
      "{\"version\": \"v0.9.1\"}".data(using: .utf8)
    )
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(RendererToAgentMessage.self, from: json)
    }
  }

  @Test func decodeRejectsBothActionAndError() throws {
    let json = try #require(
      """
      {
        "version": "v0.9.1",
        "action": {
          "name": "submit",
          "surfaceId": "main",
          "sourceComponentId": "btn_submit",
          "timestamp": "2023-10-27T10:00:00Z",
          "context": {}
        },
        "error": {
          "code": "VALIDATION_FAILED",
          "surfaceId": "main",
          "path": "/components/0",
          "message": "Invalid input"
        }
      }
      """.data(using: .utf8))
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(RendererToAgentMessage.self, from: json)
    }
  }

  @Test func decodeRejectsActionMissingRequiredField() throws {
    let json = try #require(
      """
      {
        "version": "v0.9.1",
        "action": {
          "name": "submit",
          "surfaceId": "main"
        }
      }
      """.data(using: .utf8))
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(RendererToAgentMessage.self, from: json)
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
      RendererToAgentMessage.self, from: json
    )
    if case .action(let action) = message {
      #expect(action.name == "click")
    }
  }

  // MARK: - Encoding

  @Test func encodeActionRoundTrip() throws {
    let action = RendererAction(
      name: "submit",
      surfaceID: "main",
      sourceComponentID: "btn_submit",
      timestamp: "2023-10-27T10:00:00Z",
      context: ["foo": .string("bar")]
    )
    let message = RendererToAgentMessage.action(action)
    let data = try JSONEncoder().encode(message)
    let decoded = try JSONDecoder().decode(
      RendererToAgentMessage.self, from: data
    )
    #expect(decoded == message)
  }

  @Test func encodeValidationError() throws {
    for code in ValidationFailedError.Code.allCases {
      let error = RendererError.validationFailed(
        ValidationFailedError(
          code: code,
          surfaceID: "surface-1",
          path: "/components/0",
          message: "Validation message for \(code.rawValue)"
        )
      )
      let message = RendererToAgentMessage.error(error)
      let data = try JSONEncoder().encode(message)
      let decoded = try JSONDecoder().decode(
        RendererToAgentMessage.self, from: data
      )
      #expect(decoded == message)
    }
  }

  @Test func validationFailedErrorRejectsInvalidCode() throws {
    let invalidJSON = """
      {
        "code": "SOME_UNKNOWN_CODE",
        "surfaceId": "surface-1",
        "path": "/components/0",
        "message": "Invalid"
      }
      """.data(using: .utf8)!

    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(ValidationFailedError.self, from: invalidJSON)
    }

    // When decoded through RendererError, unknown codes fall back to generic error
    let rendererError = try JSONDecoder().decode(RendererError.self, from: invalidJSON)
    if case .generic(let generic) = rendererError {
      #expect(generic.code == "SOME_UNKNOWN_CODE")
      #expect(generic.surfaceID == "surface-1")
      #expect(generic.message == "Invalid")
    } else {
      Issue.record("Expected unknown code to decode as .generic")
    }
  }

  @Test func encodeAlwaysUsesV10Version() throws {
    let action = RendererAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:]
    )
    let message = RendererToAgentMessage.action(action)
    let data = try JSONEncoder().encode(message)
    let json = try #require(String(data: data, encoding: .utf8))
    #expect(json.contains("\"version\":\"v1.0\""))
  }

  @Test func encodeProducesFlatActionPayload() throws {
    let action = RendererAction(
      name: "submit",
      surfaceID: "main",
      sourceComponentID: "btn_submit",
      timestamp: "2023-10-27T10:00:00Z",
      context: ["foo": .string("bar")]
    )
    let message = RendererToAgentMessage.action(action)
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

  // MARK: - RendererAction Equality

  @Test func clientActionsEqualByAllFields() {
    let a = RendererAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: ["key": .string("val")]
    )
    let b = RendererAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: ["key": .string("val")]
    )
    #expect(a == b)
  }

  @Test func clientActionsNotEqualByDifferentName() {
    let a = RendererAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:]
    )
    let b = RendererAction(
      name: "submit",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:]
    )
    #expect(a != b)
  }

  // MARK: - v1.0 Tests

  @Test func decodeCallAgentFunction() throws {
    let json = try #require(
      """
      {
        "version": "v1.0",
        "callAgentFunction": {
          "surfaceId": "main",
          "functionCallId": "call_1",
          "callFunction": {
            "call": "fetchData",
            "catalogId": "custom",
            "args": {"query": "weather"}
          }
        }
      }
      """.data(using: .utf8))
    let message = try JSONDecoder().decode(RendererToAgentMessage.self, from: json)
    if case .callAgentFunction(let call) = message {
      #expect(call.surfaceID == "main")
      #expect(call.functionCallID == "call_1")
      #expect(call.callFunction.call == "fetchData")
      #expect(call.callFunction.catalogID == "custom")
    } else {
      Issue.record("Expected .callAgentFunction")
    }
  }

  @Test func decodeRendererFunctionResponse() throws {
    let json = try #require(
      """
      {
        "version": "v1.0",
        "rendererFunctionResponse": {
          "functionCallId": "call_2",
          "value": "ok"
        }
      }
      """.data(using: .utf8))
    let message = try JSONDecoder().decode(RendererToAgentMessage.self, from: json)
    if case .rendererFunctionResponse(let resp) = message {
      #expect(resp.functionCallID == "call_2")
      #expect(resp.value == .string("ok"))
    } else {
      Issue.record("Expected .rendererFunctionResponse")
    }
  }
}
