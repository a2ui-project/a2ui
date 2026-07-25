// Copyright 2026 Google LLC
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

import OrderedJSON
import OrderedCollections

extension JSONValue {
  /// Returns the underlying string value if this is a `.string` case.
  public var stringValue: String? {
    switch self {
    case .string(let value): return value
    default: return nil
    }
  }

  /// Returns the underlying double value if this is a `.number` or
  /// `.integer` case.
  public var doubleValue: Double? {
    switch self {
    case .number(let value): return value
    case .integer(let value): return Double(value)
    default: return nil
    }
  }

  /// Returns the underlying integer value if this is an `.integer` or
  /// a whole-number `.number` case.
  public var intValue: Int? {
    switch self {
    case .integer(let value): return value
    case .number(let value):
      if value >= Double(Int.min) && value <= Double(Int.max) && value == value.rounded() {
        return Int(value)
      }
      return nil
    default: return nil
    }
  }

  /// Returns the underlying boolean value if this is a `.boolean` case.
  public var boolValue: Bool? {
    switch self {
    case .boolean(let value): return value
    default: return nil
    }
  }

  /// Returns the underlying array of JSONValues if this is an `.array`.
  public var arrayValue: [JSONValue]? {
    switch self {
    case .array(let value): return value
    default: return nil
    }
  }

  /// Returns the underlying object as an `OrderedDictionary` if this is
  /// an `.object` case.
  public var objectValue: OrderedDictionary<String, JSONValue>? {
    switch self {
    case .object(let value): return value
    default: return nil
    }
  }

  /// Returns the underlying object as a `[String: JSONValue]` dictionary
  /// if this is an `.object` case.
  public var dictionaryValue: [String: JSONValue]? {
    switch self {
    case .object(let value): return Dictionary(uniqueKeysWithValues: value.map { ($0.key, $0.value) })
    default: return nil
    }
  }

  // MARK: - Path Subscripting

  /// Thread-safe getter and setter for deep path-based subscripting.
  ///
  /// Path components are separated by `/` (e.g., `"/user/name"`).
  /// Array indices are numeric strings (e.g., `"/items/0"`).
  public subscript(path: String) -> JSONValue? {
    get {
      let components = Self.parsePath(path)
      if components.isEmpty { return self }
      var currentValue = self
      for component in components {
        switch currentValue {
        case .object(let dictionary):
          guard let value = dictionary[component] else { return nil }
          currentValue = value
        case .array(let array):
          guard let index = Int(component),
            index >= 0 && index < array.count
          else { return nil }
          currentValue = array[index]
        default:
          return nil
        }
      }
      return currentValue
    }
    set {
      let components = Self.parsePath(path)
      guard !components.isEmpty else {
        if let newValue {
          self = newValue
        }
        return
      }
      if let updated = Self.update(
        node: self,
        components: components[...],
        newValue: newValue
      ) {
        self = updated
      } else {
        self = .null
      }
    }
  }

  // MARK: - Path Utilities

  /// Parses a JSON Pointer-style path into components.
  static func parsePath(_ path: String) -> [String] {
    guard !path.isEmpty else { return [] }
    let adjustedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
    return adjustedPath.split(separator: "/", omittingEmptySubsequences: false).map {
      String($0)
        .replacingOccurrences(of: "~1", with: "/")
        .replacingOccurrences(of: "~0", with: "~")
    }
  }

  /// Recursively updates a node at the given path components.
  static func update(
    node: JSONValue?,
    components: ArraySlice<String>,
    newValue: JSONValue?
  ) -> JSONValue? {
    guard let key = components.first else { return newValue }
    let isLastComponent = components.count == 1
    let remainingComponents = components.dropFirst()

    switch node {
    case .some(.object(var dict)):
      if isLastComponent {
        if let newValue {
          dict[key] = newValue
        } else {
          dict.removeValue(forKey: key)
        }
      } else {
        let nextNode = dict[key]
        dict[key] = update(
          node: nextNode,
          components: remainingComponents,
          newValue: newValue
        )
      }
      return .object(dict)

    case .some(.array(var array)):
      if let index = Int(key), index >= 0 {
        if index <= array.count {
          if isLastComponent {
            if let newValue {
              if index == array.count {
                array.append(newValue)
              } else {
                array[index] = newValue
              }
            } else if index < array.count {
              // Setting an array index to nil preserves the array
              // length (sparse array), matching the blueprint's
              // JSON Pointer Implementation Rules.
              array[index] = .null
            }
          } else {
            let nextNode = index < array.count ? array[index] : nil
            let updated = update(
              node: nextNode,
              components: remainingComponents,
              newValue: newValue
            )
            if let updated {
              if index == array.count {
                array.append(updated)
              } else {
                array[index] = updated
              }
            } else if index < array.count {
              // Sparse array: preserve length, set to null.
              array[index] = .null
            }
          }
        }
        return .array(array)
      } else {
        if newValue == nil && isLastComponent { return node }
        var dict: OrderedDictionary<String, JSONValue> = [:]
        if isLastComponent {
          if let newValue { dict[key] = newValue }
        } else {
          dict[key] = update(
            node: nil,
            components: remainingComponents,
            newValue: newValue
          )
        }
        return .object(dict)
      }

    default:
      if newValue == nil { return node }
      if let index = Int(key), index >= 0 {
        // Auto-vivify an array for any numeric key, matching
        // web_core's isNumeric() auto-vivification rule.
        var array: [JSONValue] = []
        if isLastComponent {
          if let newValue { array.append(newValue) }
        } else if let updated = update(
          node: nil,
          components: remainingComponents,
          newValue: newValue
        ) {
          array.append(updated)
        }
        return .array(array)
      } else {
        var dict: OrderedDictionary<String, JSONValue> = [:]
        if isLastComponent {
          if let newValue { dict[key] = newValue }
        } else {
          dict[key] = update(
            node: nil,
            components: remainingComponents,
            newValue: newValue
          )
        }
        return .object(dict)
      }
    }
  }

  /// Resolves a relative or absolute path against a base path context.
  ///
  /// - Parameters:
  ///   - path: The path to resolve. If it starts with `/`, it is absolute.
  ///   - basePath: The base path to resolve against (if `path` is relative).
  /// - Returns: The resolved absolute path.
  public static func absolutePath(
    for path: String,
    in basePath: String?
  ) -> String {
    if path.hasPrefix("/") { return path }
    let base = basePath ?? ""
    let trimmedBase = base.hasSuffix("/") ? String(base.dropLast()) : base
    if trimmedBase.isEmpty { return "/\(path)" }
    return "\(trimmedBase)/\(path)"
  }
}
