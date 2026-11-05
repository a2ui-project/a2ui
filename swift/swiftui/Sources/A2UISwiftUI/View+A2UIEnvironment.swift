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
import OrderedJSON
import SwiftUI

extension View {
  /// Registers a single A2UI SwiftUI component catalog in the environment, merging it with any
  /// catalogs inherited from ancestor views.
  ///
  /// - Parameters:
  ///   - catalog: The SwiftUI component catalog to register.
  ///   - isDefault: Whether this catalog should become the default catalog ID for unqualified
  ///     component lookups.
  public func a2uiCatalog(
    _ catalog: Catalog<ComponentImplementation>,
    isDefault: Bool = false
  ) -> some View {
    modifier(
      A2UICatalogEnvironmentModifier(
        catalogs: [catalog.id: catalog],
        defaultCatalogID: isDefault ? catalog.id : nil
      )
    )
  }

  /// Registers a collection of A2UI SwiftUI component catalogs in the environment, merging them
  /// with any catalogs inherited from ancestor views.
  ///
  /// - Parameters:
  ///   - catalogs: The SwiftUI component catalogs to register.
  ///   - defaultCatalogID: Optional default catalog ID for unqualified component lookups.
  public func a2uiCatalogs(
    _ catalogs: [Catalog<ComponentImplementation>],
    defaultCatalogID: String? = nil
  ) -> some View {
    let dict = Dictionary(catalogs.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    return modifier(
      A2UICatalogEnvironmentModifier(
        catalogs: dict,
        defaultCatalogID: defaultCatalogID,
        fallbackDefaultCatalogID: catalogs.first?.id
      )
    )
  }

  /// Sets the A2UI theme dictionary in the SwiftUI environment for descendant surfaces.
  ///
  /// A ``Surface`` whose `SurfaceViewModel.theme` is `nil` inherits this ambient theme.
  public func a2uiTheme(_ theme: [String: JSONValue]?) -> some View {
    environment(\.a2uiTheme, theme)
  }
}

private struct A2UICatalogEnvironmentModifier: ViewModifier {
  @Environment(\.a2uiCatalogs) private var existingCatalogs
  @Environment(\.a2uiDefaultCatalogID) private var existingDefaultCatalogID

  let catalogs: [String: Catalog<ComponentImplementation>]
  let defaultCatalogID: String?
  var fallbackDefaultCatalogID: String? = nil

  func body(content: Content) -> some View {
    let merged = existingCatalogs.merging(catalogs) { _, new in new }
    content
      .environment(\.a2uiCatalogs, merged)
      .environment(
        \.a2uiDefaultCatalogID,
        defaultCatalogID ?? existingDefaultCatalogID ?? fallbackDefaultCatalogID
      )
  }
}
