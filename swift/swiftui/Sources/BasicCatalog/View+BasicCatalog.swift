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
import A2UISwiftUI
import BasicCatalog
import Foundation
import SwiftUI

extension View {
  /// Injects all built-in A2UI Basic Catalog SwiftUI component implementations (`v0.9`,
  /// `v0.9.1`, and `v1.0`) into the SwiftUI environment so descendant ``Surface`` views can render
  /// with zero catalog configuration.
  ///
  /// - Parameter locale: The locale used by locale-aware formatting functions. Defaults to
  ///   `BasicFunctions.defaultLocale` (`en_US`).
  @MainActor
  public func a2uiBasicCatalog(
    locale: Locale = BasicFunctions.defaultLocale
  ) -> some View {
    let catalogs = A2UIProtocolVersion.allCases.map {
      BasicCatalogImplementation.makeCatalog(version: $0, locale: locale)
    }
    return a2uiCatalogs(
      catalogs,
      defaultCatalogID: BasicCatalog.catalogURI(version: .v091)
    )
  }
}

extension Surface {
  /// Creates an A2UI surface preconfigured with all built-in Basic Catalog SwiftUI component
  /// implementations (`v0.9`, `v0.9.1`, and `v1.0`).
  ///
  /// - Parameters:
  ///   - viewModel: The surface state model to render.
  ///   - locale: The locale used by locale-aware formatting functions. Defaults to
  ///     `BasicFunctions.defaultLocale` (`en_US`).
  @MainActor
  public init(
    basicCatalogViewModel viewModel: SurfaceViewModel,
    locale: Locale = BasicFunctions.defaultLocale
  ) {
    let catalogs = A2UIProtocolVersion.allCases.map {
      BasicCatalogImplementation.makeCatalog(version: $0, locale: locale)
    }
    self.init(
      viewModel: viewModel,
      catalogs: catalogs,
      defaultCatalogID: viewModel.defaultCatalogID ?? BasicCatalog.catalogURI(version: .v091)
    )
  }
}
