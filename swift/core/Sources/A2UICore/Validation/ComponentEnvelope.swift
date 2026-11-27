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

/// The protocol mixins of a v1.0 component object, split from the component's own properties.
///
/// v1.0 names the component mixins `@catalogId`, `@metadata`, `@accessibility`, and `@checks`.
/// While agents move to the prefixed names, a v1.0 component may still carry a mixin under its
/// legacy bare name (`catalogId`, `metadata`, `accessibility`, `checks`), unless the component's
/// definition declares a parameter of its own with that name: then the bare key is that property,
/// and only the prefixed key is the mixin. A component that names a mixin both ways without
/// declaring the bare name is ambiguous, and is rejected. Bare `checks` is a mixin only on a
/// checkable component; elsewhere it stays a property, for validation to accept or reject.
///
/// Before v1.0 a component has no mixins beyond `id` and `component`, so this type is not used:
/// bare `catalogId` and `metadata` are ordinary properties there.
///
/// TODO(#4082): remove the legacy bare v1.0 mixin fallback. It exists only until v1.0 schemas,
/// catalogs, and agent emitters all use the `@`-prefixed names.
struct ComponentEnvelope {
  /// A component mixin, by its legacy bare name.
  enum Mixin: String, CaseIterable {
    case catalogID = "catalogId"
    case metadata
    case accessibility
    case checks

    /// The legacy bare key of the mixin, such as `metadata`.
    var bareKey: String { rawValue }

    /// The v1.0 key of the mixin, such as `@metadata`.
    var prefixedKey: String { "@" + rawValue }
  }

  /// The `@`-prefixed mixin keys that a v1.0 component object may carry at its root.
  static let prefixedKeys: Set<String> = Set(Mixin.allCases.map(\.prefixedKey))

  /// The value of each mixin the component carries.
  private var values: [Mixin: JSONValue] = [:]

  /// The key under which the component carries each mixin: prefixed, or legacy bare.
  private var keys: [Mixin: String] = [:]

  /// The component's own properties: every key but `id`, `component`, and the mixin keys.
  private(set) var properties: [String: JSONValue]

  /// Splits a v1.0 component object directly against its ``ComponentDefinition``.
  init(
    component: [String: JSONValue],
    componentAPI: (any ComponentAPI)?,
    componentID: String
  ) throws {
    try self.init(
      component: component,
      definition: componentAPI?.definition,
      componentID: componentID
    )
  }

  /// Splits a v1.0 component object directly against a ``ComponentDefinition`` (or `nil` for an
  /// unknown component type).
  init(
    component: [String: JSONValue],
    definition: ComponentDefinition?,
    componentID: String
  ) throws {
    var properties = component
    properties.removeValue(forKey: "id")
    properties.removeValue(forKey: "component")
    for mixin in Mixin.allCases {
      let prefixed = component[mixin.prefixedKey]
      let bare = component[mixin.bareKey]
      if prefixed == nil && bare == nil {
        continue
      }
      properties.removeValue(forKey: mixin.prefixedKey)
      let declaresBare =
        bare != nil && (definition.map { Self.declaresOwnProperty(mixin, in: $0) } ?? false)
      if let prefixed {
        if bare != nil, !declaresBare {
          throw Self.conflictError(mixin, componentID: componentID)
        }
        values[mixin] = prefixed
        keys[mixin] = mixin.prefixedKey
      } else if let bare, !declaresBare,
        mixin != .checks || (definition?.isCheckable ?? false)
      {
        properties.removeValue(forKey: mixin.bareKey)
        values[mixin] = bare
        keys[mixin] = mixin.bareKey
      }
    }
    self.properties = properties
  }

  /// The value of a mixin the component carries, or nil.
  subscript(mixin: Mixin) -> JSONValue? {
    values[mixin]
  }

  /// The key under which the component carries a mixin, or nil when it doesn't carry it.
  func key(of mixin: Mixin) -> String? {
    keys[mixin]
  }

  /// Returns the key and value of the catalog a v1.0 component names, or nil when it names none.
  static func catalogIDEntry(
    in component: [String: JSONValue],
    defaultCatalogComponent: (any ComponentAPI)?
  ) -> (key: String, value: JSONValue)? {
    let mixin = Mixin.catalogID
    if let prefixed = component[mixin.prefixedKey] {
      return (mixin.prefixedKey, prefixed)
    }
    guard let bare = component[mixin.bareKey] else { return nil }
    if let def = defaultCatalogComponent?.definition, declaresOwnProperty(mixin, in: def) {
      return nil
    }
    return (mixin.bareKey, bare)
  }

  /// Returns whether a ``ComponentDefinition`` declares a property of its own named like a mixin.
  static func declaresOwnProperty(_ mixin: Mixin, in definition: ComponentDefinition) -> Bool {
    definition.parameter(named: mixin.bareKey) != nil
  }

  /// The error raised for a component that carries a mixin under both of its keys.
  static func conflictError(_ mixin: Mixin, componentID: String) -> A2UIValidationError {
    let msg =
      "Component '\(componentID)' cannot specify both '\(mixin.prefixedKey)' and legacy "
      + "'\(mixin.bareKey)'."
    return A2UIValidationError(
      msg,
      details: [A2UIErrorDetail(path: mixin.prefixedKey, code: "invalid_value", message: msg)]
    )
  }
}
