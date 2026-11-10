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

/// Checks a URL that a view builds or finds itself against the URL security policy of the
/// surface it renders on.
///
/// Read it from the environment as `@Environment(\.a2uiURLSanitizer)`. ``Surface`` binds it to
/// ``SurfaceViewModel/sanitizeURL(_:context:info:)``, so the surface's policy applies and a
/// blocked URL is reported on ``SurfaceViewModel/urlBlockedPublisher``. Outside a surface it
/// runs the built-in ``URLBaseline`` checks only.
///
/// Use it only for URLs that don't come from a property marked as a URL, such as the targets of
/// Markdown links. Marked properties resolve already checked, and checking a rewritten URL
/// again could block it.
///
/// ```swift
/// @Environment(\.a2uiURLSanitizer) private var sanitizeURL
///
/// let target = sanitizeURL(href, context: .navigation, info: URLCheckInfo(propertyName: "text"))
/// ```
public struct A2UIURLSanitizer: Sendable {
  private let sanitize: @MainActor @Sendable (String, URLContext, URLCheckInfo?) -> String?

  /// Creates a sanitizer from a function that returns the URL to use, or `nil` to block it.
  public init(
    _ sanitize: @escaping @MainActor @Sendable (String, URLContext, URLCheckInfo?) -> String?
  ) {
    self.sanitize = sanitize
  }

  /// Creates a sanitizer bound to a surface's URL security policy.
  public init(surface: SurfaceViewModel) {
    self.init { url, context, info in
      surface.sanitizeURL(url, context: context, info: info)
    }
  }

  /// A sanitizer that runs the built-in ``URLBaseline`` checks only.
  public static let baseline = A2UIURLSanitizer { url, context, _ in
    URLBaseline.check(url, context: context)
  }

  /// Returns the URL to use, possibly rewritten, or `nil` when the policy blocks it.
  @MainActor
  public func callAsFunction(
    _ url: String,
    context: URLContext,
    info: URLCheckInfo? = nil
  ) -> String? {
    sanitize(url, context, info)
  }
}
