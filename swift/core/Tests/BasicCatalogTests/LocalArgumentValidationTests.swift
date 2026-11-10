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

/// Resolves `regex` and `and` locally, recording the functions whose calls failed.
@MainActor
private final class LocalValidationFunctionHandler: FunctionHandler {
  var failedFunctions: [String] = []

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    switch name {
    case "regex":
      return RegexFunction()
    case "and":
      return AndFunction(readsValidationResults: true)
    default:
      return nil
    }
  }

  func handleFunctionError(_ error: any Error, functionName: String) {
    failedFunctions.append(functionName)
  }
}

/// Covers v1.0 argument validation of local function calls.
@MainActor
struct LocalArgumentValidationTests {

  @Test func refusesRegexCallMissingRequiredPattern() {
    let handler = LocalValidationFunctionHandler()
    let context = DataContext(
      dataModel: DataModel(),
      path: "",
      functionHandler: handler,
      protocolVersion: .v10,
      isUserActivated: true
    )

    let value = context.resolveDynamicValue(["@call": "regex", "args": ["value": "abc"]])
    #expect(value == .null, "the function doesn't run")
    #expect(handler.failedFunctions == ["regex"])

    let valid = context.resolveDynamicValue([
      "@call": "regex", "args": ["value": "abc", "pattern": "^a"],
    ])
    #expect(valid == .boolean(true))
  }

  @Test func allowsUnresolvedNullBindingsWhileEnforcingRequiredAndArrayBounds() {
    let handler = LocalValidationFunctionHandler()
    let context = DataContext(
      dataModel: DataModel(),
      path: "",
      functionHandler: handler,
      protocolVersion: .v10,
      isUserActivated: true
    )

    let unresolvedRegex = context.resolveDynamicValue([
      "@call": "regex",
      "args": ["value": ["@path": "/missing"], "pattern": "^a"],
    ])
    #expect(unresolvedRegex == .boolean(false))
    #expect(handler.failedFunctions.isEmpty)

    let unresolvedAnd = context.resolveDynamicValue([
      "@call": "and",
      "args": ["values": [["@path": "/missing"], true]],
    ])
    #expect(unresolvedAnd == .boolean(false))
    #expect(handler.failedFunctions.isEmpty)

    let missingPattern = context.resolveDynamicValue([
      "@call": "regex",
      "args": ["value": ["@path": "/missing"]],
    ])
    #expect(missingPattern == .null)
    #expect(handler.failedFunctions == ["regex"])

    let tooFewItems = context.resolveDynamicValue([
      "@call": "and",
      "args": ["values": [["@path": "/missing"]]],
    ])
    #expect(tooFewItems == .null)
    #expect(handler.failedFunctions == ["regex", "and"])
  }
}
