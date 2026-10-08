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
import OrderedJSON

/// Resolves ``VersionAdapter`` instances for A2UI protocol specification versions.
public final class VersionAdapterFactory: @unchecked Sendable {
  /// Default shared factory instance.
  public static let shared = VersionAdapterFactory()

  private let lock = NSLock()
  private var adapters: [String: any VersionAdapter]

  public init() {
    let v09Adapter = V09VersionAdapter(version: .v09)
    let v091Adapter = V09VersionAdapter(version: .v091)
    let v10Adapter = V10VersionAdapter()
    self.adapters = [
      "0.9": v09Adapter,
      "0.9.1": v091Adapter,
      "1.0": v10Adapter,
    ]
  }

  /// Returns the union of all action keys supported across all registered adapters.
  public func allKnownActions() -> Set<String> {
    lock.lock()
    defer { lock.unlock() }
    var actions: Set<String> = []
    for adapter in adapters.values {
      actions.formUnion(adapter.validActions)
    }
    return actions
  }

  /// Dynamically registers a version adapter on this factory instance.
  public func registerAdapter(_ adapter: any VersionAdapter) {
    let key = canonicalizeVersionString(adapter.version.rawValue)
    lock.lock()
    defer { lock.unlock() }
    adapters[key] = adapter
  }

  /// Resolves the version adapter for a typed ``A2UIProtocolVersion``.
  public func getAdapter(for version: A2UIProtocolVersion) -> any VersionAdapter {
    let key = canonicalizeVersionString(version.rawValue)
    lock.lock()
    if let adapter = adapters[key] {
      lock.unlock()
      return adapter
    }
    lock.unlock()
    switch version {
    case .v09:
      return V09VersionAdapter(version: .v09)
    case .v091:
      return V09VersionAdapter(version: .v091)
    case .v10:
      return V10VersionAdapter()
    }
  }

  /// Resolves the version adapter for the specified version string (e.g. `"v1.0"` or `"v0.9.1"`).
  public func getAdapter(for version: String) throws -> any VersionAdapter {
    let key = canonicalizeVersionString(version)
    lock.lock()
    let found = adapters[key]
    let supportedKeys = Array(adapters.keys)
    lock.unlock()

    guard let adapter = found else {
      let supported =
        supportedKeys
        .map { $0.hasPrefix("v") ? $0 : "v\($0)" }
        .sorted()
        .joined(separator: ", ")
      throw A2UIValidationError(
        "[VersionAdapterFactory] Unsupported protocol version '\(version)'. "
          + "Supported versions: \(supported).",
        details: [
          A2UIErrorDetail(
            path: "messages.0.version",
            code: "invalid_value",
            message: "Unsupported protocol version '\(version)'"
          )
        ]
      )
    }
    return adapter
  }

  /// Inspects a raw JSON payload's `version` field and resolves the corresponding adapter.
  public func resolveFromPayload(_ payload: JSONValue) throws -> any VersionAdapter {
    let firstItem: JSONValue
    switch payload {
    case .null:
      return getAdapter(for: .v10)
    case .array(let arr):
      guard let first = arr.first else {
        return getAdapter(for: .v10)
      }
      firstItem = first
    case .object:
      firstItem = payload
    default:
      throw A2UIValidationError(
        "Payload must be a JSON object or array of objects",
        details: [
          A2UIErrorDetail(
            path: "messages",
            code: "type_mismatch",
            message: "Expected object or array"
          )
        ]
      )
    }

    guard let dict = firstItem.objectValue else {
      throw A2UIValidationError(
        "[VersionAdapterFactory] Message item at index 0 is not an object.",
        details: [
          A2UIErrorDetail(
            path: "messages.0",
            code: "type_mismatch",
            message: "Message must be an object"
          )
        ]
      )
    }

    if let messages = dict["messages"]?.arrayValue {
      return try resolveFromPayload(.array(messages))
    }
    if let rawVersion = dict["version"] {
      guard let versionString = rawVersion.stringValue else {
        throw A2UIValidationError(
          "[VersionAdapterFactory] Message payload is missing a valid 'version' string: "
            + "'version' property must be a string.",
          details: [
            A2UIErrorDetail(
              path: "messages.0.version",
              code: "type_mismatch",
              message: "Version must be a string"
            )
          ]
        )
      }
      return try getAdapter(for: versionString)
    }

    throw A2UIValidationError(
      "[VersionAdapterFactory] Message payload is missing a valid 'version' string.",
      details: [
        A2UIErrorDetail(
          path: "messages.0.version",
          code: "missing_field",
          message: "'version' is a required property"
        )
      ]
    )
  }

  // MARK: - Static Convenience API

  /// Returns the union of all action keys supported across all registered adapters on `.shared`.
  public static func allKnownActions() -> Set<String> {
    shared.allKnownActions()
  }

  /// Registers a version adapter on the shared factory instance.
  public static func registerAdapter(_ adapter: any VersionAdapter) {
    shared.registerAdapter(adapter)
  }

  /// Resolves the version adapter for a typed ``A2UIProtocolVersion`` on `.shared`.
  public static func getAdapter(for version: A2UIProtocolVersion) -> any VersionAdapter {
    shared.getAdapter(for: version)
  }

  /// Resolves the version adapter for the specified version string on `.shared`.
  public static func getAdapter(for version: String) throws -> any VersionAdapter {
    try shared.getAdapter(for: version)
  }

  /// Resolves the version adapter directly from a raw JSON payload on `.shared`.
  public static func resolveFromPayload(_ payload: JSONValue) throws -> any VersionAdapter {
    try shared.resolveFromPayload(payload)
  }
}
