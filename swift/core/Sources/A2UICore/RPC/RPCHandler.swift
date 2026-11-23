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
import OrderedCollections
import OrderedJSON

/// Coordinates bidirectional Remote Procedure Calls (RPC) between the agent and renderer.
///
/// Manages pending outbound function calls with timeouts and correlation IDs, and evaluates
/// inbound function invocations against registered catalog implementations.
@MainActor
public final class RPCHandler {

  /// The default timeout duration in seconds for outbound agent function calls.
  public static let defaultTimeoutSeconds: TimeInterval = 30

  private struct PendingCall {
    let surfaceID: String
    let continuation: CheckedContinuation<JSONValue, any Error>
    let timeoutTask: Task<Void, Never>?
  }

  private var pendingCalls: [String: PendingCall] = [:]

  /// The number of outbound calls still awaiting the agent's response.
  public var pendingCallCount: Int { pendingCalls.count }
  /// Whether ``disposeAllPendingCalls()`` has run. A disposed handler rejects new outbound
  /// calls and answers inbound calls with `DISPOSED`.
  public private(set) var isDisposed = false

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
    guard !isDisposed else {
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: FunctionErrorPayload(
          code: FunctionError.disposed(callID: message.functionCallID).rpcCode,
          message: "The renderer's RPC state was disposed."
        ),
        version: message.version
      )
    }
    let callName = message.callFunction.call
    let targetCatalogID = message.callFunction.catalogID

    if let surfaceID = message.surfaceID, dataContext == nil {
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: FunctionErrorPayload(
          code: .invalidFunctionCall,
          message: "Surface not found: \(surfaceID)"
        ),
        version: message.version
      )
    }

    let resolvedCatalog: AnyCatalog?
    if let targetCatalogID {
      guard let found = catalogs[targetCatalogID] else {
        return RendererFunctionResponseMessage(
          functionCallID: message.functionCallID,
          error: FunctionErrorPayload(
            code: .invalidFunctionCall,
            message: "Catalog not found: \(targetCatalogID)"
          ),
          version: message.version
        )
      }
      resolvedCatalog = found
    } else {
      resolvedCatalog = nil
    }

    guard let catalog = resolvedCatalog else {
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: FunctionErrorPayload(
          code: .invalidFunctionCall,
          message: "Could not resolve catalog for function: \(callName)"
        ),
        version: message.version
      )
    }

    if !catalog.isAtLeastV10 {
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: FunctionErrorPayload(
          code: .invalidFunctionCall,
          message:
            "Catalog '\(catalog.id)' protocol version (\(catalog.protocolVersion ?? "v0.9")) does not match message protocol version."
        ),
        version: message.version
      )
    }

    // A schema-only declaration has no renderer implementation, so the renderer can't run it.
    guard let function = catalog.functions[callName], function.hasLocalImplementation else {
      let errorPayload = FunctionErrorPayload(
        code: .invalidFunctionCall,
        message: "Function not found: \(callName)"
      )
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: errorPayload,
        version: message.version
      )
    }

    // Validate allowedCallers and user activation constraints.
    if let permissionError = Self.checkExecutionPermissions(
      function: function,
      name: callName,
      userActivationPresent: userActivationPresent
    ) {
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: permissionError,
        version: message.version
      )
    }

    let rawArgs = message.callFunction.args ?? [:]
    let fallbackHandler = DummyContextFunctionHandler(catalogs: catalogs)
    let argHandler = RPCArgumentFunctionHandler(
      delegate: dataContext?.functionHandler,
      fallback: fallbackHandler,
      standaloneCatalog: catalog
    )
    if let nestedError = Self.checkNestedArgumentPermissions(
      in: rawArgs,
      handler: argHandler,
      userActivationPresent: userActivationPresent
    ) {
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: nestedError,
        version: message.version
      )
    }

    let argResolutionContext = DataContext(
      dataModel: dataContext?.dataModel ?? DataModel(),
      path: dataContext?.path ?? "",
      functionHandler: argHandler,
      protocolVersion: dataContext?.protocolVersion ?? message.version,
      index: dataContext?.index,
      isUserActivated: userActivationPresent
    )
    argResolutionContext.activeFunctionCatalogID = catalog.id
    argResolutionContext.isAgentCall = true
    // `RPCArgumentFunctionHandler` intentionally omits `agentFunctionCatalogID` and
    // `agentFunctionValue`: an agent-initiated `callRendererFunction` cannot wait on another
    // outbound call back to the agent, so any unimplemented nested call fails locally.
    let executionHandler = RPCArgumentFunctionHandler(
      delegate: dataContext?.functionHandler,
      fallback: fallbackHandler,
      standaloneCatalog: catalog
    )
    let effectiveContext = DataContext(
      dataModel: argResolutionContext.dataModel,
      path: dataContext?.path ?? "",
      functionHandler: executionHandler,
      protocolVersion: dataContext?.protocolVersion ?? message.version,
      index: dataContext?.index,
      isUserActivated: userActivationPresent
    )
    effectiveContext.activeFunctionCatalogID = catalog.id
    effectiveContext.isAgentCall = true

    var resolvedArgs: [String: JSONValue] = [:]
    for (key, val) in rawArgs {
      resolvedArgs[key] = argResolutionContext.resolveDynamicValue(val)
    }

    if let capturedError = argHandler.capturedInvalidFunctionCallError ?? argHandler.capturedError {
      let code: FunctionErrorPayload.Code =
        argHandler.capturedInvalidFunctionCallError != nil ? .invalidFunctionCall : .executionError
      let errorPayload = FunctionErrorPayload(
        code: code,
        message: Self.errorMessage(
          capturedError,
          fallback: "An argument of the function call could not be resolved."
        )
      )
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: errorPayload,
        version: message.version
      )
    }

    let argsValidation = function.api.schema.validate(
      .object(OrderedDictionary(uniqueKeysWithValues: resolvedArgs))
    )
    if !argsValidation.isValid {
      let errorPayload = FunctionErrorPayload(
        code: .invalidFunctionCall,
        message: "Invalid arguments for function '\(callName)'."
      )
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: errorPayload,
        version: message.version
      )
    }

    do {
      let result = try function.evaluate(arguments: resolvedArgs, context: effectiveContext)
      if let capturedError = executionHandler.capturedInvalidFunctionCallError {
        let errorPayload = FunctionErrorPayload(
          code: .invalidFunctionCall,
          message: Self.errorMessage(
            capturedError,
            fallback: "An error occurred during function execution."
          )
        )
        return RendererFunctionResponseMessage(
          functionCallID: message.functionCallID,
          error: errorPayload,
          version: message.version
        )
      }
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        value: result,
        version: message.version
      )
    } catch {
      let effectiveError = executionHandler.capturedInvalidFunctionCallError ?? error
      let code: FunctionErrorPayload.Code =
        Self.isInvalidFunctionCallError(effectiveError) ? .invalidFunctionCall : .executionError
      let errorPayload = FunctionErrorPayload(
        code: code,
        message: Self.errorMessage(
          effectiveError,
          fallback: "An error occurred during function execution."
        )
      )
      return RendererFunctionResponseMessage(
        functionCallID: message.functionCallID,
        error: errorPayload,
        version: message.version
      )
    }
  }

  fileprivate static func isInvalidFunctionCallError(_ error: any Error) -> Bool {
    guard let fnError = error as? FunctionError else { return false }
    switch fnError {
    case .callerDisallowed, .userActivationRequired:
      return true
    default:
      return false
    }
  }

  private static func checkExecutionPermissions(
    function: any FunctionImplementation,
    name: String,
    userActivationPresent: Bool
  ) -> FunctionErrorPayload? {
    if function.api.allowedCallers == .rendererOnly {
      return FunctionErrorPayload(
        code: .invalidFunctionCall,
        message: "Function '\(name)' cannot be called by agent (allowedCallers is rendererOnly)."
      )
    }
    if function.api.requiresUserActivation && !userActivationPresent {
      return FunctionErrorPayload(
        code: .invalidFunctionCall,
        message: "Function '\(name)' requires user activation context to execute."
      )
    }
    return nil
  }

  private static func checkNestedArgumentPermissions(
    in rawArgs: [String: JSONValue],
    handler: RPCArgumentFunctionHandler,
    userActivationPresent: Bool
  ) -> FunctionErrorPayload? {
    var stack: [(value: JSONValue, depth: Int)] = rawArgs.values.reversed().map { ($0, 0) }
    while let entry = stack.popLast() {
      if entry.depth > 1000 {
        return FunctionErrorPayload(
          code: .executionError,
          message: "Maximum dynamic value nesting depth exceeded (1000)."
        )
      }
      let step = inspectNestedNode(
        entry.value,
        handler: handler,
        userActivationPresent: userActivationPresent
      )
      if let error = step.error {
        return error
      }
      for child in step.children.reversed() {
        stack.append((value: child, depth: entry.depth + 1))
      }
    }
    return nil
  }

  private static func inspectNestedNode(
    _ value: JSONValue,
    handler: RPCArgumentFunctionHandler,
    userActivationPresent: Bool
  ) -> (error: FunctionErrorPayload?, children: [JSONValue]) {
    switch value {
    case .array(let items):
      return (nil, items)
    case .object(let dict):
      if dict["@call"]?.stringValue != nil {
        if let err = checkNestedCallRecord(
          dict,
          handler: handler,
          userActivationPresent: userActivationPresent
        ) {
          return (err, [])
        }
        if case .object(let argDict)? = dict["args"] {
          return (nil, Array(argDict.values))
        }
        if let rawArgs = dict["args"] {
          return (nil, [rawArgs])
        }
        return (nil, [])
      }
      return (nil, Array(dict.values))
    default:
      return (nil, [])
    }
  }

  private static func checkNestedCallRecord(
    _ dict: OrderedDictionary<String, JSONValue>,
    handler: RPCArgumentFunctionHandler,
    userActivationPresent: Bool
  ) -> FunctionErrorPayload? {
    guard let callName = dict["@call"]?.stringValue, !callName.hasPrefix("@") else {
      return nil
    }
    let rawCatalogID = dict["catalogId"]
    guard rawCatalogID == nil || rawCatalogID?.stringValue != nil else { return nil }
    let catalogID = rawCatalogID?.stringValue
    guard (try? handler.validateFunctionCatalog(id: catalogID, functionName: callName)) != nil,
      let fn = handler.function(named: callName, catalogID: catalogID)
    else {
      return nil
    }
    return checkExecutionPermissions(
      function: fn,
      name: callName,
      userActivationPresent: userActivationPresent
    )
  }

  /// The message of an error thrown while answering an agent-initiated call, or `fallback` when
  /// the error has no message.
  private static func errorMessage(_ error: any Error, fallback: String) -> String {
    let message: String
    if let a2uiError = error as? any A2UIError {
      message = a2uiError.message
    } else if let description = (error as? any LocalizedError)?.errorDescription {
      message = description
    } else {
      message = String(describing: error)
    }
    guard message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return message }
    return fallback
  }

  // MARK: - Outgoing Calls (Renderer -> Agent)

  /// Initiates a remote function call to the agent and awaits the response.
  ///
  /// - Parameters:
  ///   - surfaceID: The surface ID initiating the function call.
  ///   - functionName: The name of the function to execute on the agent.
  ///   - catalogID: Optional catalog identifier.
  ///   - args: Named argument dictionary.
  ///   - version: The A2UI protocol version for the outbound message.
  ///   - timeoutSeconds: Maximum duration to wait before timing out (default 30s).
  ///   - sendOutbound: Callback sending the outbound message.
  /// - Returns: The evaluated JSONValue returned by the agent.
  public func callAgentFunction(
    surfaceID: String,
    functionName: String,
    catalogID: String? = nil,
    functionCallID: String? = nil,
    args: [String: JSONValue]? = nil,
    version: A2UIProtocolVersion,
    timeoutSeconds: TimeInterval = RPCHandler.defaultTimeoutSeconds,
    sendOutbound: @escaping @Sendable (RendererToAgentMessage) -> Void
  ) async throws -> JSONValue {
    let callID = functionCallID ?? UUID().uuidString
    guard !isDisposed else {
      throw FunctionError.disposed(callID: callID)
    }
    let payload = CallFunctionPayload(
      call: functionName,
      catalogID: catalogID,
      args: args
    )
    let message = CallAgentFunctionMessage(
      surfaceID: surfaceID,
      functionCallID: callID,
      callFunction: payload,
      version: version
    )
    let outbound = RendererToAgentMessage.callAgentFunction(message)

    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        guard self.pendingCalls[callID] == nil else {
          continuation.resume(throwing: FunctionError.duplicate(callID: callID))
          return
        }

        let timeoutTask: Task<Void, Never>?
        if timeoutSeconds > 0 {
          timeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
            guard let self, !Task.isCancelled else { return }
            if let pending = self.pendingCalls.removeValue(forKey: callID) {
              pending.continuation.resume(throwing: FunctionError.timeout(callID: callID))
            }
          }
        } else {
          timeoutTask = nil
        }

        self.pendingCalls[callID] = PendingCall(
          surfaceID: surfaceID,
          continuation: continuation,
          timeoutTask: timeoutTask
        )
        sendOutbound(outbound)
      }
    } onCancel: {
      Task { @MainActor [weak self] in
        guard let self else { return }
        if let pending = self.pendingCalls.removeValue(forKey: callID) {
          pending.timeoutTask?.cancel()
          pending.continuation.resume(throwing: FunctionError.cancelled(callID: callID))
        }
      }
    }
  }

  // MARK: - Inbound Agent Responses

  /// Processes an incoming response from the agent for a previously initiated call.
  ///
  /// - Parameter response: The agent function response message.
  public func handleAgentResponse(_ response: AgentFunctionResponseMessage) {
    guard let pending = pendingCalls.removeValue(forKey: response.functionCallID) else {
      return
    }
    pending.timeoutTask?.cancel()

    if let error = response.error {
      pending.continuation.resume(
        throwing: FunctionError.remoteError(
          code: error.code,
          message: error.message,
          callID: response.functionCallID
        )
      )
    } else if let value = response.value {
      pending.continuation.resume(returning: value)
    } else {
      pending.continuation.resume(returning: .null)
    }
  }

  /// Cancels all active pending calls for a specific surface, throwing
  /// `FunctionError.surfaceCallsCancelled`.
  public func cancelPendingCalls(forSurfaceID surfaceID: String) {
    let error = FunctionError.surfaceCallsCancelled(surfaceID: surfaceID)
    let callsToCancel = pendingCalls.filter { $0.value.surfaceID == surfaceID }
    for (callID, pending) in callsToCancel {
      pendingCalls.removeValue(forKey: callID)
      pending.timeoutTask?.cancel()
      pending.continuation.resume(throwing: error)
    }
  }

  /// Cancels all active pending calls, throwing `FunctionError.cancelled`.
  public func cancelAllPendingCalls() {
    for (callID, pending) in pendingCalls {
      pending.timeoutTask?.cancel()
      pending.continuation.resume(throwing: FunctionError.cancelled(callID: callID))
    }
    pendingCalls.removeAll()
  }

  /// Disposes the handler: rejects every in-flight call with `FunctionError.cancelled`
  /// (`CANCELLED`), and makes later calls fail with `FunctionError.disposed` (`DISPOSED`).
  public func disposeAllPendingCalls() {
    isDisposed = true
    for (callID, pending) in pendingCalls {
      pending.timeoutTask?.cancel()
      pending.continuation.resume(throwing: FunctionError.cancelled(callID: callID))
    }
    pendingCalls.removeAll()
  }
}

private final class RPCArgumentFunctionHandler: FunctionHandler {
  private let delegate: FunctionHandler?
  private let fallback: DummyContextFunctionHandler
  private let standaloneCatalog: AnyCatalog?
  private(set) var capturedError: Error?
  private(set) var capturedInvalidFunctionCallError: Error?

  init(
    delegate: FunctionHandler?,
    fallback: DummyContextFunctionHandler,
    standaloneCatalog: AnyCatalog? = nil
  ) {
    self.delegate = delegate
    self.fallback = fallback
    self.standaloneCatalog = standaloneCatalog
  }

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    guard let delegate else {
      return fallback.function(named: name, catalogID: catalogID)
    }
    guard let catalogID,
      let standaloneCatalog,
      catalogID == standaloneCatalog.id,
      (try? delegate.validateFunctionCatalog(id: catalogID, functionName: name)) == nil
    else {
      return delegate.function(named: name, catalogID: catalogID)
    }
    return standaloneCatalog.functions[name]
  }

  func handleFunctionError(_ error: Error, functionName: String) {
    if capturedError == nil {
      capturedError = error
    }
    if capturedInvalidFunctionCallError == nil, RPCHandler.isInvalidFunctionCallError(error) {
      capturedInvalidFunctionCallError = error
    }
    delegate?.handleFunctionError(error, functionName: functionName)
  }

  func validateFunctionCatalog(id catalogID: String?, functionName: String) throws {
    guard let delegate else {
      try fallback.validateFunctionCatalog(id: catalogID, functionName: functionName)
      return
    }
    do {
      try delegate.validateFunctionCatalog(id: catalogID, functionName: functionName)
    } catch {
      if let standaloneCatalog, catalogID == standaloneCatalog.id {
        return
      }
      throw error
    }
  }

  func resolvedFunctionCatalogID(forCallCatalogID catalogID: String?) -> String? {
    if let delegate {
      if let standaloneCatalog,
        catalogID == standaloneCatalog.id,
        (try? delegate.validateFunctionCatalog(id: catalogID, functionName: "")) == nil
      {
        return standaloneCatalog.id
      }
      return delegate.resolvedFunctionCatalogID(forCallCatalogID: catalogID)
    }
    return fallback.resolvedFunctionCatalogID(forCallCatalogID: catalogID)
  }
}

private final class DummyContextFunctionHandler: FunctionHandler {
  private let catalogs: [String: AnyCatalog]

  init(catalogs: [String: AnyCatalog]) {
    self.catalogs = catalogs
  }

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    if name == "@index" {
      return IndexFunction()
    }
    guard let catalogID else { return nil }
    return catalogs[catalogID]?.functions[name]
  }

  func validateFunctionCatalog(id catalogID: String?, functionName: String) throws {
    let path = CatalogResolutionErrors.callCatalogIDPath(functionName: functionName)
    let code = CatalogResolutionErrors.runtimeCatalogErrorCode
    guard let catalogID else {
      throw CatalogResolutionErrors.noDefaultCatalog(
        subject: "Function call '\(functionName)'",
        surfaceID: "",
        path: path,
        code: code
      )
    }
    guard catalogs[catalogID] != nil else {
      throw CatalogResolutionErrors.catalogNotFound(catalogID, path: path, code: code)
    }
  }
}
