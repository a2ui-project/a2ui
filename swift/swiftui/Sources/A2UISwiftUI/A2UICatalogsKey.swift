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

/// Environment key storing the active A2UI component catalogs for SwiftUI rendering.
@available(*, deprecated, message: "Use EnvironmentValues.a2uiCatalogs instead.")
public struct A2UICatalogsKey: EnvironmentKey {
  public static let defaultValue: [String: Catalog<ComponentImplementation>] = [:]
}

/// Environment key storing the default catalog ID used for unqualified component lookups.
@available(*, deprecated, message: "Use EnvironmentValues.a2uiDefaultCatalogID instead.")
public struct A2UIDefaultCatalogIDKey: EnvironmentKey {
  public static let defaultValue: String? = nil
}

extension EnvironmentValues {
  /// The active A2UI component catalogs for SwiftUI rendering.
  @Entry public var a2uiCatalogs: [String: Catalog<ComponentImplementation>] = [:]

  /// The default catalog ID used for unqualified component lookups.
  @Entry public var a2uiDefaultCatalogID: String? = nil
}
