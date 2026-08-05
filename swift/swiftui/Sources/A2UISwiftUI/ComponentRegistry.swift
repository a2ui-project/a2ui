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

/// A lookup key for resolving component view builders by optional catalog ID and component type.
public struct ComponentKey: Hashable, Equatable, Sendable {
  public let catalogID: String?
  public let type: String

  public init(
    catalogID: String? = nil,
    type: String
  ) {
    self.catalogID = catalogID
    self.type = type
  }
}

/// A closure that constructs a SwiftUI view from a resolved engine node.
public typealias ComponentViewBuilder = (Node) -> AnyView

/// A registry mapping component keys to SwiftUI view builders.
///
/// Supports catalog-qualified lookups when a node specifies a catalog ID,
/// with automatic fallback to an unqualified component type match.
public final class ComponentRegistry: @unchecked Sendable {
  private var builders: [ComponentKey: ComponentViewBuilder] = [:]

  public init() {}

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

  /// Resolves and invokes the registered view builder for the given node.
  public func render(node: Node) -> AnyView? {
    if let catalogID = node.catalogID {
      let qualifiedKey = ComponentKey(
        catalogID: catalogID,
        type: node.type
      )
      if let viewBuilder = builders[qualifiedKey] {
        return viewBuilder(node)
      }
    }
    let unqualifiedKey = ComponentKey(
      catalogID: nil,
      type: node.type
    )
    if let viewBuilder = builders[unqualifiedKey] {
      return viewBuilder(node)
    }
    return nil
  }
}

/// Environment key for propagating the component registry through the SwiftUI view hierarchy.
public struct A2UIComponentRegistryKey: EnvironmentKey {
  public static let defaultValue: ComponentRegistry? = nil
}

extension EnvironmentValues {
  /// The active A2UI component registry, if any.
  public var a2uiComponentRegistry: ComponentRegistry? {
    get { self[A2UIComponentRegistryKey.self] }
    set { self[A2UIComponentRegistryKey.self] = newValue }
  }
}
