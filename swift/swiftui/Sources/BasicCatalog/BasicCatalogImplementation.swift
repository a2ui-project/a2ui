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
import SwiftUI

/// Provides pre-configured SwiftUI component implementations for all 18 basic components.
@MainActor
public enum BasicCatalogImplementation: Sendable {

  /// All 18 concrete component implementations for SwiftUI.
  public static let allComponents: [ComponentImplementation] = [
    text,
    image,
    icon,
    video,
    audioPlayer,
    row,
    column,
    list,
    card,
    tabs,
    modal,
    divider,
    button,
    textField,
    checkBox,
    choicePicker,
    slider,
    dateTimeInput,
  ]

  /// All 18 concrete component implementations configured with v1.0 schemas for SwiftUI.
  public static let v10Components: [ComponentImplementation] = {
    let buildersByName = Dictionary(
      uniqueKeysWithValues: allComponents.map { ($0.name, $0.builder) }
    )
    return V10BasicCatalog.components.compactMap { api in
      guard let builder = buildersByName[api.name] else { return nil }
      return ComponentImplementation(api: api, builder: builder)
    }
  }()

  /// Returns a pre-configured SwiftUI `Catalog<ComponentImplementation>` instance for the
  /// specified A2UI protocol version.
  public static func makeCatalog(
    version: A2UIProtocolVersion
  ) -> Catalog<ComponentImplementation> {
    switch version {
    case .v09, .v091:
      return Catalog(
        id: BasicCatalog.catalogURI(version: version),
        protocolVersion: version,
        components: allComponents,
        functions: V09BasicCatalog.functions,
        themeSchema: V09BasicCatalog.themeSchema
      )
    case .v10:
      return Catalog(
        id: BasicCatalog.catalogURI(version: .v10),
        protocolVersion: .v10,
        components: v10Components,
        functions: V10BasicCatalog.functions,
        themeSchema: nil
      )
    }
  }

  /// All supported standard Basic Catalog SwiftUI implementations.
  public static let allCatalogs: [Catalog<ComponentImplementation>] =
    A2UIProtocolVersion.allCases.map { makeCatalog(version: $0) }
}
