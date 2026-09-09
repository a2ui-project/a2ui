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

import Foundation
import OrderedJSON

/// Coordinates bidirectional Remote Procedure Calls (RPC) between the agent and renderer.
///
/// Manages pending outbound function calls with timeouts and correlation IDs, and evaluates
/// inbound function invocations against registered catalog implementations.
@MainActor
public final class RPCHandler {

  private var pendingCalls: [String: CheckedContinuation<JSONValue, any Error>] = [:]

  public init() {}

  // MARK: - Incoming Calls (Agent -> Renderer)

  /// Evaluates an inbound function invocation requested by the agent.
  ///
  /// - Parameters:
  ///   - message: The call message containing function name, arguments, and correlation ID.
  ///   - catalogs: Available component/function catalogs.
  ///   - defaultCatalogID: Optional fallback catalog ID.
  ///   - dataContext: Optional active data context for execution.
  /// - Returns: A response message containing either the evaluated result or an error payload.
  public func handleIncomingCall(
    _ message: CallRendererFunctionMessage,
    catalogs: [String: AnyCatalog],
    defaultCatalogID: String? = nil,
    dataContext: DataContext? = nil,
    userActivationPresent: Bool = false
  ) async -> RendererFunctionResponseMessage {
    let callName = message.callFunction.call
    let catalogID = message.callFunction.catalogID ?? defaultCatalogID

    if let explicitCatalogID = message.callFunction.catalogID {
      guard catalogs[explicitCatalogID] != nil else {
        let errorPayload = FunctionErrorPayload(
          code: .invalidFunctionCall,
          message: "Catalog not found: \(explicitCatalogID)"
        )
        return RendererFunctionResponseMessage(
          functionCallID: message.functionCallID,
          error: errorPayload
        )
      }
    }

    func findFunction() -> (any FunctionImplementation)? {
      if let catalogID, let catalog = catalogs[catalogID], let fn = catalog.functions[callName] {
        return fn
      }
      if let defaultCatalogID, let catalog = catalogs[defaultCatalogID],
        let fn = catalog.functions[callName]
      {
        return fn
      }
      for catalog in catalogs.values {
        if let fn = catalog.functions[callName] {
          return fn
        }
      }
      return nil
    }

    guard let function = findFunction() else {
      let errorPayload = FunctionErrorPayload(
        code: .invalidFunctionCall,
        message: "Function not found: \(callName)"
      )
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: errorPayload
      )
    }

    // Validate allowedCallers constraint: agent must be permitted to invoke.
    if function.api.allowedCallers == .rendererOnly {
      let errorPayload = FunctionErrorPayload(
        code: .invalidFunctionCall,
        message:
          "Function '\(callName)' cannot be called by agent (allowedCallers is rendererOnly)."
      )
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: errorPayload
      )
    }

    // Validate user activation requirement.
    if function.api.requiresUserActivation && !userActivationPresent {
      let errorPayload = FunctionErrorPayload(
        code: .invalidFunctionCall,
        message: "Function '\(callName)' requires user activation context to execute."
      )
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: errorPayload
      )
    }

    let args = message.callFunction.args ?? [:]
    let effectiveContext =
      dataContext
      ?? DataContext(
        dataModel: DataModel(),
        path: "",
        functionHandler: DummyContextFunctionHandler(catalogs: catalogs)
      )

    do {
      let result = try function.evaluate(arguments: args, context: effectiveContext)
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        value: result
      )
    } catch {
      let errorPayload = FunctionErrorPayload(
        code: .executionError,
        message: "An error occurred during function execution."
      )
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: errorPayload
      )
    }
  }

  // MARK: - Outgoing Calls (Renderer -> Agent)

  /// Initiates a remote function call to the agent and awaits the response.
  ///
  /// - Parameters:
  ///   - surfaceID: The surface ID initiating the function call.
  ///   - functionName: The name of the function to execute on the agent.
  ///   - catalogID: Optional catalog identifier.
  ///   - args: Named argument dictionary.
  ///   - returnType: Expected return type name.
  ///   - timeoutSeconds: Maximum duration to wait before timing out (default 30s).
  ///   - sendOutbound: Callback sending the outbound message.
  /// - Returns: The evaluated JSONValue returned by the agent.
  public func callAgentFunction(
    surfaceID: String,
    functionName: String,
    catalogID: String? = nil,
    functionCallID: String? = nil,
    args: [String: JSONValue]? = nil,
    returnType: String? = nil,
    timeoutSeconds: TimeInterval = 30.0,
    sendOutbound: @escaping @Sendable (RendererToAgentMessage) -> Void
  ) async throws -> JSONValue {
    let callID = functionCallID ?? UUID().uuidString
    let payload = CallFunctionPayload(
      call: functionName,
      catalogID: catalogID,
      args: args,
      returnType: returnType
    )
    let message = CallAgentFunctionMessage(
      surfaceID: surfaceID,
      functionCallID: callID,
      callFunction: payload
    )
    let outbound = RendererToAgentMessage.callAgentFunction(message)

    return try await withCheckedThrowingContinuation { continuation in
      self.pendingCalls[callID] = continuation
      sendOutbound(outbound)

      if timeoutSeconds > 0 {
        Task { [weak self] in
          try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
          guard let self else { return }
          if let pending = self.pendingCalls.removeValue(forKey: callID) {
            pending.resume(throwing: FunctionError.timeout(callID: callID))
          }
        }
      }
    }
  }

  // MARK: - Inbound Agent Responses

  /// Processes an incoming response from the agent for a previously initiated call.
  ///
  /// - Parameter response: The agent function response message.
  public func handleAgentResponse(_ response: AgentFunctionResponseMessage) {
    guard let continuation = pendingCalls.removeValue(forKey: response.functionCallID) else {
      return
    }

    if let error = response.error {
      continuation.resume(
        throwing: FunctionError.remoteError(code: error.code, message: error.message)
      )
    } else if let value = response.value {
      continuation.resume(returning: value)
    } else {
      continuation.resume(returning: .null)
    }
  }

  /// Cancels all active pending calls, throwing a cancellation error.
  public func cancelAllPendingCalls() {
    for (_, continuation) in pendingCalls {
      continuation.resume(throwing: CancellationError())
    }
    pendingCalls.removeAll()
  }
}

private final class DummyContextFunctionHandler: FunctionHandler {
  private let catalogs: [String: AnyCatalog]

  init(catalogs: [String: AnyCatalog]) {
    self.catalogs = catalogs
  }

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    if let catalogID, let cat = catalogs[catalogID], let fn = cat.functions[name] {
      return fn
    }
    for cat in catalogs.values {
      if let fn = cat.functions[name] {
        return fn
      }
    }
    return nil
  }
}
