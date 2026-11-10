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

/// Reports to the enclosing ``ComponentNodeView`` that a component applied its explicit
/// accessibility label and hint to its own focusable control, so the dispatcher must not apply
/// them to the component's root as well.
struct A2UIAccessibilityControlKey: PreferenceKey {
  static let defaultValue = false

  static func reduce(value: inout Bool, nextValue: () -> Bool) {
    value = value || nextValue()
  }
}
