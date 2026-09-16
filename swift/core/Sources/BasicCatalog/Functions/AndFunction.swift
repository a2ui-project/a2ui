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

public final class AndFunction: FunctionImplementation, Sendable {
  public let api = FunctionAPI(
    name: "and",
    returnType: .boolean,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "values": {
              "type": "array",
              "items": { "type": "boolean" },
              "minItems": 2
            }
          },
          "required": ["values"]
        }
        """
    )
  )

  public init() {}

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let values = arguments["values"]?.arrayValue else { return .boolean(false) }
    for v in values {
      if v.boolValue != true {
        return .boolean(false)
      }
    }
    return .boolean(true)
  }
}
