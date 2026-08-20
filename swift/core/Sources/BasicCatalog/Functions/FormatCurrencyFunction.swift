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

public final class FormatCurrencyFunction: FunctionImplementation, Sendable {
  public let api = FunctionAPI(
    name: "formatCurrency",
    returnType: .string,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": { "type": ["number", "string"] },
            "currency": { "type": "string" },
            "decimals": { "type": "number" },
            "grouping": { "type": "boolean" }
          },
          "required": ["currency", "value"]
        }
        """
    )
  )

  public init() {}

  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let currency = arguments["currency"]?.stringValue else {
      return .string("")
    }

    let numberValue: Double
    if let val = arguments["value"]?.doubleValue {
      numberValue = val
    } else if let valStr = arguments["value"]?.stringValue, let parsed = Double(valStr) {
      numberValue = parsed
    } else {
      return .string("")
    }

    let formatter = NumberFormatter()
    formatter.locale = Locale.current
    formatter.numberStyle = .currency
    formatter.currencyCode = currency

    // Enable grouping unless explicitly set to false
    let grouping = arguments["grouping"]?.boolValue ?? true
    formatter.usesGroupingSeparator = grouping

    // Force decimals if provided
    if let decimalsDouble = arguments["decimals"]?.doubleValue,
      let decimals = Int(exactly: decimalsDouble),
      decimals >= 0
    {
      formatter.minimumFractionDigits = decimals
      formatter.maximumFractionDigits = decimals
    }

    let formattedString = formatter.string(from: NSNumber(value: numberValue)) ?? ""
    return .string(formattedString)
  }
}
