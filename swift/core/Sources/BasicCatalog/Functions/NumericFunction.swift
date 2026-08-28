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

public final class NumericFunction: FunctionImplementation, Sendable {
  public let api = FunctionAPI(
    name: "numeric",
    returnType: .boolean,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": { "type": "number" },
            "min": { "type": "number" },
            "max": { "type": "number" }
          },
          "required": ["value"],
          "anyOf": [
            { "required": ["min"] },
            { "required": ["max"] }
          ]
        }
        """
    )
  )

  public init() {}

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    let numberValue: Double
    if let val = arguments["value"]?.doubleValue {
      numberValue = val
    } else if let valStr = arguments["value"]?.stringValue, let parsed = Double(valStr) {
      numberValue = parsed
    } else {
      return .boolean(false)
    }

    if let minVal = arguments["min"]?.doubleValue, numberValue < minVal {
      return .boolean(false)
    }

    if let maxVal = arguments["max"]?.doubleValue, numberValue > maxVal {
      return .boolean(false)
    }

    return .boolean(true)
  }
}
