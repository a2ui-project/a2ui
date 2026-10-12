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

import Foundation
import OrderedCollections
import OrderedJSON

/// Shared base class providing payload unwrapping, action key validation,
/// and version header verification for protocol version adapters.
open class BaseVersionAdapter: VersionAdapter, @unchecked Sendable {
  private static let validPathRegex = try! NSRegularExpression(
    pattern: "^(?:(?:/(?:[^~/]|~[01])*)*|(?:[^~/]|~[01])+(?:/(?:[^~/]|~[01])*)*)$"
  )
  private static let maxFunctionDepth = 5
  private static let maxGlobalDepth = 50

  public let version: A2UIProtocolVersion

  public init(version: A2UIProtocolVersion) {
    self.version = version
  }

  open var validActions: Set<String> {
    []
  }

  open var compatibleCatalogVersions: Set<String> {
    let canonical = canonicalizeVersionString(version.rawValue)
    return canonical.isEmpty ? [] : [canonical]
  }

  open func isCatalogCompatible(_ catalogVersion: String?) -> Bool {
    isCatalogVersionCompatible(
      catalogVersion: catalogVersion,
      expectedVersion: version.rawValue
    )
  }

  open func extractOperations(from payload: JSONValue) throws -> [InternalOperation] {
    switch payload {
    case .null:
      return []
    case .array(let items):
      if items.isEmpty { return [] }
      for (index, item) in items.enumerated() {
        guard let dict = item.objectValue else {
          throw A2UIValidationError(
            "Message at index \(index) must be an object",
            details: [
              A2UIErrorDetail(
                path: "messages.\(index)",
                code: "type_mismatch",
                message: "Message must be an object"
              )
            ]
          )
        }
        do {
          _ = try extractSingleAction(from: dict)
        } catch let error as A2UIValidationError {
          throw rewriteMessageIndex(in: error, to: index)
        }
      }
      return try items.enumerated().flatMap { index, item -> [InternalOperation] in
        do {
          return try extractOperations(from: item)
        } catch let error as A2UIValidationError {
          throw rewriteMessageIndex(in: error, to: index)
        }
      }
    case .object(let dict):
      if let messages = dict["messages"]?.arrayValue {
        return try extractOperations(from: .array(messages))
      }

      let action = try extractSingleAction(from: dict)
      guard let actionObj = dict[action]?.objectValue else {
        throw A2UIValidationError(
          "Payload for action '\(action)' must be an object",
          details: [
            A2UIErrorDetail(
              path: "messages.0.\(action)",
              code: "type_mismatch",
              message: "Action payload must be an object"
            )
          ]
        )
      }

      try validateVersionHeader(in: dict)
      try validatePathsAndRecursion(.object(dict))
      return try extractOperationsFromObject(dict, action: action, actionObject: actionObj)
    default:
      return []
    }
  }

  open func adaptMessage(_ message: AgentToRendererMessage) throws -> [InternalOperation] {
    let encoder = JSONEncoder()
    encoder.userInfo[.a2uiProtocolVersion] = message.version
    let data = try encoder.encode(message)
    let jsonValue = try JSONValue.parse(data)
    let ops = try extractOperations(from: jsonValue)
    if case .updateDataModel(let msg) = message, msg.value == nil {
      return ops.map { op in
        if case .updateDataModel(let updateOp) = op {
          return .updateDataModel(
            InternalUpdateDataModelOp(
              surfaceID: updateOp.surfaceID,
              path: updateOp.path,
              value: nil
            )
          )
        }
        return op
      }
    }
    return ops
  }

  open func extractOperationsFromObject(
    _ message: OrderedDictionary<String, JSONValue>,
    action: String,
    actionObject: OrderedDictionary<String, JSONValue>
  ) throws -> [InternalOperation] {
    fatalError("Subclasses must override extractOperationsFromObject(_:action:actionObject:)")
  }

  // MARK: - Validation Helpers

  private func rewriteMessageIndex(
    in error: A2UIValidationError,
    to index: Int
  ) -> A2UIValidationError {
    guard index != 0, !error.details.isEmpty else { return error }
    let rewrittenDetails = error.details.map { detail -> A2UIErrorDetail in
      if detail.path == "messages.0" {
        return A2UIErrorDetail(
          path: "messages.\(index)",
          code: detail.code,
          message: detail.message
        )
      }
      if detail.path.hasPrefix("messages.0.") {
        let suffix = detail.path.dropFirst("messages.0.".count)
        return A2UIErrorDetail(
          path: "messages.\(index).\(suffix)",
          code: detail.code,
          message: detail.message
        )
      }
      return detail
    }
    return A2UIValidationError(error.message, details: rewrittenDetails)
  }

  internal func validateAllowedKeys(
    in actionObject: OrderedDictionary<String, JSONValue>,
    action: String,
    allowed: Set<String>
  ) throws {
    for key in actionObject.keys where !allowed.contains(key) {
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: unrecognized property '\(key)' in \(action)",
        details: [
          A2UIErrorDetail(
            path: "messages.0.\(action).\(key)",
            code: "invalid_value",
            message: "Unrecognized property '\(key)' in \(action)"
          )
        ]
      )
    }
  }

  internal func extractSingleAction(
    from dict: OrderedDictionary<String, JSONValue>
  ) throws -> String {
    for actionKey in validActions {
      if let actionObj = dict[actionKey]?.objectValue,
        let rawSurfaceID = actionObj["surfaceId"]
      {
        guard rawSurfaceID.stringValue != nil else {
          throw A2UIValidationError(
            "surfaceId must be a string",
            details: [
              A2UIErrorDetail(
                path: "messages.0.\(actionKey).surfaceId",
                code: "type_mismatch",
                message: "Field 'surfaceId' must be a string"
              )
            ]
          )
        }
      }
    }

    let nonVersionKeys = dict.keys.filter { $0 != "version" }
    if nonVersionKeys.count > 1 {
      let presentNativeKeys = validActions.filter { dict[$0] != nil }.sorted()
      let joined = (presentNativeKeys.count > 1 ? presentNativeKeys : Array(nonVersionKeys))
        .joined(separator: ", ")
      throw A2UIValidationError(
        "Message contains multiple conflicting update actions: \(joined).",
        details: [
          A2UIErrorDetail(
            path: "messages.0",
            code: "invalid_value",
            message: "Message must contain exactly one action key"
          )
        ]
      )
    }

    let presentNativeKeys = validActions.filter { dict[$0] != nil }.sorted()
    if presentNativeKeys.isEmpty {
      let allKnown = VersionAdapterFactory.shared.allKnownActions()
      let otherAction = dict.keys.first {
        allKnown.contains($0) && !validActions.contains($0)
      }
      let sortedAllowed = validActions.sorted().joined(separator: ", ")
      if let otherAction {
        throw A2UIValidationError(
          "Invalid \(version.rawValue) message: action '\(otherAction)' is not supported in "
            + "protocol version \(version.rawValue). Allowed actions: \(sortedAllowed).",
          details: [
            A2UIErrorDetail(
              path: "messages.0",
              code: "invalid_value",
              message:
                "Action '\(otherAction)' is not supported in protocol version \(version.rawValue)"
            )
          ]
        )
      }
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: message must contain exactly one update action: "
          + "\(sortedAllowed).",
        details: [
          A2UIErrorDetail(
            path: "messages.0",
            code: nonVersionKeys.isEmpty ? "missing_field" : "invalid_value",
            message: nonVersionKeys.isEmpty
              ? "Message must contain an action key"
              : "Unrecognized message action '\(nonVersionKeys[0])'"
          )
        ]
      )
    }

    return presentNativeKeys[0]
  }

  internal func validateVersionHeader(
    in dict: OrderedDictionary<String, JSONValue>
  ) throws {
    guard let rawVersion = dict["version"] else {
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: version: 'version' is a required property",
        details: [
          A2UIErrorDetail(
            path: "messages.0.version",
            code: "missing_field",
            message: "'version' is a required property"
          )
        ]
      )
    }
    guard let versionStr = rawVersion.stringValue else {
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: version: 'version' must be a string",
        details: [
          A2UIErrorDetail(
            path: "messages.0.version",
            code: "type_mismatch",
            message: "Version must be a string"
          )
        ]
      )
    }
    let canonical = canonicalizeVersionString(versionStr)
    guard compatibleCatalogVersions.contains(canonical) else {
      let allowed = compatibleCatalogVersions.sorted().map { "v\($0)" }.joined(separator: ", ")
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: version '\(versionStr)' is not compatible with "
          + "expected version (\(allowed)).",
        details: [
          A2UIErrorDetail(
            path: "messages.0.version",
            code: "invalid_value",
            message: "Unsupported protocol version '\(versionStr)'"
          )
        ]
      )
    }
  }

  internal func requireSurfaceID(
    in actionObject: OrderedDictionary<String, JSONValue>,
    action: String
  ) throws -> String {
    guard let rawID = actionObject["surfaceId"] else {
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: \(action).surfaceId is required",
        details: [
          A2UIErrorDetail(
            path: "messages.0.\(action).surfaceId",
            code: "missing_field",
            message: "Field 'surfaceId' is required"
          )
        ]
      )
    }
    guard let surfaceID = rawID.stringValue, !surfaceID.isEmpty else {
      throw A2UIValidationError(
        "surfaceId must be a non-empty string",
        details: [
          A2UIErrorDetail(
            path: "messages.0.\(action).surfaceId",
            code: rawID.stringValue == nil ? "type_mismatch" : "invalid_value",
            message: "surfaceId must be a non-empty string"
          )
        ]
      )
    }
    return surfaceID
  }

  internal func parseComponentsArray(
    _ value: JSONValue?,
    action: String
  ) throws -> [[String: JSONValue]]? {
    guard let value else { return nil }
    guard let arr = value.arrayValue else {
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: \(action).components must be an array",
        details: [
          A2UIErrorDetail(
            path: "messages.0.\(action).components",
            code: "type_mismatch",
            message: "Components must be an array"
          )
        ]
      )
    }
    return try arr.enumerated().map { index, item in
      guard let obj = item.objectValue else {
        throw A2UIValidationError(
          "Invalid \(version.rawValue) message: each component in \(action).components "
            + "must be an object",
          details: [
            A2UIErrorDetail(
              path: "messages.0.\(action).components.\(index)",
              code: "type_mismatch",
              message: "Component definition must be an object"
            )
          ]
        )
      }
      return Dictionary(uniqueKeysWithValues: obj.map { ($0.key, $0.value) })
    }
  }

  internal func validatePathsAndRecursion(
    _ value: JSONValue,
    globalDepth: Int = 0,
    functionDepth: Int = 0,
    validateExpressions: Bool = true
  ) throws {
    if globalDepth > Self.maxGlobalDepth {
      throw A2UIRecursionError(
        "Global recursion limit exceeded: Depth > \(Self.maxGlobalDepth)"
      )
    }
    if validateExpressions && functionDepth > Self.maxFunctionDepth {
      throw A2UIRecursionError(
        "Recursion limit exceeded: functionCall depth > \(Self.maxFunctionDepth)"
      )
    }

    switch value {
    case .object(let dictionary):
      var nextDepth = functionDepth
      if validateExpressions {
        let pathKey = version.isAtLeastV10 ? "@path" : "path"
        if let path = dictionary[pathKey]?.stringValue ?? dictionary["path"]?.stringValue {
          let range = NSRange(path.startIndex..<path.endIndex, in: path)
          if Self.validPathRegex.firstMatch(in: path, range: range) == nil {
            throw A2UIValidationError(
              "Invalid path syntax: '\(path)'",
              details: [
                A2UIErrorDetail(
                  path: path,
                  code: "invalid_path_syntax",
                  message: "Invalid path syntax"
                )
              ]
            )
          }
        }

        let callKey = version.isAtLeastV10 ? "@call" : "call"
        if let callName = dictionary[callKey]?.stringValue ?? dictionary["call"]?.stringValue,
          !UnicodeIdentifierValidator.isValidFunctionIdentifier(callName)
        {
          throw A2UIValidationError(
            "Invalid function identifier: '\(callName)'",
            details: [
              A2UIErrorDetail(
                path: callName,
                code: "invalid_identifier",
                message: "Invalid function identifier: '\(callName)'"
              )
            ]
          )
        }

        let isFunctionCall =
          dictionary[callKey] != nil || dictionary["call"] != nil || dictionary["function"] != nil
        if isFunctionCall {
          nextDepth += 1
        }
      }

      for (key, propertyValue) in dictionary {
        let isRawDataPayload =
          globalDepth == 1
          && (key == "dataModel" || key == "value" || key == "metadata")
        try validatePathsAndRecursion(
          propertyValue,
          globalDepth: globalDepth + 1,
          functionDepth: nextDepth,
          validateExpressions: validateExpressions && !isRawDataPayload
        )
      }

    case .array(let array):
      for item in array {
        try validatePathsAndRecursion(
          item,
          globalDepth: globalDepth + 1,
          functionDepth: functionDepth,
          validateExpressions: validateExpressions
        )
      }

    default:
      break
    }
  }
}
