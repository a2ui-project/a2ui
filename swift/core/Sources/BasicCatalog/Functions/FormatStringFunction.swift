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
      let resolved = context.resolveDynamicValue(part)

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
      default:
        // Complex objects or arrays are usually not meaningfully stringified in basic interpolation,
        // but we can skip or serialize. Let's just skip them or use their description.
        continue
      }
    }

    return .string(result)
  }
}
