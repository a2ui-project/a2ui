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

/// Environment key for the main axis of the row or column whose direct children are being
/// rendered.
struct A2UILayoutAxisKey: EnvironmentKey {
  static let defaultValue: A2UILayoutAxis? = nil
}

extension EnvironmentValues {
  /// The main axis of the row or column whose direct children are being rendered, or `nil`
  /// outside one.
  var a2uiLayoutAxis: A2UILayoutAxis? {
    get { self[A2UILayoutAxisKey.self] }
    set { self[A2UILayoutAxisKey.self] = newValue }
  }
}
