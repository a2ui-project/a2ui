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

/// Announces the text of a live region (`live` is `polite` or `assertive`) when it changes.
///
/// It stays in the view tree while the region is hidden, so the text goes from `nil` to the
/// visible text when the region is shown again and that text is announced. Nothing is announced
/// while the region or one of its ancestors is hidden.
struct LiveRegionHostModifier: ViewModifier {
  @Environment(\.a2uiAccessibilityHidden) private var isAncestorHidden

  let modifier: A2UIAccessibilityModifier

  func body(content: Content) -> some View {
    let isSilent = modifier.isHidden || isAncestorHidden
    return
      content
      .environment(\.a2uiInLiveRegion, !isSilent)
      .overlayPreferenceValue(A2UIAccessibleTextKey.self) { subtreeText in
        Color.clear
          .accessibilityHidden(true)
          .allowsHitTesting(false)
          .modifier(
            AnnouncementTrigger(
              text: isSilent ? nil : modifier.announcementText(subtreeText: subtreeText),
              assertive: modifier.isAssertive
            )
          )
      }
      // The nearest live region announces the text, so a live ancestor doesn't repeat it.
      .transformPreference(A2UIAccessibleTextKey.self) { $0 = [] }
  }
}
