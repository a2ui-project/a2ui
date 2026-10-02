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

@MainActor
private final class ConformanceFunctionHandler: FunctionHandler {
  private let functionsMap: [String: any FunctionImplementation] = Dictionary(
    uniqueKeysWithValues: BasicFunctions.allFunctions.map { ($0.api.name, $0) }
  )

  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    functionsMap[named]
  }
}

/// Runs the shared `conformance/core/actions.yaml` suite.
@MainActor
struct ActionsConformanceTests {
  private let functionHandler = ConformanceFunctionHandler()

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
      let context = DataContext(dataModel: model, path: scope, functionHandler: functionHandler)

      let rawAction =
        (testCase["actionPayload"] ?? testCase["action_data"]).map {
          ConformanceTestHelper.toJSONValue($0)
        } ?? .null
      let resolved = context.resolveAction(rawAction)

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
