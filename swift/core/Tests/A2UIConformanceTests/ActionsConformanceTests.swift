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
import OrderedJSON
import Testing

private final class ConformanceErrorCaptureHandler: ActionHandling, @unchecked Sendable {
  var capturedErrors: [ClientServerError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: ClientServerError, from surfaceID: String) {
    capturedErrors.append(error)
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

      let initialData: JSONValue =
        (testCase["dataModel"] ?? testCase["data_model"]).map {
          ConformanceTestHelper.toJSONValue($0)
        } ?? .object([:])
      let model = DataModel(initial: initialData)
      let scope = testCase["scope"] as? String ?? "/"
      let surfaceID = testCase["surfaceId"] as? String ?? "main"
      let errorHandler = ConformanceErrorCaptureHandler()
      // The resolver is the surface's function handler and error sink.
      let resolver = NodeResolver(
        surfaceID: surfaceID,
        catalogs: [BasicCatalog.v09Catalog],
        dataModel: model,
        actionHandler: errorHandler
      )
      let context = DataContext(dataModel: model, path: scope, functionHandler: resolver)

      let rawAction =
        (testCase["actionPayload"] ?? testCase["action_data"]).map {
          ConformanceTestHelper.toJSONValue($0)
        } ?? .null
      // A functionCall action runs locally, as `NodeResolver` does when triggered.
      let resolved: JSONValue
      if let functionCall = rawAction["functionCall"] {
        _ = context.resolveDynamicValue(functionCall)
        resolved = .null
      } else {
        resolved = context.resolveAction(rawAction)
      }

      if let expectedErrors = testCase["expectDispatchedErrors"] as? [[String: Any]] {
        let actualCodes = errorHandler.capturedErrors.map { error -> String in
          switch error {
          case .generic(let generic):
            #expect(generic.surfaceID == surfaceID, "\(name): error surfaceId mismatch")
            return generic.code
          case .validationFailed:
            return "VALIDATION_FAILED"
          }
        }
        let expectedCodes = expectedErrors.compactMap { $0["code"] as? String }
        #expect(actualCodes == expectedCodes, "\(name): dispatched error codes mismatch")
      }

      let expectedDispatched =
        (testCase["expectDispatched"] ?? testCase["expected"]).map {
          ConformanceTestHelper.toJSONValue($0)
        }

      if let expectedDispatched, case .object(let expDict) = expectedDispatched {
        guard case .object(let resDict) = resolved else {
          Issue.record("\(name): resolved action should be an object")
          continue
        }

        let eventObj = resDict["event"] ?? resolved
        guard case .object(let evDict) = eventObj else {
          Issue.record("\(name): resolved action should contain event object")
          continue
        }

        if let expName = expDict["name"]?.stringValue {
          #expect(evDict["name"]?.stringValue == expName, "\(name): event name mismatch")
        }

        if let expCtx = expDict["context"] {
          let actualCtx = evDict["context"] ?? .object([:])
          #expect(actualCtx == expCtx, "\(name): event context mismatch")
        }

        if let expMsg = expDict["userMessage"] {
          let actualMsg = evDict["userMessage"] ?? .null
          #expect(actualMsg == expMsg, "\(name): userMessage mismatch")
        }
      }
    }
  }
}
