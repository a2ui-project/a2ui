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

/// Provides pre-configured Basic Catalog definitions for A2UI Protocol v1.0.
public enum V10BasicCatalog: Sendable {
  /// The canonical catalog URI for A2UI v1.0 Basic Catalog.
  public static let catalogURI =
    "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"

  /// All 18 standard component APIs for A2UI Protocol v1.0.
  public static let components: [AnyComponentAPI] =
    V10BasicCatalogComponents.allComponents

  /// Standard function implementations for A2UI Protocol v1.0.
  public static let functions: [any FunctionImplementation] =
    V10BasicFunctions.allFunctions

  /// Pre-configured Basic Catalog instance for A2UI Protocol v1.0.
  public static let catalog = Catalog(
    id: catalogURI,
    protocolVersion: .v10,
    components: components,
    functions: functions,
    themeSchema: nil
  )
}
