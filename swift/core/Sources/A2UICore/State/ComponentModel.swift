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

import OrderedJSON

/// The state model for an individual UI component.
///
/// Mirrors `ComponentModel` in the core blueprint and `web_core`.
/// Stores the component's `id`, `type` (component name), and raw
/// `properties` dictionary (excluding `id` and `component` keys).
public struct ComponentModel: Sendable, Equatable {
  /// The unique identifier for this component.
  public let id: String

  /// The component type name (e.g., "Button", "Text").
  public let type: String

  /// The optional catalog ID for this component, overriding any surface-level default catalog ID.
  public let catalogID: String?

  /// The raw, unresolved properties of the component.
  ///
  /// This excludes the `id` and `component` keys from the original
  /// JSON payload, which are promoted to top-level fields.
  public var properties: [String: JSONValue]

  /// Optional metadata envelope (`["extensions": .object(...)]`) attached to the component.
  public private(set) var metadata: [String: JSONValue]?

  /// Convenience accessor returning `metadata["extensions"]` as a dictionary, or `nil`.
  public var extensions: [String: JSONValue]? {
    MetadataValidator.extensions(from: metadata)
  }

  /// Creates a new component model.
  ///
  /// - Parameters:
  ///   - id: The unique identifier for this component.
  ///   - type: The component type name.
  ///   - catalogID: Optional catalog identifier overriding surface default.
  ///   - properties: The raw properties (excluding `id`, `component`, `catalogId`, and `metadata`).
  ///   - metadata: Optional metadata dictionary.
  public init(
    id: String,
    type: String,
    catalogID: String? = nil,
    properties: [String: JSONValue],
    metadata: [String: JSONValue]? = nil
  ) {
    self.id = id
    self.type = type
    self.catalogID = catalogID
    self.properties = properties
    self.metadata = metadata
  }

  /// Replaces the component's metadata dictionary after validating UAX #31 extension keys.
  public mutating func setMetadata(_ metadata: [String: JSONValue]?) throws {
    self.metadata = try MetadataValidator.validate(
      metadata,
      pathPrefix: "components.\(id).metadata"
    )
  }

  /// Sets a single extension key inside the component's metadata envelope.
  public mutating func setExtension(_ key: String, value: JSONValue) throws {
    self.metadata = try MetadataValidator.settingExtension(
      key,
      value: value,
      in: metadata,
      pathPrefix: "components.\(id).metadata"
    )
  }

  /// Removes a single extension key from the component's metadata envelope.
  public mutating func removeExtension(_ key: String) {
    self.metadata = MetadataValidator.removingExtension(key, from: metadata)
  }
}
