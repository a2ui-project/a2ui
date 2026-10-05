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
  public let protocolVersion: String?
  public let index: Int?

  /// A reference to the function handler to evaluate dynamic function calls.
  public weak var functionHandler: FunctionHandler?

  public init(
    dataModel: DataModel,
    path: String,
    functionHandler: FunctionHandler,
    protocolVersion: String? = nil,
    index: Int? = nil
  ) {
    self.dataModel = dataModel
    self.path = path
    self.functionHandler = functionHandler
    self.protocolVersion = protocolVersion
    self.index = index
  }

  public var isV10: Bool {
    guard let version = protocolVersion else { return false }
    let core = version.hasPrefix("v") ? String(version.dropFirst()) : version
    guard let major = Int(core.split(separator: ".").first ?? "") else { return false }
    return major >= 1
  }

  public static func validateReservedDirectives<S: Sequence>(_ keys: S) throws
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
      index: index ?? self.index
    )
  }

  /// Resolves a dynamic value to its current literal `JSONValue`.
  ///
  /// Only a top-level `path` or `call` object is a binding; any other value,
  /// including containers with nested `path`/`call` keys, passes through
  /// unchanged.
  public func resolveDynamicValue(_ value: JSONValue) -> JSONValue {
    switch value {
    case .object(let dict):
      if isV10 {
        if let pathStr = dict["@path"]?.stringValue {
          let absPath = JSONValue.absolutePath(for: pathStr, in: self.path)
          return dataModel.get(absPath) ?? .null
        } else if let callName = dict["@call"]?.stringValue {
          return evaluateFunctionCall(name: callName, dict: dict)
        }

        if dict.keys.contains(where: { $0.hasPrefix("@@") }) {
          var resultDict: OrderedDictionary<String, JSONValue> = [:]
          for (k, v) in dict {
            let unescapedKey = k.hasPrefix("@@") ? String(k.dropFirst()) : k
            resultDict[unescapedKey] = v
          }
          return .object(resultDict)
        }

        return value
      } else {
        let allowAtPrefix = (protocolVersion == nil)
        if let pathStr =
          (dict["path"]?.stringValue ?? (allowAtPrefix ? dict["@path"]?.stringValue : nil)),
          dict["componentId"] == nil
        {
          let absPath = JSONValue.absolutePath(for: pathStr, in: self.path)
          return dataModel.get(absPath) ?? .null
        } else if let callName =
          (dict["call"]?.stringValue ?? (allowAtPrefix ? dict["@call"]?.stringValue : nil))
        {
          return evaluateFunctionCall(name: callName, dict: dict)
        }

        if allowAtPrefix, dict.keys.contains(where: { $0.hasPrefix("@@") }) {
          var resultDict: OrderedDictionary<String, JSONValue> = [:]
          for (k, v) in dict {
            let unescapedKey = k.hasPrefix("@@") ? String(k.dropFirst()) : k
            resultDict[unescapedKey] = v
          }
          return .object(resultDict)
        }

        return value
      }
    default:
      return value
    }
  }

  private func evaluateFunctionCall(
    name callName: String,
    dict: OrderedDictionary<String, JSONValue>
  ) -> JSONValue {
    let catalogID = dict["catalogId"]?.stringValue
    guard !(callName == "@index" && catalogID != nil) else {
      return .null
    }
    guard
      let function = functionHandler?.function(named: callName, catalogID: catalogID)
        ?? (callName == "@index" ? IndexFunction() : nil)
    else {
      return .null
    }

    var resolvedArgs: [String: JSONValue] = [:]
    if let argsObj = dict["args"]?.dictionaryValue {
      for (argKey, argVal) in argsObj {
        if let arr = argVal.arrayValue {
          resolvedArgs[argKey] = .array(arr.map { resolveDynamicValue($0) })
        } else {
          resolvedArgs[argKey] = resolveDynamicValue(argVal)
        }
      }
    }

    do {
      return try function.evaluate(arguments: resolvedArgs, context: self)
    } catch {
      return .null
    }
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
