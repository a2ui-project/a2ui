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

/// Validates and manipulates A2UI v1.0 metadata envelopes (`{ "extensions": { ... } }`).
public enum MetadataValidator {
  /// Validates a raw JSON metadata value and returns the normalized dictionary.
  ///
  /// - Parameters:
  ///   - rawMetadata: Raw `JSONValue` representing a `metadata` field.
  ///   - pathPrefix: Diagnostic JSON path prefix used in validation errors.
  /// - Returns: Validated metadata dictionary, or `nil` when `rawMetadata` is `nil` or `.null`.
  /// - Throws: ``A2UIValidationError`` when `rawMetadata` is not an object, contains unrecognized
  ///   keys outside `extensions`, or contains a non-UAX #31 extension key.
  public static func validate(
    _ rawMetadata: JSONValue?,
    pathPrefix: String = "metadata"
  ) throws -> [String: JSONValue]? {
    guard let rawMetadata else {
      return nil
    }
    guard let metaObj = rawMetadata.objectValue else {
      throw A2UIValidationError(
        "Invalid v1.0 message: metadata must be an object",
        details: [
          A2UIErrorDetail(
            path: pathPrefix,
            code: "type_mismatch",
            message: "Field 'metadata' must be an object"
          )
        ]
      )
    }
    let dict = Dictionary(uniqueKeysWithValues: metaObj.map { ($0.key, $0.value) })
    return try validate(dict, pathPrefix: pathPrefix)
  }

  /// Validates a metadata dictionary and returns a normalized copy (or `nil` if empty).
  ///
  /// - Parameters:
  ///   - metadata: Metadata dictionary (`["extensions": .object(...)]`).
  ///   - pathPrefix: Diagnostic JSON path prefix used in validation errors.
  /// - Returns: Normalized metadata dictionary, or `nil` when `metadata` is `nil` or has an empty
  ///   `extensions` dictionary.
  /// - Throws: ``A2UIValidationError`` when `metadata` contains unrecognized keys or non-UAX #31
  ///   extension keys.
  public static func validate(
    _ metadata: [String: JSONValue]?,
    pathPrefix: String = "metadata"
  ) throws -> [String: JSONValue]? {
    guard let metadata else {
      return nil
    }
    for key in metadata.keys where key != "extensions" {
      throw A2UIValidationError(
        "Invalid v1.0 message: unrecognized property '\(key)' in metadata",
        details: [
          A2UIErrorDetail(
            path: "\(pathPrefix).\(key)",
            code: "invalid_value",
            message: "Unrecognized property '\(key)' in metadata"
          )
        ]
      )
    }
    guard let rawExtensions = metadata["extensions"] else {
      return nil
    }
    guard let extObj = rawExtensions.objectValue else {
      throw A2UIValidationError(
        "Invalid v1.0 message: metadata.extensions must be an object",
        details: [
          A2UIErrorDetail(
            path: "\(pathPrefix).extensions",
            code: "type_mismatch",
            message: "Field 'extensions' must be an object"
          )
        ]
      )
    }
    for extKey in extObj.keys where !UnicodeIdentifierValidator.isValidIdentifier(extKey) {
      let msg = "Invalid extension key \"\(extKey)\": Keys MUST be Unicode identifiers (UAX #31)."
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "\(pathPrefix).extensions.\(extKey)",
            code: "invalid_identifier",
            message: msg
          )
        ]
      )
    }
    if extObj.isEmpty {
      return nil
    }
    return ["extensions": .object(extObj)]
  }

  /// Extracts the `extensions` dictionary from a metadata dictionary, or `nil` if absent.
  public static func extensions(from metadata: [String: JSONValue]?) -> [String: JSONValue]? {
    metadata?["extensions"]?.dictionaryValue
  }

  /// Extracts the ordered `extensions` object from a metadata dictionary, or `nil` if absent.
  public static func extensionsObject(
    from metadata: [String: JSONValue]?
  ) -> OrderedDictionary<String, JSONValue>? {
    metadata?["extensions"]?.objectValue
  }

  /// Validates and merges payload `base` metadata with call-site `override` metadata.
  /// Call-site extension keys take precedence over payload extension keys.
  public static func mergeActionMetadata(
    base: [String: JSONValue]?,
    override: [String: JSONValue]?
  ) throws -> [String: JSONValue]? {
    let validatedBase = try validate(base, pathPrefix: "action.metadata")
    let validatedOverride = try validate(override, pathPrefix: "action.metadata")
    guard let validatedOverride else { return validatedBase }
    guard let validatedBase else { return validatedOverride }
    var mergedExtensions = extensionsObject(from: validatedBase) ?? [:]
    if let overrideExtensions = extensionsObject(from: validatedOverride) {
      for (key, val) in overrideExtensions {
        mergedExtensions[key] = val
      }
    }
    if mergedExtensions.isEmpty {
      return nil
    }
    return ["extensions": .object(mergedExtensions)]
  }

  /// Returns an updated metadata dictionary with `key` set to `value` inside `extensions`.
  public static func settingExtension(
    _ key: String,
    value: JSONValue,
    in metadata: [String: JSONValue]?,
    pathPrefix: String = "metadata"
  ) throws -> [String: JSONValue] {
    guard UnicodeIdentifierValidator.isValidIdentifier(key) else {
      let msg = "Invalid extension key \"\(key)\": Keys MUST be Unicode identifiers (UAX #31)."
      throw A2UIValidationError(
        msg,
        details: [
          A2UIErrorDetail(
            path: "\(pathPrefix).extensions.\(key)",
            code: "invalid_identifier",
            message: msg
          )
        ]
      )
    }
    var extObj = extensionsObject(from: metadata) ?? [:]
    extObj[key] = value
    return ["extensions": .object(extObj)]
  }

  /// Removes `key` from `metadata["extensions"]`, collapsing empty extensions to `nil`.
  public static func removingExtension(
    _ key: String,
    from metadata: [String: JSONValue]?
  ) -> [String: JSONValue]? {
    guard var extObj = extensionsObject(from: metadata), extObj[key] != nil else {
      return metadata
    }
    extObj.removeValue(forKey: key)
    if extObj.isEmpty {
      return nil
    }
    return ["extensions": .object(extObj)]
  }

  /// Compares two `JSONValue` trees for structural equality without requiring identical object
  /// key insertion order.
  public static func jsonEquals(_ lhs: JSONValue, _ rhs: JSONValue) -> Bool {
    switch (lhs, rhs) {
    case (.array(let leftItems), .array(let rightItems)):
      guard leftItems.count == rightItems.count else { return false }
      return zip(leftItems, rightItems).allSatisfy { jsonEquals($0, $1) }
    case (.object(let leftObj), .object(let rightObj)):
      guard leftObj.count == rightObj.count else { return false }
      for (key, leftVal) in leftObj {
        guard let rightVal = rightObj[key], jsonEquals(leftVal, rightVal) else { return false }
      }
      return true
    default:
      return lhs == rhs
    }
  }

  /// Compares two optional metadata dictionaries for structural JSON equality independent of
  /// `OrderedDictionary` key order.
  public static func areEqual(
    _ lhs: [String: JSONValue]?,
    _ rhs: [String: JSONValue]?
  ) -> Bool {
    if lhs == nil && rhs == nil {
      return true
    }
    guard let lhs, let rhs, lhs.count == rhs.count else {
      return false
    }
    for (key, leftVal) in lhs {
      guard let rightVal = rhs[key], jsonEquals(leftVal, rightVal) else {
        return false
      }
    }
    return true
  }
}
