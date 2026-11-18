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
import SwiftUI

extension EnvironmentValues {
  /// Catalogs provided by ancestor views via ``SwiftUI/View/a2uiCatalog(_:)`` or
  /// ``SwiftUI/View/a2uiCatalogs(_:)`` for descendant ``Surface`` views to merge with their own.
  @Entry var a2uiProvidedCatalogs = CatalogRegistry()

  /// `Equatable` backing store for ``a2uiCatalogs`` so ``Surface`` redraws do not invalidate
  /// descendants when the active catalog set has not changed.
  @Entry var a2uiActiveCatalogRegistry = CatalogRegistry()

  /// The active A2UI component catalogs injected by ``Surface`` for SwiftUI rendering.
  public internal(set) var a2uiCatalogs: [String: Catalog<ComponentImplementation>] {
    get { a2uiActiveCatalogRegistry.catalogs }
    set { a2uiActiveCatalogRegistry = CatalogRegistry(catalogs: newValue) }
  }

  /// The default catalog ID injected by ``Surface`` for unqualified component lookups.
  @Entry public internal(set) var a2uiDefaultCatalogID: String? = nil
}
