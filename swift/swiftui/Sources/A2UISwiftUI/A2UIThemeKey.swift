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

/// Environment key for propagating the active surface theme through
/// the SwiftUI view hierarchy.
public struct A2UIThemeKey: EnvironmentKey {
  public static let defaultValue: [String: JSONValue]? = nil
}

extension EnvironmentValues {
  /// The active A2UI surface theme, if any.
  public var a2uiTheme: [String: JSONValue]? {
    get { self[A2UIThemeKey.self] }
    set { self[A2UIThemeKey.self] = newValue }
  }
}
