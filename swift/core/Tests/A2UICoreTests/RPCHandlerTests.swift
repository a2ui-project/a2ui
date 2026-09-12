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
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing

@MainActor
struct RPCHandlerTests {

  private struct MockEchoFunction: FunctionImplementation {
    let api: FunctionAPI

    init(allowedCallers: AllowedCallers = .rendererOrAgent) {
      let schema = try! Schema(
        rawSchema: .object(["type": .string("object")]),
        context: Context(dialect: .draft2020_12)
      )
      self.api = FunctionAPI(
        name: "echo",
        returnType: .string,
        schema: schema,
        allowedCallers: allowedCallers
      )
    }

    func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
      arguments["message"] ?? .null
    }
  }

  @Test func incomingCallSuccess() async {
    let handler = RPCHandler()
    let echoFn = MockEchoFunction()
    let catalog = Catalog(id: "test", components: [AnyComponentAPI](), functions: [echoFn])
      .eraseToAnyCatalog()

    let callPayload = CallFunctionPayload(
      call: "echo",
      catalogID: "test",
      args: ["message": .string("Hello Agent")]
    )
    let callMsg = CallRendererFunctionMessage(
      functionCallID: "call_1",
      callFunction: callPayload
    )

    let response = await handler.handleIncomingCall(
      callMsg,
      catalogs: [catalog.id: catalog]
    )

    #expect(response.functionCallID == "call_1")
    #expect(response.value == .string("Hello Agent"))
    #expect(response.error == nil)
  }

  @Test func incomingCallUnknownFunction() async {
    let handler = RPCHandler()
    let catalog = Catalog(id: "test", components: [AnyComponentAPI]()).eraseToAnyCatalog()

    let callPayload = CallFunctionPayload(call: "nonexistent")
    let callMsg = CallRendererFunctionMessage(
      functionCallID: "call_2",
      callFunction: callPayload
    )

    let response = await handler.handleIncomingCall(
      callMsg,
      catalogs: [catalog.id: catalog]
    )

    #expect(response.functionCallID == "call_2")
    #expect(response.value == nil)
    #expect(response.error?.code == "INVALID_FUNCTION_CALL")
  }

  @Test func incomingCallDisallowedCaller() async {
    let handler = RPCHandler()
    let echoFn = MockEchoFunction(allowedCallers: .rendererOnly)
    let catalog = Catalog(id: "test", components: [AnyComponentAPI](), functions: [echoFn])
      .eraseToAnyCatalog()

    let callPayload = CallFunctionPayload(call: "echo")
    let callMsg = CallRendererFunctionMessage(
      functionCallID: "call_3",
      callFunction: callPayload
    )

    let response = await handler.handleIncomingCall(
      callMsg,
      catalogs: [catalog.id: catalog]
    )

    #expect(response.functionCallID == "call_3")
    #expect(response.value == nil)
    #expect(response.error?.code == "INVALID_FUNCTION_CALL")
  }

  @Test func outgoingCallSuccess() async throws {
    let handler = RPCHandler()
    let box = RPCBox<RendererToAgentMessage>()

    let task = Task {
      try await handler.callAgentFunction(
        surfaceID: "surf1",
        functionName: "fetchProfile",
        args: ["userID": .string("u123")],
        timeoutSeconds: 5.0,
        sendOutbound: { msg in
          box.value = msg
        }
      )
    }

    // Wait a brief tick for the call to be registered and outbound dispatched
    try await Task.sleep(nanoseconds: 20_000_000)

    guard case .callAgentFunction(let callMsg) = box.value else {
      Issue.record("Expected .callAgentFunction message")
      return
    }

    #expect(callMsg.surfaceID == "surf1")
    #expect(callMsg.callFunction.call == "fetchProfile")
    #expect(callMsg.callFunction.args?["userID"] == .string("u123"))

    // Agent replies with response
    handler.handleAgentResponse(
      AgentFunctionResponseMessage(
        functionCallID: callMsg.functionCallID,
        value: .object(["name": .string("Alice")])
      )
    )

    let result = try await task.value
    #expect(result["name"]?.stringValue == "Alice")
  }

  @Test func outgoingCallRemoteError() async throws {
    let handler = RPCHandler()
    let box = RPCBox<String>()

    let task = Task {
      try await handler.callAgentFunction(
        surfaceID: "surf1",
        functionName: "failingFunction",
        timeoutSeconds: 5.0,
        sendOutbound: { msg in
          if case .callAgentFunction(let callMsg) = msg {
            box.value = callMsg.functionCallID
          }
        }
      )
    }

    try await Task.sleep(nanoseconds: 20_000_000)
    let callID = try #require(box.value)

    handler.handleAgentResponse(
      AgentFunctionResponseMessage(
        functionCallID: callID,
        error: FunctionErrorPayload(code: "INVALID_USER", message: "User does not exist")
      )
    )

    do {
      _ = try await task.value
      Issue.record("Expected error to be thrown")
    } catch let error as FunctionError {
      #expect(error == .remoteError(code: "INVALID_USER", message: "User does not exist"))
    }
  }

  @Test func outgoingCallTimeout() async throws {
    let handler = RPCHandler()

    do {
      _ = try await handler.callAgentFunction(
        surfaceID: "surf1",
        functionName: "slowFunction",
        timeoutSeconds: 0.05,
        sendOutbound: { _ in }
      )
      Issue.record("Expected timeout error")
    } catch let error as FunctionError {
      if case .timeout = error {
        // Success
      } else {
        Issue.record("Expected .timeout, got \(error)")
      }
    }
  }

  @Test func messageProcessorRoutesRPCCalls() async throws {
    let echoFn = MockEchoFunction()
    let catalog = Catalog(id: "test", components: [AnyComponentAPI](), functions: [echoFn])
    let processor = MessageProcessor(catalog: catalog)

    let box = RPCBox<RendererFunctionResponseMessage>()
    processor.outboundListener = { msg in
      if case .rendererFunctionResponse(let resp) = msg {
        box.value = resp
      }
    }

    let inboundCallJSON = """
      {
        "version": "v1.0",
        "callRendererFunction": {
          "functionCallId": "proc_call_1",
          "callFunction": {
            "call": "echo",
            "args": { "message": "Processor Echo" }
          }
        }
      }
      """

    let parser = MessageParser()
    let message = try parser.parse(jsonString: inboundCallJSON)
    processor.process(message: message)

    // Give Task brief moment to evaluate
    try await Task.sleep(nanoseconds: 50_000_000)

    let response = try #require(box.value)
    #expect(response.functionCallID == "proc_call_1")
    #expect(response.value == "Processor Echo")
  }
}

private final class RPCBox<T>: @unchecked Sendable {
  var value: T?
}
