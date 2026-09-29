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

import OrderedCollections
import OrderedJSON

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
      return Int(exactly: value)
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
    case .object(let value):
      return Dictionary(uniqueKeysWithValues: value.map { ($0.key, $0.value) })
    default: return nil
    }
  }

  // MARK: - Path Subscripting

  /// Maximum supported array index during path traversal and auto-vivification.
  public static let maxArrayIndex = 10_000

  private static let forbiddenPathKeys: Set<String> = [
    "__proto__", "constructor", "prototype",
  ]

  /// Validates and parses an RFC 6901 array index (rejecting leading zeros and negative values).
  static func isValidArrayIndex(_ key: String) -> Int? {
    guard !key.isEmpty else { return nil }
    if key.count > 1 && key.hasPrefix("0") { return nil }
    guard key.allSatisfy({ $0.isASCII && $0.isNumber }),
      let index = Int(key), index >= 0
    else { return nil }
    return index
  }

  /// Thread-safe getter and setter for deep path-based subscripting.
  ///
  /// Path components are separated by `/` (e.g., `"/user/name"`).
  /// Array indices are numeric strings (e.g., `"/items/0"`).
  public subscript(path: String) -> JSONValue? {
    get {
      guard let components = try? Self.parsePathThrowing(path) else { return nil }
      if components.isEmpty { return self }
      var currentValue = self
      for component in components {
        switch currentValue {
        case .object(let dictionary):
          guard let value = dictionary[component] else { return nil }
          currentValue = value
        case .array(let array):
          guard let index = Self.isValidArrayIndex(component),
            index < array.count
          else { return nil }
          currentValue = array[index]
        default:
          return nil
        }
      }
      return currentValue
    }
    set {
      guard let components = try? Self.parsePathThrowing(path) else { return }
      guard !components.isEmpty else {
        self = newValue ?? .object([:])
        return
      }
      if newValue == nil && !Self.hasPath(node: self, components: components) {
        return
      }
      if let updated = try? Self.updateThrowing(
        node: self,
        components: components[...],
        newValue: newValue,
        fullPath: path
      ) {
        self = updated
      }
    }
  }

  // MARK: - Path Utilities

  /// Parses a JSON Pointer-style path into components, collapsing empty segments.
  static func parsePath(_ path: String) -> [String] {
    (try? parsePathThrowing(path)) ?? []
  }

  /// Parses a JSON Pointer-style path into components and validates against forbidden segments.
  static func parsePathThrowing(_ path: String) throws -> [String] {
    guard !path.isEmpty && path != "/" else { return [] }
    let parsed = path.split(separator: "/", omittingEmptySubsequences: true).map {
      String($0)
        .replacingOccurrences(of: "~1", with: "/")
        .replacingOccurrences(of: "~0", with: "~")
    }
    for segment in parsed where forbiddenPathKeys.contains(segment) {
      throw A2UIDataError("Forbidden path segment '\(segment)' in path '\(path)'.")
    }
    return parsed
  }

  /// Checks whether a parsed path physically exists in `node`.
  static func hasPath(node: JSONValue, components: [String]) -> Bool {
    if components.isEmpty { return true }
    var currentValue = node
    for component in components {
      switch currentValue {
      case .object(let dictionary):
        guard let value = dictionary[component] else { return false }
        currentValue = value
      case .array(let array):
        guard let index = isValidArrayIndex(component),
          index < array.count
        else { return false }
        currentValue = array[index]
      default:
        return false
      }
    }
    return true
  }

  /// Recursively updates a node at the given path components, throwing `A2UIDataError` on invalid mutations.
  static func updateThrowing(
    node: JSONValue?,
    components: ArraySlice<String>,
    newValue: JSONValue?,
    fullPath: String
  ) throws -> JSONValue? {
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
        if let nextNode, nextNode != .null,
          nextNode.objectValue == nil && nextNode.arrayValue == nil
        {
          throw A2UIDataError(
            "Cannot set path '\(fullPath)': segment '\(key)' is a primitive value."
          )
        }
        dict[key] = try updateThrowing(
          node: nextNode,
          components: remainingComponents,
          newValue: newValue,
          fullPath: fullPath
        )
      }
      return .object(dict)

    case .some(.array(var array)):
      guard let index = isValidArrayIndex(key) else {
        throw A2UIDataError(
          "Cannot use non-numeric segment '\(key)' on an array in path '\(fullPath)'."
        )
      }
      if index > maxArrayIndex {
        throw A2UIDataError(
          "Cannot set path '\(fullPath)': array index '\(key)' exceeds maximum supported index (\(maxArrayIndex))."
        )
      }
      if isLastComponent {
        if let newValue {
          while array.count <= index {
            array.append(.null)
          }
          array[index] = newValue
        } else if index < array.count {
          array[index] = .null
        }
      } else {
        let nextNode: JSONValue? = index < array.count ? array[index] : nil
        if let nextNode, nextNode != .null,
          nextNode.objectValue == nil && nextNode.arrayValue == nil
        {
          throw A2UIDataError(
            "Cannot set path '\(fullPath)': segment '\(key)' is a primitive value."
          )
        }
        let updated = try updateThrowing(
          node: nextNode,
          components: remainingComponents,
          newValue: newValue,
          fullPath: fullPath
        )
        if let updated {
          while array.count <= index {
            array.append(.null)
          }
          array[index] = updated
        } else if index < array.count {
          array[index] = .null
        }
      }
      return .array(array)

    default:
      if let node, node != .null {
        throw A2UIDataError(
          "Cannot set path '\(fullPath)': the data model root or intermediate node is a primitive value."
        )
      }
      if newValue == nil { return node }
      if let index = isValidArrayIndex(key) {
        if index > maxArrayIndex {
          throw A2UIDataError(
            "Cannot set path '\(fullPath)': array index '\(key)' exceeds maximum supported index (\(maxArrayIndex))."
          )
        }
        var array: [JSONValue] = []
        if isLastComponent {
          if let newValue {
            while array.count <= index {
              array.append(.null)
            }
            array[index] = newValue
          }
        } else if let updated = try updateThrowing(
          node: nil,
          components: remainingComponents,
          newValue: newValue,
          fullPath: fullPath
        ) {
          while array.count <= index {
            array.append(.null)
          }
          array[index] = updated
        }
        return .array(array)
      } else {
        var dict: OrderedDictionary<String, JSONValue> = [:]
        if isLastComponent {
          if let newValue { dict[key] = newValue }
        } else {
          dict[key] = try updateThrowing(
            node: nil,
            components: remainingComponents,
            newValue: newValue,
            fullPath: fullPath
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
    if path.isEmpty || path == "." {
      return trimmedBase.isEmpty ? "/" : trimmedBase
    }
    if trimmedBase.isEmpty { return "/\(path)" }
    return "\(trimmedBase)/\(path)"
  }
}
