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
import Foundation

/// Provides pre-configured Basic Catalog instances containing all 18 standard components
/// and basic client-side functions across supported A2UI specification versions.
public enum BasicCatalog: Sendable {
  /// Returns the canonical catalog URI for the specified A2UI protocol version.
  public static func catalogURI(version: A2UIProtocolVersion) -> String {
    switch version {
    case .v09:
      return V09BasicCatalog.catalogURI
    case .v091:
      return V09BasicCatalog.v091CatalogURI
    case .v10:
      return V10BasicCatalog.catalogURI
    }
  }

  /// Returns a pre-configured Basic Catalog instance for the specified A2UI protocol version.
  public static func makeCatalog(version: A2UIProtocolVersion) -> AnyCatalog {
    switch version {
    case .v09:
      return V09BasicCatalog.catalog
    case .v091:
      return V09BasicCatalog.v091Catalog
    case .v10:
      return V10BasicCatalog.catalog
    }
  }

  /// Returns a new Basic Catalog instance for the specified A2UI protocol version whose
  /// `formatNumber`, `formatCurrency` and `pluralize` functions use `locale`.
  ///
  /// `makeCatalog(version:)` returns shared instances that use `BasicFunctions.defaultLocale`.
  public static func makeCatalog(version: A2UIProtocolVersion, locale: Locale) -> AnyCatalog {
    switch version {
    case .v09, .v091:
      return Catalog(
        id: catalogURI(version: version),
        protocolVersion: version,
        components: V09BasicCatalog.components,
        functions: V09BasicFunctions.makeFunctions(locale: locale),
        themeSchema: V09BasicCatalog.themeSchema
      )
    case .v10:
      return Catalog(
        id: catalogURI(version: version),
        protocolVersion: version,
        components: V10BasicCatalog.components,
        functions: V10BasicFunctions.makeFunctions(locale: locale),
        themeSchema: nil
      )
    }
  }

  /// All supported standard Basic Catalog instances.
  public static let allCatalogs: [AnyCatalog] =
    A2UIProtocolVersion.allCases.map(makeCatalog(version:))
}
