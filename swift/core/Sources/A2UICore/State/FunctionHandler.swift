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

@MainActor
public protocol FunctionHandler: AnyObject, Sendable {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)?
  func handleFunctionError(_ error: any Error, functionName: String)

  /// Checks that the catalog a v1.0 function call runs in resolves: the catalog the call names,
  /// or the default catalog when it names none.
  ///
  /// ``DataContext`` calls this from v1.0 before looking up a catalog function, so that an
  /// unresolvable catalog is reported as a catalog fault rather than a missing function. The
  /// default implementation accepts every catalog.
  ///
  /// - Throws: An error, typically `A2UICatalogError`, if the catalog can't be resolved.
  func validateFunctionCatalog(id catalogID: String?, functionName: String) throws

  /// Returns the catalog that a v1.0 call is sent to the agent with, when the renderer has no
  /// local implementation of the function, or `nil` if this handler can't call the agent.
  ///
  /// ``DataContext`` calls this after ``validateFunctionCatalog(id:functionName:)`` accepted the
  /// call's catalog, for a function that the catalog doesn't declare or declares without an
  /// implementation (see ``FunctionImplementation/hasLocalImplementation``). The default
  /// implementation returns `nil`, so such calls fail locally.
  ///
  /// - Parameter catalogID: The catalog the call names, or `nil` when it names none.
  /// - Returns: The identifier of the catalog the call resolved to (the named catalog, else the
  ///   default catalog), or `nil` when calls are not routed to the agent.
  func agentFunctionCatalogID(forCallCatalogID catalogID: String?) -> String?

  /// Sends a call to the agent, returning its result if it is already available.
  ///
  /// ``DataContext`` calls this for each call it routes to the agent. The handler reports an agent
  /// error or timeout itself, through ``handleFunctionError(_:functionName:)``. The default
  /// implementation sends nothing and returns `nil`.
  ///
  /// - Parameter call: The call, naming the catalog it resolved to and its resolved arguments.
  /// - Returns: The agent's result, or `nil` while the call awaits it or after it failed. A
  ///   function call that takes the value as an argument then doesn't run.
  func agentFunctionValue(for call: AgentFunctionCall) -> JSONValue?
}

extension FunctionHandler {
  public func handleFunctionError(_ error: any Error, functionName: String) {}

  public func validateFunctionCatalog(id catalogID: String?, functionName: String) throws {}

  public func agentFunctionCatalogID(forCallCatalogID catalogID: String?) -> String? {
    nil
  }

  public func agentFunctionValue(for call: AgentFunctionCall) -> JSONValue? {
    nil
  }
}
