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

/// Runs the shared `conformance/core/rpc_functions.yaml` suite.
@MainActor
struct RPCConformanceTests {
  @Test func rpcFunctionsConformance() async throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/rpc_functions.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from rpc_functions.yaml")

    let rpcHandler = RPCHandler()

    for testCase in testCases {
      guard testCase.action == "handle_rpc" else { continue }

      // Build mock catalogs from functionMetadata
      var functions: [any FunctionImplementation] = []
      if let metadata = testCase.args?["functionMetadata"]?.objectValue {
        for (fnName, metaVal) in metadata {
          let callersStr = metaVal["allowedCallers"]?.stringValue ?? "rendererOrAgent"
          let callers: AllowedCallers
          switch callersStr {
          case "rendererOnly": callers = .rendererOnly
          case "agentOnly": callers = .agentOnly
          default: callers = .rendererOrAgent
          }
          let reqUserActivation = metaVal["requiresUserActivation"]?.boolValue ?? false
          let paramSchema: Schema? = metaVal["parameters"].flatMap {
            try? Schema(rawSchema: $0, context: Context(dialect: .draft2020_12))
          }

          let mockFn: any FunctionImplementation
          if fnName == "failingFunction" {
            mockFn = ConformanceMockRPCFunction(
              name: fnName,
              schema: paramSchema,
              allowedCallers: callers,
              requiresUserActivation: reqUserActivation
            ) { _, _ in
              throw A2UIValidationError("Runtime error")
            }
          } else if fnName == "playMedia" {
            mockFn = ConformanceMockRPCFunction(
              name: fnName,
              schema: paramSchema,
              allowedCallers: callers,
              requiresUserActivation: reqUserActivation
            ) { _, _ in
              .object(["playing": .boolean(true), "timestamp": .integer(0)])
            }
          } else if fnName == "openExternalUrl" {
            mockFn = ConformanceMockRPCFunction(
              name: fnName,
              schema: paramSchema,
              allowedCallers: callers,
              requiresUserActivation: reqUserActivation
            ) { _, _ in
              .object(["opened": .boolean(true)])
            }
          } else {
            mockFn = ConformanceMockRPCFunction(
              name: fnName,
              schema: paramSchema,
              allowedCallers: callers,
              requiresUserActivation: reqUserActivation
            ) { _, _ in
              .null
            }
          }
          functions.append(mockFn)
        }
      }

      let catalog = Catalog(
        id: "basic",
        protocolVersion: "1.0",
        components: [AnyComponentAPI](),
        functions: functions
      ).eraseToAnyCatalog()

      let mediaCatalog = Catalog(
        id: "media_catalog",
        protocolVersion: "1.0",
        components: [AnyComponentAPI](),
        functions: functions
      ).eraseToAnyCatalog()

      let systemCatalog = Catalog(
        id: "system_catalog",
        protocolVersion: "1.0",
        components: [AnyComponentAPI](),
        functions: functions
      ).eraseToAnyCatalog()

      var catalogs = [
        "basic": catalog,
        "media_catalog": mediaCatalog,
        "system_catalog": systemCatalog,
      ]
      if let extraCatID = testCase.args?["catalogId"]?.stringValue {
        let extraCatVersion = testCase.args?["catalogVersion"]?.stringValue ?? "1.0"
        catalogs[extraCatID] = Catalog(
          id: extraCatID,
          protocolVersion: extraCatVersion,
          components: [AnyComponentAPI](),
          functions: functions
        ).eraseToAnyCatalog()
      }

      let userActivation = testCase.args?["userActivationPresent"]?.boolValue ?? false

      // Inbound call
      if let messageJSON = testCase.args?["message"] {
        let expectedErr = testCase.expect?["error"]?.objectValue
        let message: AgentToRendererMessage?
        do {
          // parseAll runs the version adapter's schema checks, which a bare
          // JSONDecoder skips (e.g. a missing callFunction.catalogId).
          message = try AgentToRendererMessage.parseAll(messageJSON).first
          #expect(expectedErr == nil, "\(testCase.name): expected a validation error")
        } catch {
          // If schema validation rejected invalid payload (e.g. missing callFunction)
          #expect(expectedErr != nil, "\(testCase.name): unexpected error \(error)")
          if let msgSub = expectedErr?["message"]?.stringValue {
            #expect("\(error)".contains(msgSub))
          }
          message = nil
        }
        if case .callRendererFunction(let callMsg)? = message {
          let response = await rpcHandler.handleIncomingCall(
            callMsg,
            catalogs: catalogs,
            userActivationPresent: userActivation
          )

          if let expectedResp = testCase.expect?["response"]?["rendererFunctionResponse"] {
            let expectedCallID = expectedResp["functionCallId"]?.stringValue
            #expect(response.functionCallID == expectedCallID)

            if let expectedValue = expectedResp["value"] {
              #expect(response.value == expectedValue)
            }

            if let expectedErr = expectedResp["error"] {
              let expectedCode = expectedErr["code"]?.stringValue
              let expectedMsg = expectedErr["message"]?.stringValue
              #expect(response.error?.code == expectedCode)
              if let expectedMsg {
                #expect(response.error?.message.contains(expectedMsg) == true)
              }
            }
          }
        }
      }

      // Outbound call
      if let outboundCall = testCase.args?["outboundCall"],
        let inboundResponse = testCase.args?["inboundResponse"]
      {
        let surfaceID = outboundCall["surfaceId"]?.stringValue ?? "s"
        let fnCallID = outboundCall["functionCallId"]?.stringValue ?? "c"
        let expectedCallFunction = try #require(outboundCall["callFunction"]?.objectValue)
        let call = try #require(expectedCallFunction["@call"]?.stringValue)
        let catID = expectedCallFunction["catalogId"]?.stringValue
        let args: [String: JSONValue]? = expectedCallFunction["args"]?.objectValue.map {
          Dictionary(uniqueKeysWithValues: $0.map { ($0.key, $0.value) })
        }

        // `callAgentFunction` registers the pending call before it sends the outbound
        // message, so once the message arrives the response can be routed.
        var callTask: Task<JSONValue, any Error>?
        let outbound = await withCheckedContinuation { continuation in
          callTask = Task {
            try await rpcHandler.callAgentFunction(
              surfaceID: surfaceID,
              functionName: call,
              catalogID: catID,
              functionCallID: fnCallID,
              args: args,
              version: .v10,
              timeoutSeconds: 5.0,
              sendOutbound: { continuation.resume(returning: $0) }
            )
          }
        }

        // The outbound message must be the v1.0 callAgentFunction the case describes.
        let outboundJSON = try JSONDecoder().decode(
          JSONValue.self, from: JSONEncoder().encode(outbound))
        let sentCall = try #require(outboundJSON["callAgentFunction"])
        #expect(sentCall["surfaceId"]?.stringValue == surfaceID)
        #expect(
          sentCall["functionCallId"]?.stringValue
            == testCase.expect?["correlatedCallId"]?.stringValue)
        let sentCallFunction = try #require(sentCall["callFunction"]?.objectValue)
        #expect(Set(sentCallFunction.keys) == Set(expectedCallFunction.keys))
        for (key, value) in expectedCallFunction {
          #expect(sentCallFunction[key] == value, "callFunction.\(key)")
        }

        // Parse inbound response and route
        let respData = try JSONEncoder().encode(inboundResponse)
        let respMsg = try JSONDecoder().decode(AgentToRendererMessage.self, from: respData)
        if case .agentFunctionResponse(let agentResp) = respMsg {
          rpcHandler.handleAgentResponse(agentResp)
        }

        let result = try await #require(callTask).value
        let expectedResult = testCase.expect?["result"]
        #expect(result == expectedResult)
      }
    }
  }
}

private final class ConformanceMockRPCFunction: FunctionImplementation, Sendable {
  let api: FunctionAPI
  private let handler: @Sendable ([String: JSONValue], DataContext) throws -> JSONValue

  init(
    name: String,
    schema: Schema? = nil,
    allowedCallers: AllowedCallers = .rendererOrAgent,
    requiresUserActivation: Bool = false,
    handler: @escaping @Sendable ([String: JSONValue], DataContext) throws -> JSONValue
  ) {
    self.api = FunctionAPI(
      name: name,
      returnType: .any,
      schema: schema ?? (try! Schema(instance: "{}")),
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation
    )
    self.handler = handler
  }

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    try handler(arguments, context)
  }
}
