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

/// Posts the announcements of live regions (`live` is `polite` or `assertive`).
///
/// The default posts an `AccessibilityNotification.Announcement`. Tests replace it through the
/// `a2uiAnnouncer` environment value to observe what a live region announces.
@_spi(Testing)
public struct A2UIAnnouncer: Sendable {
  /// Posts `text`. `isAssertive` is `true` when the announcement interrupts current speech.
  public let announce: @MainActor @Sendable (_ text: String, _ isAssertive: Bool) -> Void

  public init(
    announce: @escaping @MainActor @Sendable (_ text: String, _ isAssertive: Bool) -> Void
  ) {
    self.announce = announce
  }

  /// Posts an `AccessibilityNotification.Announcement`, with high priority when assertive.
  public static let accessibilityNotification = A2UIAnnouncer { text, isAssertive in
    A2UIAccessibilityModifier.announce(text, assertive: isAssertive)
  }
}
