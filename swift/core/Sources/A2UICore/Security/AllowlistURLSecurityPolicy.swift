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

/// Rewrites a URL an ``AllowlistURLSecurityPolicy`` allowed, for example to route it through a
/// proxy. Returns the URL to use, or `nil` to block it.
public typealias URLRewriteHook = @Sendable (String, URLContext, URLCheckInfo?) -> String?

/// A policy that limits each URL context to a list of hosts.
///
/// Host entries are exact hosts (`cdn.example.com`) or subdomain wildcards (`*.example.com`,
/// which matches `a.example.com` and `a.b.example.com` but not `example.com`), compared without
/// regard to case. An entry with a port (`localhost:8080`) matches only that port; one without
/// matches any port.
///
/// A context without a list keeps the baseline checks only. Once a context has a list, an
/// `http(s)` URL passes only if its host matches an entry (an empty list matches nothing), and
/// relative URLs are blocked unless the context is in `allowRelative`. URLs without a host
/// (`data:` media, `mailto:` and `tel:` links) make no request to a server, so the lists don't
/// apply to them; the baseline still limits them to their contexts.
///
/// A rewrite hook runs after the host check, and the baseline checks what it returns again.
///
/// ```swift
/// let policy = try AllowlistURLSecurityPolicy(
///   media: ["cdn.example.com", "*.googleusercontent.com"],
///   navigation: ["*.example.com"],
///   rewrite: [
///     .media: { url, _, _ in
///       let encoded = url.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? url
///       return "https://proxy.example.com/?u=\(encoded)"
///     }
///   ]
/// )
/// ```
public struct AllowlistURLSecurityPolicy: URLSecurityPolicy {
  public let allowSVGDataURLs: Bool
  public let urlProperties: URLPropertyMap?
  private let hostLists: [URLContext: [AllowlistHostEntry]]
  private let allowRelative: Set<URLContext>
  private let rewrite: [URLContext: URLRewriteHook]

  /// Creates an allowlist policy.
  ///
  /// - Parameters:
  ///   - media: Hosts that media URLs may point to. `nil` keeps media at the baseline checks; an
  ///     empty list blocks every `http(s)` media URL.
  ///   - navigation: Hosts that navigation URLs may point to.
  ///   - iframe: Hosts that iframe URLs may point to.
  ///   - allowRelative: Contexts that keep allowing relative URLs even though they have a list.
  ///   - rewrite: Hooks that rewrite allowed URLs, per context.
  ///   - allowSVGDataURLs: Whether `data:image/svg+xml` URLs are allowed as media.
  ///   - urlProperties: URL properties of catalogs the host can't annotate.
  /// - Throws: `A2UIValidationError` if an entry is not a host, a host with a port, or a `*.`
  ///   wildcard.
  public init(
    media: [String]? = nil,
    navigation: [String]? = nil,
    iframe: [String]? = nil,
    allowRelative: Set<URLContext> = [],
    rewrite: [URLContext: URLRewriteHook] = [:],
    allowSVGDataURLs: Bool = false,
    urlProperties: URLPropertyMap? = nil
  ) throws {
    var hostLists: [URLContext: [AllowlistHostEntry]] = [:]
    let lists: [(URLContext, [String]?)] = [
      (.media, media), (.navigation, navigation), (.iframe, iframe),
    ]
    for (context, hosts) in lists {
      guard let hosts else { continue }
      hostLists[context] = try hosts.map { entry -> AllowlistHostEntry in
        guard let parsed = AllowlistHostEntry(entry) else {
          throw A2UIValidationError(
            "Invalid \(context.rawValue) host entry '\(entry)': use a host such as "
              + "'cdn.example.com', a host with a port, or a subdomain wildcard such as "
              + "'*.example.com'."
          )
        }
        return parsed
      }
    }
    self.hostLists = hostLists
    self.allowRelative = allowRelative
    self.rewrite = rewrite
    self.allowSVGDataURLs = allowSVGDataURLs
    self.urlProperties = urlProperties
  }

  public func sanitizeURL(_ url: String, context: URLContext, info: URLCheckInfo?) -> String? {
    guard
      let kind = URLBaseline.classify(url, context: context, allowSVGDataURLs: allowSVGDataURLs)
    else {
      return nil
    }
    if let entries = hostLists[context] {
      switch kind {
      case .relative:
        guard allowRelative.contains(context) else { return nil }
      case .http:
        guard let authority = HTTPAuthority(url), entries.contains(where: { $0.matches(authority) })
        else {
          return nil
        }
      case .data, .mailto, .tel:
        break
      }
    }
    guard let hook = rewrite[context] else { return url }
    return hook(url, context, info)
  }
}
