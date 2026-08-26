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

/// Defines the standard Common Locale Data Repository (CLDR) plural categories.
public enum PluralCategory: String, Sendable {
  case zero, one, two, few, many, other
}

/// A protocol for overriding CLDR plural categorization logic.
///
/// A2UI uses ``CLDRPluralResolver`` by default. Host applications can implement this protocol to
/// bridge another internationalization engine into the evaluation pipeline.
public protocol PluralResolver: AnyObject, Sendable {
  /// Determines the CLDR plural category for the given numeric value.
  func pluralCategory(for value: Double) -> PluralCategory
}

public final class PluralizeFunction: FunctionImplementation, @unchecked Sendable {
  public let api = FunctionAPI(
    name: "pluralize",
    returnType: .string,
    schema: try! Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": { "type": ["number", "string"] },
            "zero": { "type": "string" },
            "one": { "type": "string" },
            "two": { "type": "string" },
            "few": { "type": "string" },
            "many": { "type": "string" },
            "other": { "type": "string" }
          },
          "required": ["value", "other"]
        }
        """
    )
  )

  public weak var resolver: (any PluralResolver)?
  private let defaultResolver: CLDRPluralResolver

  /// Initializes a new pluralize function, optionally accepting a custom resolver.
  ///
  /// - Parameters:
  ///   - resolver: An optional weak reference to a custom `PluralResolver`.
  ///   - locale: The locale used by the built-in CLDR resolver when `resolver` is `nil`.
  public init(resolver: (any PluralResolver)? = nil, locale: Locale = .current) {
    self.resolver = resolver
    self.defaultResolver = CLDRPluralResolver(locale: locale)
  }

  /// Evaluates the pluralize function.
  ///
  /// This implementation checks the numeric `value` argument against the configured
  /// `PluralResolver`, or the built-in CLDR resolver if no override is present. It then returns the
  /// string argument corresponding to that category (e.g. `one`, `few`, `other`).
  ///
  /// - Parameters:
  ///   - arguments: The dictionary of arguments provided to the function.
  ///   - context: The current data context.
  /// - Returns: The resolved string, or `other` when the selected category is not provided.
  public func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let other = arguments["other"]?.stringValue else {
      return .string("")
    }

    let numberValue: Double
    if let val = arguments["value"]?.doubleValue {
      numberValue = val
    } else if let valStr = arguments["value"]?.stringValue, let parsed = Double(valStr) {
      numberValue = parsed
    } else {
      return .string(other)
    }

    let category =
      resolver?.pluralCategory(for: numberValue)
      ?? defaultResolver.pluralCategory(for: numberValue)

    let match: String
    switch category {
    case .zero: match = arguments["zero"]?.stringValue ?? other
    case .one: match = arguments["one"]?.stringValue ?? other
    case .two: match = arguments["two"]?.stringValue ?? other
    case .few: match = arguments["few"]?.stringValue ?? other
    case .many: match = arguments["many"]?.stringValue ?? other
    case .other: match = other
    }

    return .string(match)
  }
}
