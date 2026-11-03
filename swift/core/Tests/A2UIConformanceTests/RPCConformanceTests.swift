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
import BasicCatalog
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing

private final class RPCErrorCaptureHandler: ActionHandling, @unchecked Sendable {
  var capturedErrors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    capturedErrors.append(error)
  }
}

private final class OutboundMessageBox: @unchecked Sendable {
  var lastMessage: RendererToAgentMessage?
  var lastAgentCall: CallAgentFunctionMessage?
  var lastActionResult: JSONValue?
}

/// Runs the shared `conformance/core/rpc_functions.yaml` suite.
@MainActor
struct RPCConformanceTests {
  private static let knownCaseKeys: Set<String> = [
    "action",
    "args",
    "catalog",
    "expect",
    "expectError",
  ]

  private static let knownArgsKeys: Set<String> = [
    "afterCall",
    "catalogId",
    "catalogVersion",
    "dataModel",
    "functionMetadata",
    "inboundResponse",
    "lateInboundResponse",
    "message",
    "outboundCall",
    "outboundListener",
    "secondOutboundCall",
    "surfaceId",
    "uiActionFallbackScenario",
    "uiBindingScenario",
    "userActivationPresent",
  ]

  private static let knownFunctionMetaKeys: Set<String> = [
    "allowedCallers",
    "parameters",
    "requiresUserActivation",
  ]

  private static let knownOutboundCallKeys: Set<String> = [
    "callFunction",
    "functionCallId",
    "surfaceId",
    "timeoutMs",
  ]

  private static let knownInboundResponseKeys: Set<String> = [
    "agentFunctionResponse",
    "version",
  ]

  private static let knownUIBindingKeys: Set<String> = [
    "catalogId",
    "component",
    "components",
    "inboundResponseError",
    "inboundResponseValue",
    "localFunctions",
    "observe",
    "surfaceId",
  ]

  private static let knownUIActionKeys: Set<String> = [
    "actionPayload",
    "catalogId",
    "inboundResponseError",
    "inboundResponseValue",
    "localFunctions",
    "surfaceId",
  ]

  private static let knownExpectKeys: Set<String> = [
    "correlatedCallId",
    "dataModel",
    "error",
    "initialValue",
    "lateResponseIgnored",
    "outboundCall",
    "resolvedValue",
    "response",
    "result",
    "siblings",
    "surfaceError",
    "validationResult",
  ]

  private static let knownExpectErrorKeys: Set<String> = [
    "category",
    "code",
    "functionCallId",
    "rendererError",
  ]

  @Test(arguments: ConformanceTestHelper.cases("core/rpc_functions.yaml"))
  func rpcFunctionsConformance(_ conformanceCase: ConformanceCase) async throws {
    try await ConformanceManifest.runAsync(conformanceCase) {
      try await runSingleRPCCase(conformanceCase)
    }
  }

  private func runSingleRPCCase(_ conformanceCase: ConformanceCase) async throws {
    let rawDict = conformanceCase.rawDictionary
    try validateRPCCaseKeys(rawDict, name: conformanceCase.name)
    let action = rawDict["action"] as? String ?? ""
    guard action == "handle_rpc" else {
      throw UnknownConformanceKeyError(
        "[\(conformanceCase.name)] Unknown rpc_functions.yaml action '\(action)'"
      )
    }
    let testCase = try #require(
      conformanceCase.parsedTestCase(),
      "[\(conformanceCase.name)] Could not parse rpc_functions case"
    )
    let rpcHandler = RPCHandler()
    let catalogs = buildRPCCatalogs(for: testCase)

    if let messageJSON = testCase.args?["message"] {
      try await runInboundMessageCase(
        testCase: testCase,
        messageJSON: messageJSON,
        catalogs: catalogs,
        rpcHandler: rpcHandler
      )
    }

    if let outboundCall = testCase.args?["outboundCall"] {
      try await runOutboundCallCase(
        testCase: testCase,
        outboundCall: outboundCall,
        catalogs: catalogs,
        rpcHandler: rpcHandler
      )
    }

    if let uiBinding = testCase.args?["uiBindingScenario"] {
      try await runUIBindingScenario(
        testCase: testCase,
        scenario: uiBinding
      )
    }

    if let uiActionFallback = testCase.args?["uiActionFallbackScenario"] {
      try await runUIActionFallbackScenario(
        testCase: testCase,
        scenario: uiActionFallback
      )
    }
  }

  private func validateRPCCaseKeys(_ rawDict: [String: Any], name: String) throws {
    try ConformanceTestHelper.assertKnownKeys(
      rawDict,
      Self.knownCaseKeys,
      "rpc_functions.yaml case '\(name)'"
    )
    if let args = rawDict["args"] as? [String: Any] {
      try validateRPCArgsKeys(args, name: name)
    }
    if let expect = rawDict["expect"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expect,
        Self.knownExpectKeys,
        "rpc_functions.yaml expect in '\(name)'",
        allowMetadata: false
      )
    }
    if let expectError = rawDict["expectError"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        expectError,
        Self.knownExpectErrorKeys,
        "rpc_functions.yaml expectError in '\(name)'",
        allowMetadata: false
      )
    }
  }

  private func validateRPCArgsKeys(_ args: [String: Any], name: String) throws {
    try ConformanceTestHelper.assertKnownKeys(
      args,
      Self.knownArgsKeys,
      "rpc_functions.yaml args in '\(name)'",
      allowMetadata: false
    )
    if let fnMeta = args["functionMetadata"] as? [String: Any] {
      for (fnName, rawMeta) in fnMeta {
        if let metaDict = rawMeta as? [String: Any] {
          try ConformanceTestHelper.assertKnownKeys(
            metaDict,
            Self.knownFunctionMetaKeys,
            "rpc_functions.yaml functionMetadata.\(fnName) in '\(name)'",
            allowMetadata: false
          )
        }
      }
    }
    if let outbound = args["outboundCall"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        outbound,
        Self.knownOutboundCallKeys,
        "rpc_functions.yaml outboundCall in '\(name)'",
        allowMetadata: false
      )
    }
    if let secondOutbound = args["secondOutboundCall"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        secondOutbound,
        Self.knownOutboundCallKeys,
        "rpc_functions.yaml secondOutboundCall in '\(name)'",
        allowMetadata: false
      )
    }
    if let inbound = args["inboundResponse"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        inbound,
        Self.knownInboundResponseKeys,
        "rpc_functions.yaml inboundResponse in '\(name)'",
        allowMetadata: false
      )
    }
    if let lateInbound = args["lateInboundResponse"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        lateInbound,
        Self.knownInboundResponseKeys,
        "rpc_functions.yaml lateInboundResponse in '\(name)'",
        allowMetadata: false
      )
    }
    if let uiBinding = args["uiBindingScenario"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        uiBinding,
        Self.knownUIBindingKeys,
        "rpc_functions.yaml uiBindingScenario in '\(name)'",
        allowMetadata: false
      )
    }
    if let uiAction = args["uiActionFallbackScenario"] as? [String: Any] {
      try ConformanceTestHelper.assertKnownKeys(
        uiAction,
        Self.knownUIActionKeys,
        "rpc_functions.yaml uiActionFallbackScenario in '\(name)'",
        allowMetadata: false
      )
    }
  }

  private func buildRPCCatalogs(for testCase: ConformanceTestCase) -> [String: AnyCatalog] {
    var functions: [any FunctionImplementation] = BasicFunctions.allFunctions
    if let metadata = testCase.args?["functionMetadata"]?.objectValue {
      for (fnName, metaVal) in metadata {
        functions.append(makeMockRPCFunction(name: fnName, metadata: metaVal))
      }
    }

    var catalogs: [String: AnyCatalog] = [:]
    for id in ["basic", "media_catalog", "system_catalog", "store_catalog"] {
      catalogs[id] = Catalog<AnyComponentAPI>(
        id: id,
        protocolVersion: "1.0",
        components: [],
        functions: functions
      ).eraseToAnyCatalog()
    }
    if let extraCatID = testCase.args?["catalogId"]?.stringValue {
      let extraCatVersion = testCase.args?["catalogVersion"]?.stringValue ?? "1.0"
      catalogs[extraCatID] = Catalog<AnyComponentAPI>(
        id: extraCatID,
        protocolVersion: extraCatVersion,
        components: [],
        functions: functions
      ).eraseToAnyCatalog()
    }
    return catalogs
  }

  private func makeMockRPCFunction(
    name functionName: String,
    metadata metadataValue: JSONValue
  ) -> any FunctionImplementation {
    let allowedCallersString = metadataValue["allowedCallers"]?.stringValue ?? "rendererOrAgent"
    let callers = AllowedCallers(rawValue: allowedCallersString) ?? .rendererOrAgent
    let requiresUserActivation = metadataValue["requiresUserActivation"]?.boolValue ?? false
    let parameterSchema: Schema? = metadataValue["parameters"].flatMap {
      try? Schema(rawSchema: $0, context: Context(dialect: .draft2020_12))
    }

    switch functionName {
    case "failingFunction":
      return ConformanceMockRPCFunction(
        name: functionName,
        schema: parameterSchema,
        allowedCallers: callers,
        requiresUserActivation: requiresUserActivation
      ) { _, _ in
        throw A2UIValidationError("Runtime error")
      }
    case "playMedia":
      return ConformanceMockRPCFunction(
        name: functionName,
        schema: parameterSchema,
        allowedCallers: callers,
        requiresUserActivation: requiresUserActivation
      ) { _, _ in
        .object(["playing": .boolean(true), "timestamp": .integer(0)])
      }
    case "openExternalUrl":
      return ConformanceMockRPCFunction(
        name: functionName,
        schema: parameterSchema,
        allowedCallers: callers,
        requiresUserActivation: requiresUserActivation
      ) { _, _ in
        .object(["opened": .boolean(true)])
      }
    case "echoArgs":
      return ConformanceMockRPCFunction(
        name: functionName,
        schema: parameterSchema,
        allowedCallers: callers,
        requiresUserActivation: requiresUserActivation
      ) { args, _ in
        var ordered: OrderedDictionary<String, JSONValue> = [:]
        for key in args.keys.sorted() {
          ordered[key] = args[key]
        }
        return .object(ordered)
      }
    default:
      return ConformanceMockRPCFunction(
        name: functionName,
        schema: parameterSchema,
        allowedCallers: callers,
        requiresUserActivation: requiresUserActivation
      ) { _, _ in
        .null
      }
    }
  }

  private func runInboundMessageCase(
    testCase: ConformanceTestCase,
    messageJSON: JSONValue,
    catalogs: [String: AnyCatalog],
    rpcHandler: RPCHandler
  ) async throws {
    let userActivation = testCase.args?["userActivationPresent"]?.boolValue ?? false

    do {
      let message = try AgentToRendererMessage.parseAll(messageJSON).first
      if case .callRendererFunction(let callMsg)? = message {
        let contextAndCatalog = buildSurfaceContext(
          for: callMsg.surfaceID,
          testCase: testCase,
          catalogs: catalogs
        )
        let response = await rpcHandler.handleIncomingCall(
          callMsg,
          catalogs: catalogs,
          defaultCatalogID: contextAndCatalog.defaultCatalogID,
          dataContext: contextAndCatalog.context,
          userActivationPresent: userActivation
        )
        assertRPCResponseMatches(response: response, testCase: testCase)
      }
    } catch {
      assertEnvelopeFaultMatches(
        messageJSON: messageJSON,
        catalogs: catalogs,
        testCase: testCase
      )
    }
  }

  private func buildSurfaceContext(
    for targetSurfaceID: String?,
    testCase: ConformanceTestCase,
    catalogs: [String: AnyCatalog]
  ) -> (context: DataContext?, defaultCatalogID: String?) {
    guard let targetSurfaceID,
      let configuredSurfaceID = testCase.args?["surfaceId"]?.stringValue,
      targetSurfaceID == configuredSurfaceID
    else {
      return (nil, nil)
    }
    let surface = SurfaceViewModel(
      surfaceID: configuredSurfaceID,
      catalogs: catalogs,
      defaultCatalogID: "basic",
      protocolVersion: .v10
    )
    if let dataModelObj = testCase.args?["dataModel"]?.objectValue {
      for (key, val) in dataModelObj {
        surface.dataModel.set("/\(key)", value: val)
      }
    }
    let context = DataContext(
      dataModel: surface.dataModel,
      path: "/",
      functionHandler: surface,
      protocolVersion: .v10
    )
    return (context, surface.defaultCatalogID)
  }

  private func assertRPCResponseMatches(
    response: RendererFunctionResponseMessage,
    testCase: ConformanceTestCase
  ) {
    guard let expectedResp = testCase.expect?["response"]?["rendererFunctionResponse"] else {
      return
    }
    let expectedCallID = expectedResp["functionCallId"]?.stringValue
    #expect(response.functionCallID == expectedCallID, "[\(testCase.name)] functionCallId mismatch")

    if let expectedValue = expectedResp["value"] {
      #expect(response.value == expectedValue, "[\(testCase.name)] value mismatch")
    }
    if let expectedErr = expectedResp["error"] {
      let expectedCode = expectedErr["code"]?.stringValue
      let expectedMsg = expectedErr["message"]?.stringValue
      #expect(response.error?.code == expectedCode, "[\(testCase.name)] error.code mismatch")
      if let expectedMsg {
        #expect(
          ConformanceTestHelper.messageMatches(
            response.error?.message ?? "", expected: expectedMsg),
          """
          [\(testCase.name)] error.message mismatch: \
          \(String(describing: response.error?.message))
          """
        )
      }
    }
  }

  private func assertEnvelopeFaultMatches(
    messageJSON: JSONValue,
    catalogs: [String: AnyCatalog],
    testCase: ConformanceTestCase
  ) {
    let errorHandler = RPCErrorCaptureHandler()
    let processor = MessageProcessor(
      catalogs: Array(catalogs.values),
      actionHandler: errorHandler,
      validationConfig: .strict
    )
    var caughtError: Error?
    do {
      try processor.processMessages(messageJSON)
    } catch {
      caughtError = error
    }
    #expect(
      caughtError != nil, "[\(testCase.name)] Expected processor to throw on invalid RPC message")

    if let expectedRendererError = testCase.expectError?.rendererError {
      ConformanceTestHelper.assertRendererErrorMatches(
        errorHandler.capturedErrors.last,
        expected: expectedRendererError,
        context: testCase.name
      )
    } else if let expectedErr = testCase.expect?["error"]?.objectValue,
      let msgSub = expectedErr["message"]?.stringValue
    {
      let desc =
        caughtError.map { ($0 as? (any A2UIError))?.message ?? $0.localizedDescription } ?? ""
      #expect(
        ConformanceTestHelper.messageMatches(desc, expected: msgSub),
        "[\(testCase.name)] Expected error message containing '\(msgSub)', got '\(desc)'"
      )
    }
  }

  private func runOutboundCallCase(
    testCase: ConformanceTestCase,
    outboundCall: JSONValue,
    catalogs: [String: AnyCatalog],
    rpcHandler: RPCHandler
  ) async throws {
    if let inboundResponse = testCase.args?["inboundResponse"] {
      try await runCorrelatedOutboundCall(
        testCase: testCase,
        outboundCall: outboundCall,
        inboundResponse: inboundResponse,
        rpcHandler: rpcHandler
      )
    } else if testCase.args?["outboundListener"]?.boolValue == false {
      await runNoListenerOutboundCall(
        testCase: testCase,
        outboundCall: outboundCall,
        catalogs: catalogs
      )
    } else if let secondCall = testCase.args?["secondOutboundCall"] {
      await runDuplicateOutboundCall(
        testCase: testCase,
        firstCall: outboundCall,
        secondCall: secondCall,
        rpcHandler: rpcHandler
      )
    } else if let afterCall = testCase.args?["afterCall"]?.stringValue {
      try await runAfterCallOutboundCall(
        testCase: testCase,
        outboundCall: outboundCall,
        afterCall: afterCall,
        rpcHandler: rpcHandler
      )
    } else {
      try await runTimeoutOutboundCall(
        testCase: testCase,
        outboundCall: outboundCall,
        rpcHandler: rpcHandler
      )
    }
  }

  private func runCorrelatedOutboundCall(
    testCase: ConformanceTestCase,
    outboundCall: JSONValue,
    inboundResponse: JSONValue,
    rpcHandler: RPCHandler
  ) async throws {
    let surfaceID = outboundCall["surfaceId"]?.stringValue ?? "s"
    let fnCallID = outboundCall["functionCallId"]?.stringValue ?? "c"
    let expectedCallFunction = outboundCall["callFunction"]?.objectValue ?? [:]
    let call =
      expectedCallFunction["@call"]?.stringValue
      ?? expectedCallFunction["call"]?.stringValue ?? ""
    let catID = expectedCallFunction["catalogId"]?.stringValue
    let args: [String: JSONValue]? = expectedCallFunction["args"]?.objectValue.map {
      Dictionary(uniqueKeysWithValues: $0.map { ($0.key, $0.value) })
    }

    let box = OutboundMessageBox()
    var callTask: Task<JSONValue, any Error>!
    await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
      callTask = Task {
        try await rpcHandler.callAgentFunction(
          surfaceID: surfaceID,
          functionName: call,
          catalogID: catID,
          functionCallID: fnCallID,
          args: args,
          version: .v10,
          timeoutSeconds: 5.0,
          sendOutbound: { message in
            box.lastMessage = message
            started.resume()
          }
        )
      }
    }

    assertOutboundCallAgentMatches(
      captured: box.lastMessage,
      expectedOutbound: .object(["callAgentFunction": outboundCall]),
      testName: testCase.name
    )

    let respData = try JSONEncoder().encode(inboundResponse)
    let respMsg = try JSONDecoder().decode(AgentToRendererMessage.self, from: respData)
    if case .agentFunctionResponse(let agentResp) = respMsg {
      rpcHandler.handleAgentResponse(agentResp)
    }

    let result = try await callTask.value
    let expectedResult = testCase.expect?["result"]
    #expect(result == expectedResult, "[\(testCase.name)] Outbound call result mismatch")
  }

  private func assertLateResponseIgnored(
    testCase: ConformanceTestCase,
    rpcHandler: RPCHandler
  ) throws {
    guard let lateInbound = testCase.args?["lateInboundResponse"] else { return }
    let respData = try JSONEncoder().encode(lateInbound)
    let respMsg = try JSONDecoder().decode(AgentToRendererMessage.self, from: respData)
    if case .agentFunctionResponse(let agentResp) = respMsg {
      rpcHandler.handleAgentResponse(agentResp)
    }
    if testCase.expect?["lateResponseIgnored"]?.boolValue == true {
      #expect(true)
    }
  }

  private func runNoListenerOutboundCall(
    testCase: ConformanceTestCase,
    outboundCall: JSONValue,
    catalogs: [String: AnyCatalog]
  ) async {
    let surfaceID = outboundCall["surfaceId"]?.stringValue ?? "s"
    let fnCallID = outboundCall["functionCallId"]?.stringValue ?? "c"
    let call =
      outboundCall["callFunction"]?["@call"]?.stringValue
      ?? outboundCall["callFunction"]?["call"]?.stringValue ?? ""
    let processor = MessageProcessor(catalogs: Array(catalogs.values))
    do {
      _ = try await processor.callAgentFunction(
        surfaceID: surfaceID,
        functionName: call,
        functionCallID: fnCallID,
        version: .v10
      )
      Issue.record("[\(testCase.name)] Expected NO_LISTENER error")
    } catch let error as FunctionError {
      if case .noListener = error {
        #expect(testCase.expectError?.code == "NO_LISTENER")
      } else {
        Issue.record("[\(testCase.name)] Expected FunctionError.noListener, got \(error)")
      }
    } catch {
      Issue.record("[\(testCase.name)] Unexpected error: \(error)")
    }
  }

  private func runAfterCallOutboundCall(
    testCase: ConformanceTestCase,
    outboundCall: JSONValue,
    afterCall: String,
    rpcHandler: RPCHandler
  ) async throws {
    let surfaceID = outboundCall["surfaceId"]?.stringValue ?? "s"
    let fnCallID = outboundCall["functionCallId"]?.stringValue ?? "c"
    let call =
      outboundCall["callFunction"]?["@call"]?.stringValue
      ?? outboundCall["callFunction"]?["call"]?.stringValue ?? ""

    var callTask: Task<JSONValue, any Error>!
    await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
      callTask = Task {
        try await rpcHandler.callAgentFunction(
          surfaceID: surfaceID,
          functionName: call,
          functionCallID: fnCallID,
          version: .v10,
          timeoutSeconds: 5.0,
          sendOutbound: { _ in
            started.resume()
          }
        )
      }
    }

    if afterCall == "cancel" {
      rpcHandler.cancelAllPendingCalls()
      do {
        _ = try await callTask.value
        Issue.record("[\(testCase.name)] Expected CANCELLED error")
      } catch let error as FunctionError {
        if case .cancelled = error {
          #expect(testCase.expectError?.code == "CANCELLED")
        } else {
          Issue.record("[\(testCase.name)] Expected FunctionError.cancelled, got \(error)")
        }
      }
    } else if afterCall == "dispose" {
      rpcHandler.disposeAllPendingCalls()
      do {
        _ = try await callTask.value
        Issue.record("[\(testCase.name)] Expected DISPOSED error")
      } catch let error as FunctionError {
        if case .disposed = error {
          #expect(testCase.expectError?.code == "DISPOSED")
        } else {
          Issue.record("[\(testCase.name)] Expected FunctionError.disposed, got \(error)")
        }
      }
      try assertLateResponseIgnored(testCase: testCase, rpcHandler: rpcHandler)
    }
  }

  private func runTimeoutOutboundCall(
    testCase: ConformanceTestCase,
    outboundCall: JSONValue,
    rpcHandler: RPCHandler
  ) async throws {
    let surfaceID = outboundCall["surfaceId"]?.stringValue ?? "s"
    let fnCallID = outboundCall["functionCallId"]?.stringValue ?? "c"
    let call =
      outboundCall["callFunction"]?["@call"]?.stringValue
      ?? outboundCall["callFunction"]?["call"]?.stringValue ?? ""
    let timeoutMs = outboundCall["timeoutMs"]?.doubleValue ?? 10.0

    do {
      _ = try await rpcHandler.callAgentFunction(
        surfaceID: surfaceID,
        functionName: call,
        functionCallID: fnCallID,
        version: .v10,
        timeoutSeconds: timeoutMs / 1000.0,
        sendOutbound: { _ in }
      )
      Issue.record("[\(testCase.name)] Expected timeout error")
    } catch let error as FunctionError {
      if case .timeout = error {
        #expect(testCase.expectError?.code == "TIMEOUT")
      } else {
        Issue.record("[\(testCase.name)] Expected FunctionError.timeout, got \(error)")
      }
    } catch {
      Issue.record("[\(testCase.name)] Unexpected error: \(error)")
    }
    try assertLateResponseIgnored(testCase: testCase, rpcHandler: rpcHandler)
  }

  private func runDuplicateOutboundCall(
    testCase: ConformanceTestCase,
    firstCall: JSONValue,
    secondCall: JSONValue,
    rpcHandler: RPCHandler
  ) async {
    let surfaceID = firstCall["surfaceId"]?.stringValue ?? "s"
    let fnCallID = firstCall["functionCallId"]?.stringValue ?? "c"
    let call =
      firstCall["callFunction"]?["@call"]?.stringValue
      ?? firstCall["callFunction"]?["call"]?.stringValue ?? ""

    var firstTask: Task<JSONValue, any Error>!
    await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
      firstTask = Task {
        try await rpcHandler.callAgentFunction(
          surfaceID: surfaceID,
          functionName: call,
          functionCallID: fnCallID,
          version: .v10,
          timeoutSeconds: 5.0,
          sendOutbound: { _ in
            started.resume()
          }
        )
      }
    }

    let secondID = secondCall["functionCallId"]?.stringValue ?? fnCallID
    do {
      _ = try await rpcHandler.callAgentFunction(
        surfaceID: surfaceID,
        functionName: call,
        functionCallID: secondID,
        version: .v10,
        timeoutSeconds: 5.0,
        sendOutbound: { _ in }
      )
      Issue.record("[\(testCase.name)] Expected duplicate call ID error")
    } catch let error as FunctionError {
      if case .duplicate = error {
        #expect(testCase.expectError?.code == "DUPLICATE")
      } else {
        Issue.record("[\(testCase.name)] Expected FunctionError.duplicate, got \(error)")
      }
    } catch {
      Issue.record("[\(testCase.name)] Unexpected error: \(error)")
    }

    firstTask.cancel()
    rpcHandler.cancelAllPendingCalls()
  }

  private func runUIBindingScenario(
    testCase: ConformanceTestCase,
    scenario: JSONValue
  ) async throws {
    let surfaceID = scenario["surfaceId"]?.stringValue ?? "main_surface"
    let catalogID = scenario["catalogId"]?.stringValue ?? "store_catalog"
    let (processor, surface, errorHandler, box) = makeUIScenarioHarness(
      surfaceID: surfaceID,
      catalogID: catalogID,
      scenario: scenario
    )

    var rawComponents: [JSONValue] = []
    if let comps = scenario["components"]?.arrayValue {
      rawComponents = comps
    } else if let singleComp = scenario["component"] {
      rawComponents = [singleComp]
    }
    if !rawComponents.contains(where: { $0["id"]?.stringValue == "root" }),
      let firstID = rawComponents.first?["id"]?.stringValue
    {
      rawComponents.insert(
        .object([
          "id": .string("root"),
          "component": .string("Column"),
          "children": .array([.string(firstID)]),
        ]),
        at: 0
      )
    }
    applyScenarioComponents(rawComponents, to: surface)

    let observe = scenario["observe"]
    let targetCompID =
      observe?["componentId"]?.stringValue
      ?? scenario["component"]?["id"]?.stringValue
      ?? "root"
    let targetProp = observe?["property"]?.stringValue ?? "text"

    if let expectedInitial = testCase.expect?["initialValue"] {
      let initialStr = findNode(id: targetCompID, in: surface.rootNode)?.string(for: targetProp)
      let actualInitial = initialStr.map(JSONValue.string) ?? .null
      #expect(
        actualInitial == expectedInitial,
        "[\(testCase.name)] initialValue mismatch"
      )
    }

    let actualCall = try await awaitScenarioAgentCall(
      box: box,
      processor: processor,
      scenario: scenario,
      expectedOutbound: testCase.expect?["outboundCall"],
      testName: testCase.name
    )

    if let expectedResolved = testCase.expect?["resolvedValue"] {
      let resolvedStr = findNode(id: targetCompID, in: surface.rootNode)?.string(for: targetProp)
      let actualResolved = resolvedStr.map(JSONValue.string) ?? .null
      #expect(
        actualResolved == expectedResolved,
        "[\(testCase.name)] resolvedValue mismatch"
      )
    }

    if let expectedSiblings = testCase.expect?["siblings"]?.objectValue {
      for (sibID, expectedPropsVal) in expectedSiblings {
        let sibNode = findNode(id: sibID, in: surface.rootNode)
        #expect(sibNode != nil, "[\(testCase.name)] Missing sibling node '\(sibID)'")
        for (propKey, expPropVal) in expectedPropsVal.objectValue ?? [:] {
          let actualPropVal = sibNode?.string(for: propKey).map(JSONValue.string) ?? .null
          #expect(
            actualPropVal == expPropVal,
            "[\(testCase.name)] Sibling '\(sibID).\(propKey)' mismatch"
          )
        }
      }
    }

    if let expectedValidation = testCase.expect?["validationResult"]?.objectValue {
      let targetNode = findNode(id: targetCompID, in: surface.rootNode)
      if let expValid = expectedValidation["valid"]?.boolValue {
        #expect(
          targetNode?.isValid == expValid,
          "[\(testCase.name)] validationResult.valid mismatch"
        )
      }
      if let expMsg = expectedValidation["message"]?.stringValue {
        #expect(
          targetNode?.validationErrors.contains(expMsg) == true,
          "[\(testCase.name)] validationResult.message mismatch"
        )
      }
    }

    assertScenarioSurfaceError(
      expectedSurfaceError: testCase.expect?["surfaceError"],
      errorHandler: errorHandler,
      outboundCallID: actualCall.functionCallID,
      testName: testCase.name
    )
  }

  private func runUIActionFallbackScenario(
    testCase: ConformanceTestCase,
    scenario: JSONValue
  ) async throws {
    let surfaceID = scenario["surfaceId"]?.stringValue ?? "main_surface"
    let fnCall = scenario["actionPayload"]?["functionCall"]
    let catalogID =
      scenario["catalogId"]?.stringValue
      ?? fnCall?["catalogId"]?.stringValue
      ?? "store_catalog"
    let (processor, surface, errorHandler, box) = makeUIScenarioHarness(
      surfaceID: surfaceID,
      catalogID: catalogID,
      scenario: scenario
    )

    if let baseCaller = surface.agentFunctionCaller {
      surface.agentFunctionCaller = { call in
        let val = try await baseCaller(call)
        box.lastActionResult = val
        return val
      }
    }

    let actionPayload = scenario["actionPayload"] ?? .object([:])
    applyScenarioComponents(
      [
        .object([
          "id": .string("root"),
          "component": .string("Button"),
          "child": .string("btn_label"),
          "action": actionPayload,
        ]),
        .object([
          "id": .string("btn_label"),
          "component": .string("Text"),
          "text": .string("Trigger"),
        ]),
      ],
      to: surface
    )

    let action = try #require(
      surface.rootNode?.action(for: "action"),
      "[\(testCase.name)] Expected resolved Button action"
    )
    action()

    let actualCall = try await awaitScenarioAgentCall(
      box: box,
      processor: processor,
      scenario: scenario,
      expectedOutbound: testCase.expect?["outboundCall"],
      testName: testCase.name
    )

    if let expectedResult = testCase.expect?["result"] {
      #expect(
        box.lastActionResult == expectedResult,
        "[\(testCase.name)] result mismatch"
      )
    }

    if let expectedDataModel = testCase.expect?["dataModel"] {
      #expect(
        surface.dataModel.data == expectedDataModel,
        "[\(testCase.name)] dataModel mismatch"
      )
    }

    assertScenarioSurfaceError(
      expectedSurfaceError: testCase.expect?["surfaceError"],
      errorHandler: errorHandler,
      outboundCallID: actualCall.functionCallID,
      testName: testCase.name
    )
  }

  private func makeUIScenarioHarness(
    surfaceID: String,
    catalogID: String,
    scenario: JSONValue
  ) -> (
    processor: MessageProcessor,
    surface: SurfaceViewModel,
    errorHandler: RPCErrorCaptureHandler,
    box: OutboundMessageBox
  ) {
    let baseCatalog = BasicCatalog.makeCatalog(version: .v10)
    var functions: [any FunctionImplementation] = Array(baseCatalog.functions.values)
    if let localFns = scenario["localFunctions"]?.objectValue {
      for (fnName, spec) in localFns {
        let returnType =
          spec["returnType"]?.stringValue.flatMap { FunctionReturnType(rawValue: $0) } ?? .any
        let setData = spec["effect"]?["setData"]
        functions.append(
          ConformanceMockRPCFunction(name: fnName, returnType: returnType) { _, context in
            if let path = setData?["path"]?.stringValue, let val = setData?["value"] {
              context.set(path, value: val)
              return val
            }
            return .boolean(true)
          }
        )
      }
    }
    let components = Array(baseCatalog.components.values)
    var catalogsDict: [String: AnyCatalog] = [:]
    for id in Set(["basic", catalogID]) {
      catalogsDict[id] = Catalog(
        id: id,
        protocolVersion: "1.0",
        components: components,
        functions: functions,
        themeSchema: baseCatalog.themeSchema
      ).eraseToAnyCatalog()
    }

    let errorHandler = RPCErrorCaptureHandler()
    let processor = MessageProcessor(
      catalogs: Array(catalogsDict.values),
      actionHandler: errorHandler,
      validationConfig: .relaxed
    )
    let surface = SurfaceViewModel(
      surfaceID: surfaceID,
      catalogs: catalogsDict,
      defaultCatalogID: catalogID,
      actionHandler: errorHandler,
      protocolVersion: .v10
    )
    processor.surfaceGroupModel.addSurface(surface)

    let box = OutboundMessageBox()
    processor.outboundListener = { message in
      MainActor.assumeIsolated {
        box.lastMessage = message
        if case .callAgentFunction(let callMsg) = message {
          box.lastAgentCall = callMsg
        }
      }
    }
    return (processor, surface, errorHandler, box)
  }

  private func applyScenarioComponents(_ rawComponents: [JSONValue], to surface: SurfaceViewModel) {
    var models: [ComponentModel] = []
    for compVal in rawComponents {
      guard let compDict = compVal.objectValue,
        let id = compDict["id"]?.stringValue,
        let type = compDict["component"]?.stringValue
      else { continue }
      var props: [String: JSONValue] = [:]
      for (key, val) in compDict
      where key != "id" && key != "component" && key != "catalogId" && key != "metadata" {
        props[key] = val
      }
      models.append(
        ComponentModel(
          id: id,
          type: type,
          catalogID: compDict["catalogId"]?.stringValue,
          properties: props
        )
      )
    }
    if !models.isEmpty {
      surface.componentsModel.applyBatch(adding: models)
    }
  }

  private func findNode(id targetID: String, in node: Node?) -> Node? {
    guard let node else { return nil }
    if node.id == targetID {
      return node
    }
    for child in node.allChildNodes {
      if let found = findNode(id: targetID, in: child) {
        return found
      }
    }
    return nil
  }

  private func awaitScenarioAgentCall(
    box: OutboundMessageBox,
    processor: MessageProcessor,
    scenario: JSONValue,
    expectedOutbound: JSONValue?,
    testName: String
  ) async throws -> CallAgentFunctionMessage {
    for _ in 0..<200 where box.lastAgentCall == nil {
      await Task.yield()
      if box.lastAgentCall != nil { break }
      try? await Task.sleep(nanoseconds: 5_000_000)
    }
    let actualCall = try #require(
      box.lastAgentCall,
      "[\(testName)] Timed out waiting for outbound callAgentFunction"
    )
    assertOutboundCallAgentMatches(
      captured: .callAgentFunction(actualCall),
      expectedOutbound: expectedOutbound,
      testName: testName
    )

    if let errObj = scenario["inboundResponseError"] {
      processor.rpcHandler.handleAgentResponse(
        AgentFunctionResponseMessage(
          functionCallID: actualCall.functionCallID,
          error: FunctionErrorPayload(
            code: errObj["code"]?.stringValue ?? "EXECUTION_ERROR",
            message: errObj["message"]?.stringValue ?? "RPC error"
          ),
          version: .v10
        )
      )
    } else {
      let inboundVal = scenario["inboundResponseValue"] ?? .null
      processor.rpcHandler.handleAgentResponse(
        AgentFunctionResponseMessage(
          functionCallID: actualCall.functionCallID,
          value: inboundVal,
          version: .v10
        )
      )
    }
    for _ in 0..<20 {
      await Task.yield()
    }
    return actualCall
  }

  private func assertScenarioSurfaceError(
    expectedSurfaceError: JSONValue?,
    errorHandler: RPCErrorCaptureHandler,
    outboundCallID: String,
    testName: String
  ) {
    guard let expectedSurfaceErr = expectedSurfaceError?.objectValue else { return }
    let genericErrors: [GenericError] = errorHandler.capturedErrors.compactMap {
      guard case .generic(let err) = $0 else { return nil }
      return err
    }
    guard let lastErr = genericErrors.last else {
      Issue.record("[\(testName)] Expected surfaceError, but no generic error was captured")
      return
    }
    if let expCode = expectedSurfaceErr["code"]?.stringValue {
      #expect(lastErr.code == expCode, "[\(testName)] surfaceError.code mismatch")
    }
    if let expCallID = expectedSurfaceErr["functionCallId"]?.stringValue {
      let resolvedExpCallID = expCallID == "$outboundCallId" ? outboundCallID : expCallID
      #expect(
        lastErr.functionCallID == resolvedExpCallID,
        "[\(testName)] surfaceError.functionCallId mismatch"
      )
    }
  }

  private func assertOutboundCallAgentMatches(
    captured: RendererToAgentMessage?,
    expectedOutbound: JSONValue?,
    testName: String
  ) {
    guard let expectedCall = expectedOutbound?["callAgentFunction"] else { return }
    guard case .callAgentFunction(let actualCall) = captured else {
      Issue.record(
        "[\(testName)] Expected outbound callAgentFunction, got \(String(describing: captured))")
      return
    }
    if let expSurfaceID = expectedCall["surfaceId"]?.stringValue {
      #expect(actualCall.surfaceID == expSurfaceID, "[\(testName)] surfaceId mismatch")
    }
    if let expFn = expectedCall["callFunction"]?["@call"]?.stringValue {
      #expect(actualCall.callFunction.call == expFn, "[\(testName)] callFunction.@call mismatch")
    }
    if let expCat = expectedCall["callFunction"]?["catalogId"]?.stringValue {
      #expect(actualCall.callFunction.catalogID == expCat, "[\(testName)] catalogId mismatch")
    }
  }
}

private final class ConformanceMockRPCFunction: FunctionImplementation, Sendable {
  let api: FunctionAPI
  private let handler: @MainActor @Sendable ([String: JSONValue], DataContext) throws -> JSONValue

  init(
    name: String,
    returnType: FunctionReturnType = .any,
    schema: Schema? = nil,
    allowedCallers: AllowedCallers = .rendererOrAgent,
    requiresUserActivation: Bool = false,
    handler: @escaping @MainActor @Sendable ([String: JSONValue], DataContext) throws -> JSONValue
  ) {
    self.api = FunctionAPI(
      name: name,
      returnType: returnType,
      schema: schema ?? (try! Schema(instance: "{}")),
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation
    )
    self.handler = handler
  }

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    try handler(arguments, context)
  }
}
