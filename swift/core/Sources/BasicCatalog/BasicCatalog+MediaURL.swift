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

extension BasicCatalog {
  private static let mediaURLTrimmingSet = CharacterSet.whitespacesAndNewlines.union(
    .controlCharacters)

  /// Validates a media URL from an `Image`, `Video` or `AudioPlayer` component.
  ///
  /// Trims surrounding whitespace, then runs the same ``URLBaseline`` checks as the URL security
  /// policy for ``URLContext/media``: `http(s)` URLs with a host, `image/*`, `audio/*` and
  /// `video/*` `data:` URLs (not `data:image/svg+xml`), and relative paths pass. Anything else
  /// (`javascript:`, `file:`, `blob:`, protocol-relative `//host`, and look-alike forms such as
  /// `/\host` or `https:host`) is rejected.
  ///
  /// - Parameter urlString: The URL string supplied by the agent.
  /// - Returns: The URL parsed from the trimmed string, or `nil` if it is empty, malformed or not
  ///   allowed.
  @available(
    *, deprecated,
    message: "The resolver checks media URLs; for other URLs call sanitizeURL(_:context:info:)"
  )
  public static func sanitizeMediaURL(_ urlString: String?) -> URL? {
    guard
      let trimmed = urlString?.trimmingCharacters(in: mediaURLTrimmingSet),
      let allowed = URLBaseline.check(trimmed, context: .media)
    else {
      return nil
    }
    return URL(string: allowed)
  }
}
