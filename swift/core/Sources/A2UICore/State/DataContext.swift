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
import JSONSchema
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

  /// The number of function calls evaluated that have no value: calls routed to the agent that
  /// are still awaiting its response or failed, and calls that failed with a reported error.
  ///
  /// A function call whose arguments include such a call is not evaluated or sent: its value is
  /// pending too, like the value of the nested call. A failed nested call has been reported
  /// already, so the enclosing call reports nothing.
  private var unsettledCallCount = 0

  /// Whether a function call was not evaluated or sent because one of its arguments includes a
  /// call that has no value (see `unsettledCallCount`).
  ///
  /// ``NodeResolver`` runs an action's function call again once those calls have settled.
  private(set) var hasDeferredFunctionCall = false

  /// Whether a function call failed with an error that was reported.
  ///
  /// ``NodeResolver`` doesn't run an action's function call again after such a failure.
  private(set) var hasFailedFunctionCall = false

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
        recordFailedCall()
        return .null
      case .local(let resolved):
        function = resolved
      case .agent(let declaration, let catalogID):
        return routeToAgent(
          name: callName,
          declaration: declaration,
          catalogID: catalogID,
          callDictionary: dict
        )
      }
    } else {
      // Before v1.0 a call can't select a catalog: it always runs in the surface catalog.
      function =
        functionHandler?.function(named: callName, catalogID: nil)
        ?? (callName == "@index" ? IndexFunction() : nil)
    }
    guard let function else {
      functionHandler?.handleFunctionError(
        FunctionError.functionNotFound(callName),
        functionName: callName
      )
      recordFailedCall()
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
      recordFailedCall()
      return .null
    }

    guard var resolvedArguments = resolveArguments(of: dict) else {
      return .null
    }
    if atLeastV10,
      let argPropsSchema = function.api.schema.jsonValue["properties"]?.objectValue
    {
      for (argKey, resolvedVal) in resolvedArguments {
        if let propSchema = argPropsSchema[argKey] {
          resolvedArguments[argKey] = Self.coerceValidationResults(
            schema: propSchema,
            value: resolvedVal
          )
        }
      }
    }

    do {
      return try function.evaluate(arguments: resolvedArguments, context: self)
    } catch {
      functionHandler?.handleFunctionError(error, functionName: callName)
      recordFailedCall()
      return .null
    }
  }

  /// Records a function call that failed with a reported error: it has no value, so a call that
  /// takes it as an argument doesn't run.
  private func recordFailedCall() {
    unsettledCallCount += 1
    hasFailedFunctionCall = true
  }

  /// Resolves the arguments of a function call.
  ///
  /// - Returns: The resolved arguments, or `nil` if an argument includes a call that has no
  ///   value: a call routed to the agent that is still awaiting the agent's response or failed,
  ///   or a call that failed with a reported error. The calling function's value is then pending
  ///   too, and it reports nothing.
  private func resolveArguments(
    of callDictionary: OrderedDictionary<String, JSONValue>
  ) -> [String: JSONValue]? {
    let unsettledBefore = unsettledCallCount
    let resolvedArguments =
      callDictionary["args"]?.dictionaryValue?.mapValues { resolveDynamicValue($0) } ?? [:]
    guard unsettledCallCount == unsettledBefore else {
      hasDeferredFunctionCall = true
      return nil
    }
    return resolvedArguments
  }

  /// Sends a v1.0 call that the renderer has no local implementation for to the agent: the
  /// fallback routing of `callAgentFunction`.
  ///
  /// A call to a declared function must be allowed for renderer callers and satisfy its
  /// `requiresUserActivation`, and its arguments must match its schema; the schema's top-level
  /// defaults are applied to the arguments sent.
  ///
  /// - Returns: The agent's result, or `null` while it is pending or after reporting an error.
  private func routeToAgent(
    name callName: String,
    declaration: (any FunctionImplementation)?,
    catalogID: String,
    callDictionary: OrderedDictionary<String, JSONValue>
  ) -> JSONValue {
    if let declaration {
      guard declaration.api.allowedCallers != .agentOnly else {
        functionHandler?.handleFunctionError(
          FunctionError.callerDisallowed(name: callName, caller: "renderer"),
          functionName: callName
        )
        recordFailedCall()
        return .null
      }
      guard !declaration.api.requiresUserActivation || isUserActivated else {
        functionHandler?.handleFunctionError(
          FunctionError.securityConstraintViolation(
            "Function '\(callName)' requires user activation and cannot be evaluated without an"
              + " active user gesture."
          ),
          functionName: callName
        )
        recordFailedCall()
        return .null
      }
    }
    guard var arguments = resolveArguments(of: callDictionary) else {
      return .null
    }
    if let declaration {
      let schema = declaration.api.schema
      if let argPropsSchema = schema.jsonValue["properties"]?.objectValue {
        for (argKey, resolvedVal) in arguments {
          if let propSchema = argPropsSchema[argKey] {
            arguments[argKey] = Self.coerceValidationResults(
              schema: propSchema,
              value: resolvedVal
            )
          }
        }
      }
      arguments = Self.applyingArgumentDefaults(of: schema.jsonValue, to: arguments)
      let result = schema.validate(.object(OrderedDictionary(uniqueKeysWithValues: arguments)))
      guard result.isValid else {
        functionHandler?.handleFunctionError(
          A2UIValidationError(
            "Validation failed for function '\(callName)': the arguments do not match its schema."
          ),
          functionName: callName
        )
        recordFailedCall()
        return .null
      }
    }
    let call = AgentFunctionCall(name: callName, catalogID: catalogID, args: arguments)
    guard let value = functionHandler?.agentFunctionValue(for: call) else {
      unsettledCallCount += 1
      return .null
    }
    return value
  }

  private static func isDynamicBooleanSchema(_ schema: JSONValue) -> Bool {
    if let ref = schema["$ref"]?.stringValue, ref.hasSuffix("/$defs/DynamicBoolean") {
      return true
    }
    if schema["type"]?.stringValue == "boolean" {
      return true
    }
    for keyword in ["oneOf", "anyOf", "allOf"] {
      if let subSchemas = schema[keyword]?.arrayValue,
        subSchemas.contains(where: { isDynamicBooleanSchema($0) })
      {
        return true
      }
    }
    return false
  }

  private static func coerceValidationResults(schema: JSONValue, value: JSONValue) -> JSONValue {
    if isDynamicBooleanSchema(schema) {
      if let members = value.objectValue, let valid = members["valid"]?.boolValue {
        return .boolean(valid)
      }
      return value
    }
    if let itemsSchema = schema["items"], let arr = value.arrayValue {
      return .array(arr.map { coerceValidationResults(schema: itemsSchema, value: $0) })
    }
    if let propsSchema = schema["properties"]?.objectValue, let obj = value.objectValue {
      var coerced: OrderedDictionary<String, JSONValue> = [:]
      for (k, v) in obj {
        if let propSchema = propsSchema[k] {
          coerced[k] = coerceValidationResults(schema: propSchema, value: v)
        } else {
          coerced[k] = v
        }
      }
      return .object(coerced)
    }
    return value
  }

  /// Adds the `default` of each top-level property in an argument schema that `arguments` lacks.
  private static func applyingArgumentDefaults(
    of schemaJSON: JSONValue,
    to arguments: [String: JSONValue]
  ) -> [String: JSONValue] {
    guard let properties = schemaJSON["properties"]?.dictionaryValue else { return arguments }
    var result = arguments
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
