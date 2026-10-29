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

/// Transient object created on-demand during rendering to solve "scope"
/// and binding resolution.
@MainActor
public final class DataContext {
  public let path: String
  public let dataModel: DataModel
  public let protocolVersion: A2UIProtocolVersion?
  public let index: Int?

  /// Whether this context evaluates in response to a user gesture, such as an action.
  ///
  /// A call routed to the agent for a declared function with `requiresUserActivation` is rejected
  /// unless this is `true`.
  public let isUserActivated: Bool

  /// A reference to the function handler to evaluate dynamic function calls.
  public weak var functionHandler: FunctionHandler?

  /// The number of calls routed to the agent that are still awaiting a result.
  ///
  /// A function call whose arguments include such a call is not evaluated or sent: its value is
  /// pending too, like the value of the nested call.
  private var pendingAgentCallCount = 0

  /// The outcome of looking up the function that a v1.0 call runs.
  private enum V10FunctionTarget {
    /// The renderer runs the function.
    case local(any FunctionImplementation)
    /// The agent runs the function. `declaration` is the catalog's declaration, if any.
    case agent(declaration: (any FunctionImplementation)?, catalogID: String)
  }

  public init(
    dataModel: DataModel,
    path: String,
    functionHandler: FunctionHandler,
    protocolVersion: A2UIProtocolVersion? = nil,
    index: Int? = nil,
    isUserActivated: Bool = false
  ) {
    self.dataModel = dataModel
    self.path = path
    self.functionHandler = functionHandler
    self.protocolVersion = protocolVersion
    self.index = index
    self.isUserActivated = isUserActivated
  }

  public var atLeastV10: Bool {
    protocolVersion?.isAtLeastV10 ?? false
  }

  public nonisolated static func validateReservedDirectives<S: Sequence>(_ keys: S) throws
  where S.Element == String {
    for key in keys {
      if key.hasPrefix("@") && !key.hasPrefix("@@") && key != "@path" && key != "@call" {
        throw A2UIValidationError(
          "Unrecognized reserved protocol directive '\(key)' in v1.0 dynamic object. Reserved keys must be in @path, @call, or escaped with prefix doubling.",
          details: [
            A2UIErrorDetail(
              path: "/\(key)",
              code: "INVALID_RESERVED_KEY",
              message: "Unrecognized reserved protocol directive '\(key)'"
            )
          ]
        )
      }
    }
  }

  /// Sets a value at the given JSON Pointer path.
  /// If the path is relative, it is resolved against this context's path.
  public func set(_ targetPath: String, value: JSONValue?) {
    let absPath = JSONValue.absolutePath(for: targetPath, in: self.path)
    dataModel.set(absPath, value: value)
  }

  public func nested(relativePath: String, index: Int? = nil) -> DataContext? {
    guard let handler = functionHandler else { return nil }
    let absPath = JSONValue.absolutePath(for: relativePath, in: self.path)

    return DataContext(
      dataModel: dataModel,
      path: absPath,
      functionHandler: handler,
      protocolVersion: protocolVersion,
      index: index ?? self.index,
      isUserActivated: isUserActivated
    )
  }

  public nonisolated static func unescapeObjectKey(_ key: String) -> String {
    key.hasPrefix("@@") ? String(key.dropFirst()) : key
  }

  /// Resolves a dynamic value to its current literal `JSONValue`.
  ///
  /// Recursively evaluates data bindings (`path` / `@path`), function calls
  /// (`call` / `@call`), arrays, and nested plain objects.
  public func resolveDynamicValue(_ value: JSONValue) -> JSONValue {
    switch value {
    case .array(let arr):
      return .array(arr.map { resolveDynamicValue($0) })
    case .object(let dict):
      let allowAtPrefix = protocolVersion?.isAtLeastV10 ?? true
      let allowLegacyDirectives = !atLeastV10

      if allowAtPrefix, let pathStr = dict["@path"]?.stringValue {
        let absPath = JSONValue.absolutePath(for: pathStr, in: self.path)
        return dataModel.get(absPath) ?? .null
      } else if allowLegacyDirectives,
        let pathStr = dict["path"]?.stringValue,
        dict["componentId"] == nil
      {
        let absPath = JSONValue.absolutePath(for: pathStr, in: self.path)
        return dataModel.get(absPath) ?? .null
      } else if allowAtPrefix, let callName = dict["@call"]?.stringValue {
        return evaluateFunctionCall(name: callName, dict: dict)
      } else if allowLegacyDirectives, let callName = dict["call"]?.stringValue {
        return evaluateFunctionCall(name: callName, dict: dict)
      }

      var resultDict: OrderedDictionary<String, JSONValue> = [:]
      for (k, v) in dict {
        let unescapedKey = allowAtPrefix ? Self.unescapeObjectKey(k) : k
        resultDict[unescapedKey] = resolveDynamicValue(v)
      }
      return .object(resultDict)
    default:
      return value
    }
  }

  private func evaluateFunctionCall(
    name callName: String,
    dict: OrderedDictionary<String, JSONValue>
  ) -> JSONValue {
    let function: (any FunctionImplementation)?
    if atLeastV10 {
      switch resolveV10Function(name: callName, dict: dict) {
      case nil:
        return .null
      case .local(let resolved):
        function = resolved
      case .agent(let declaration, let catalogID):
        return routeToAgent(
          name: callName,
          declaration: declaration,
          catalogID: catalogID,
          dict: dict
        )
      }
    } else {
      let catalogID = dict["catalogId"]?.stringValue
      if callName == "@index", let catalogID {
        functionHandler?.handleFunctionError(
          Self.systemFunctionNamesCatalogError(callName, catalogID: catalogID),
          functionName: callName
        )
        return .null
      }
      function =
        functionHandler?.function(named: callName, catalogID: catalogID)
        ?? (callName == "@index" ? IndexFunction() : nil)
    }
    guard let function else {
      functionHandler?.handleFunctionError(
        FunctionError.functionNotFound(callName),
        functionName: callName
      )
      return .null
    }
    // Bindings, checks and actions are renderer callers. In v1.0 an agentOnly function runs
    // only through an agent-initiated callRendererFunction, which RPCHandler evaluates
    // directly. allowedCallers is a v1.0 feature, so v0.9 calls are not restricted.
    if atLeastV10 && function.api.allowedCallers == .agentOnly {
      functionHandler?.handleFunctionError(
        FunctionError.callerDisallowed(name: callName, caller: "renderer"),
        functionName: callName
      )
      return .null
    }

    guard let resolvedArgs = resolveArguments(of: dict) else {
      return .null
    }

    do {
      return try function.evaluate(arguments: resolvedArgs, context: self)
    } catch {
      functionHandler?.handleFunctionError(error, functionName: callName)
      return .null
    }
  }

  /// Resolves the arguments of a function call.
  ///
  /// - Returns: The resolved arguments, or `nil` if an argument includes a call routed to the
  ///   agent that is still awaiting its result. The calling function's value is then pending too.
  private func resolveArguments(
    of dict: OrderedDictionary<String, JSONValue>
  ) -> [String: JSONValue]? {
    let pendingBefore = pendingAgentCallCount
    var resolvedArgs: [String: JSONValue] = [:]
    if let argsObj = dict["args"]?.dictionaryValue {
      for (argKey, argVal) in argsObj {
        resolvedArgs[argKey] = resolveDynamicValue(argVal)
      }
    }
    return pendingAgentCallCount == pendingBefore ? resolvedArgs : nil
  }

  /// Sends a v1.0 call that the renderer has no local implementation for to the agent: the
  /// fallback routing of `callAgentFunction`.
  ///
  /// A call to a declared function must satisfy its `requiresUserActivation`, and its arguments
  /// must match its schema; the schema's top-level defaults are applied to the arguments sent.
  ///
  /// - Returns: The agent's result, or `null` while it is pending or after reporting an error.
  private func routeToAgent(
    name callName: String,
    declaration: (any FunctionImplementation)?,
    catalogID: String,
    dict: OrderedDictionary<String, JSONValue>
  ) -> JSONValue {
    if let declaration, declaration.api.requiresUserActivation, !isUserActivated {
      functionHandler?.handleFunctionError(
        FunctionError.securityConstraintViolation(
          "Function '\(callName)' requires user activation and cannot be evaluated without an"
            + " active user gesture."
        ),
        functionName: callName
      )
      return .null
    }
    guard var args = resolveArguments(of: dict) else {
      return .null
    }
    if let declaration {
      let schema = declaration.api.schema
      args = Self.applyingArgumentDefaults(of: schema.jsonValue, to: args)
      let result = schema.validate(.object(OrderedDictionary(uniqueKeysWithValues: args)))
      if !result.isValid {
        functionHandler?.handleFunctionError(
          A2UIValidationError(
            "Validation failed for function '\(callName)': the arguments do not match its schema."
          ),
          functionName: callName
        )
        return .null
      }
    }
    let call = AgentFunctionCall(name: callName, catalogID: catalogID, args: args)
    guard let value = functionHandler?.agentFunctionValue(for: call) else {
      pendingAgentCallCount += 1
      return .null
    }
    return value
  }

  /// Adds the `default` of each top-level property in an argument schema that `args` lacks.
  private static func applyingArgumentDefaults(
    of schemaJSON: JSONValue,
    to args: [String: JSONValue]
  ) -> [String: JSONValue] {
    guard let properties = schemaJSON["properties"]?.dictionaryValue else { return args }
    var result = args
    for (name, propertySchema) in properties where result[name] == nil {
      if let defaultValue = propertySchema["default"] {
        result[name] = defaultValue
      }
    }
    return result
  }

  /// Looks up the function a v1.0 call runs, reporting any failure to the function handler.
  ///
  /// A reserved `@` system function belongs to no catalog: a call to one that carries a
  /// `catalogId` key, whatever its value, is a malformed expression. Any other call runs in the
  /// catalog it names, else in the default catalog; a non-string `catalogId` or a catalog that
  /// can't be resolved is reported as a catalog error, not looked up in the default catalog.
  ///
  /// A function that the resolved catalog doesn't declare, or declares without a local
  /// implementation, runs on the agent when the function handler can call it (see
  /// ``FunctionHandler/agentFunctionCatalogID(forCallCatalogID:)``). Reserved `@` system
  /// functions never do.
  ///
  /// - Returns: Where the function runs, or `nil` after reporting an error. A function missing
  ///   from its resolved catalog, and not routed to the agent, is reported as
  ///   `FunctionError.functionNotFound`.
  private func resolveV10Function(
    name callName: String,
    dict: OrderedDictionary<String, JSONValue>
  ) -> V10FunctionTarget? {
    let rawCatalogID = dict["catalogId"]
    let catalogIDPath = CatalogResolutionErrors.callCatalogIDPath(functionName: callName)
    let failure: any Error
    if callName.hasPrefix("@") {
      if let rawCatalogID {
        failure = Self.systemFunctionNamesCatalogError(
          callName,
          catalogID: rawCatalogID.stringValue ?? Self.jsonText(rawCatalogID)
        )
      } else if callName == "@index" {
        return .local(
          functionHandler?.function(named: callName, catalogID: nil) ?? IndexFunction()
        )
      } else {
        failure = FunctionError.functionNotFound(callName)
      }
    } else if let rawCatalogID, rawCatalogID.stringValue == nil {
      failure = CatalogResolutionErrors.catalogNotFound(
        Self.jsonText(rawCatalogID),
        path: catalogIDPath,
        code: CatalogResolutionErrors.runtimeCatalogErrorCode
      )
    } else {
      let catalogID = rawCatalogID?.stringValue
      do {
        try functionHandler?.validateFunctionCatalog(id: catalogID, functionName: callName)
      } catch {
        functionHandler?.handleFunctionError(error, functionName: callName)
        return nil
      }
      let function = functionHandler?.function(named: callName, catalogID: catalogID)
      if let function, function.hasLocalImplementation {
        return .local(function)
      }
      if let agentCatalogID = functionHandler?.agentFunctionCatalogID(
        forCallCatalogID: catalogID
      ) {
        return .agent(declaration: function, catalogID: agentCatalogID)
      }
      if let function {
        return .local(function)
      }
      failure = FunctionError.functionNotFound(callName)
    }
    functionHandler?.handleFunctionError(failure, functionName: callName)
    return nil
  }

  /// The error reported for a call to a reserved `@` system function that names a catalog.
  private static func systemFunctionNamesCatalogError(
    _ callName: String,
    catalogID: String
  ) -> FunctionError {
    FunctionError.invalidArgumentType(
      expected: "no catalogId on system function \(callName)",
      actual: catalogID
    )
  }

  /// Returns the JSON text of a value, for error messages.
  private static func jsonText(_ value: JSONValue) -> String {
    guard let data = try? JSONEncoder().encode(value),
      let text = String(data: data, encoding: .utf8)
    else {
      return String(describing: value)
    }
    return text
  }

  /// Resolves an action payload by evaluating dynamic values in its context and userMessage.
  public func resolveAction(_ action: JSONValue) -> JSONValue {
    switch action {
    case .string(let name):
      return .object([
        "event": .object([
          "name": .string(name),
          "context": .object([:]),
        ])
      ])
    case .object(let dict):
      if let eventVal = dict["event"], case .object(let eventDict) = eventVal {
        var resolvedEvent = eventDict
        if let ctxVal = eventDict["context"], case .object(let ctxDict) = ctxVal {
          var resolvedCtx = OrderedDictionary<String, JSONValue>()
          for (k, v) in ctxDict {
            resolvedCtx[k] = resolveDynamicValue(v)
          }
          resolvedEvent["context"] = .object(resolvedCtx)
        } else {
          resolvedEvent["context"] = .object([:])
        }
        if let msgVal = eventDict["userMessage"] {
          resolvedEvent["userMessage"] = resolveDynamicValue(msgVal)
        }
        var newDict = dict
        newDict["event"] = .object(resolvedEvent)
        return .object(newDict)
      } else if dict["name"] != nil {
        var resolvedAction = dict
        if let ctxVal = dict["context"], case .object(let ctxDict) = ctxVal {
          var resolvedCtx = OrderedDictionary<String, JSONValue>()
          for (k, v) in ctxDict {
            resolvedCtx[k] = resolveDynamicValue(v)
          }
          resolvedAction["context"] = .object(resolvedCtx)
        } else {
          resolvedAction["context"] = .object([:])
        }
        if let msgVal = dict["userMessage"] {
          resolvedAction["userMessage"] = resolveDynamicValue(msgVal)
        }
        return .object(resolvedAction)
      }
      return action
    default:
      return action
    }
  }
}
