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
import OrderedJSON
import Testing

@MainActor
struct V10ConformanceTests {

  // MARK: - Composition Constraints Conformance

  @Test func compositionConstraintsConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/composition_constraints.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from composition_constraints.yaml")

    for testCase in testCases {
      var catalogs: [AnyCatalog] = [BasicCatalog.v10Catalog]
      if let customCatalog = ConformanceTestHelper.buildCatalog(from: testCase.catalogConfiguration)
      {
        catalogs.append(customCatalog)
      }
      let validator = A2UIValidator(
        catalogs: catalogs,
        config: ValidationConfig(targetVersion: "v1.0")
      )

      for (stepIndex, step) in testCase.steps.enumerated() {
        guard let payload = step.payload else { continue }

        if let expectedError = step.expectError {
          var caughtError: Error?
          do {
            try validator.validate(payload: payload)
          } catch {
            caughtError = error
          }

          let error = try #require(
            caughtError,
            "Expected error for '\(testCase.name)' at step \(stepIndex)"
          )

          if let expectedCode = expectedError.code {
            if let valError = error as? A2UIValidationError {
              #expect(
                valError.details.contains(where: { $0.code == expectedCode }),
                "[\(testCase.name)] Expected error code '\(expectedCode)', got \(valError.details)"
              )
            }
          }
        } else {
          do {
            try validator.validate(payload: payload)
          } catch {
            Issue.record("[\(testCase.name)] Expected valid payload, caught: \(error)")
          }
        }
      }
    }
  }

  // MARK: - Data Deletion Conformance

  @Test func dataDeletionConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/data_deletion.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from data_deletion.yaml")

    for testCase in testCases {
      let processor = MessageProcessor(
        catalogs: BasicCatalog.allCatalogs,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      for step in testCase.steps {
        guard let payload = step.payload else { continue }
        let messages = try parsePayload(payload)
        processor.process(messages: messages)
      }

      if let expectSurfaces = testCase.expect?["surfaces"]?.objectValue {
        for (surfaceID, expectedSurface) in expectSurfaces {
          if let expectedDataModel = expectedSurface["dataModel"] {
            let actualDataModel = processor.getRendererDataModel(surfaceID: surfaceID)
            #expect(
              actualDataModel == expectedDataModel,
              "[\(testCase.name)] Data model for \(surfaceID) did not match expected"
            )
          }
        }
      }
    }
  }

  // MARK: - Index Function Conformance

  @Test func indexFunctionConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/index_function.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from index_function.yaml")

    for testCase in testCases {
      let processor = MessageProcessor(
        catalogs: BasicCatalog.allCatalogs,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      for step in testCase.steps {
        guard let payload = step.payload else { continue }

        if let expectedError = step.expectError {
          var caughtError: Error?
          do {
            let messages = try parsePayload(payload)
            processor.process(messages: messages)
          } catch {
            caughtError = error
          }

          if let caughtError {
            if let expectedMessage = expectedError.message {
              #expect(
                caughtError.localizedDescription.contains(expectedMessage)
                  || "\(caughtError)".contains(expectedMessage)
              )
            }
          }
        } else {
          let messages = try parsePayload(payload)
          processor.process(messages: messages)

          if let expectSurfaces = testCase.expect?["surfaces"]?.objectValue {
            for (surfaceID, expectedSurface) in expectSurfaces {
              guard let surface = processor.surface(id: surfaceID) else {
                Issue.record("Expected surface '\(surfaceID)' to exist")
                continue
              }

              if let expectedComponents = expectedSurface["components"]?.objectValue {
                for (compID, compExpected) in expectedComponents {
                  let node = surface.findNode(id: compID)
                  if let expectedText = compExpected["text"]?.stringValue {
                    #expect(
                      node?.string(for: "text") == expectedText,
                      "[\(testCase.name)] Expected node \(compID).text == '\(expectedText)', got '\(node?.string(for: "text") ?? "nil")'"
                    )
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // MARK: - Validation Result Conformance

  @Test func validationResultConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/validation_result.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from validation_result.yaml")

    for testCase in testCases {
      let processor = MessageProcessor(
        catalogs: BasicCatalog.allCatalogs,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      for step in testCase.steps {
        guard let payload = step.payload else { continue }
        let messages = try parsePayload(payload)
        processor.process(messages: messages)
      }

      if let expectSurfaces = testCase.expect?["surfaces"]?.objectValue {
        for (surfaceID, expectedSurface) in expectSurfaces {
          guard let surface = processor.surface(id: surfaceID) else {
            Issue.record("Expected surface '\(surfaceID)' to exist")
            continue
          }

          if let expectedVR = expectedSurface["validationResult"]?.objectValue {
            for (nodeID, expectedCheck) in expectedVR {
              let node = surface.findNode(id: nodeID)
              let expectedValid = expectedCheck["valid"]?.boolValue ?? true
              #expect(
                node?.isValid == expectedValid,
                "[\(testCase.name)] Expected node \(nodeID).isValid == \(expectedValid)"
              )

              if let expectedMsg = expectedCheck["message"]?.stringValue {
                #expect(
                  node?.validationErrors.contains(expectedMsg) == true,
                  "[\(testCase.name)] Expected validation errors to contain '\(expectedMsg)'"
                )
              }
            }
          }
        }
      }
    }
  }

  // MARK: - RPC Functions Conformance

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

          let mockFn: any FunctionImplementation
          if fnName == "failingFunction" {
            mockFn = ConformanceMockRPCFunction(
              name: fnName,
              allowedCallers: callers,
              requiresUserActivation: reqUserActivation
            ) { _, _ in
              throw A2UIValidationError("Runtime error")
            }
          } else if fnName == "playMedia" {
            mockFn = ConformanceMockRPCFunction(
              name: fnName,
              allowedCallers: callers,
              requiresUserActivation: reqUserActivation
            ) { _, _ in
              .object(["playing": .boolean(true), "timestamp": .integer(0)])
            }
          } else if fnName == "openExternalUrl" {
            mockFn = ConformanceMockRPCFunction(
              name: fnName,
              allowedCallers: callers,
              requiresUserActivation: reqUserActivation
            ) { _, _ in
              .object(["opened": .boolean(true)])
            }
          } else if fnName == "syncState" {
            mockFn = ConformanceMockRPCFunction(
              name: fnName,
              allowedCallers: callers,
              requiresUserActivation: reqUserActivation
            ) { _, _ in
              .null
            }
          } else {
            mockFn = ConformanceMockRPCFunction(
              name: fnName,
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

      let catalogs = [
        "basic": catalog,
        "media_catalog": mediaCatalog,
        "system_catalog": systemCatalog,
      ]

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
                  #expect(response.error?.message == expectedMsg)
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

  private func parsePayload(_ payload: JSONValue) throws -> [AgentToRendererMessage] {
    let data = try JSONEncoder().encode(payload)
    let decoder = JSONDecoder()
    if let list = try? decoder.decode([AgentToRendererMessage].self, from: data) {
      return list
    }
    let single = try decoder.decode(AgentToRendererMessage.self, from: data)
    return [single]
  }
}

// MARK: - Conformance Helpers

private final class ConformanceMockRPCFunction: FunctionImplementation, Sendable {
  let api: FunctionAPI
  private let handler: @Sendable ([String: JSONValue], DataContext) throws -> JSONValue

  init(
    name: String,
    allowedCallers: AllowedCallers = .rendererOrAgent,
    requiresUserActivation: Bool = false,
    handler: @escaping @Sendable ([String: JSONValue], DataContext) throws -> JSONValue
  ) {
    self.api = FunctionAPI(
      name: name,
      returnType: .any,
      schema: try! Schema(instance: "{}"),
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation
    )
    self.handler = handler
  }

  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    try handler(arguments, context)
  }
}

extension SurfaceViewModel {
  func findNode(id: String) -> Node? {
    guard let root = rootNode else { return nil }
    return findNodeInTree(node: root, targetID: id)
  }

  private func findNodeInTree(node: Node, targetID: String) -> Node? {
    if node.id == targetID { return node }
    for property in node.properties.values {
      if let childNode = property as? Node,
        let found = findNodeInTree(node: childNode, targetID: targetID)
      {
        return found
      }
      if let childList = property as? [Node] {
        for child in childList {
          if let found = findNodeInTree(node: child, targetID: targetID) {
            return found
          }
        }
      }
    }
    return nil
  }
}
