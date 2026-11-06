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

/// Reports a view's visible text through ``A2UIAccessibleTextKey`` when the view is inside a live
/// region. Outside one, the text is never evaluated.
struct A2UIAccessibleTextReporter: ViewModifier {
  @Environment(\.a2uiInLiveRegion) private var isInLiveRegion

  let text: () -> String?

  func body(content: Content) -> some View {
    content.preference(key: A2UIAccessibleTextKey.self, value: reportedText)
  }

  private var reportedText: [String] {
    guard isInLiveRegion, let text = text(), !text.isEmpty else { return [] }
    return [text]
  }
}
