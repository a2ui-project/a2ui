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
/// A2UI uses Foundation by default. Host applications can implement this protocol to bridge
/// another internationalization engine into the evaluation pipeline.
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
  private static let categoryTemplate = Bundle.module.localizedString(
    forKey: "category", value: nil, table: "PluralCategories")
  private let locale: Locale

  /// Initializes a new pluralize function, optionally accepting a custom resolver.
  ///
  /// - Parameters:
  ///   - resolver: An optional weak reference to a custom `PluralResolver`.
  ///   - locale: The locale used by the default Foundation implementation when `resolver` is `nil`.
  public init(resolver: (any PluralResolver)? = nil, locale: Locale = .current) {
    self.resolver = resolver
    self.locale = locale
  }

  /// Evaluates the pluralize function.
  ///
  /// This implementation checks the numeric `value` argument against the configured
  /// `PluralResolver`, or Foundation if no override is present. It then returns the string argument
  /// corresponding to that category (e.g. `one`, `few`, `other`).
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
      ?? defaultCategory(for: numberValue)

    return .string(arguments[category.rawValue]?.stringValue ?? other)
  }

  private func defaultCategory(for value: Double) -> PluralCategory {
    guard value.isFinite else { return .other }
    // A single unlocalized resource returns category names using the explicitly supplied locale.
    // Rules and numeric boundaries follow the OS, not a pinned ICU or JavaScript implementation.
    let category = String(
      format: Self.categoryTemplate, locale: locale, arguments: [abs(value)])
    return PluralCategory(rawValue: category) ?? .other
  }
}
