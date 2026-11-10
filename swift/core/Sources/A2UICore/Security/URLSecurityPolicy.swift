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

/// URL properties of catalogs that a host can't annotate itself, keyed by catalog identifier,
/// then component type, then property name.
///
/// ```swift
/// let urlProperties: URLPropertyMap = [
///   "https://maps.example.com/catalog.json": ["MapTile": ["tileUrl": .media]]
/// ]
/// ```
public typealias URLPropertyMap = [String: [String: [String: URLContextAnnotation]]]

/// Decides which URLs a renderer may load, open, or embed.
///
/// Pass one to ``MessageProcessor`` as its `urlSecurityPolicy`; every surface it creates uses it.
/// Every URL a policy sees has already passed the built-in baseline checks (see
/// ``URLBaseline``), and whatever it returns is checked by the baseline again, so a policy can
/// only narrow or rewrite what the baseline allows.
///
/// The SDK provides ``PermissiveURLSecurityPolicy``, the default, and
/// ``AllowlistURLSecurityPolicy``.
public protocol URLSecurityPolicy: Sendable {
  /// Returns the URL to use, possibly rewritten (for example through a media proxy), or `nil` to
  /// block it.
  ///
  /// - Parameters:
  ///   - url: The URL, exactly as the agent or data model gave it.
  ///   - context: How the renderer uses the URL.
  ///   - info: Where the URL comes from, when known.
  /// - Returns: The URL to use, or `nil` when it is blocked.
  func sanitizeURL(_ url: String, context: URLContext, info: URLCheckInfo?) -> String?

  /// Whether `data:image/svg+xml` URLs are allowed as ``URLContext/media``. The baseline blocks
  /// them unless the policy opts in. Defaults to `false`.
  var allowSVGDataURLs: Bool { get }

  /// URL properties of catalogs the host can't annotate. An entry here wins over a catalog's own
  /// `x-a2ui-url-context` annotation. Defaults to `nil`.
  var urlProperties: URLPropertyMap? { get }
}

extension URLSecurityPolicy {
  public var allowSVGDataURLs: Bool { false }

  public var urlProperties: URLPropertyMap? { nil }
}
