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

/// Environment key for the ``A2UIURLSanitizer`` of the surface being rendered.
public struct A2UIURLSanitizerKey: EnvironmentKey {
  public static let defaultValue = A2UIURLSanitizer.baseline
}

extension EnvironmentValues {
  /// Checks URLs a view builds or finds itself against the surface's URL security policy.
  /// ``Surface`` sets it; elsewhere it runs the built-in baseline checks only.
  public var a2uiURLSanitizer: A2UIURLSanitizer {
    get { self[A2UIURLSanitizerKey.self] }
    set { self[A2UIURLSanitizerKey.self] = newValue }
  }
}
