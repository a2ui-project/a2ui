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

import A2UICore

/// An `Equatable` container for SwiftUI component catalogs stored in the environment.
///
/// Equality compares catalog IDs, protocol versions, and each component implementation's
/// per-instance identity so SwiftUI can diff environment catalog maps without comparing
/// type-erased view builder closures.
struct CatalogRegistry: Equatable, Sendable {
  var catalogs: [String: Catalog<ComponentImplementation>]

  init(catalogs: [String: Catalog<ComponentImplementation>] = [:]) {
    self.catalogs = catalogs
  }

  init(catalogs: [Catalog<ComponentImplementation>]) {
    self.catalogs = Dictionary(
      catalogs.map { ($0.id, $0) },
      uniquingKeysWith: { _, last in last }
    )
  }

  var isEmpty: Bool {
    catalogs.isEmpty
  }

  /// Combines `self` with `overrides`, preferring entries in `overrides` on catalog ID collisions.
  func merging(_ overrides: CatalogRegistry) -> CatalogRegistry {
    if overrides.isEmpty {
      return self
    }
    if isEmpty {
      return overrides
    }
    return CatalogRegistry(
      catalogs: catalogs.merging(overrides.catalogs) { _, override in override }
    )
  }

  static func == (lhs: Self, rhs: Self) -> Bool {
    guard lhs.catalogs.count == rhs.catalogs.count else {
      return false
    }
    for (key, lhsCatalog) in lhs.catalogs {
      guard let rhsCatalog = rhs.catalogs[key],
        lhsCatalog.id == rhsCatalog.id,
        lhsCatalog.protocolVersion == rhsCatalog.protocolVersion,
        lhsCatalog.components.count == rhsCatalog.components.count
      else {
        return false
      }
      for (name, lhsComponent) in lhsCatalog.components {
        guard rhsCatalog.components[name]?.identity == lhsComponent.identity else {
          return false
        }
      }
    }
    return true
  }
}
