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

extension View {
  /// Provides a component catalog through the SwiftUI environment to descendant ``Surface`` views.
  ///
  /// Catalogs provided at multiple levels accumulate; when two entries share a catalog ID, the
  /// catalog closer to the ``Surface`` takes precedence, and catalogs passed directly to
  /// ``Surface``'s initializer override environment-provided catalogs.
  ///
  /// Store the catalog (or its ``ComponentImplementation`` values) outside `body` so unrelated
  /// parent redraws do not trigger descendant surface redraws.
  public func a2uiCatalog(_ catalog: Catalog<ComponentImplementation>) -> some View {
    modifier(ProvidedCatalogsModifier(added: CatalogRegistry(catalogs: [catalog])))
  }

  /// Provides component catalogs through the SwiftUI environment to descendant ``Surface`` views.
  ///
  /// Catalogs provided at multiple levels accumulate; when two entries share a catalog ID, the
  /// catalog closer to the ``Surface`` takes precedence (with later elements winning within the
  /// same array), and catalogs passed directly to ``Surface``'s initializer override
  /// environment-provided catalogs.
  ///
  /// Store the catalogs (or their ``ComponentImplementation`` values) outside `body` so unrelated
  /// parent redraws do not trigger descendant surface redraws.
  public func a2uiCatalogs(_ catalogs: [Catalog<ComponentImplementation>]) -> some View {
    modifier(ProvidedCatalogsModifier(added: CatalogRegistry(catalogs: catalogs)))
  }
}
