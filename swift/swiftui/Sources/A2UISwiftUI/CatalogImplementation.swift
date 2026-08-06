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

import A2UICore
import SwiftUI

/// A catalog implementation mapping component keys to SwiftUI view builders.
///
/// Supports catalog-qualified lookups when a node specifies a catalog ID,
/// with automatic fallback to an unqualified component type match.
public final class CatalogImplementation: @unchecked Sendable {
  private var builders: [ComponentKey: ComponentViewBuilder] = [:]

  public init() {}

  /// Creates a new catalog implementation initialized with an array of components.
  ///
  /// - Parameters:
  ///   - catalogID: The optional catalog ID for the registered components.
  ///   - components: The component implementations to register.
  public init(
    catalogID: String? = nil,
    components: [ComponentImplementation] = []
  ) {
    register(catalogID: catalogID, components: components)
  }

  /// Creates a new catalog implementation initialized with a catalog and components.
  ///
  /// - Parameters:
  ///   - catalog: The catalog definition.
  ///   - components: The component implementations to register.
  public init(
    catalog: Catalog,
    components: [ComponentImplementation]
  ) {
    register(catalog: catalog, components: components)
  }

  /// Registers a view builder for a component type within an optional catalog ID.
  public func register(
    catalogID: String? = nil,
    type: String,
    builder: @escaping ComponentViewBuilder
  ) {
    let key = ComponentKey(
      catalogID: catalogID,
      type: type
    )
    builders[key] = builder
  }

  /// Registers a view builder for a component type within a specific catalog.
  public func register(
    catalog: Catalog,
    type: String,
    builder: @escaping ComponentViewBuilder
  ) {
    register(
      catalogID: catalog.id,
      type: type,
      builder: builder
    )
  }

  /// Registers a component implementation within an optional catalog ID.
  public func register(
    catalogID: String? = nil,
    component: ComponentImplementation
  ) {
    register(
      catalogID: catalogID,
      type: component.name,
      builder: component.builder
    )
  }

  /// Registers a component implementation within a specific catalog.
  public func register(
    catalog: Catalog,
    component: ComponentImplementation
  ) {
    register(
      catalogID: catalog.id,
      component: component
    )
  }

  /// Registers multiple component implementations within an optional catalog ID.
  public func register(
    catalogID: String? = nil,
    components: [ComponentImplementation]
  ) {
    for component in components {
      register(catalogID: catalogID, component: component)
    }
  }

  /// Registers multiple component implementations within a specific catalog.
  public func register(
    catalog: Catalog,
    components: [ComponentImplementation]
  ) {
    register(catalogID: catalog.id, components: components)
  }

  /// Returns the registered view builder for the specified component key.
  public func builder(for key: ComponentKey) -> ComponentViewBuilder? {
    builders[key]
  }

  /// Resolves the registered view builder matching an optional catalog ID and component type.
  ///
  /// Performs a catalog-qualified lookup when `catalogID` is present, falling back to an
  /// unqualified match on `type` alone if a qualified builder is not found.
  public func builder(catalogID: String? = nil, type: String) -> ComponentViewBuilder? {
    if let catalogID {
      let qualifiedKey = ComponentKey(
        catalogID: catalogID,
        type: type
      )
      if let viewBuilder = builders[qualifiedKey] {
        return viewBuilder
      }
    }
    let unqualifiedKey = ComponentKey(
      catalogID: nil,
      type: type
    )
    return builders[unqualifiedKey]
  }
}
