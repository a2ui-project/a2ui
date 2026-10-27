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
import BasicCatalog
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing

@MainActor
private final class ConformanceActionFunctionHandler: FunctionHandler {
  private let functionsMap: [String: any FunctionImplementation]
  var capturedErrors: [RendererError] = []
  let surfaceID: String
  let protocolVersion: A2UIProtocolVersion

  init(surfaceID: String, protocolVersion: A2UIProtocolVersion, userActivation: Bool) {
    self.surfaceID = surfaceID
    self.protocolVersion = protocolVersion
    var map = Dictionary(
      uniqueKeysWithValues: BasicFunctions.allFunctions.map { ($0.api.name, $0) }
    )
    map["incrementCounter"] = ActionTestFunction(name: "incrementCounter") { args, context in
      guard let path = args["path"]?.stringValue else { return .null }
      let step = args["step"]?.integerValue ?? 1
      let current = context.dataModel.get(path)?.integerValue ?? 0
      context.set(path, value: .integer(current + step))
      return .integer(current + step)
    }
    map["failingAction"] = ActionTestFunction(name: "failingAction") { _, _ in
      throw FunctionError.executionFailed(name: "failingAction", message: "Simulated action error")
    }
    if !userActivation {
      map["openUrl"] = ActionTestFunction(name: "openUrl") { _, _ in
        throw FunctionError.executionFailed(
          name: "openUrl",
          message: "Function 'openUrl' requires user activation."
        )
      }
    }
    self.functionsMap = map
  }

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    if name == "@index" {
      return IndexFunction()
    }
    return functionsMap[name]
  }

  func handleFunctionError(_ error: any Error, functionName: String) {
    let msg = (error as? (any A2UIError))?.message ?? String(describing: error)
    capturedErrors.append(
      .generic(
        GenericError(
          code: "EXECUTION_ERROR",
          surfaceID: surfaceID,
          message: msg,
          expression: functionName,
          version: protocolVersion
        )
      )
    )
  }
}

private final class ActionTestFunction: FunctionImplementation, Sendable {
  let api: FunctionAPI
  private let block: @MainActor @Sendable ([String: JSONValue], DataContext) throws -> JSONValue

  init(
    name: String,
    block: @escaping @MainActor @Sendable ([String: JSONValue], DataContext) throws -> JSONValue
  ) {
    self.api = FunctionAPI(
      name: name,
      returnType: .any,
      schema: try! Schema(instance: "{}")
    )
    self.block = block
  }

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    try block(arguments, context)
  }
}

/// Runs the shared `conformance/core/actions.yaml` suite.
@MainActor
struct ActionsConformanceTests {
  @Test func actionsConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/actions.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/actions.yaml should hold test cases")

    for testCase in cases {
      let name = testCase["name"] as? String ?? "<unnamed>"
      let action = testCase["action"] as? String ?? "dispatch_action"
      guard action == "dispatch_action" else { continue }
      runDispatchActionCase(testCase, name: name)
    }
  }

  private func runDispatchActionCase(_ testCase: [String: Any], name: String) {
    let versionStr = testCase["protocolVersion"] as? String ?? "v0.9"
    let protocolVersion = A2UIProtocolVersion(lenientRawValue: versionStr) ?? .v09
    let surfaceID = testCase["surfaceId"] as? String ?? "default"
    let sourceComponentID = testCase["sourceComponentId"] as? String ?? "comp"
    let userActivation = testCase["userActivation"] as? Bool ?? true
    let scope = testCase["scope"] as? String ?? "/"
    let index = extractTrailingIndex(from: scope)

    let initialData: JSONValue =
      (testCase["dataModel"] ?? testCase["data_model"]).map {
        ConformanceTestHelper.toJSONValue($0)
      } ?? .object([:])
    let model = DataModel(initial: initialData)
    let handler = ConformanceActionFunctionHandler(
      surfaceID: surfaceID,
      protocolVersion: protocolVersion,
      userActivation: userActivation
    )
    let context = DataContext(
      dataModel: model,
      path: scope,
      functionHandler: handler,
      protocolVersion: protocolVersion,
      index: index
    )

    let rawAction =
      (testCase["actionPayload"] ?? testCase["action_data"]).map {
        ConformanceTestHelper.toJSONValue($0)
      } ?? .null

    let dispatched = executeActionPayload(
      rawAction,
      context: context,
      handler: handler,
      surfaceID: surfaceID,
      sourceComponentID: sourceComponentID,
      protocolVersion: protocolVersion
    )

    verifyActionOutcome(
      testCase: testCase,
      dispatched: dispatched,
      model: model,
      capturedErrors: handler.capturedErrors,
      name: name
    )
  }

  private func extractTrailingIndex(from scope: String) -> Int? {
    guard let lastSegment = scope.split(separator: "/").last else { return nil }
    return Int(lastSegment)
  }

  private func executeActionPayload(
    _ rawAction: JSONValue,
    context: DataContext,
    handler: ConformanceActionFunctionHandler,
    surfaceID: String,
    sourceComponentID: String,
    protocolVersion: A2UIProtocolVersion
  ) -> RendererAction? {
    guard case .object(let dict) = rawAction else { return nil }

    if let funcCallVal = dict["functionCall"] {
      _ = context.resolveDynamicValue(funcCallVal)
      return nil
    }

    let eventDict: OrderedDictionary<String, JSONValue>?
    if let eventVal = dict["event"], case .object(let inner) = eventVal {
      eventDict = inner
    } else if dict["name"] != nil {
      eventDict = dict
    } else {
      eventDict = nil
    }

    guard let eventDict else { return nil }
    return dispatchEventAction(
      eventDict,
      context: context,
      handler: handler,
      surfaceID: surfaceID,
      sourceComponentID: sourceComponentID,
      protocolVersion: protocolVersion
    )
  }

  private func dispatchEventAction(
    _ eventDict: OrderedDictionary<String, JSONValue>,
    context: DataContext,
    handler: ConformanceActionFunctionHandler,
    surfaceID: String,
    sourceComponentID: String,
    protocolVersion: A2UIProtocolVersion
  ) -> RendererAction? {
    guard let eventName = eventDict["name"]?.stringValue, !eventName.isEmpty else {
      handler.capturedErrors.append(
        .generic(
          GenericError(
            code: "INVALID_ACTION",
            surfaceID: surfaceID,
            message: "Event action is missing a valid string 'name'.",
            version: protocolVersion
          )
        )
      )
      return nil
    }

    var resolvedUserMessage: String?
    if let rawMsg = eventDict["userMessage"] {
      let evaluatedMsg = context.resolveDynamicValue(rawMsg)
      guard let msgStr = evaluatedMsg.stringValue else {
        handler.capturedErrors.append(
          .generic(
            GenericError(
              code: "INVALID_ACTION",
              surfaceID: surfaceID,
              message: "Event 'userMessage' must resolve to a string.",
              version: protocolVersion
            )
          )
        )
        return nil
      }
      resolvedUserMessage = msgStr
    }

    var resolvedContext: [String: JSONValue] = [:]
    if let ctxObj = eventDict["context"]?.objectValue {
      for (key, val) in ctxObj {
        let outKey = protocolVersion.isAtLeastV10 ? DataContext.unescapeObjectKey(key) : key
        resolvedContext[outKey] = context.resolveDynamicValue(val)
      }
    }

    return RendererAction(
      name: eventName,
      surfaceID: surfaceID,
      sourceComponentID: sourceComponentID,
      timestamp: ISO8601DateFormatter().string(from: Date()),
      context: resolvedContext,
      userMessage: resolvedUserMessage,
      version: protocolVersion
    )
  }

  private func verifyActionOutcome(
    testCase: [String: Any],
    dispatched: RendererAction?,
    model: DataModel,
    capturedErrors: [RendererError],
    name: String
  ) {
    if let expectDataModel = testCase["expectDataModel"] {
      #expect(
        model.data == ConformanceTestHelper.toJSONValue(expectDataModel),
        "\(name): dataModel mismatch"
      )
    }

    if let expectErrorDict = testCase["expectError"] as? [String: Any] {
      assertActionErrorMatches(capturedErrors: capturedErrors, expectError: expectErrorDict, name: name)
    } else {
      #expect(capturedErrors.isEmpty, "\(name): unexpected action errors \(capturedErrors)")
    }

    if testCase["expectDispatched"] is NSNull {
      #expect(dispatched == nil, "\(name): expected no dispatched action, got \(String(describing: dispatched))")
      return
    }

    guard let rawExpected = testCase["expectDispatched"] ?? testCase["expected"],
      case .object(let expDict) = ConformanceTestHelper.toJSONValue(rawExpected)
    else {
      return
    }
    assertDispatchedActionMatches(dispatched: dispatched, expected: expDict, name: name)
  }

  private func assertActionErrorMatches(
    capturedErrors: [RendererError],
    expectError: [String: Any],
    name: String
  ) {
    guard let lastError = capturedErrors.last else {
      Issue.record("\(name): expected action error but none was captured")
      return
    }
    let expected = ConformanceExpectRendererError(
      code: expectError["code"] as? String,
      surfaceID: expectError["surfaceId"] as? String,
      functionCallID: nil,
      path: expectError["path"] as? String,
      message: expectError["message"] as? String
    )
    ConformanceTestHelper.assertRendererErrorMatches(lastError, expected: expected, context: name)
  }

  private func assertDispatchedActionMatches(
    dispatched: RendererAction?,
    expected expDict: OrderedDictionary<String, JSONValue>,
    name: String
  ) {
    guard let dispatched else {
      Issue.record("\(name): expected dispatched action but got nil")
      return
    }
    if let expName = expDict["name"]?.stringValue {
      #expect(dispatched.name == expName, "\(name): event name mismatch")
    }
    if let expSurfaceID = expDict["surfaceId"]?.stringValue {
      #expect(dispatched.surfaceID == expSurfaceID, "\(name): surfaceId mismatch")
    }
    if let expSourceID = expDict["sourceComponentId"]?.stringValue {
      #expect(dispatched.sourceComponentID == expSourceID, "\(name): sourceComponentId mismatch")
    }
    if expDict["timestampIso8601"]?.boolValue == true {
      #expect(!dispatched.timestamp.isEmpty, "\(name): expected non-empty ISO8601 timestamp")
    }
    if let expCtx = expDict["context"]?.objectValue {
      var actualOrdered: OrderedDictionary<String, JSONValue> = [:]
      for key in expCtx.keys {
        actualOrdered[key] = dispatched.context[key]
      }
      #expect(
        JSONValue.object(actualOrdered) == JSONValue.object(expCtx),
        "\(name): event context mismatch: got \(dispatched.context), expected \(expCtx)"
      )
    }
    if let expMsg = expDict["userMessage"]?.stringValue {
      #expect(dispatched.userMessage == expMsg, "\(name): userMessage mismatch")
    }
  }
}
