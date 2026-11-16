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
import Foundation
import JSONSchema

public final class RegexFunction: FunctionImplementation, Sendable {
  public let api: FunctionAPI
  private let returnValidationResult: Bool

  public init(returnValidationResult: Bool = false) {
    self.returnValidationResult = returnValidationResult
    self.api = FunctionAPI(
      name: "regex",
      returnType: returnValidationResult ? .validationResult : .boolean,
      schema: try! Schema(
        instance: """
          {
            "type": "object",
            "properties": {
              "value": { "type": "string" },
              "pattern": { "type": "string" }
            },
            "required": ["value", "pattern"]
          }
          """
      )
    )
  }

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let value = arguments["value"]?.stringValue,
      let pattern = arguments["pattern"]?.stringValue
    else {
      return returnValidationResult ? .object(["valid": .boolean(false)]) : .boolean(false)
    }

    let regex = try RegexSubset.compileGuarded(pattern)
    guard value.unicodeScalars.count <= RegexSubset.maxValueCodePoints else {
      return returnValidationResult ? .object(["valid": .boolean(false)]) : .boolean(false)
    }
    let nsRange = NSRange(value.startIndex..<value.endIndex, in: value)
    let isMatch = regex.firstMatch(in: value, options: [], range: nsRange) != nil

    if returnValidationResult {
      return .object(["valid": .boolean(isMatch)])
    }
    return .boolean(isMatch)
  }
}
