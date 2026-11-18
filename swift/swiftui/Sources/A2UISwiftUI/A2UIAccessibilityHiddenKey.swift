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

import SwiftUI

/// Environment key that is `true` inside a subtree hidden from assistive technologies, where a
/// live region announces nothing.
struct A2UIAccessibilityHiddenKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// Whether an ancestor hides this view from assistive technologies with `hidden`.
  var a2uiAccessibilityHidden: Bool {
    get { self[A2UIAccessibilityHiddenKey.self] }
    set { self[A2UIAccessibilityHiddenKey.self] = newValue }
  }
}
