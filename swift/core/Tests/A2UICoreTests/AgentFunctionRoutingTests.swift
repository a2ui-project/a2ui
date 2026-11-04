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

/// Covers the v1.0 fallback routing of `callAgentFunction`: a function call that the renderer has
/// no local implementation for runs on the agent.
@MainActor
struct AgentFunctionRoutingTests {

  private static let finCatalogID = "https://example.com/fin/v1/catalog.json"

  /// The root `Text` component, bound to an undeclared function.
  private static let fetchFxRateText = """
    {"id": "root", "component": "Text",
     "text": {"@call": "fetchFxRate", "args": {"base": "EUR"}}}
    """

  /// An `updateDataModel` message setting `/symbol` on surface `s1` to the JSON `value`.
  private static func setSymbol(_ value: String) -> String {
    """
    {"version": "1.0",
     "updateDataModel": {"surfaceId": "s1", "path": "/symbol", "value": \(value)}}
    """
  }

  /// Returns its `value` argument in upper case.
  private struct UpperFunction: FunctionImplementation {
    let api = FunctionAPI(
      name: "upper",
      returnType: .string,
      schema: try! Schema(
        instance: """
          {
            "type": "object",
            "properties": { "value": { "type": "string" } },
            "required": ["value"]
          }
          """
      )
    )

    func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
      guard let value = arguments["value"]?.stringValue else {
        throw FunctionError.invalidArgumentType(expected: "string", actual: "\(arguments)")
      }
      return .string(value.uppercased())
    }
  }

  /// Joins its `value` and `suffix` arguments.
  private struct JoinFunction: FunctionImplementation {
    let api = FunctionAPI(
      name: "join",
      returnType: .string,
      schema: try! Schema(instance: "{\"type\": \"object\"}"),
      allowedCallers: .rendererOrAgent
    )

    func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
      let value = arguments["value"]?.stringValue ?? ""
      let suffix = arguments["suffix"]?.stringValue ?? ""
      return .string(value + suffix)
    }
  }

  /// Resolves a call to `fetchGreeting` itself while it runs, as `formatString` resolves its
  /// `${...}` parts, and wraps the result in brackets.
  private struct BracketGreetingFunction: FunctionImplementation {
    let api = FunctionAPI(
      name: "bracketGreeting",
      returnType: .string,
      schema: try! Schema(instance: "{\"type\": \"object\"}")
    )

    func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
      let greeting = context.resolveDynamicValue(["@call": "fetchGreeting"])
      return .string("[\(greeting.stringValue ?? "")]")
    }
  }

  /// An error without a message.
  private struct SilentError: Error, CustomStringConvertible {
    var description: String { "" }
  }

  /// Fails with an error that has no message.
  private struct SilentFailureFunction: FunctionImplementation {
    let api = FunctionAPI(
      name: "silentFailure",
      returnType: .string,
      schema: try! Schema(instance: "{\"type\": \"object\"}")
    )

    func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
      throw SilentError()
    }
  }

  /// Fails with the message "boom" when it runs.
  private struct ExplodeFunction: FunctionImplementation {
    let api = FunctionAPI(
      name: "explode",
      returnType: .string,
      schema: try! Schema(instance: "{\"type\": \"object\"}")
    )

    func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
      throw FunctionError.executionFailed(name: "explode", message: "boom")
    }
  }

  /// Returns a number that has no JSON form.
  private struct NotANumberFunction: FunctionImplementation {
    let api = FunctionAPI(
      name: "notANumber",
      returnType: .number,
      schema: try! Schema(instance: "{\"type\": \"object\"}")
    )

    func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
      .number(.nan)
    }
  }

  /// Declared in the catalog, but implemented on the agent.
  private static let quote = SchemaOnlyFunction(
    api: FunctionAPI(
      name: "quote",
      returnType: .number,
      schema: try! Schema(
        instance: """
          {
            "type": "object",
            "properties": {
              "symbol": { "type": "string" },
              "currency": { "type": "string", "default": "USD" }
            },
            "required": ["symbol"],
            "additionalProperties": false
          }
          """
      )
    )
  )

  /// Declared in the catalog with a nested object schema, but implemented on the agent.
  private static let estimate = SchemaOnlyFunction(
    api: FunctionAPI(
      name: "estimate",
      returnType: .number,
      schema: try! Schema(
        instance: """
          {
            "type": "object",
            "properties": {
              "options": {
                "type": "object",
                "properties": {
                  "unit": { "type": "string", "default": "USD" },
                  "rounding": {
                    "type": "object",
                    "properties": { "digits": { "type": "integer", "default": 2 } }
                  }
                }
              },
              "region": { "type": "object", "properties": { "code": { "default": "US" } } }
            }
          }
          """
      )
    )
  )

  /// Declared in the catalog, implemented on the agent, and run only on a user gesture.
  private static let confirmOrder = SchemaOnlyFunction(
    api: FunctionAPI(
      name: "confirmOrder",
      returnType: .boolean,
      schema: try! Schema(instance: "{\"type\": \"object\"}"),
      requiresUserActivation: true
    )
  )

  /// Declared in the catalog, implemented on the agent, and callable only by the agent.
  private static let auditLog = SchemaOnlyFunction(
    api: FunctionAPI(
      name: "auditLog",
      returnType: .boolean,
      schema: try! Schema(instance: "{\"type\": \"object\"}"),
      allowedCallers: .agentOnly
    )
  )

  /// Collects the processor's outbound messages, and keeps the processor alive.
  private final class Outbound: @unchecked Sendable {
    var messages: [RendererToAgentMessage] = []
    var processor: MessageProcessor?

    var agentCalls: [CallAgentFunctionMessage] {
      messages.compactMap {
        guard case .callAgentFunction(let call) = $0 else { return nil }
        return call
      }
    }
  }

  private let outbound = Outbound()
  private let handler = TestProcessorActionHandler()

  private var errors: [GenericError] {
    handler.capturedErrors.compactMap {
      guard case .generic(let error) = $0 else { return nil }
      return error
    }
  }

  private func makeCatalog(protocolVersion: A2UIProtocolVersion = .v10) throws -> AnyCatalog {
    let dynamicString = A2UICommonSchema.v10URI(for: "DynamicString")
    let checkRule = A2UICommonSchema.v10URI(for: "CheckRule")
    let action = A2UICommonSchema.v10URI(for: "Action")
    let schema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "text": { "$ref": "\(dynamicString)" },
            "label": { "$ref": "\(dynamicString)" },
            "checks": { "type": "array", "items": { "$ref": "\(checkRule)" } },
            "onClick": { "$ref": "\(action)" }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    return Catalog(
      id: Self.finCatalogID,
      protocolVersion: protocolVersion,
      components: [AnyComponentAPI(name: "Text", schema: schema)],
      functions: [
        UpperFunction(), JoinFunction(), NotANumberFunction(), BracketGreetingFunction(),
        SilentFailureFunction(), ExplodeFunction(), Self.quote, Self.estimate, Self.confirmOrder,
        Self.auditLog,
      ]
    ).eraseToAnyCatalog()
  }

  /// Creates a processor with a surface `s1`, listening to outbound messages unless
  /// `listening` is false.
  private func makeProcessor(
    listening: Bool = true,
    version: String = "1.0"
  ) throws -> (MessageProcessor, SurfaceViewModel) {
    let protocolVersion: A2UIProtocolVersion = version == "1.0" ? .v10 : .v09
    let processor = MessageProcessor(
      catalog: try makeCatalog(protocolVersion: protocolVersion),
      actionHandler: handler
    )
    outbound.processor = processor
    if listening {
      let outbound = self.outbound
      processor.outboundListener = { message in
        MainActor.assumeIsolated {
          outbound.messages.append(message)
        }
      }
    }
    try process(
      processor,
      """
      {
        "version": "\(version)",
        "createSurface": { "surfaceId": "s1", "catalogId": "\(Self.finCatalogID)" }
      }
      """
    )
    let surface = try #require(processor.surfaceGroupModel["s1"])
    return (processor, surface)
  }

  private func process(_ processor: MessageProcessor, _ json: String) throws {
    processor.process(message: try MessageParser().parse(jsonString: json))
  }

  /// Sets the components of surface `s1`, given as JSON objects.
  private func render(_ processor: MessageProcessor, _ components: String...) throws {
    try process(
      processor,
      """
      {
        "version": "1.0",
        "updateComponents": {
          "surfaceId": "s1",
          "components": [\(components.joined(separator: ","))]
        }
      }
      """
    )
  }

  /// Answers the outbound `callAgentFunction` at `index` with `response`, the JSON members of
  /// the `agentFunctionResponse` besides its `functionCallId`.
  private func respond(_ processor: MessageProcessor, _ index: Int, _ response: String) throws {
    let callID = outbound.agentCalls[index].functionCallID
    try process(
      processor,
      """
      {
        "version": "1.0",
        "agentFunctionResponse": { "functionCallId": "\(callID)", \(response) }
      }
      """
    )
  }

  /// Waits for asynchronous work until `condition` holds, recording an issue if it still doesn't
  /// after about two seconds.
  private func waitUntil(
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

  /// Lets ready main-actor tasks run, for checks that something did not happen.
  private func settle() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }

  private func text(_ surface: SurfaceViewModel) -> String? {
    (surface.rootNode?.properties["text"] as? DataBinding<String>)?.value
  }

  private func context(_ surface: SurfaceViewModel) -> DataContext {
    DataContext(
      dataModel: surface.dataModel,
      path: "/",
      functionHandler: surface,
      protocolVersion: surface.protocolVersion
    )
  }

  @Test func sendsUndeclaredFunctionWithResolvedCatalogID() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      Self.fetchFxRateText
    )
    await waitUntil { outbound.agentCalls.count == 1 }

    let call = try #require(outbound.agentCalls.first)
    #expect(call.surfaceID == "s1")
    #expect(call.callFunction.call == "fetchFxRate")
    #expect(call.callFunction.catalogID == Self.finCatalogID)
    #expect(call.callFunction.args == ["base": "EUR"])
    #expect(text(surface) == nil, "the value is pending until the agent answers")

    try respond(processor, 0, #""value": 1.08"#)
    await waitUntil { text(surface) != nil }
    #expect(text(surface) == "1.08")
    #expect(handler.capturedErrors.isEmpty)
    await settle()
    #expect(outbound.agentCalls.count == 1, "re-resolving with the result sends nothing")
  }

  @Test func feedsAgentResultIntoLocalFunction() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "upper", "args": {"value": {"@call": "fetchGreeting"}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(outbound.agentCalls.count == 1)
    #expect(text(surface) == nil)

    try respond(processor, 0, #""value": "hello""#)
    await waitUntil { text(surface) != nil }
    #expect(text(surface) == "HELLO")
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func doesNotRunEnclosingFunctionWhenNestedAgentCallFails() async throws {
    let (processor, surface) = try makeProcessor()
    try process(processor, Self.setSymbol(#""GOOG""#))
    try render(
      processor,
      """
      {"id": "root", "component": "Text", "label": {"@path": "/symbol"},
       "text": {"@call": "upper", "args": {"value": {"@call": "fetchGreeting"}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }

    try respond(processor, 0, #""error": {"code": "FAIL", "message": "boom"}"#)
    await waitUntil { !errors.isEmpty }
    // Resolving the node again must not run `upper` with a `null` value, nor resend the call.
    try process(processor, Self.setSymbol(#""AAPL""#))
    await settle()
    #expect(text(surface) == nil)
    #expect(errors.count == 1)
    #expect(errors.first?.expression == "fetchGreeting")
    #expect(errors.first?.message.contains("boom") == true)
    #expect(outbound.agentCalls.count == 1)
  }

  @Test func chainsNestedAgentCallsInOrder() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "convert",
                "args": {"rate": {"@call": "fetchFxRate", "args": {"base": "EUR"}}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    await settle()
    #expect(outbound.agentCalls.map(\.callFunction.call) == ["fetchFxRate"])

    try respond(processor, 0, #""value": 1.08"#)
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(outbound.agentCalls[1].callFunction.call == "convert")
    #expect(outbound.agentCalls[1].callFunction.catalogID == Self.finCatalogID)
    #expect(outbound.agentCalls[1].callFunction.args == ["rate": 1.08])

    try respond(processor, 1, #""value": "108.00""#)
    await waitUntil { text(surface) != nil }
    #expect(text(surface) == "108.00")
    #expect(handler.capturedErrors.isEmpty)
  }

  /// A one-shot read can't wait for the agent: it never sends, and only reads a kept answer.
  @Test func oneShotReadNeverSendsAndReadsOnlyKeptAnswers() async throws {
    let (processor, surface) = try makeProcessor()
    let call: JSONValue = ["@call": "fetchFxRate", "args": ["base": "EUR"]]
    #expect(context(surface).resolveDynamicValue(call) == .null)
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.expression == "fetchFxRate")

    try render(processor, Self.fetchFxRateText)
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": 1.08"#)
    await waitUntil { text(surface) == "1.08" }
    #expect(context(surface).resolveDynamicValue(call) == .number(1.08))
    await settle()
    #expect(outbound.agentCalls.count == 1, "reading the kept answer sends nothing")
    #expect(errors.count == 1)
  }

  @Test func doesNotReportFailureOfCallNoLongerMade() async throws {
    let (processor, surface) = try makeProcessor()
    try render(processor, Self.fetchFxRateText)
    await waitUntil { outbound.agentCalls.count == 1 }
    try render(processor, #"{"id": "root", "component": "Text", "text": "static"}"#)
    #expect(text(surface) == "static")

    try respond(processor, 0, #""error": {"code": "FAIL", "message": "boom"}"#)
    await settle()
    #expect(handler.capturedErrors.isEmpty, "no node makes the call anymore")

    // Remounting the call after an unmounted failure sends a fresh request.
    try render(processor, Self.fetchFxRateText)
    await waitUntil { outbound.agentCalls.count == 2 }
    try respond(processor, 1, #""value": 1.09"#)
    await waitUntil { text(surface) == "1.09" }
    #expect(text(surface) == "1.09")
  }

  @Test func validatesAndParsesSchemaOnlyFunctionArguments() async throws {
    let (processor, surface) = try makeProcessor()
    try process(
      processor,
      Self.setSymbol("42")
    )
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "quote", "args": {"symbol": {"@path": "/symbol"}}}}
      """
    )
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.message.contains("Validation failed for function 'quote'") == true)

    try process(
      processor,
      Self.setSymbol(#""GOOG""#)
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    let call = try #require(outbound.agentCalls.first)
    #expect(call.callFunction.call == "quote")
    #expect(
      call.callFunction.args == ["symbol": "GOOG", "currency": "USD"],
      "the parsed arguments are sent, with schema defaults applied"
    )

    try respond(processor, 0, #""value": 180"#)
    await waitUntil { text(surface) != nil }
    #expect(text(surface) == "180")
  }

  @Test func runsImplementedFunctionLocally() async throws {
    let (_, surface) = try makeProcessor()
    let value = context(surface).resolveDynamicValue(
      ["@call": "upper", "args": ["value": "abc"]]
    )
    #expect(value == "ABC")
    await settle()
    #expect(outbound.agentCalls.isEmpty)
  }

  @Test func reportsAgentErrorAsExpressionError() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      Self.fetchFxRateText
    )
    await waitUntil { outbound.agentCalls.count == 1 }

    try respond(
      processor,
      0,
      #""error": {"code": "UNKNOWN_FUNCTION", "message": "No such function: fetchFxRate"}"#
    )
    await waitUntil { !errors.isEmpty }
    #expect(text(surface) == nil)
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.message.contains("No such function: fetchFxRate") == true)
  }

  @Test func reportsTimeoutAsExpressionError() async throws {
    let (processor, surface) = try makeProcessor()
    processor.agentFunctionTimeoutSeconds = 0.02
    try render(
      processor,
      Self.fetchFxRateText
    )
    await waitUntil { !errors.isEmpty }

    #expect(text(surface) == nil)
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.message.contains("timed out") == true)
  }

  @Test func sendsOneRequestForIdenticalBindings() async throws {
    let (processor, surface) = try makeProcessor()
    let fetch = #"{"@call": "fetchFxRate", "args": {"base": "EUR"}}"#
    try render(
      processor,
      #"{"id": "root", "component": "Text", "text": \#(fetch), "label": \#(fetch)}"#
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    await settle()
    #expect(outbound.agentCalls.count == 1)

    try respond(processor, 0, #""value": 1.08"#)
    await waitUntil { text(surface) != nil }
    #expect(text(surface) == "1.08")
  }

  @Test func surfaceSharesIdenticalCallsAwaitingResponse() async throws {
    let (processor, surface) = try makeProcessor()
    let call = AgentFunctionCall(
      name: "fetchFxRate",
      catalogID: Self.finCatalogID,
      args: ["base": "EUR"]
    )
    async let first = surface.callAgentFunction(call)
    async let second = surface.callAgentFunction(call)
    await waitUntil { outbound.agentCalls.count == 1 }
    await settle()
    #expect(outbound.agentCalls.count == 1)

    try respond(processor, 0, #""value": 1.08"#)
    #expect(try await first == .number(1.08))
    #expect(try await second == .number(1.08))

    // Once answered, the same call is sent again.
    async let third = surface.callAgentFunction(call)
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(outbound.agentCalls.count == 2)
    try respond(processor, 1, #""value": 1.09"#)
    #expect(try await third == .number(1.09))
  }

  @Test func sendsSeparateRequestsForDifferentArguments() async throws {
    let (processor, _) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "fetchFxRate", "args": {"base": "EUR"}},
       "label": {"@call": "fetchFxRate", "args": {"base": "USD"}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(outbound.agentCalls.count == 2)
  }

  @Test func sendsActionFunctionCall() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"functionCall": {"@call": "submitOrder", "args": {"id": "o-1"}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    await settle()
    #expect(outbound.agentCalls.isEmpty, "resolving an action does not run it")

    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    let call = try #require(outbound.agentCalls.first)
    #expect(call.callFunction.call == "submitOrder")
    #expect(call.callFunction.args == ["id": "o-1"])

    try respond(processor, 0, #""value": "ok-1""#)
    await settle()

    // Triggering the action again sends a fresh call instead of reading the surface cache.
    action()
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(outbound.agentCalls[1].callFunction.call == "submitOrder")
    #expect(outbound.agentCalls[1].callFunction.args == ["id": "o-1"])
  }

  @Test func concurrentActionInvocationsNeverShareInFlightCall() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"functionCall": {"@call": "submitOrder", "args": {"id": "o-1"}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)

    action()
    action()
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(outbound.agentCalls.count == 2)
  }

  @Test func eventActionAwaitsAgentFunctionInContext() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout",
                             "context": {"token": {"@call": "mintToken"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(handler.capturedActions.isEmpty)

    try respond(processor, 0, #""value": "t-99""#)
    await waitUntil { handler.capturedActions.count == 1 }
    if case .event(let name, let ctx, _) = handler.capturedActions.first?.identity {
      #expect(name == "checkout")
      #expect(ctx?["token"] == .string("t-99"))
    } else {
      Issue.record("Expected checkout event action")
    }
  }

  @Test func eventActionAwaitingAgentFunctionKeepsMetadata() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout",
                             "context": {"token": {"@call": "mintToken"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    try action(metadata: ["extensions": .object(["origin": .string("tap")])])
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(handler.capturedActions.isEmpty)

    try respond(processor, 0, #""value": "t-99""#)
    await waitUntil { handler.capturedActions.count == 1 }
    #expect(
      handler.capturedActions.first?.metadata
        == ["extensions": .object(["origin": .string("tap")])]
    )
  }

  @Test func sendsActionFunctionCallOnceNestedAgentArgumentSettles() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"functionCall": {"@call": "submitOrder",
                                    "args": {"token": {"@call": "mintToken"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    await settle()
    #expect(outbound.agentCalls.map(\.callFunction.call) == ["mintToken"])

    try respond(processor, 0, #""value": "t-1""#)
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(outbound.agentCalls[1].callFunction.call == "submitOrder")
    #expect(outbound.agentCalls[1].callFunction.args == ["token": "t-1"])
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func stopsActionFunctionCallWhenNestedAgentArgumentFails() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"functionCall": {"@call": "submitOrder",
                                    "args": {"token": {"@call": "mintToken"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }

    try respond(processor, 0, #""error": {"code": "FAIL", "message": "no token"}"#)
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(outbound.agentCalls.map(\.callFunction.call) == ["mintToken"])
    #expect(errors.count == 1)
    #expect(errors.first?.message.contains("no token") == true)

    // Running the action again retries the failed call.
    action()
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(outbound.agentCalls[1].callFunction.call == "mintToken")
  }

  @Test func stopsActionFunctionCallWhenNestedArgumentFailsSynchronously() async throws {
    let (processor, surface) = try makeProcessor()
    try process(processor, Self.setSymbol("42"))
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"functionCall": {"@call": "submitOrder",
                                    "args": {"price": {"@call": "quote",
                                                       "args": {"symbol": {"@path": "/symbol"}}},
                                             "token": {"@call": "mintToken"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": "t-1""#)
    await settle()
    #expect(outbound.agentCalls.map(\.callFunction.call) == ["mintToken"])
    #expect(errors.count == 1)
    #expect(errors.first?.expression == "quote")
  }

  @Test func sendsCheckRuleFunctionCall() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "checks": [{"condition": {"@call": "isAvailable"}, "message": "Unavailable"}]}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(outbound.agentCalls.first?.callFunction.call == "isAvailable")
    let checks = { surface.rootNode?.properties["checks"] as? [ResolvedCheck] }
    #expect(checks()?.first?.isPending == true)
    #expect(checks()?.first?.passed == false, "a pending check does not pass")
    #expect(checks()?.first?.isValid == true, "a pending check does not fail either")
    #expect(surface.rootNode?.isValid == true)
    #expect(surface.rootNode?.isValidationPending == true)
    #expect(surface.rootNode?.validationResults.isEmpty == true)

    try respond(processor, 0, #""value": true"#)
    await waitUntil { checks()?.first?.isPending == false }
    #expect(checks()?.first?.passed == true)
    #expect(surface.rootNode?.isValidationPending == false)
  }

  @Test func pendingCheckBecomesInvalidWhenCallFails() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "checks": [{"condition": {"@call": "isAvailable"}, "message": "Unavailable"}]}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(surface.rootNode?.isValid == true)

    try respond(processor, 0, #""error": {"code": "FAIL", "message": "down"}"#)
    await waitUntil { surface.rootNode?.isValid == false && !errors.isEmpty }
    #expect(surface.rootNode?.validationErrors == ["Unavailable"])
    #expect(surface.rootNode?.isValidationPending == false)
    #expect(errors.count == 1)
    await settle()
    #expect(outbound.agentCalls.count == 1, "resolving the failed check again sends nothing")
  }

  @Test func requiresUserActivationForDeclaredFunction() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text", "text": {"@call": "confirmOrder"},
       "onClick": {"functionCall": {"@call": "confirmOrder"}}}
      """
    )
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.message.contains("requires user activation") == true)

    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(outbound.agentCalls.first?.callFunction.call == "confirmOrder")
  }

  @Test func rejectsAgentOnlyDeclaredFunction() async throws {
    let (_, surface) = try makeProcessor()
    let value = context(surface).resolveDynamicValue(["@call": "auditLog"])
    #expect(value == .null)
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.message.contains("cannot be called by renderer") == true)
  }

  @Test func reportsUnavailableCatalogAsCatalogError() async throws {
    let (_, surface) = try makeProcessor()
    let value = context(surface).resolveDynamicValue([
      "@call": "fetchFxRate",
      "catalogId": "https://example.com/unknown.json",
      "args": [:],
    ])
    #expect(value == .null)
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(handler.capturedErrors.count == 1)
    guard case .generic(let error) = handler.capturedErrors.first else {
      Issue.record("Expected a generic error, got \(handler.capturedErrors)")
      return
    }
    #expect(error.code == "CATALOG_ERROR")
  }

  @Test func doesNotRouteSystemFunctions() async throws {
    let (_, surface) = try makeProcessor()
    let value = context(surface).resolveDynamicValue(["@call": "@unknownSystemFunction"])
    #expect(value == .null)
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.message.contains("Function not found") == true)
  }

  @Test func keepsFailingLocallyWithoutOutboundListener() async throws {
    let (_, surface) = try makeProcessor(listening: false)
    #expect(surface.agentFunctionCaller == nil)
    let value = context(surface).resolveDynamicValue(
      ["@call": "fetchFxRate", "args": ["base": "EUR"]]
    )
    #expect(value == .null)
    await settle()
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.message.contains("Function not found") == true)
  }

  @Test func schemaOnlyFunctionFailsWithoutOutboundListener() async throws {
    let (_, surface) = try makeProcessor(listening: false)
    let value = context(surface).resolveDynamicValue(
      ["@call": "quote", "args": ["symbol": "GOOG"]]
    )
    #expect(value == .null)
    await settle()
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.message.contains("schema-only") == true)
  }

  @Test func installsCallerWhenOutboundListenerIsSetLater() async throws {
    let (processor, surface) = try makeProcessor(listening: false)
    let outbound = self.outbound
    processor.outboundListener = { message in
      MainActor.assumeIsolated {
        outbound.messages.append(message)
      }
    }
    #expect(surface.agentFunctionCaller != nil)
    try render(processor, Self.fetchFxRateText)
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(outbound.agentCalls.count == 1)

    processor.outboundListener = nil
    #expect(surface.agentFunctionCaller == nil)
  }

  @Test func routesRenderedCallsOnceOutboundListenerIsSet() async throws {
    let (processor, surface) = try makeProcessor(listening: false)
    try render(processor, Self.fetchFxRateText)
    await settle()
    #expect(text(surface) == nil)
    #expect(outbound.agentCalls.isEmpty)
    #expect(!handler.capturedErrors.isEmpty, "the call fails locally without a listener")

    let outbound = self.outbound
    processor.outboundListener = { message in
      MainActor.assumeIsolated {
        outbound.messages.append(message)
      }
    }
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(outbound.agentCalls.first?.callFunction.call == "fetchFxRate")

    try respond(processor, 0, #""value": 1.08"#)
    await waitUntil { text(surface) != nil }
    #expect(text(surface) == "1.08")
  }

  /// An agent-initiated call is unaffected: the renderer can't run a schema-only function.
  @Test func agentCannotCallSchemaOnlyFunctionOnRenderer() async throws {
    let catalog = try makeCatalog()
    let response = await RPCHandler().handleIncomingCall(
      CallRendererFunctionMessage(
        functionCallID: "c1",
        callFunction: CallFunctionPayload(
          call: "quote",
          catalogID: Self.finCatalogID,
          args: ["symbol": "GOOG"]
        ),
        version: .v10
      ),
      catalogs: [Self.finCatalogID: catalog]
    )

    #expect(response.value == nil)
    #expect(response.error?.code == "INVALID_FUNCTION_CALL")
    #expect(response.error?.message == "Function not found: quote")
  }

  @Test func doesNotRouteCallsOnPre10Surface() async throws {
    let (_, surface) = try makeProcessor(version: "v0.9")
    #expect(surface.agentFunctionCaller == nil)
    let value = context(surface).resolveDynamicValue(["call": "fetchFxRate", "args": [:]])
    #expect(value == .null)
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.message.contains("Function not found") == true)
  }

  @Test func synchronousNestedArgumentFailureStopsEnclosingCalls() async throws {
    let (_, surface) = try makeProcessor()
    let dataContext = context(surface)

    let localValue = dataContext.resolveDynamicValue([
      "@call": "upper",
      "args": [
        "value": ["@call": "quote", "args": ["symbol": 123]]
      ],
    ])
    #expect(localValue == .null)
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.expression == "quote")

    handler.capturedErrors.removeAll()
    let agentValue = dataContext.resolveDynamicValue([
      "@call": "outerAgent",
      "args": [
        "nested": ["@call": "quote", "args": ["symbol": 123]]
      ],
    ])
    #expect(agentValue == .null)
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.expression == "quote")
  }

  @Test func failedNestedAgentCallStaysFailedAfterSiblingDataUpdate() async throws {
    let (processor, surface) = try makeProcessor()
    try process(
      processor,
      """
      {"version": "1.0",
       "updateDataModel": {"surfaceId": "s1", "path": "/prefix", "value": "A"}}
      """
    )
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "upper",
                "args": {"value": {"@call": "fetchGreeting"},
                         "extra": {"@path": "/prefix"}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(
      processor,
      0,
      #""error": {"code": "EXECUTION_ERROR", "message": "Fetch failed"}"#
    )
    await waitUntil { !errors.isEmpty }
    #expect(errors.count == 1)
    #expect(errors.first?.expression == "fetchGreeting")
    #expect(text(surface) == nil)

    try process(
      processor,
      """
      {"version": "1.0",
       "updateDataModel": {"surfaceId": "s1", "path": "/prefix", "value": "B"}}
      """
    )
    await settle()
    #expect(outbound.agentCalls.count == 1)
    #expect(errors.count == 1)
    #expect(text(surface) == nil)
  }

  @Test func deleteSurfaceCancelsPendingAgentCallsWithoutSurfaceErrors() async throws {
    let (processor, _) = try makeProcessor()
    try render(processor, Self.fetchFxRateText)
    await waitUntil { outbound.agentCalls.count == 1 }

    try process(
      processor,
      #"{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}"#
    )
    await settle()
    #expect(errors.isEmpty)
  }

  // MARK: - Cross-SDK alignment

  /// An action's user activation still applies to a call that runs after its agent arguments
  /// settle.
  @Test func userActivationSurvivesNestedAgentArgument() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"functionCall": {"@call": "confirmOrder",
                                    "args": {"token": {"@call": "mintToken"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": "t-1""#)
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(outbound.agentCalls[1].callFunction.call == "confirmOrder")
    #expect(outbound.agentCalls[1].callFunction.args == ["token": "t-1"])
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func eventActionResolvesContextEntriesInOrder() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout",
                             "context": {"token": {"@call": "mintToken"},
                                         "user": {"@call": "lookupUser"}},
                             "userMessage": {"@call": "describeOrder"}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    let answers = ["mintToken": #""value": "t-1""#, "lookupUser": #""value": "u-1""#]
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    await settle()
    #expect(outbound.agentCalls.count == 1, "one context entry is resolved at a time")
    let firstName = try #require(outbound.agentCalls.first?.callFunction.call)
    try respond(processor, 0, try #require(answers[firstName]))

    await waitUntil { outbound.agentCalls.count == 2 }
    await settle()
    #expect(outbound.agentCalls.count == 2)
    let names = Set(outbound.agentCalls.map(\.callFunction.call))
    #expect(names == ["mintToken", "lookupUser"])
    let secondName = outbound.agentCalls[1].callFunction.call
    try respond(processor, 1, try #require(answers[secondName]))

    // `userMessage` is resolved after every `context` entry.
    await waitUntil { outbound.agentCalls.count == 3 }
    #expect(outbound.agentCalls[2].callFunction.call == "describeOrder")
    #expect(handler.capturedActions.isEmpty)

    try respond(processor, 2, #""value": "Buy it""#)
    await waitUntil { handler.capturedActions.count == 1 }
    guard case .event(_, let context, let userMessage) = handler.capturedActions.first?.identity
    else {
      Issue.record("Expected an event action")
      return
    }
    #expect(context == ["token": "t-1", "user": "u-1"])
    #expect(userMessage == "Buy it")
    #expect(outbound.agentCalls.count == 3, "settled entries are not sent again")
  }

  @Test func eventActionStopsAtFirstFailedEntry() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout",
                             "context": {"token": {"@call": "mintToken"},
                                         "user": {"@call": "lookupUser"}},
                             "userMessage": {"@call": "describeOrder"}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""error": {"code": "FAIL", "message": "no token"}"#)
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(outbound.agentCalls.count == 1, "no later entry sends a call")
    #expect(errors.count == 1)
    #expect(handler.capturedActions.isEmpty)
  }

  @Test func eventActionStopsAtFirstSynchronouslyFailedEntry() async throws {
    let (processor, surface) = try makeProcessor()
    try process(processor, Self.setSymbol("42"))
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout",
                             "context": {"price": {"@call": "quote",
                                                   "args": {"symbol": {"@path": "/symbol"}}}},
                             "userMessage": {"@call": "describeOrder"}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await settle()
    #expect(outbound.agentCalls.isEmpty, "the user message is not resolved")
    #expect(errors.count == 1)
    #expect(errors.first?.expression == "quote")
    #expect(handler.capturedActions.isEmpty)
  }

  @Test func actionReportsOnlyFirstFailureOfSiblingCalls() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"functionCall": {"@call": "submitOrder",
                                    "args": {"token": {"@call": "mintToken"},
                                             "user": {"@call": "lookupUser"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 2 }
    try respond(processor, 0, #""error": {"code": "FAIL", "message": "first"}"#)
    try respond(processor, 1, #""error": {"code": "FAIL", "message": "second"}"#)
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(errors.count == 1)
    #expect(outbound.agentCalls.count == 2, "the enclosing function is not sent")
  }

  @Test func eventContextHonorsUserActivation() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "confirm",
                             "context": {"confirmed": {"@call": "confirmOrder"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(outbound.agentCalls.first?.callFunction.call == "confirmOrder")
    try respond(processor, 0, #""value": true"#)
    await waitUntil { handler.capturedActions.count == 1 }
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func sharesCallsWhoseArgumentsDifferOnlyInObjectKeyOrder() async throws {
    let (processor, _) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "search", "args": {"filter": {"a": 1, "b": [1, 2]}}},
       "label": {"@call": "search", "args": {"filter": {"b": [1, 2], "a": 1}}},
       "checks": [{"condition": {"@call": "search", "args": {"filter": {"a": 1, "b": [2, 1]}}},
                   "message": "No match"}]}
      """
    )
    await waitUntil { outbound.agentCalls.count == 2 }
    await settle()
    #expect(outbound.agentCalls.count == 2, "only array order makes calls differ")
  }

  @Test func refusesArgumentsThatAreNotJSON() async throws {
    let (_, surface) = try makeProcessor()
    let value = context(surface).resolveDynamicValue([
      "@call": "fetchFxRate", "args": ["rate": ["@call": "notANumber"]],
    ])
    #expect(value == .null)
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.expression == "fetchFxRate")
    #expect(errors.first?.message.contains("are not valid JSON") == true)
  }

  @Test func replacingCallerDropsAnswersAndIgnoresLateResults() async throws {
    let (processor, surface) = try makeProcessor()
    try render(processor, Self.fetchFxRateText)
    await waitUntil { outbound.agentCalls.count == 1 }

    surface.agentFunctionCaller = { _ in .number(2) }
    await waitUntil { text(surface) == "2" }
    #expect(text(surface) == "2", "the call is sent again through the new caller")

    // The answer to the call made through the previous caller is not kept.
    try respond(processor, 0, #""value": 1.08"#)
    await settle()
    #expect(text(surface) == "2")
    let call: JSONValue = ["@call": "fetchFxRate", "args": ["base": "EUR"]]
    #expect(context(surface).resolveDynamicValue(call) == .number(2))

    surface.agentFunctionCaller = { _ in .number(3) }
    await waitUntil { text(surface) == "3" }
    #expect(text(surface) == "3", "replacing the caller drops the kept answer")
  }

  @Test func sharedAnswersAreIndependentValues() async throws {
    let (processor, surface) = try makeProcessor()
    let call = AgentFunctionCall(name: "profile", catalogID: Self.finCatalogID)
    async let first = surface.callAgentFunction(call)
    async let second = surface.callAgentFunction(call)
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": {"name": "Ada"}"#)
    var firstValue = try await first
    firstValue["name"] = "Grace"
    #expect(try await second == ["name": "Ada"])
  }

  @Test func cancelledCallsReportNothing() async throws {
    let (processor, surface) = try makeProcessor()
    surface.agentFunctionCaller = { _ in
      throw FunctionError.surfaceCallsCancelled(surfaceID: "s1")
    }
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "fetchFxRate", "args": {"base": "EUR"}},
       "checks": [{"condition": {"@call": "isAvailable"}, "message": "Unavailable"}],
       "onClick": {"functionCall": {"@call": "submitOrder"}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await settle()
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func cancellingSurfaceCallsUsesNeutralMessage() async throws {
    let rpcHandler = RPCHandler()
    let call = Task { @MainActor in
      try await rpcHandler.callAgentFunction(
        surfaceID: "s1",
        functionName: "fetchFxRate",
        version: .v10,
        sendOutbound: { _ in }
      )
    }
    await settle()
    rpcHandler.cancelPendingCalls(forSurfaceID: "s1")
    do {
      _ = try await call.value
      Issue.record("Expected the call to be cancelled")
    } catch let error as FunctionError {
      #expect(error.rpcCode == "CANCELLED")
      #expect(error.description == "Pending calls for surface 's1' were cancelled.")
    }
  }

  @Test func deletedSurfaceSendsNothing() async throws {
    let (processor, surface) = try makeProcessor()
    let caller = try #require(surface.agentFunctionCaller)
    try process(processor, #"{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}"#)

    let call = AgentFunctionCall(name: "fetchFxRate", catalogID: Self.finCatalogID)
    await #expect(throws: FunctionError.surfaceCallsCancelled(surfaceID: "s1")) {
      try await surface.callAgentFunction(call)
    }
    await #expect(throws: FunctionError.surfaceCallsCancelled(surfaceID: "s1")) {
      try await caller(call)
    }
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func eventActionDoesNotResumeAfterDeleteSurface() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout",
                             "context": {"token": {"@call": "mintToken"},
                                         "user": {"@call": "lookupUser"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    try process(processor, #"{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}"#)
    await settle()
    #expect(outbound.agentCalls.count == 1)
    #expect(handler.capturedActions.isEmpty)
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func validatesSchemaOnlyArgumentsAfterTheyResolve() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "quote", "args": {"symbol": {"@call": "pickSymbol"}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(errors.isEmpty, "a pending argument is not validated")

    try respond(processor, 0, #""value": 42"#)
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(errors.count == 1)
    #expect(errors.first?.message.contains("Validation failed for function 'quote'") == true)
    #expect(outbound.agentCalls.map(\.callFunction.call) == ["pickSymbol"])
    #expect(text(surface) == nil)
  }

  @Test func failedCallIsSentAgainOnlyForNewEvaluationOrNewArguments() async throws {
    let (processor, _) = try makeProcessor()
    try process(processor, Self.setSymbol(#""EUR""#))
    try render(
      processor,
      """
      {"id": "root", "component": "Text", "label": {"@path": "/other"},
       "text": {"@call": "fetchFxRate", "args": {"base": {"@path": "/symbol"}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""error": {"code": "FAIL", "message": "boom"}"#)
    await waitUntil { !errors.isEmpty }

    try process(
      processor,
      #"{"version": "1.0", "updateDataModel": {"surfaceId": "s1", "path": "/other", "value": 1}}"#
    )
    await settle()
    #expect(outbound.agentCalls.count == 1, "an unrelated change doesn't send it again")

    // Remounting the node is a new evaluation, which sends the call again.
    try render(processor, #"{"id": "root", "component": "Text", "text": "static"}"#)
    try render(
      processor,
      """
      {"id": "root", "component": "Text", "label": {"@path": "/other"},
       "text": {"@call": "fetchFxRate", "args": {"base": {"@path": "/symbol"}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(outbound.agentCalls.count == 2, "a new evaluation sends it again")

    try process(processor, Self.setSymbol(#""USD""#))
    await waitUntil { outbound.agentCalls.count == 3 }
    #expect(outbound.agentCalls[2].callFunction.args == ["base": "USD"])
  }

  @Test func localFunctionFedByAgentKeepsUpdating() async throws {
    let (processor, surface) = try makeProcessor()
    try process(
      processor,
      """
      {"version": "1.0",
       "updateDataModel": {"surfaceId": "s1", "path": "/suffix", "value": "!"}}
      """
    )
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "join", "args": {"value": {"@call": "fetchGreeting"},
                                          "suffix": {"@path": "/suffix"}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": "hi""#)
    await waitUntil { text(surface) == "hi!" }

    try process(
      processor,
      """
      {"version": "1.0",
       "updateDataModel": {"surfaceId": "s1", "path": "/suffix", "value": "?"}}
      """
    )
    await waitUntil { text(surface) == "hi?" }
    #expect(text(surface) == "hi?")
    #expect(outbound.agentCalls.count == 1)
  }

  @Test func eventUserMessageThatResolvesToNonStringIsInvalidAction() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout", "userMessage": {"@call": "describeOrder"}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": 42"#)
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(handler.capturedActions.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.code == "INVALID_ACTION")
    #expect(errors.first?.message == "Action event 'userMessage' must resolve to a string.")
  }

  @Test func eventUserMessageThatResolvesToNonStringAtOnceIsInvalidAction() async throws {
    let (processor, surface) = try makeProcessor()
    try process(processor, Self.setSymbol("42"))
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout", "userMessage": {"@path": "/symbol"}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(handler.capturedActions.isEmpty)
    #expect(errors.count == 1)
    #expect(errors.first?.code == "INVALID_ACTION")
    #expect(errors.first?.message == "Action event 'userMessage' must resolve to a string.")
  }

  @Test func eventUserMessageThatResolvesToNullIsAbsent() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout", "userMessage": {"@path": "/missing"}}},
       "label": "x"}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { handler.capturedActions.count == 1 }
    guard case .event(_, _, let userMessage) = handler.capturedActions.first?.identity else {
      Issue.record("Expected an event action")
      return
    }
    #expect(userMessage == nil)
    await settle()
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func eventUserMessageThatResolvesToNullAfterAgentCallIsAbsent() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout", "userMessage": {"@call": "describeOrder"}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": null"#)
    await waitUntil { handler.capturedActions.count == 1 }
    guard case .event(_, _, let userMessage) = handler.capturedActions.first?.identity else {
      Issue.record("Expected an event action")
      return
    }
    #expect(userMessage == nil)
    await settle()
    #expect(handler.capturedErrors.isEmpty)
  }

  // MARK: - Cross-SDK alignment, round 2

  /// Counts the calls a test agent function caller receives.
  private final class CallCounter: @unchecked Sendable {
    var count = 0
  }

  @Test func cancellationIsNotRememberedAsFailure() async throws {
    let (processor, surface) = try makeProcessor()
    try process(processor, Self.setSymbol(#""EUR""#))
    let counter = CallCounter()
    surface.agentFunctionCaller = { _ in
      counter.count += 1
      if counter.count == 1 {
        throw FunctionError.surfaceCallsCancelled(surfaceID: "s1")
      }
      return .number(5)
    }
    try render(
      processor,
      """
      {"id": "root", "component": "Text", "label": {"@path": "/other"},
       "text": {"@call": "fetchFxRate", "args": {"base": {"@path": "/symbol"}}}}
      """
    )
    await waitUntil { counter.count == 1 }
    await settle()
    #expect(text(surface) == nil)

    // An unrelated change evaluates the binding again with the same arguments.
    try process(
      processor,
      #"{"version": "1.0", "updateDataModel": {"surfaceId": "s1", "path": "/other", "value": 1}}"#
    )
    await waitUntil { text(surface) == "5" }
    #expect(counter.count == 2, "the cancelled call is sent again")
    #expect(handler.capturedErrors.isEmpty, "cancellation is silent")
  }

  @Test func agentInitiatedCallArgumentsNeverRoute() async throws {
    let (_, surface) = try makeProcessor()
    let catalog = try makeCatalog()
    for nested in ["fetchGreeting", "quote"] {
      let response = await RPCHandler().handleIncomingCall(
        CallRendererFunctionMessage(
          functionCallID: "c-\(nested)",
          callFunction: CallFunctionPayload(
            call: "join",
            catalogID: Self.finCatalogID,
            args: ["value": ["@call": .string(nested), "args": ["symbol": "GOOG"]]]
          ),
          version: .v10
        ),
        catalogs: [Self.finCatalogID: catalog],
        defaultCatalogID: Self.finCatalogID,
        dataContext: context(surface)
      )
      #expect(response.value == nil)
      let message = try #require(response.error?.message)
      #expect(message.contains(nested), "the error names the nested function: \(message)")
    }
    await settle()
    #expect(outbound.agentCalls.isEmpty)
  }

  @Test func processorDisposeCancelsPendingCallsSilently() async throws {
    let (processor, surface) = try makeProcessor()
    try render(processor, Self.fetchFxRateText)
    await waitUntil { outbound.agentCalls.count == 1 }
    let call = AgentFunctionCall(name: "lookupUser", catalogID: Self.finCatalogID)
    let direct = Task { @MainActor in try await surface.callAgentFunction(call) }
    await waitUntil { outbound.agentCalls.count == 2 }

    processor.dispose()
    #expect(processor.surfaceGroupModel.surfacesMap.isEmpty)
    // The RPC handler has no pending call left: the call awaiting a response was rejected.
    await #expect(throws: FunctionError.self) { try await direct.value }
    await #expect(throws: FunctionError.surfaceCallsCancelled(surfaceID: "s1")) {
      try await surface.callAgentFunction(call)
    }
    try respond(processor, 0, #""value": 1.08"#)
    await settle()
    #expect(outbound.agentCalls.count == 2)
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func deleteSurfaceCancelsCallsAwaitingResponse() async throws {
    let (processor, surface) = try makeProcessor()
    let call = AgentFunctionCall(name: "lookupUser", catalogID: Self.finCatalogID)
    let direct = Task { @MainActor in try await surface.callAgentFunction(call) }
    await waitUntil { outbound.agentCalls.count == 1 }
    try process(processor, #"{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}"#)
    await #expect(throws: FunctionError.surfaceCallsCancelled(surfaceID: "s1")) {
      try await direct.value
    }
    await settle()
    #expect(handler.capturedErrors.isEmpty)
  }

  @Test func siblingArgumentsAreSentConcurrently() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "join", "args": {"value": {"@call": "fetchGreeting"},
                                          "suffix": {"@call": "fetchSuffix"}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 2 }
    #expect(Set(outbound.agentCalls.map(\.callFunction.call)) == ["fetchGreeting", "fetchSuffix"])
    for (index, call) in outbound.agentCalls.enumerated() {
      let value = call.callFunction.call == "fetchGreeting" ? "hi" : "!"
      try respond(processor, index, #""value": "\#(value)""#)
    }
    await waitUntil { text(surface) == "hi!" }
    #expect(text(surface) == "hi!")
  }

  /// More distinct calls than the cache's limit don't make a node send its calls again.
  @Test func manyActiveCallsAreNotSentAgain() async throws {
    let (processor, surface) = try makeProcessor()
    let count = 300
    let checks = (0..<count).map { index in
      #"{"condition": {"@call": "isAvailable", "args": {"slot": \#(index)}}, "message": "No"}"#
    }
    try render(
      processor,
      #"{"id": "root", "component": "Text", "checks": [\#(checks.joined(separator: ","))]}"#
    )
    await waitUntil { outbound.agentCalls.count == count }
    for index in 0..<count {
      try respond(processor, index, #""value": true"#)
    }
    await waitUntil { surface.rootNode?.checks.allSatisfy(\.passed) == true }
    await settle()
    #expect(outbound.agentCalls.count == count)
    #expect(surface.rootNode?.checks.count == count)
  }

  @Test func localFunctionThrowingInActionIsExecutionError() async throws {
    let (processor, surface) = try makeProcessor()
    try process(processor, Self.setSymbol("42"))
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "explode"},
       "onClick": {"functionCall": {"@call": "explode"}}}
      """
    )
    await waitUntil { !errors.isEmpty }
    #expect(errors.map(\.code) == ["EXPRESSION_ERROR"], "a binding reports EXPRESSION_ERROR")

    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { errors.count == 2 }
    #expect(errors.last?.code == "EXECUTION_ERROR")
    #expect(errors.last?.expression == "explode")
    #expect(errors.last?.message.contains("boom") == true)
    #expect(errors.last?.surfaceID == "s1")
  }

  /// A failing event entry is reported the same way, whether it runs at once or after a pending
  /// entry.
  @Test func eventEntryFailureIsReportedTheSameWayAfterPendingEntry() async throws {
    let (processor, surface) = try makeProcessor()
    try process(processor, Self.setSymbol("42"))
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout",
                             "context": {"token": {"@call": "mintToken"}},
                             "userMessage": {"@call": "explode"}}},
       "label": {"@path": "/other"}}
      """
    )
    let delayed = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    delayed()
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": "t-1""#)
    await waitUntil { !errors.isEmpty }

    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "checkout",
                             "userMessage": {"@call": "explode"}}}}
      """
    )
    let immediate = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    immediate()
    await waitUntil { errors.count == 2 }
    await settle()
    #expect(errors.count == 2)
    #expect(errors.map(\.code) == ["EXECUTION_ERROR", "EXECUTION_ERROR"])
    #expect(errors.map(\.surfaceID) == ["s1", "s1"])
    #expect(errors[0].message == errors[1].message)
    #expect(handler.capturedActions.isEmpty)
  }

  @Test func appliesNestedSchemaDefaultsToSchemaOnlyArguments() async throws {
    let (processor, _) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "estimate", "args": {"options": {"rounding": {}}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(
      outbound.agentCalls.first?.callFunction.args
        == ["options": ["rounding": ["digits": 2], "unit": "USD"]],
      "nested defaults are applied, and an absent object without a default stays absent"
    )
  }

  @Test func agentSuppliedKeysStayOrdinaryKeys() async throws {
    let (processor, _) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "text": {"@call": "fetchFxRate", "args": {"__proto__": {"polluted": true}}}}
      """
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    #expect(outbound.agentCalls.first?.callFunction.args == ["__proto__": ["polluted": true]])
  }

  // MARK: - Round 2 reconciliation

  /// A call that a running local function resolves, as `formatString` resolves its `${...}`
  /// parts, can't wait for the agent: it is refused, and the part is empty.
  @Test func interpolatedAgentCallIsRefused() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      #"{"id": "root", "component": "Text", "text": {"@call": "bracketGreeting"}}"#
    )
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(outbound.agentCalls.isEmpty)
    #expect(text(surface) == "[]")
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.expression == "fetchGreeting")
  }

  @Test func actionRefusesInterpolatedAgentCall() async throws {
    let (processor, surface) = try makeProcessor()
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"functionCall": {"@call": "submitOrder",
                                    "args": {"note": {"@call": "bracketGreeting"}}}}}
      """
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(outbound.agentCalls.isEmpty, "neither the template part nor the action is sent")
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.expression == "fetchGreeting")
  }

  /// Renders `component` on surface `s1` without payload validation, as a malformed component
  /// that reached the renderer.
  private func addUnvalidated(_ surface: SurfaceViewModel, _ component: JSONValue) async throws {
    let properties = try #require(component.dictionaryValue)
    surface.componentsModel.addComponent(
      ComponentModel(id: "root", type: "Text", properties: properties)
    )
    await waitUntil { surface.rootNode?.properties["onClick"] != nil }
  }

  @Test func malformedEventContextEntryIsExpressionError() async throws {
    let (_, surface) = try makeProcessor()
    try await addUnvalidated(
      surface,
      ["onClick": ["event": ["name": "checkout", "context": ["bad": ["@call": 5]]]]]
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.surfaceID == "s1")
    #expect(
      errors.first?.message
        == "Action event context entry 'bad' is invalid: '@call' must be a string."
    )
    #expect(handler.capturedActions.isEmpty)
  }

  @Test func malformedEventValueAfterPendingEntryIsReportedTheSameWay() async throws {
    let (processor, surface) = try makeProcessor()
    try await addUnvalidated(
      surface,
      [
        "onClick": [
          "event": [
            "name": "checkout",
            "context": ["token": ["@call": "mintToken"]],
            "userMessage": ["@call": "describeOrder", "args": 5],
          ]
        ]
      ]
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": "t-1""#)
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.surfaceID == "s1")
    #expect(
      errors.first?.message
        == "Action event userMessage is invalid: the 'args' of 'describeOrder' must be an object."
    )
    #expect(outbound.agentCalls.count == 1)
    #expect(handler.capturedActions.isEmpty)
  }

  @Test func nestedArgumentFailureWithoutMessageUsesFallbackText() async throws {
    let (_, surface) = try makeProcessor()
    let response = await RPCHandler().handleIncomingCall(
      CallRendererFunctionMessage(
        functionCallID: "c1",
        callFunction: CallFunctionPayload(
          call: "join",
          catalogID: Self.finCatalogID,
          args: ["value": ["@call": "silentFailure"]]
        ),
        version: .v10
      ),
      catalogs: [Self.finCatalogID: try makeCatalog()],
      defaultCatalogID: Self.finCatalogID,
      dataContext: context(surface)
    )
    #expect(response.error?.code == "EXECUTION_ERROR")
    #expect(response.error?.message == "An argument of the function call could not be resolved.")
  }

  /// Refusals are expression errors in actions too; only a local function that ran and threw is
  /// an execution error.
  @Test func refusalsInActionsAreExpressionErrors() async throws {
    let (processor, surface) = try makeProcessor()
    try process(processor, Self.setSymbol("42"))
    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"functionCall": {"@call": "quote",
                                    "args": {"symbol": {"@path": "/symbol"}}}}}
      """
    )
    let validation = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    validation()
    await waitUntil { errors.count == 1 }

    try render(
      processor,
      """
      {"id": "root", "component": "Text",
       "onClick": {"event": {"name": "audit", "context": {"logged": {"@call": "auditLog"}}}}}
      """
    )
    let agentOnly = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    agentOnly()
    await waitUntil { errors.count == 2 }
    await settle()
    #expect(errors.map(\.code) == ["EXPRESSION_ERROR", "EXPRESSION_ERROR"])
    #expect(errors.map(\.expression) == ["quote", "auditLog"])
    #expect(outbound.agentCalls.isEmpty)
    #expect(handler.capturedActions.isEmpty)
  }

  /// Answers `fetchGreeting` for a binding, so the surface keeps the answer.
  private func cacheGreeting(
    _ processor: MessageProcessor,
    _ surface: SurfaceViewModel
  ) async throws {
    try render(
      processor,
      #"{"id": "root", "component": "Text", "text": {"@call": "fetchGreeting"}}"#
    )
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": "hi""#)
    await waitUntil { text(surface) == "hi" }
    #expect(context(surface).resolveDynamicValue(["@call": "fetchGreeting"]) == "hi")
  }

  @Test func interpolatedAgentCallIsRefusedEvenWithKeptAnswer() async throws {
    let (processor, surface) = try makeProcessor()
    try await cacheGreeting(processor, surface)

    try render(
      processor,
      #"{"id": "root", "component": "Text", "text": {"@call": "bracketGreeting"}}"#
    )
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(text(surface) == "[]", "the kept answer isn't read")
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.expression == "fetchGreeting")
    #expect(outbound.agentCalls.count == 1)
  }

  @Test func agentInitiatedCallArgumentFailsEvenWithKeptAnswer() async throws {
    let (processor, surface) = try makeProcessor()
    try await cacheGreeting(processor, surface)

    let response = await RPCHandler().handleIncomingCall(
      CallRendererFunctionMessage(
        functionCallID: "c1",
        callFunction: CallFunctionPayload(
          call: "join",
          catalogID: Self.finCatalogID,
          args: ["value": ["@call": "fetchGreeting"]]
        ),
        version: .v10
      ),
      catalogs: [Self.finCatalogID: try makeCatalog()],
      defaultCatalogID: Self.finCatalogID,
      dataContext: context(surface)
    )
    await settle()
    #expect(response.value == nil)
    #expect(response.error?.code == "EXECUTION_ERROR")
    #expect(response.error?.message == "Function not found: fetchGreeting")
    #expect(outbound.agentCalls.count == 1)
  }

  /// A local function whose arguments don't match its schema is refused, not run: an
  /// `EXPRESSION_ERROR` in bindings and actions alike.
  @Test func localArgumentValidationFailureIsExpressionError() async throws {
    let (_, surface) = try makeProcessor()
    try await addUnvalidated(
      surface,
      [
        "text": ["@call": "upper"],
        "onClick": ["functionCall": ["@call": "upper"]],
      ]
    )
    await waitUntil { !errors.isEmpty }
    #expect(errors.map(\.code) == ["EXPRESSION_ERROR"], "the binding is refused")
    #expect(text(surface) == nil)

    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { errors.count == 2 }
    #expect(errors.last?.code == "EXPRESSION_ERROR")
    #expect(errors.last?.expression == "upper")
    #expect(errors.last?.message.contains("Validation failed for function 'upper'") == true)
  }

  @Test func eventContextLocalArgumentValidationFailureIsNotDispatched() async throws {
    let (_, surface) = try makeProcessor()
    try await addUnvalidated(
      surface,
      ["onClick": ["event": ["name": "checkout", "context": ["shout": ["@call": "upper"]]]]]
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(errors.map(\.code) == ["EXPRESSION_ERROR"])
    #expect(errors.first?.expression == "upper")
    #expect(handler.capturedActions.isEmpty)
  }

  @Test func unknownExpressionKeyInEventContextIsMalformed() async throws {
    let (_, surface) = try makeProcessor()
    try await addUnvalidated(
      surface,
      ["onClick": ["event": ["name": "checkout", "context": ["bad": ["@unknown": 1]]]]]
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.surfaceID == "s1")
    #expect(
      errors.first?.message
        == "Action event context entry 'bad' is invalid: '@unknown' is not a known expression key."
    )
    #expect(handler.capturedActions.isEmpty)
  }

  @Test func unknownExpressionKeyAfterPendingEntryIsReportedTheSameWay() async throws {
    let (processor, surface) = try makeProcessor()
    try await addUnvalidated(
      surface,
      [
        "onClick": [
          "event": [
            "name": "checkout",
            "context": ["token": ["@call": "mintToken"]],
            "userMessage": ["@unknown": 1],
          ]
        ]
      ]
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { outbound.agentCalls.count == 1 }
    try respond(processor, 0, #""value": "t-1""#)
    await waitUntil { !errors.isEmpty }
    await settle()
    #expect(errors.count == 1)
    #expect(errors.first?.code == "EXPRESSION_ERROR")
    #expect(errors.first?.surfaceID == "s1")
    #expect(
      errors.first?.message
        == "Action event userMessage is invalid: '@unknown' is not a known expression key."
    )
    #expect(handler.capturedActions.isEmpty)
  }

  @Test func escapedAtKeyInEventContextIsLiteral() async throws {
    let (_, surface) = try makeProcessor()
    try await addUnvalidated(
      surface,
      ["onClick": ["event": ["name": "checkout", "context": ["tag": ["@@mention": "ada"]]]]]
    )
    let action = try #require(surface.rootNode?.properties["onClick"] as? ResolvedAction)
    action()
    await waitUntil { handler.capturedActions.count == 1 }
    guard case .event(_, let context, _) = handler.capturedActions.first?.identity else {
      Issue.record("Expected an event action")
      return
    }
    #expect(context == ["tag": ["@mention": "ada"]])
    #expect(handler.capturedErrors.isEmpty)
  }
}
