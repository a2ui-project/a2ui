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

/// Shared base class providing payload unwrapping, action key validation,
/// and version header verification for protocol version adapters.
open class BaseVersionAdapter: VersionAdapter, @unchecked Sendable {
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
      for item in items {
        if let dict = item.objectValue {
          _ = try extractSingleAction(from: dict)
        }
      }
      return try items.flatMap { try extractOperations(from: $0) }
    case .object(let dict):
      if let messages = dict["messages"]?.arrayValue {
        return try extractOperations(from: .array(messages))
      }

      let action = try extractSingleAction(from: dict)
      guard let actionObj = dict[action]?.objectValue else {
        throw A2UIValidationError("Payload for action '\(action)' must be an object")
      }

      try validateVersionHeader(in: dict)
      return try extractOperationsFromObject(dict, action: action, actionObject: actionObj)
    default:
      return []
    }
  }

  open func adaptMessage(_ message: AgentToRendererMessage) throws -> [InternalOperation] {
    fatalError("Subclasses must override adaptMessage(_:)")
  }

  open func extractOperationsFromObject(
    _ message: OrderedDictionary<String, JSONValue>,
    action: String,
    actionObject: OrderedDictionary<String, JSONValue>
  ) throws -> [InternalOperation] {
    fatalError("Subclasses must override extractOperationsFromObject(_:action:actionObject:)")
  }

  // MARK: - Validation Helpers

  internal func extractSingleAction(
    from dict: OrderedDictionary<String, JSONValue>
  ) throws -> String {
    for actionKey in validActions {
      if let actionObj = dict[actionKey]?.objectValue,
        let rawSurfaceID = actionObj["surfaceId"]
      {
        guard rawSurfaceID.stringValue != nil else {
          throw A2UIValidationError("surfaceId must be a string")
        }
      }
    }

    let presentNativeKeys = validActions.filter { dict[$0] != nil }.sorted()
    if presentNativeKeys.count > 1 {
      let joined = presentNativeKeys.joined(separator: ", ")
      throw A2UIValidationError(
        "Message contains multiple conflicting update actions: \(joined)."
      )
    }

    if presentNativeKeys.isEmpty {
      let allKnown = VersionAdapterFactory.allKnownActions()
      let otherAction = dict.keys.first {
        allKnown.contains($0) && !validActions.contains($0)
      }
      let sortedAllowed = validActions.sorted().joined(separator: ", ")
      if let otherAction {
        throw A2UIValidationError(
          "Invalid \(version.rawValue) message: action '\(otherAction)' is not supported in "
            + "protocol version \(version.rawValue). Allowed actions: \(sortedAllowed)."
        )
      }
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: message must contain exactly one update action: "
          + "\(sortedAllowed)."
      )
    }

    return presentNativeKeys[0]
  }

  internal func validateVersionHeader(
    in dict: OrderedDictionary<String, JSONValue>
  ) throws {
    guard let rawVersion = dict["version"] else {
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: version: 'version' is a required property"
      )
    }
    guard let versionStr = rawVersion.stringValue else {
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: version: 'version' must be a string"
      )
    }
    let canonical = canonicalizeVersionString(versionStr)
    guard compatibleCatalogVersions.contains(canonical) else {
      let allowed = compatibleCatalogVersions.sorted().map { "v\($0)" }.joined(separator: ", ")
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: version '\(versionStr)' is not compatible with "
          + "expected version (\(allowed))."
      )
    }
  }

  internal func requireSurfaceID(
    in actionObject: OrderedDictionary<String, JSONValue>,
    action: String
  ) throws -> String {
    guard let rawID = actionObject["surfaceId"] else {
      throw A2UIValidationError(
        "Invalid \(version.rawValue) message: \(action).surfaceId is required"
      )
    }
    guard let surfaceID = rawID.stringValue, !surfaceID.isEmpty else {
      throw A2UIValidationError("surfaceId must be a non-empty string")
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
        "Invalid \(version.rawValue) message: \(action).components must be an array"
      )
    }
    return try arr.map { item in
      guard let obj = item.objectValue else {
        throw A2UIValidationError(
          "Invalid \(version.rawValue) message: each component in \(action).components "
            + "must be an object"
        )
      }
      return Dictionary(uniqueKeysWithValues: obj.map { ($0.key, $0.value) })
    }
  }
}
