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

/// The default policy: allows every URL that passes the built-in ``URLBaseline`` checks,
/// unchanged.
///
/// ```swift
/// // Same as leaving `urlSecurityPolicy` unset, but also allows SVG data URLs.
/// let processor = MessageProcessor(
///   catalogs: [catalog],
///   urlSecurityPolicy: PermissiveURLSecurityPolicy(allowSVGDataURLs: true)
/// )
/// ```
public struct PermissiveURLSecurityPolicy: URLSecurityPolicy {
  public let allowSVGDataURLs: Bool
  public let urlProperties: URLPropertyMap?

  /// Creates a permissive policy.
  ///
  /// - Parameters:
  ///   - allowSVGDataURLs: Whether `data:image/svg+xml` URLs are allowed as media.
  ///   - urlProperties: URL properties of catalogs the host can't annotate.
  public init(allowSVGDataURLs: Bool = false, urlProperties: URLPropertyMap? = nil) {
    self.allowSVGDataURLs = allowSVGDataURLs
    self.urlProperties = urlProperties
  }

  public func sanitizeURL(_ url: String, context: URLContext, info: URLCheckInfo?) -> String? {
    URLBaseline.check(url, context: context, allowSVGDataURLs: allowSVGDataURLs)
  }
}
