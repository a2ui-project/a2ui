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
import JSONSchema
import OrderedCollections

/// Performs string interpolation of data model values and other functions.
public final class FormatStringFunction: FunctionImplementation, Sendable {
  public let api = FunctionAPI(
    name: "formatString",
    returnType: .string,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": { "type": "string" }
          },
          "required": ["value"]
        }
        """
    )
  )

  private let parser = ExpressionParser()

  public init() {}

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let valueString = arguments["value"]?.stringValue else {
      throw FunctionError.missingArgument("value")
    }

    let parts = try parser.parse(valueString)
    var result = ""

    for part in parts {
      let dynamicPart = context.atLeastV10 ? Self.adaptedForV10(part) : part
      let resolved = context.resolveDynamicValue(dynamicPart)

      switch resolved {
      case .string(let s):
        result += s
      case .integer(let i):
        result += String(i)
      case .number(let n):
        // Format to avoid .0 if integer-like, or let Swift default formatting apply.
        // Swift Double to String formatting is usually reasonable.
        if let exactInt = Int(exactly: n) {
          result += String(exactInt)
        } else {
          result += String(n)
        }
      case .boolean(let b):
        result += b ? "true" : "false"
      case .null:
        // skip or append "null"? usually skip or empty. A2UI uses empty for null in strings.
        continue
      case .object, .array:
        result += try resolved.serialized()
      }
    }

    return .string(result)
  }

  /// Rewrites a parsed `path` or `call` part into its v1.0 `@path` or `@call` form.
  ///
  /// `ExpressionParser` emits v0.9 directive keys, which a v1.0 `DataContext` reads as plain
  /// object keys. On a v1.0 surface each part, including nested call arguments, is adapted
  /// before it is resolved.
  private static func adaptedForV10(_ part: JSONValue) -> JSONValue {
    guard case .object(let dict) = part else {
      return part
    }
    if let path = dict["path"]?.stringValue, dict["@path"] == nil {
      return .object(["@path": .string(path)])
    }
    if let call = dict["call"]?.stringValue, dict["@call"] == nil {
      var args: OrderedDictionary<String, JSONValue> = [:]
      if case .object(let rawArgs)? = dict["args"] {
        for (key, value) in rawArgs {
          args[key] = adaptedForV10(value)
        }
      }
      var adapted: OrderedDictionary<String, JSONValue> = [
        "@call": .string(call),
        "args": .object(args),
      ]
      if let returnType = dict["returnType"] {
        adapted["returnType"] = returnType
      }
      return .object(adapted)
    }
    return part
  }
}
