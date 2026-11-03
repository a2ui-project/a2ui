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
import OrderedJSON
import Testing

/// Routes undeclared functions to a fake agent, recording the calls sent and the errors.
@MainActor
private final class AgentRoutingFunctionHandler: FunctionHandler {
  var sentCalls: [AgentFunctionCall] = []
  var failedFunctions: [String] = []

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    name == "formatString" ? FormatStringFunction() : nil
  }

  func agentFunctionCatalogID(forCallCatalogID catalogID: String?) -> String? {
    catalogID ?? "https://example.com/catalog.json"
  }

  func agentFunctionValue(for call: AgentFunctionCall) -> JSONValue? {
    sentCalls.append(call)
    return .number(1.08)
  }

  func handleFunctionError(_ error: any Error, functionName: String) {
    failedFunctions.append(functionName)
  }
}

/// Covers `formatString` `${...}` parts that call a function the agent implements.
@MainActor
struct FormatStringAgentRoutingTests {

  private let call: JSONValue = [
    "@call": "formatString", "args": ["value": "Rate: ${fetchFxRate()}"],
  ]

  /// A `${...}` part can't wait for the agent, so a part that calls an agent function is
  /// refused: nothing is sent, and the part is empty.
  @Test func interpolatedAgentCallIsRefused() {
    let handler = AgentRoutingFunctionHandler()
    let context = DataContext(
      dataModel: DataModel(),
      path: "",
      functionHandler: handler,
      protocolVersion: .v10
    )

    #expect(context.resolveDynamicValue(call) == .string("Rate: "))
    #expect(handler.sentCalls.isEmpty)
    #expect(handler.failedFunctions == ["fetchFxRate"])
  }
}
