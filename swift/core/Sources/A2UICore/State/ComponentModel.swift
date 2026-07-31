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

  /// The raw, unresolved properties of the component.
  ///
  /// This excludes the `id` and `component` keys from the original
  /// JSON payload, which are promoted to top-level fields.
  public var properties: [String: JSONValue]

  /// Creates a new component model.
  ///
  /// - Parameters:
  ///   - id: The unique identifier for this component.
  ///   - type: The component type name.
  ///   - properties: The raw properties (excluding `id` and `component`).
  public init(id: String, type: String, properties: [String: JSONValue]) {
    self.id = id
    self.type = type
    self.properties = properties
  }
}
