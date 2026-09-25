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
        protocolVersion: "v1.0",
        components: [AnyComponentAPI](),
        functions: functions
      ).eraseToAnyCatalog()

      let mediaCatalog = Catalog(
        id: "media_catalog",
        protocolVersion: "v1.0",
        components: [AnyComponentAPI](),
        functions: functions
      ).eraseToAnyCatalog()

      let systemCatalog = Catalog(
        id: "system_catalog",
        protocolVersion: "v1.0",
        components: [AnyComponentAPI](),
        functions: functions
      ).eraseToAnyCatalog()

      var catalogs = [
        "basic": catalog,
        "media_catalog": mediaCatalog,
        "system_catalog": systemCatalog,
      ]
      if let extraCatID = testCase.args?["catalogId"]?.stringValue {
        let extraCatVersion = testCase.args?["catalogVersion"]?.stringValue ?? "v1.0"
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
        let data = try JSONEncoder().encode(messageJSON)
        do {
          let message = try JSONDecoder().decode(AgentToRendererMessage.self, from: data)
          if case .callRendererFunction(let callMsg) = message {
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
        } catch {
          // If schema validation rejected invalid payload (e.g. missing callFunction)
          if let expectedErr = testCase.expect?["error"]?.objectValue {
            let msgSub = expectedErr["message"]?.stringValue ?? ""
            #expect("\(error)".contains(msgSub))
          }
        }
      }

      // Outbound call
      if let outboundCall = testCase.args?["outboundCall"],
        let inboundResponse = testCase.args?["inboundResponse"]
      {
        let surfaceID = outboundCall["surfaceId"]?.stringValue ?? "s"
        let fnCallID = outboundCall["functionCallId"]?.stringValue ?? "c"
        let call = outboundCall["callFunction"]?["call"]?.stringValue ?? ""
        let catID = outboundCall["callFunction"]?["catalogId"]?.stringValue

        let callTask = Task {
          try await rpcHandler.callAgentFunction(
            surfaceID: surfaceID,
            functionName: call,
            catalogID: catID,
            functionCallID: fnCallID,
            timeoutSeconds: 5.0,
            sendOutbound: { _ in }
          )
        }

        try await Task.sleep(nanoseconds: 10_000_000)

        // Parse inbound response and route
        let respData = try JSONEncoder().encode(inboundResponse)
        let respMsg = try JSONDecoder().decode(AgentToRendererMessage.self, from: respData)
        if case .agentFunctionResponse(let agentResp) = respMsg {
          rpcHandler.handleAgentResponse(agentResp)
        }

        let result = try await callTask.value
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
