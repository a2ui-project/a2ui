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

/// Environment key for propagating the active component catalogs through
/// the SwiftUI view hierarchy.
public struct A2UICatalogsKey: EnvironmentKey {
  public static let defaultValue: [String: Catalog<ComponentImplementation>] = [:]
}

/// Environment key for propagating the default catalog ID through
/// the SwiftUI view hierarchy.
public struct A2UIDefaultCatalogIDKey: EnvironmentKey {
  public static let defaultValue: String? = nil
}

extension EnvironmentValues {
  /// The active A2UI component catalogs for SwiftUI rendering.
  public var a2uiCatalogs: [String: Catalog<ComponentImplementation>] {
    get { self[A2UICatalogsKey.self] }
    set { self[A2UICatalogsKey.self] = newValue }
  }

  /// The default catalog ID used for unqualified component lookups.
  public var a2uiDefaultCatalogID: String? {
    get { self[A2UIDefaultCatalogIDKey.self] }
    set { self[A2UIDefaultCatalogIDKey.self] = newValue }
  }
}
