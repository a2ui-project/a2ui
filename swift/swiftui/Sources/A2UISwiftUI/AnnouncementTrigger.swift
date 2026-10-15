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

/// Posts an accessibility announcement whenever `text` changes to a non-nil value.
///
/// Uses the two-parameter `onChange` where available and falls back to the iOS 16 form, which
/// the package still supports.
struct AnnouncementTrigger: ViewModifier {
  let text: String?
  let assertive: Bool

  func body(content: Content) -> some View {
    if #available(iOS 17.0, macOS 14.0, *) {
      content.onChange(of: text) { _, newText in
        announce(newText)
      }
    } else {
      content.onChange(of: text) { newText in
        announce(newText)
      }
    }
  }

  private func announce(_ newText: String?) {
    guard let newText else { return }
    A2UIAccessibilityModifier.announce(newText, assertive: assertive)
  }
}
