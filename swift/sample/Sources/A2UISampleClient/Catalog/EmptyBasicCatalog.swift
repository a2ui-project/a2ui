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

/// Provides an empty catalog instance matching canonical Basic Catalog URIs without schema definitions.
///
/// As intended at this architectural phase, schema validation errors or `CATALOG_NOT_FOUND` exceptions
/// during message processing are captured and displayed in the diagnostic log pane without interrupting
/// progressive message step-through.
public enum EmptyBasicCatalog: Sendable {
  public static let v09Catalog = Catalog(
    id: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    components: []
  )

  public static let v091Catalog = Catalog(
    id: "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json",
    components: []
  )

  public static let v10Catalog = Catalog(
    id: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    components: []
  )

  public static let allCatalogs: [String: Catalog] = [
    v09Catalog.id: v09Catalog,
    v091Catalog.id: v091Catalog,
    v10Catalog.id: v10Catalog,
  ]
}
