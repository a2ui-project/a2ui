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

/// Environment key for the ``A2UIAnnouncer`` that live regions post their announcements with.
struct A2UIAnnouncerKey: EnvironmentKey {
  static let defaultValue = A2UIAnnouncer.accessibilityNotification
}

extension EnvironmentValues {
  /// Posts the announcements of live regions. Set it to observe them in tests.
  @_spi(Testing)
  public var a2uiAnnouncer: A2UIAnnouncer {
    get { self[A2UIAnnouncerKey.self] }
    set { self[A2UIAnnouncerKey.self] = newValue }
  }
}
