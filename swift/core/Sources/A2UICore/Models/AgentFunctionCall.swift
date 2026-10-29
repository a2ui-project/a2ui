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

/// A function call that a surface routes to the agent.
///
/// Unlike a `FunctionCall` in a payload, it always names the catalog the call resolved to, and its
/// arguments are resolved values. Two calls are equal when they name the same catalog, function
/// and arguments; ``SurfaceViewModel/callAgentFunction(_:)`` sends identical calls that are still
/// awaiting a response only once.
public struct AgentFunctionCall: Hashable, Sendable {
  /// The name of the function to call.
  public var name: String

  /// The identifier of the catalog the call resolved to on the surface.
  public var catalogID: String

  /// The resolved argument values.
  public var args: [String: JSONValue]

  /// Creates an agent function call.
  ///
  /// - Parameters:
  ///   - name: The name of the function to call.
  ///   - catalogID: The identifier of the catalog the call resolved to.
  ///   - args: The resolved argument values.
  public init(name: String, catalogID: String, args: [String: JSONValue] = [:]) {
    self.name = name
    self.catalogID = catalogID
    self.args = args
  }
}
