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

import 'url_security_policy.dart';

/// Rewrites an allowed URL, for example to route it through a proxy.
/// Returns the URL to use, or null to block it.
typedef UrlRewriteHook = String? Function(
  String url,
  UrlContext context,
  UrlCheckInfo? info,
);

/// A policy that limits each URL context to a list of hosts.
///
/// Host entries are exact hosts (`cdn.example.com`) or subdomain wildcards
/// (`*.example.com`, which matches `a.example.com` and `a.b.example.com` but
/// not `example.com`), compared case-insensitively. An entry with a port
/// (`localhost:8080`) matches only that port; one without matches any port.
///
/// A context left out (null) keeps the baseline checks only; an empty list
/// blocks every `http(s)` URL in that context. Once a context has a list,
/// relative URLs are blocked for it unless the context is in
/// `allowRelative`. URLs without a host (`data:` media, `mailto:` and `tel:`
/// links) make no request to a server, so the lists don't apply to them; the
/// baseline still limits them to their contexts.
///
/// ```dart
/// MessageProcessor(
///   catalogs: [BasicCatalog.v1_0()],
///   urlSecurityPolicy: AllowlistUrlSecurityPolicy(
///     media: ['cdn.example.com', '*.googleusercontent.com'],
///     navigation: ['*.example.com'],
///     rewrite: {
///       UrlContext.media: (url, _, __) =>
///           'https://proxy.example.com/?u=${Uri.encodeComponent(url)}',
///     },
///   ),
/// );
/// ```
class AllowlistUrlSecurityPolicy extends UrlSecurityPolicy {
  /// Creates an allowlist policy from host lists per context, plus the
  /// contexts that keep relative URLs ([allowRelative]), rewrite hooks per
  /// context ([rewrite], whose output still has to pass the baseline), the
  /// SVG data URL opt-in, and URL properties of catalogs the host can't edit.
  ///
  /// Throws [ArgumentError] if a host entry is not a host, a host with a
  /// port, or a `*.` subdomain wildcard.
  AllowlistUrlSecurityPolicy({
    List<String>? media,
    List<String>? navigation,
    List<String>? iframe,
    Set<UrlContext> allowRelative = const {},
    Map<UrlContext, UrlRewriteHook> rewrite = const {},
    this.allowSvgDataUrls = false,
    this.urlProperties,
  })  : _allowRelative = Set.unmodifiable(allowRelative),
        _rewrite = Map.unmodifiable(rewrite),
        _matchers = Map.unmodifiable({
          if (media != null)
            UrlContext.media: _HostMatcher.compile(media, UrlContext.media),
          if (navigation != null)
            UrlContext.navigation: _HostMatcher.compile(
              navigation,
              UrlContext.navigation,
            ),
          if (iframe != null)
            UrlContext.iframe: _HostMatcher.compile(iframe, UrlContext.iframe),
        });

  @override
  final bool allowSvgDataUrls;

  @override
  final UrlPropertyMap? urlProperties;

  final Map<UrlContext, _HostMatcher> _matchers;
  final Set<UrlContext> _allowRelative;
  final Map<UrlContext, UrlRewriteHook> _rewrite;

  @override
  String? sanitizeUrl(String url, UrlContext context, {UrlCheckInfo? info}) {
    final BaselineUrlKind? kind = classifyBaselineUrl(
      url,
      context,
      allowSvgDataUrls: allowSvgDataUrls,
    );
    if (kind == null) return null;
    final _HostMatcher? matcher = _matchers[context];
    if (matcher != null) {
      if (kind == BaselineUrlKind.relative &&
          !_allowRelative.contains(context)) {
        return null;
      }
      if (kind == BaselineUrlKind.http && !matcher.matches(url)) return null;
    }
    final UrlRewriteHook? rewrite = _rewrite[context];
    return rewrite == null ? url : rewrite(url, context, info);
  }
}

/// The compiled host list of one context.
class _HostMatcher {
  _HostMatcher(this._exact, this._suffixes, this._withPort);

  /// Compiles [hosts], the list for [context].
  factory _HostMatcher.compile(List<String> hosts, UrlContext context) {
    final exact = <String>{};
    final suffixes = <String>[];
    var withPort = false;
    for (final entry in hosts) {
      final bool isWildcard = entry.startsWith('*.');
      final String? host = _normalizeHostEntry(
        isWildcard ? entry.substring(2) : entry,
      );
      if (host == null) {
        throw ArgumentError.value(
          entry,
          context.jsonValue,
          "Use a host such as 'cdn.example.com', a host with a port, or a "
          "subdomain wildcard such as '*.example.com'.",
        );
      }
      if (_explicitPort.hasMatch(entry)) withPort = true;
      if (isWildcard) {
        suffixes.add('.$host');
      } else {
        exact.add(host);
      }
    }
    return _HostMatcher(exact, suffixes, withPort);
  }

  /// Exact hosts.
  final Set<String> _exact;

  /// Subdomain suffixes, with a leading dot, for wildcards.
  final List<String> _suffixes;

  /// Whether an entry has a port, so the comparison also tries `host:port`.
  final bool _withPort;

  static final RegExp _invalidEntryCharacters = RegExp(r'[/?#@*\s\\]');
  static final RegExp _explicitPort = RegExp(r':(\d+)$');

  /// Normalizes a host entry the way the URL parser normalizes hosts (lower
  /// case, no trailing dot), keeping a port written out even when it is the
  /// scheme's default, or returns null if the entry is not a bare host with
  /// an optional port.
  static String? _normalizeHostEntry(String entry) {
    if (entry.isEmpty || _invalidEntryCharacters.hasMatch(entry)) return null;
    final Uri? parsed = Uri.tryParse('https://$entry');
    if (parsed == null) return null;
    final String host = _stripTrailingDot(parsed.host);
    if (host.isEmpty) return null;
    final String? port = _explicitPort.firstMatch(entry)?.group(1);
    return port == null ? host : '$host:${int.parse(port)}';
  }

  static String _stripTrailingDot(String host) =>
      host.endsWith('.') ? host.substring(0, host.length - 1) : host;

  /// Whether the host of [url], an `http(s)` URL that passed the baseline,
  /// is on the list.
  bool matches(String url) {
    final Uri? parsed = parseUrlHost(url);
    if (parsed == null) return false;
    final String host = _stripTrailingDot(parsed.host.toLowerCase());
    final candidates = [host, if (_withPort) '$host:${parsed.port}'];
    return candidates.any(
      (candidate) =>
          _exact.contains(candidate) ||
          _suffixes.any((suffix) => candidate.endsWith(suffix)),
    );
  }
}
