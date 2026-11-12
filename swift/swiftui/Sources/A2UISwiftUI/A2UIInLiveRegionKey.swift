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

/// Environment key that is `true` inside a live region, where components report their visible
/// text through ``A2UIAccessibleTextKey``. Outside one, nothing reads that text, so components
/// skip building it.
struct A2UIInLiveRegionKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// Whether this view is inside a live region that announces its subtree text.
  var a2uiInLiveRegion: Bool {
    get { self[A2UIInLiveRegionKey.self] }
    set { self[A2UIInLiveRegionKey.self] = newValue }
  }
}
