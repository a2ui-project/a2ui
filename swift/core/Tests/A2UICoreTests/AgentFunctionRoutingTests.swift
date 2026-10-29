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
      functions: [UpperFunction(), Self.quote, Self.confirmOrder, Self.auditLog]
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

  @Test func directDataContextReadsSettledValue() async throws {
    let (processor, surface) = try makeProcessor()
    let dataContext = context(surface)
    let call: JSONValue = ["@call": "fetchFxRate", "args": ["base": "EUR"]]
    #expect(dataContext.resolveDynamicValue(call) == .null)
    await waitUntil { outbound.agentCalls.count == 1 }

    try respond(processor, 0, #""value": 1.08"#)
    await waitUntil { dataContext.resolveDynamicValue(call) != .null }
    #expect(dataContext.resolveDynamicValue(call) == .number(1.08))
    #expect(context(surface).resolveDynamicValue(call) == .number(1.08))
    #expect(outbound.agentCalls.count == 1, "reading the settled value sends nothing")
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
      #"{"id": "root", "component": "Text", "text": \#(fetch)}"#
    )
    let second = context(surface).resolveDynamicValue(
      ["@call": "fetchFxRate", "args": ["base": "EUR"]]
    )
    #expect(second == .null)
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
    let (_, surface) = try makeProcessor()
    let dataContext = context(surface)
    _ = dataContext.resolveDynamicValue(["@call": "fetchFxRate", "args": ["base": "EUR"]])
    _ = dataContext.resolveDynamicValue(["@call": "fetchFxRate", "args": ["base": "USD"]])
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
    #expect(checks()?.first?.isValid == false, "a pending check does not pass")

    try respond(processor, 0, #""value": true"#)
    await waitUntil { checks()?.first?.isValid == true }
    #expect(checks()?.first?.isValid == true)
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
    #expect(errors.first?.message.contains("Caller 'renderer' is not allowed") == true)
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
    _ = context(surface).resolveDynamicValue(["@call": "fetchFxRate", "args": ["base": "EUR"]])
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
}
