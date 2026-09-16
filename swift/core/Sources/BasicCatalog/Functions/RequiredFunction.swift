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

public final class RequiredFunction: FunctionImplementation, Sendable {
  public let api = FunctionAPI(
    name: "required",
    returnType: .boolean,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": {}
          },
          "required": ["value"]
        }
        """
    )
  )

  public init() {}

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let value = arguments["value"] else { return .boolean(false) }
    switch value {
    case .null:
      return .boolean(false)
    case .string(let str):
      return .boolean(!str.isEmpty)
    case .array(let arr):
      return .boolean(!arr.isEmpty)
    case .object(let dict):
      return .boolean(!dict.isEmpty)
    default:
      return .boolean(true)
    }
  }
}
