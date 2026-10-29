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

  private func makeVersionedDecoder(_ version: A2UIProtocolVersion = .v10) -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.userInfo[.a2uiProtocolVersion] = version
    return decoder
  }

  @Test func encodeActionRoundTrip() throws {
    let action = RendererAction(
      name: "submit",
      surfaceID: "main",
      sourceComponentID: "btn_submit",
      timestamp: "2023-10-27T10:00:00Z",
      context: ["foo": .string("bar")],
      version: .v10
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
          message: "Validation message for \(code.rawValue)",
          version: .v10
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
    let invalidJSON = try #require(
      """
      {
        "code": "SOME_UNKNOWN_CODE",
        "surfaceId": "surface-1",
        "path": "/components/0",
        "message": "Invalid"
      }
      """.data(using: .utf8)
    )

    let decoder = makeVersionedDecoder(.v10)
    #expect(throws: DecodingError.self) {
      try decoder.decode(ValidationFailedError.self, from: invalidJSON)
    }

    // When decoded through RendererError, unknown codes fall back to generic error
    let rendererError = try decoder.decode(RendererError.self, from: invalidJSON)
    if case .generic(let generic) = rendererError {
      #expect(generic.code == "SOME_UNKNOWN_CODE")
      #expect(generic.surfaceID == "surface-1")
      #expect(generic.message == "Invalid")
    } else {
      Issue.record("Expected unknown code to decode as .generic")
    }
  }

  @Test func encodeIncludesConfiguredVersion() throws {
    let action = RendererAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:],
      version: .v10
    )
    let message = RendererToAgentMessage.action(action)
    let data = try JSONEncoder().encode(message)
    let json = try #require(String(data: data, encoding: .utf8))
    #expect(json.contains("\"version\":\"1.0\""))
  }

  @Test func encodeProducesFlatActionPayload() throws {
    let action = RendererAction(
      name: "submit",
      surfaceID: "main",
      sourceComponentID: "btn_submit",
      timestamp: "2023-10-27T10:00:00Z",
      context: ["foo": .string("bar")],
      version: .v10
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
      context: ["key": .string("val")],
      version: .v10
    )
    let b = RendererAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: ["key": .string("val")],
      version: .v10
    )
    #expect(a == b)
  }

  @Test func clientActionsNotEqualByDifferentName() {
    let a = RendererAction(
      name: "click",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:],
      version: .v10
    )
    let b = RendererAction(
      name: "submit",
      surfaceID: "main",
      sourceComponentID: "btn",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:],
      version: .v10
    )
    #expect(a != b)
  }

  // MARK: - v1.0 Tests

  @Test func decodeCallAgentFunction() throws {
    let json = try #require(
      """
      {
        "version": "1.0",
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

  @Test func encodeCallAgentFunctionUsesAtCallWithoutReturnType() throws {
    let message = RendererToAgentMessage.callAgentFunction(
      CallAgentFunctionMessage(
        surfaceID: "main",
        functionCallID: "call_1",
        callFunction: CallFunctionPayload(
          call: "fetchData",
          catalogID: "custom",
          args: ["query": .string("weather")]
        ),
        version: .v10
      )
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys

    let json = try #require(String(data: try encoder.encode(message), encoding: .utf8))

    #expect(
      json == """
        {"callAgentFunction":{"callFunction":{"@call":"fetchData","args":{"query":"weather"},\
        "catalogId":"custom"},"functionCallId":"call_1","surfaceId":"main"},"version":"1.0"}
        """
    )
    let decoded = try JSONDecoder().decode(RendererToAgentMessage.self, from: Data(json.utf8))
    guard case .callAgentFunction(let call) = decoded else {
      Issue.record("Expected .callAgentFunction")
      return
    }
    #expect(call.callFunction.call == "fetchData")
  }

  @Test func decodeRendererFunctionResponse() throws {
    let json = try #require(
      """
      {
        "version": "1.0",
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

  @Test func genericErrorEnforcesSurfaceOrFunctionCallID() throws {
    let decoder = makeVersionedDecoder(.v10)
    // Valid with surfaceId
    let validSurfaceJSON = try #require(
      """
      {
        "code": "CUSTOM_ERROR",
        "surfaceId": "surf_1",
        "message": "failed"
      }
      """.data(using: .utf8)
    )
    let err1 = try decoder.decode(GenericError.self, from: validSurfaceJSON)
    #expect(err1.surfaceID == "surf_1")
    #expect(err1.functionCallID == nil)

    // Valid with functionCallId
    let validFnJSON = try #require(
      """
      {
        "code": "CUSTOM_ERROR",
        "functionCallId": "call_1",
        "message": "failed"
      }
      """.data(using: .utf8)
    )
    let err2 = try decoder.decode(GenericError.self, from: validFnJSON)
    #expect(err2.surfaceID == nil)
    #expect(err2.functionCallID == "call_1")

    // Invalid: neither surfaceId nor functionCallId
    let neitherJSON = try #require(
      """
      {
        "code": "CUSTOM_ERROR",
        "message": "failed"
      }
      """.data(using: .utf8)
    )
    #expect(throws: DecodingError.self) {
      try decoder.decode(GenericError.self, from: neitherJSON)
    }

    // Invalid: both surfaceId and functionCallId
    let bothJSON = try #require(
      """
      {
        "code": "CUSTOM_ERROR",
        "surfaceId": "surf_1",
        "functionCallId": "call_1",
        "message": "failed"
      }
      """.data(using: .utf8)
    )
    #expect(throws: DecodingError.self) {
      try decoder.decode(GenericError.self, from: bothJSON)
    }
  }

  @Test func genericErrorEncodesExactlyOneTargetID() throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let decoder = makeVersionedDecoder(.v10)

    let surfaceError = GenericError(
      code: "ERR", surfaceID: "surf_1", message: "msg", version: .v10)
    let surfaceJSON = try #require(
      String(data: try encoder.encode(surfaceError), encoding: .utf8))
    #expect(surfaceJSON == #"{"code":"ERR","message":"msg","surfaceId":"surf_1"}"#)
    #expect(
      try decoder.decode(GenericError.self, from: encoder.encode(surfaceError)) == surfaceError)

    let functionCallError = GenericError(
      code: "ERR", functionCallID: "call_1", message: "msg", version: .v10)
    let functionCallJSON = try #require(
      String(data: try encoder.encode(functionCallError), encoding: .utf8))
    #expect(functionCallJSON == #"{"code":"ERR","functionCallId":"call_1","message":"msg"}"#)
    #expect(
      try decoder.decode(GenericError.self, from: encoder.encode(functionCallError))
        == functionCallError)

    #expect(surfaceError.surfaceID == "surf_1")
    #expect(surfaceError.functionCallID == nil)
    #expect(functionCallError.surfaceID == nil)
    #expect(functionCallError.functionCallID == "call_1")

    // The same ID string under different targets must not compare equal.
    let surfaceWithCallID = GenericError(
      code: "ERR", surfaceID: "call_1", message: "msg", version: .v10)
    #expect(surfaceWithCallID != functionCallError)
  }

  @Test func rendererFunctionResponseEnforcesValueXorError() throws {
    let decoder = makeVersionedDecoder(.v10)
    // Both value and error present should fail
    let bothJSON = try #require(
      """
      {
        "functionCallId": "c1",
        "value": 123,
        "error": { "code": "ERR", "message": "fail" }
      }
      """.data(using: .utf8)
    )
    #expect(throws: DecodingError.self) {
      try decoder.decode(RendererFunctionResponseMessage.self, from: bothJSON)
    }
    #expect(throws: DecodingError.self) {
      try decoder.decode(AgentFunctionResponseMessage.self, from: bothJSON)
    }

    // Neither value nor error present should fail
    let neitherJSON = try #require(
      """
      {
        "functionCallId": "c1"
      }
      """.data(using: .utf8)
    )
    #expect(throws: DecodingError.self) {
      try decoder.decode(RendererFunctionResponseMessage.self, from: neitherJSON)
    }
  }

  @Test func functionResponsesEncodeExactlyOneOfValueOrError() throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let decoder = makeVersionedDecoder(.v10)
    let payload = FunctionErrorPayload(code: "ERR", message: "fail")

    let rendererValue = RendererFunctionResponseMessage(
      functionCallID: "c1", value: .number(1), version: .v10)
    let rendererValueJSON = try #require(
      String(data: try encoder.encode(rendererValue), encoding: .utf8))
    #expect(rendererValueJSON == #"{"functionCallId":"c1","value":1}"#)
    #expect(
      try decoder.decode(RendererFunctionResponseMessage.self, from: encoder.encode(rendererValue))
        == rendererValue)
    #expect(rendererValue.value == .number(1))
    #expect(rendererValue.error == nil)

    let rendererError = RendererFunctionResponseMessage(
      functionCallID: "c1", error: payload, version: .v10)
    let rendererErrorJSON = try #require(
      String(data: try encoder.encode(rendererError), encoding: .utf8))
    #expect(
      rendererErrorJSON == #"{"error":{"code":"ERR","message":"fail"},"functionCallId":"c1"}"#)
    #expect(
      try decoder.decode(RendererFunctionResponseMessage.self, from: encoder.encode(rendererError))
        == rendererError)
    #expect(rendererError.value == nil)
    #expect(rendererError.error == payload)
    #expect(rendererValue != rendererError)

    let agentValue = AgentFunctionResponseMessage(
      functionCallID: "c1", value: .number(1), version: .v10)
    let agentValueJSON = try #require(
      String(data: try encoder.encode(agentValue), encoding: .utf8))
    #expect(agentValueJSON == #"{"functionCallId":"c1","value":1}"#)
    #expect(
      try decoder.decode(AgentFunctionResponseMessage.self, from: encoder.encode(agentValue))
        == agentValue)
    #expect(agentValue.value == .number(1))
    #expect(agentValue.error == nil)

    let agentError = AgentFunctionResponseMessage(
      functionCallID: "c1", error: payload, version: .v10)
    let agentErrorJSON = try #require(
      String(data: try encoder.encode(agentError), encoding: .utf8))
    #expect(agentErrorJSON == #"{"error":{"code":"ERR","message":"fail"},"functionCallId":"c1"}"#)
    #expect(
      try decoder.decode(AgentFunctionResponseMessage.self, from: encoder.encode(agentError))
        == agentError)
    #expect(agentError.value == nil)
    #expect(agentError.error == payload)
    #expect(agentValue != agentError)
  }

  @Test func functionErrorPayloadCodeEnum() {
    let payload = FunctionErrorPayload(code: .invalidFunctionCall, message: "Invalid")
    #expect(payload.code == "INVALID_FUNCTION_CALL")
    #expect(payload.structuredCode == .invalidFunctionCall)

    let custom = FunctionErrorPayload(code: "CUSTOM_CODE", message: "Custom")
    #expect(custom.code == "CUSTOM_CODE")
    #expect(custom.structuredCode == nil)
  }

  @Test func deprecatedTypealiasesCompileAndMatch() {
    let action: ClientAction = RendererAction(
      name: "click",
      surfaceID: "s1",
      sourceComponentID: "c1",
      timestamp: "2024-01-01T00:00:00Z",
      context: [:],
      version: .v10
    )
    let msg: ClientToServerMessage = .action(action)
    if case .action(let act) = msg {
      #expect(act.name == "click")
    } else {
      Issue.record("Expected .action")
    }

    let err: ClientServerError = .generic(
      GenericError(code: "ERR", surfaceID: "s1", message: "msg", version: .v10)
    )
    #expect(
      err == .generic(GenericError(code: "ERR", surfaceID: "s1", message: "msg", version: .v10))
    )
  }

  @Test func encodeActionAndErrorPreserveProtocolVersion() throws {
    for targetVersion in A2UIProtocolVersion.allCases {
      let action = RendererAction(
        name: "click",
        surfaceID: "s1",
        sourceComponentID: "btn1",
        timestamp: "2024-01-01T00:00:00Z",
        context: [:],
        version: targetVersion
      )
      let actionMsg = RendererToAgentMessage.action(action)
      #expect(actionMsg.version == targetVersion)
      let actionData = try JSONEncoder().encode(actionMsg)
      let actionJSON = try #require(String(data: actionData, encoding: .utf8))
      #expect(actionJSON.contains("\"version\":\"\(targetVersion.rawValue)\""))
      let decodedAction = try JSONDecoder().decode(RendererToAgentMessage.self, from: actionData)
      #expect(decodedAction == actionMsg)
      #expect(decodedAction.version == targetVersion)

      let error = RendererError.validationFailed(
        ValidationFailedError(
          surfaceID: "s1",
          path: "/components/0",
          message: "Invalid",
          version: targetVersion
        )
      )
      let errorMsg = RendererToAgentMessage.error(error)
      #expect(errorMsg.version == targetVersion)
      let errorData = try JSONEncoder().encode(errorMsg)
      let errorJSON = try #require(String(data: errorData, encoding: .utf8))
      #expect(errorJSON.contains("\"version\":\"\(targetVersion.rawValue)\""))
      let decodedError = try JSONDecoder().decode(RendererToAgentMessage.self, from: errorData)
      #expect(decodedError == errorMsg)
      #expect(decodedError.version == targetVersion)
    }
  }

  @Test func genericErrorExpressionRoundTrips() throws {
    for targetVersion in A2UIProtocolVersion.allCases {
      let errorMsg = RendererToAgentMessage.error(
        .generic(
          GenericError(
            code: "EXPRESSION_ERROR",
            surfaceID: "s1",
            message: "Function not found: noSuchFunction",
            expression: "noSuchFunction",
            version: targetVersion
          )
        )
      )
      let data = try JSONEncoder().encode(errorMsg)
      let json = try #require(String(data: data, encoding: .utf8))
      #expect(json.contains("\"expression\":\"noSuchFunction\""))
      let decoded = try JSONDecoder().decode(RendererToAgentMessage.self, from: data)
      #expect(decoded == errorMsg)
    }
  }

  @Test func genericErrorOmitsExpressionWhenNil() throws {
    let error = GenericError(code: "ERR", surfaceID: "s1", message: "msg", version: .v10)
    let data = try JSONEncoder().encode(RendererToAgentMessage.error(.generic(error)))
    let json = try #require(String(data: data, encoding: .utf8))
    #expect(!json.contains("expression"))
  }
}
