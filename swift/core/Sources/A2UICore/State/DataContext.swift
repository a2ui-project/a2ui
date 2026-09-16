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

/// Transient object created on-demand during rendering to solve "scope"
/// and binding resolution.
@MainActor
public final class DataContext {
  public let path: String
  public let dataModel: DataModel

  /// A reference to the function handler to evaluate dynamic function calls.
  public weak var functionHandler: FunctionHandler?

  public init(
    dataModel: DataModel,
    path: String,
    functionHandler: FunctionHandler
  ) {
    self.dataModel = dataModel
    self.path = path
    self.functionHandler = functionHandler
  }

  /// Sets a value at the given JSON Pointer path.
  /// If the path is relative, it is resolved against this context's path.
  public func set(_ targetPath: String, value: JSONValue?) {
    let absPath = JSONValue.absolutePath(for: targetPath, in: self.path)
    dataModel.set(absPath, value: value)
  }

  public func nested(relativePath: String) -> DataContext? {
    guard let handler = functionHandler else { return nil }
    let absPath = JSONValue.absolutePath(for: relativePath, in: self.path)

    return DataContext(
      dataModel: dataModel,
      path: absPath,
      functionHandler: handler
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
      if let pathStr = dict["path"]?.stringValue {
        let absPath = JSONValue.absolutePath(for: pathStr, in: self.path)
        return dataModel.get(absPath) ?? .null
      } else if let callName = dict["call"]?.stringValue {
        let catalogID = dict["catalogId"]?.stringValue
        guard let function = functionHandler?.function(named: callName, catalogID: catalogID) else {
          return .null
        }

        var resolvedArgs: [String: JSONValue] = [:]
        if let argsObj = dict["args"]?.dictionaryValue {
          for (argKey, argVal) in argsObj {
            resolvedArgs[argKey] = resolveDynamicValue(argVal)
          }
        }

        do {
          return try function.evaluate(arguments: resolvedArgs, context: self)
        } catch {
          return .null
        }
      }

      return value
    default:
      return value
    }
  }
}
