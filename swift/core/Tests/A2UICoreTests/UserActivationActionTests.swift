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

@MainActor
private final class SpyUserActivationFunction: FunctionImplementation, @unchecked Sendable {
  let api: FunctionAPI
  var callCount = 0

  init(name: String, requiresUserActivation: Bool) throws {
    let emptySchema = try Schema(instance: #"{"type": "object"}"#)
    self.api = FunctionAPI(
      name: name,
      returnType: .string,
      schema: emptySchema,
      allowedCallers: .rendererOnly,
      requiresUserActivation: requiresUserActivation
    )
  }

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    callCount += 1
    return .string("ran-\(api.name)")
  }
}

/// An agent-callable function that returns its `text` argument.
private struct AgentEchoFunction: FunctionImplementation {
  let api: FunctionAPI

  init() throws {
    self.api = FunctionAPI(
      name: "echo",
      returnType: .string,
      schema: try Schema(instance: #"{"type": "object"}"#),
      allowedCallers: .rendererOrAgent
    )
  }

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    arguments["text"] ?? .null
  }
}

@MainActor
private final class RecordingFunctionHandler: FunctionHandler {
  private let functions: [String: any FunctionImplementation]
  var recordedErrors: [(error: any Error, functionName: String)] = []

  init(functions: [any FunctionImplementation]) {
    self.functions = Dictionary(uniqueKeysWithValues: functions.map { ($0.api.name, $0) })
  }

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    functions[name]
  }

  func handleFunctionError(_ error: any Error, functionName: String) {
    recordedErrors.append((error, functionName))
  }
}

@MainActor
struct UserActivationActionTests {
  private static func makeButtonCatalog(
    functions: [any FunctionImplementation]
  ) throws -> AnyCatalog {
    let common = "https://a2ui.org/schemas/v0_9_1/common.json#/$defs"
    let buttonSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "label": { "$ref": "\(common)/DynamicString" },
            "checks": { "type": "array", "items": { "$ref": "\(common)/CheckRule" } },
            "action": { "$ref": "\(common)/Action" }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    return Catalog(
      id: "test-cat",
      protocolVersion: .v10,
      components: [AnyComponentAPI(name: "Button", schema: buttonSchema)],
      functions: functions
    ).eraseToAnyCatalog()
  }

  private static func makeButtonResolver(
    functionName: String,
    catalog: AnyCatalog,
    actionHandler: TestProcessorActionHandler
  ) -> NodeResolver {
    let resolver = NodeResolver(
      surfaceID: "main",
      catalogs: ["test-cat": catalog],
      defaultCatalogID: "test-cat",
      actionHandler: actionHandler,
      protocolVersion: .v10
    )
    resolver.componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Button",
        properties: [
          "action": .object([
            "functionCall": .object([
              "@call": .string(functionName),
              "args": .object([:]),
            ])
          ])
        ]
      )
    )
    return resolver
  }

  @Test func gatedActionRefusedWithoutUserActivation() throws {
    let gatedFunction = try SpyUserActivationFunction(
      name: "openExternal",
      requiresUserActivation: true
    )
    let catalog = try Self.makeButtonCatalog(functions: [gatedFunction])
    let actionHandler = TestProcessorActionHandler()
    let resolver = Self.makeButtonResolver(
      functionName: "openExternal",
      catalog: catalog,
      actionHandler: actionHandler
    )

    let root = try #require(resolver.resolveTree())
    let programmaticAction = try #require(root.action(for: "action", userActivation: false))
    programmaticAction()

    #expect(gatedFunction.callCount == 0)
    #expect(actionHandler.capturedActions.isEmpty)
    #expect(actionHandler.capturedErrors.count == 1)
    if case .generic(let error) = actionHandler.capturedErrors.first {
      #expect(error.code == "EXPRESSION_ERROR")
      #expect(error.surfaceID == "main")
      #expect(error.expression == "openExternal")
      #expect(
        error.message == "Function 'openExternal' requires user activation context to execute."
      )
    } else {
      Issue.record("Expected EXPRESSION_ERROR generic error, got \(actionHandler.capturedErrors)")
    }
  }

  @Test func gatedActionRunsWithUserActivation() throws {
    let gatedFunction = try SpyUserActivationFunction(
      name: "openExternal",
      requiresUserActivation: true
    )
    let catalog = try Self.makeButtonCatalog(functions: [gatedFunction])
    let actionHandler = TestProcessorActionHandler()
    let resolver = Self.makeButtonResolver(
      functionName: "openExternal",
      catalog: catalog,
      actionHandler: actionHandler
    )

    let root = try #require(resolver.resolveTree())
    let gestureAction = try #require(root.action(for: "action", userActivation: true))
    let unactivatedAction = try #require(root.action(for: "action", userActivation: false))
    #expect(gestureAction != unactivatedAction)
    #expect(gestureAction.withUserActivation(false) == unactivatedAction)
    gestureAction()

    #expect(gatedFunction.callCount == 1)
    #expect(actionHandler.capturedActions.isEmpty)
    #expect(actionHandler.capturedErrors.isEmpty)

    let defaultAction = try #require(root.action(for: "action"))
    defaultAction()

    #expect(gatedFunction.callCount == 2)
    #expect(actionHandler.capturedErrors.isEmpty)
  }

  @Test func ungatedActionRunsWithOrWithoutUserActivation() throws {
    let ungatedFunction = try SpyUserActivationFunction(
      name: "increment",
      requiresUserActivation: false
    )
    let catalog = try Self.makeButtonCatalog(functions: [ungatedFunction])
    let actionHandler = TestProcessorActionHandler()
    let resolver = Self.makeButtonResolver(
      functionName: "increment",
      catalog: catalog,
      actionHandler: actionHandler
    )

    let root = try #require(resolver.resolveTree())
    let withoutActivation = try #require(root.action(for: "action", userActivation: false))
    withoutActivation()
    #expect(ungatedFunction.callCount == 1)
    #expect(actionHandler.capturedErrors.isEmpty)

    let withActivation = try #require(root.action(for: "action", userActivation: true))
    withActivation()
    #expect(ungatedFunction.callCount == 2)
    #expect(actionHandler.capturedErrors.isEmpty)
  }

  @Test func dataContextRefusesGatedFunctionWithoutUserActivation() throws {
    let gatedFunction = try SpyUserActivationFunction(
      name: "openExternal",
      requiresUserActivation: true
    )
    let handler = RecordingFunctionHandler(functions: [gatedFunction])
    let dataModel = DataModel()
    let callExpression: JSONValue = .object([
      "@call": .string("openExternal"),
      "args": .object([:]),
    ])

    let inactiveContext = DataContext(
      dataModel: dataModel,
      path: "/",
      functionHandler: handler,
      protocolVersion: .v10
    )
    #expect(inactiveContext.isUserActivated == false)
    let deniedResult = inactiveContext.resolveDynamicValue(callExpression)
    #expect(deniedResult == .null)
    #expect(gatedFunction.callCount == 0)
    #expect(handler.recordedErrors.count == 1)

    let recordedError = try #require(handler.recordedErrors.first?.error as? FunctionError)
    #expect(recordedError == .userActivationRequired(name: "openExternal"))
    #expect(recordedError.rpcCode == "INVALID_FUNCTION_CALL")
    #expect(
      recordedError.description
        == "Function 'openExternal' requires user activation context to execute."
    )

    let activeContext = DataContext(
      dataModel: dataModel,
      path: "/",
      functionHandler: handler,
      protocolVersion: .v10,
      isUserActivated: true
    )
    let overrideDenied = activeContext.resolveDynamicValue(callExpression, userActivation: false)
    #expect(overrideDenied == .null)
    #expect(gatedFunction.callCount == 0)
    #expect(handler.recordedErrors.count == 2)

    let allowedResult = activeContext.resolveDynamicValue(callExpression)
    #expect(allowedResult == .string("ran-openExternal"))
    #expect(gatedFunction.callCount == 1)
  }

  @Test func passiveBindingsAndChecksRefuseGatedFunctions() throws {
    let gatedFunction = try SpyUserActivationFunction(
      name: "openExternal",
      requiresUserActivation: true
    )
    let catalog = try Self.makeButtonCatalog(functions: [gatedFunction])
    let actionHandler = TestProcessorActionHandler()
    let resolver = NodeResolver(
      surfaceID: "main",
      catalogs: ["test-cat": catalog],
      defaultCatalogID: "test-cat",
      actionHandler: actionHandler,
      protocolVersion: .v10
    )
    let callExpression: JSONValue = .object([
      "@call": .string("openExternal"),
      "args": .object([:]),
    ])
    resolver.componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Button",
        properties: [
          "label": callExpression,
          "checks": .array([
            .object([
              "condition": callExpression,
              "message": .string("Blocked check"),
            ])
          ]),
        ]
      )
    )

    let root = try #require(resolver.resolveTree())
    #expect(root.string(for: "label") == nil)
    #expect(root.isValid == false)
    #expect(gatedFunction.callCount == 0)
    #expect(actionHandler.capturedErrors.count == 2)

    resolver.componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Button",
        properties: [
          "action": .object([
            "event": .object([
              "name": .string("submit"),
              "context": .object(["secret": callExpression]),
            ])
          ])
        ]
      )
    )

    let eventRoot = try #require(resolver.resolveTree())
    let programmaticEvent = try #require(eventRoot.action(for: "action", userActivation: false))
    programmaticEvent()
    #expect(gatedFunction.callCount == 0)
    #expect(actionHandler.capturedErrors.count == 3)
    #expect(actionHandler.capturedActions.isEmpty)

    let gestureEvent = try #require(eventRoot.action(for: "action", userActivation: true))
    gestureEvent()
    #expect(gatedFunction.callCount == 1)
    #expect(actionHandler.capturedErrors.count == 3)
    if case .event(_, let context, _) = actionHandler.capturedActions.last?.identity {
      #expect(context?["secret"] == .string("ran-openExternal"))
    } else {
      Issue.record("Expected dispatched event action")
    }
  }

  // MARK: - callRendererFunction

  private static func makeRPCProcessor(
    gatedFunction: SpyUserActivationFunction
  ) throws -> (MessageProcessor, () -> [RendererFunctionResponseMessage]) {
    let catalog = try makeButtonCatalog(functions: [gatedFunction, try AgentEchoFunction()])
    let processor = MessageProcessor(catalogs: [catalog])
    var responses: [RendererFunctionResponseMessage] = []
    processor.outboundListener = { message in
      MainActor.assumeIsolated {
        if case .rendererFunctionResponse(let response) = message {
          responses.append(response)
        }
      }
    }
    return (processor, { responses })
  }

  private static func callRendererFunctionJSON(
    id: String,
    call: String,
    args: String = "{}"
  ) -> String {
    """
    {
      "version": "1.0",
      "callRendererFunction": {
        "functionCallId": "\(id)",
        "callFunction": { "@call": "\(call)", "catalogId": "test-cat", "args": \(args) }
      }
    }
    """
  }

  /// An agent call to `echo` whose argument is a nested call to the gated function.
  private static func echoOfGatedCallJSON(id: String) -> String {
    callRendererFunctionJSON(
      id: id,
      call: "echo",
      args: #"{ "text": { "@call": "openExternal", "catalogId": "test-cat", "args": {} } }"#
    )
  }

  private static func echoOfGatedCall(id: String) throws -> JSONValue {
    try JSONValue.parse(echoOfGatedCallJSON(id: id))
  }

  private static func echoOfGatedCallMessage(id: String) throws -> AgentToRendererMessage {
    try MessageParser().parse(jsonString: echoOfGatedCallJSON(id: id))
  }

  private static func waitUntil(
    _ condition: () -> Bool,
    sourceLocation: SourceLocation = #_sourceLocation
  ) async {
    for _ in 0..<400 where !condition() {
      await Task.yield()
      if condition() { return }
      try? await Task.sleep(nanoseconds: 5_000_000)
    }
    if !condition() {
      Issue.record("Timed out waiting for condition", sourceLocation: sourceLocation)
    }
  }

  @Test func callRendererFunctionRefusesGatedNestedCallByDefault() async throws {
    let gatedFunction = try SpyUserActivationFunction(
      name: "openExternal",
      requiresUserActivation: true
    )
    let (processor, responses) = try Self.makeRPCProcessor(gatedFunction: gatedFunction)

    try processor.processMessages(try Self.echoOfGatedCall(id: "rpc-1"))
    processor.process(payload: try Self.echoOfGatedCall(id: "rpc-2"))
    processor.process(message: try Self.echoOfGatedCallMessage(id: "rpc-3"))
    try processor.processMessages(try Self.echoOfGatedCall(id: "rpc-4"), isUserActivated: false)

    await Self.waitUntil { responses().count == 4 }
    #expect(Set(responses().map(\.functionCallID)) == ["rpc-1", "rpc-2", "rpc-3", "rpc-4"])
    for response in responses() {
      #expect(response.value == nil)
      #expect(response.error?.message.contains("requires user activation") == true)
    }
    #expect(gatedFunction.callCount == 0)
  }

  @Test func callRendererFunctionRunsGatedNestedCallWhenUserActivated() async throws {
    let gatedFunction = try SpyUserActivationFunction(
      name: "openExternal",
      requiresUserActivation: true
    )
    let (processor, responses) = try Self.makeRPCProcessor(gatedFunction: gatedFunction)

    try processor.processMessages(try Self.echoOfGatedCall(id: "rpc-1"), isUserActivated: true)
    processor.process(payload: try Self.echoOfGatedCall(id: "rpc-2"), isUserActivated: true)
    processor.process(message: try Self.echoOfGatedCallMessage(id: "rpc-3"), isUserActivated: true)
    processor.process(
      messages: [try Self.echoOfGatedCallMessage(id: "rpc-4")],
      isUserActivated: true
    )

    await Self.waitUntil { responses().count == 4 }
    #expect(Set(responses().map(\.functionCallID)) == ["rpc-1", "rpc-2", "rpc-3", "rpc-4"])
    for response in responses() {
      #expect(response.error == nil)
      #expect(response.value == .string("ran-openExternal"))
    }
    #expect(gatedFunction.callCount == 4)
  }

  @Test func callRendererFunctionToRendererOnlyGatedFunctionStaysRejected() async throws {
    let gatedFunction = try SpyUserActivationFunction(
      name: "openExternal",
      requiresUserActivation: true
    )
    let (processor, responses) = try Self.makeRPCProcessor(gatedFunction: gatedFunction)

    try processor.processMessages(
      try JSONValue.parse(Self.callRendererFunctionJSON(id: "rpc-direct", call: "openExternal")),
      isUserActivated: true
    )

    await Self.waitUntil { responses().count == 1 }
    let response = try #require(responses().first)
    #expect(response.functionCallID == "rpc-direct")
    #expect(response.error?.code == FunctionErrorPayload.Code.invalidFunctionCall.rawValue)
    #expect(gatedFunction.callCount == 0)
  }
}
