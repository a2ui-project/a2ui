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
import Testing

@testable import BasicCatalog

private final class MockFunctionHandler: FunctionHandler, @unchecked Sendable {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    return nil
  }
}

struct OrFunctionTests {

  let function = OrFunction()
  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "or")
    #expect(function.api.returnType == .boolean)
  }

  // MARK: - Edge-Case Evaluation

  @Test func evaluatesToFalseWhenValuesIsMissing() throws {
    let result = try function.evaluate(arguments: [:], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToFalseWhenValuesIsNotAnArray() throws {
    let result = try function.evaluate(
      arguments: ["values": .boolean(true)], context: context)
    #expect(result == .boolean(false))
  }

  @Test func evaluatesToFalseWithEmptyArray() throws {
    let result = try function.evaluate(
      arguments: ["values": .array([])], context: context)
    #expect(result == .boolean(false))
  }
}
