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
import JSONSchema
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

  /// Creates a SwiftUI `Catalog<ComponentImplementation>` instance with all Basic Catalog components.
  public static func createCatalog(
    id: String = BasicCatalog.v091CatalogURI,
    components: [ComponentImplementation] = allComponents,
    functions: [any FunctionImplementation] = BasicFunctions.allFunctions,
    themeSchema: Schema? = BasicCatalog.themeSchema
  ) -> Catalog<ComponentImplementation> {
    Catalog(
      id: id,
      components: components,
      functions: functions,
      themeSchema: themeSchema
    )
  }

  public static let v09Catalog = createCatalog(id: BasicCatalog.v09CatalogURI)
  public static let v091Catalog = createCatalog(id: BasicCatalog.v091CatalogURI)

  /// All supported standard Basic Catalog SwiftUI implementations.
  public static let allCatalogs: [Catalog<ComponentImplementation>] = [
    v09Catalog,
    v091Catalog,
  ]
}
