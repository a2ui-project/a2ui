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

public final class EmailFunction: FunctionImplementation, Sendable {
  public let api: FunctionAPI
  private let returnValidationResult: Bool

  public init(returnValidationResult: Bool = false) {
    self.returnValidationResult = returnValidationResult
    self.api = FunctionAPI(
      name: "email",
      returnType: returnValidationResult ? .validationResult : .boolean,
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
  }

  public convenience init(protocolVersion: String) {
    self.init(returnValidationResult: protocolVersion == "v1.0" || protocolVersion == "1.0")
  }

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let value = arguments["value"]?.stringValue else {
      if returnValidationResult {
        return .object([
          "valid": .boolean(false),
          "code": .string("INVALID_EMAIL"),
          "message": .string("Please enter a valid email address (e.g. user@example.com)."),
          "severity": .string("error"),
        ])
      }
      return .boolean(false)
    }

    let emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    let isMatch = (try? emailRegex.wholeMatch(in: value)) != nil
    if returnValidationResult {
      if isMatch {
        return .object(["valid": .boolean(true)])
      } else {
        return .object([
          "valid": .boolean(false),
          "code": .string("INVALID_EMAIL"),
          "message": .string("Please enter a valid email address (e.g. user@example.com)."),
          "severity": .string("error"),
        ])
      }
    }
    return .boolean(isMatch)
  }
}
