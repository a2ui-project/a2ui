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

import A2UICore
import Foundation

/// Turns the resolved value of a media URL property into the URL a media view loads.
enum MediaURL {
  /// Returns the URL to load for a resolved `url` or `posterUrl` value, or `nil` to load nothing.
  ///
  /// The resolver already passed the value through the surface's URL security policy, which may
  /// have rewritten it (for example, to a media proxy), so the policy doesn't run again: a
  /// second check would test a proxy URL against the allowlist. Only the built-in baseline runs,
  /// which a policy's result always passes, so a catalog that doesn't mark these properties
  /// still can't load `javascript:` or similar URLs.
  static func url(from resolved: String?) -> URL? {
    guard let resolved, let allowed = URLBaseline.check(resolved, context: .media) else {
      return nil
    }
    return URL(string: allowed)
  }
}
