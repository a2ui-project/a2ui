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

public final class LengthFunction: FunctionImplementation, Sendable {
  public let api: FunctionAPI
  private let returnValidationResult: Bool

  public init(returnValidationResult: Bool = false) {
    self.returnValidationResult = returnValidationResult
    self.api = FunctionAPI(
      name: "length",
      returnType: returnValidationResult ? .validationResult : .boolean,
      schema: try! Schema(
        instance: """
          {
            "type": "object",
            "properties": {
              "value": { "type": "string" },
              "min": { "type": "integer", "minimum": 0 },
              "max": { "type": "integer", "minimum": 0 }
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
  }

  public convenience init(protocolVersion: String) {
    self.init(returnValidationResult: protocolVersion == "v1.0" || protocolVersion == "1.0")
  }

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let valueStr = arguments["value"]?.stringValue else {
      return returnValidationResult ? .object(["valid": .boolean(false)]) : .boolean(false)
    }
    let count = valueStr.count

    if let minVal = arguments["min"]?.intValue, count < minVal {
      return returnValidationResult ? .object(["valid": .boolean(false)]) : .boolean(false)
    }

    if let maxVal = arguments["max"]?.intValue, count > maxVal {
      return returnValidationResult ? .object(["valid": .boolean(false)]) : .boolean(false)
    }

    return returnValidationResult ? .object(["valid": .boolean(true)]) : .boolean(true)
  }
}
