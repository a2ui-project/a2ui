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

public final class FormatDateFunction: FunctionImplementation, Sendable {
  public let api = FunctionAPI(
    name: "formatDate",
    returnType: .string,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": {},
            "format": { "type": "string" }
          },
          "required": ["format", "value"]
        }
        """
    )
  )

  public init() {}

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let format = arguments["format"]?.stringValue else {
      return .string("")
    }

    let date: Date
    if let valueDouble = arguments["value"]?.doubleValue {
      // Heuristic: If it's a huge number, it's likely milliseconds since 1970.
      if valueDouble > 10_000_000_000 {
        date = Date(timeIntervalSince1970: valueDouble / 1000.0)
      } else {
        date = Date(timeIntervalSince1970: valueDouble)
      }
    } else if let valueString = arguments["value"]?.stringValue {
      if let parsedNumber = Double(valueString) {
        if parsedNumber > 10_000_000_000 {
          date = Date(timeIntervalSince1970: parsedNumber / 1000.0)
        } else {
          date = Date(timeIntervalSince1970: parsedNumber)
        }
      } else if let parsedDate = ISO8601DateFormatter().date(from: valueString) {
        date = parsedDate
      } else {
        // Simple fallback for standard yyyy-MM-dd if not full ISO8601
        let fallbackFormatter = DateFormatter()
        fallbackFormatter.locale = Locale(identifier: "en_US_POSIX")
        fallbackFormatter.dateFormat = "yyyy-MM-dd"

        if let fallbackDate = fallbackFormatter.date(from: valueString) {
          date = fallbackDate
        } else {
          return .string("")
        }
      }
    } else {
      return .string("")
    }

    let formatter = DateFormatter()
    formatter.dateFormat = format
    formatter.locale = Locale.current

    return .string(formatter.string(from: date))
  }
}
