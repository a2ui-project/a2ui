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

/// Environment key through which ``A2UIModal`` hands its trigger subtree the action that opens
/// the sheet, so a ``A2UIButton`` in the trigger opens it from its own action.
struct A2UIModalTriggerActionKey: EnvironmentKey {
  static let defaultValue: (@MainActor () -> Void)? = nil
}

extension EnvironmentValues {
  /// Opens the enclosing Modal's sheet, or `nil` outside a Modal's trigger.
  var a2uiModalTriggerAction: (@MainActor () -> Void)? {
    get { self[A2UIModalTriggerActionKey.self] }
    set { self[A2UIModalTriggerActionKey.self] = newValue }
  }
}
