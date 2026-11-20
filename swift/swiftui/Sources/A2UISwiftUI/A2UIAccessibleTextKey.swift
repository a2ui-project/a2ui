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

/// Collects the visible text that components report with
/// ``SwiftUI/View/a2uiAccessibleText(_:)``, in tree order.
///
/// ``A2UIAccessibilityModifier`` reads this key on a live region (`live` is `polite` or
/// `assertive`) and announces the joined text when it changes, so a live `Text` and a live
/// container such as a `Column` or `Card` both announce their updates without the adapter
/// knowing any catalog property names. A hidden subtree reports no text, and a live region
/// reports none to its ancestors, so an update is announced once, by the nearest live region.
/// Components report text only inside a live region, so the rest of a surface does no extra work.
public struct A2UIAccessibleTextKey: PreferenceKey {
  public static let defaultValue: [String] = []

  public static func reduce(value: inout [String], nextValue: () -> [String]) {
    value.append(contentsOf: nextValue())
  }
}
