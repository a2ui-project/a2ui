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

import OrderedJSON

/// A function that a catalog declares without the renderer implementing it.
///
/// Register one in a v1.0 ``Catalog`` for a function the agent implements. Payload validation then
/// knows the function and checks its calls, and a surface that can call the agent sends each call
/// to it with `callAgentFunction`, after validating the arguments against ``api``'s schema. Without
/// a way to reach the agent, evaluating a call fails with
/// ``FunctionError/executionFailed(name:message:)``.
public struct SchemaOnlyFunction: FunctionImplementation {
  /// The API definition (name, returnType, schema) of the agent-side function.
  public let api: FunctionAPI

  /// Always `false`: the function runs on the agent.
  public var hasLocalImplementation: Bool { false }

  /// Creates a schema-only declaration.
  ///
  /// - Parameter api: The API definition of the agent-side function.
  public init(api: FunctionAPI) {
    self.api = api
  }

  /// Fails, because the renderer has no implementation of the function.
  ///
  /// - Throws: ``FunctionError/executionFailed(name:message:)``.
  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    throw FunctionError.executionFailed(
      name: api.name,
      message: "Function '\(api.name)' is schema-only and has no implementation."
    )
  }
}
