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

/// The URL security policy contract, the built-in baseline checks every
/// policy runs, and the default permissive policy.
library;

import 'dart:async';

/// How a renderer uses a URL, which decides the rules it is checked against.
enum UrlContext {
  /// Loaded automatically without a click, such as an image, video, or audio
  /// source.
  media('media'),

  /// Opened when the user acts, such as a link or `openUrl`.
  navigation('navigation'),

  /// Embedded in a frame.
  iframe('iframe');

  const UrlContext(this.jsonValue);

  /// The context as catalogs write it in `x-a2ui-url-context`.
  final String jsonValue;

  /// The context whose [jsonValue] is [value], or null for any other value,
  /// including `'none'`.
  static UrlContext? tryParse(Object? value) {
    for (final UrlContext context in values) {
      if (context.jsonValue == value) return context;
    }
    return null;
  }
}

/// Details about where a URL comes from, for logging and per-component
/// rules.
///
/// Contexts fill in what they know: `ComponentContext.sanitizeUrl` adds the
/// catalog, component type, and component ID, the surface adds its ID, and
/// the resolver adds the property name.
class UrlCheckInfo {
  /// Creates check details. Every field is optional.
  const UrlCheckInfo({
    this.surfaceId,
    this.catalogId,
    this.componentType,
    this.componentId,
    this.propertyName,
    this.functionName,
  });

  /// Identifier of the surface the URL appears on.
  final String? surfaceId;

  /// Identifier of the catalog of the component or function using the URL.
  final String? catalogId;

  /// Type of the component using the URL, such as `'Image'`.
  final String? componentType;

  /// Identifier of the component instance using the URL.
  final String? componentId;

  /// Name of the property holding the URL. Nested properties are written as
  /// a path, with `[]` for list items, such as `'items[].imageUrl'`.
  final String? propertyName;

  /// Name of the function using the URL, such as `'openUrl'`.
  final String? functionName;

  /// These details, with each field of [other] that is set taking the place
  /// of the field here.
  UrlCheckInfo merge(UrlCheckInfo? other) => other == null
      ? this
      : UrlCheckInfo(
          surfaceId: other.surfaceId ?? surfaceId,
          catalogId: other.catalogId ?? catalogId,
          componentType: other.componentType ?? componentType,
          componentId: other.componentId ?? componentId,
          propertyName: other.propertyName ?? propertyName,
          functionName: other.functionName ?? functionName,
        );

  /// The fields that are set, keyed by name.
  Map<String, Object?> toJson() => {
        if (surfaceId != null) 'surfaceId': surfaceId,
        if (catalogId != null) 'catalogId': catalogId,
        if (componentType != null) 'componentType': componentType,
        if (componentId != null) 'componentId': componentId,
        if (propertyName != null) 'propertyName': propertyName,
        if (functionName != null) 'functionName': functionName,
      };

  @override
  String toString() => 'UrlCheckInfo(${toJson()})';
}

/// URL properties of catalogs that a host can't annotate itself, keyed by
/// catalog ID, then component type, then property name.
///
/// A null context states that a property is not a URL, as
/// `"x-a2ui-url-context": "none"` does in a catalog.
///
/// ```dart
/// const UrlPropertyMap urlProperties = {
///   'https://maps.example.com/catalog.json': {
///     'MapTile': {'tileUrl': UrlContext.media},
///   },
/// };
/// ```
typedef UrlPropertyMap = Map<String, Map<String, Map<String, UrlContext?>>>;

/// Checks a URL a component or function is about to load, open, or embed,
/// and returns the URL to use, or null when it is blocked.
typedef UrlSanitizer = String? Function(
  String url,
  UrlContext context, {
  UrlCheckInfo? info,
});

/// Opens [url] on behalf of the basic catalog's `openUrl` function.
///
/// It only receives URLs the URL security policy allowed (and possibly
/// rewrote) as `navigation`, so it is for presentation, such as a
/// confirmation dialog or an in-app browser, not for security decisions. A
/// relative URL is passed as the policy returned it. A returned future is
/// passed back to the caller, which may await it.
typedef OpenUrlCallback = FutureOr<void> Function(Uri url);

/// Decides which URLs a renderer may load, open, or embed.
///
/// Set one with `MessageProcessor`'s `urlSecurityPolicy`. Every URL a policy
/// sees has already passed the built-in baseline checks, and whatever it
/// returns is checked by the baseline again, so a policy can only narrow or
/// rewrite what the baseline allows. A policy that throws blocks the URL.
///
/// Implement [sanitizeUrl], or use [PermissiveUrlSecurityPolicy] (the
/// default) or `AllowlistUrlSecurityPolicy`.
abstract class UrlSecurityPolicy {
  /// Const constructor for subclasses.
  const UrlSecurityPolicy();

  /// Returns the URL to use, possibly rewritten (for example through a media
  /// proxy), or null to block it.
  ///
  /// [url] is exactly as the agent or data model gave it, [context] says how
  /// the renderer uses it, and [info] says where it comes from, when known.
  String? sanitizeUrl(String url, UrlContext context, {UrlCheckInfo? info});

  /// Whether `data:image/svg+xml` URLs are allowed as `media`. The baseline
  /// blocks them unless the policy opts in. False by default.
  bool get allowSvgDataUrls => false;

  /// URL properties of catalogs the host can't annotate. An entry here wins
  /// over a catalog's own `x-a2ui-url-context` annotation. Null by default.
  UrlPropertyMap? get urlProperties => null;
}

/// The default policy: allows every URL that passes the built-in baseline
/// checks, unchanged.
///
/// ```dart
/// // Same as leaving urlSecurityPolicy unset, but also allows SVG data URLs.
/// MessageProcessor(
///   catalogs: [BasicCatalog.v1_0()],
///   urlSecurityPolicy: const PermissiveUrlSecurityPolicy(
///     allowSvgDataUrls: true,
///   ),
/// );
/// ```
class PermissiveUrlSecurityPolicy extends UrlSecurityPolicy {
  /// Creates a permissive policy, optionally allowing SVG data URLs as
  /// `media` and listing URL properties of catalogs the host can't edit.
  const PermissiveUrlSecurityPolicy({
    this.allowSvgDataUrls = false,
    this.urlProperties,
  });

  @override
  final bool allowSvgDataUrls;

  @override
  final UrlPropertyMap? urlProperties;

  @override
  String? sanitizeUrl(String url, UrlContext context, {UrlCheckInfo? info}) =>
      checkUrlBaseline(url, context, allowSvgDataUrls: allowSvgDataUrls);
}

/// The policy used where none is configured.
///
/// Package-internal.
const UrlSecurityPolicy defaultUrlSecurityPolicy =
    PermissiveUrlSecurityPolicy();

/// The scheme-level kind of a URL that passed the baseline checks.
///
/// Package-internal.
enum BaselineUrlKind { http, relative, data, mailto, tel }

// Control characters, spaces, DEL, and backslashes. URL parsers strip or
// ignore some of them and browsers treat backslashes as path separators,
// either of which can hide a different host from a check.
final RegExp _unsafeCharacters = RegExp(r'[\x00-\x20\x7f\\]');
final RegExp _scheme = RegExp(r'^([a-zA-Z][a-zA-Z0-9+.-]*):');
// `https://` followed by a host, not by another slash (which a WHATWG URL
// parser would skip, turning `https:///evil.example` into a host).
final RegExp _httpWithAuthority =
    RegExp(r'^https?://[^/?#]', caseSensitive: false);
final RegExp _mediaDataUrl = RegExp(
  r'^data:(?:image|audio|video)/[a-z0-9!#$&^_.+-]+[;,]',
  caseSensitive: false,
);
final RegExp _svgDataUrl =
    RegExp(r'^data:image/svg\+xml[;,]', caseSensitive: false);
final RegExp _dataMediaType = RegExp(
  r'^data:([a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+)',
  caseSensitive: false,
);

/// Runs the built-in baseline checks every URL passes before and after a
/// policy, whatever the policy is, and returns the kind of URL, or null when
/// the baseline rejects it.
///
/// 1. Control characters, spaces, and backslashes are rejected anywhere in
///    the URL, including at its ends.
/// 2. `http:` and `https:` URLs need `//` and a host (`https:evil.example`
///    and protocol-relative `//evil.example` are rejected).
/// 3. `data:` URLs are allowed only as `media`, only with an `image/*`,
///    `audio/*`, or `video/*` type, and not as `data:image/svg+xml` unless
///    [allowSvgDataUrls] is set.
/// 4. `mailto:` and `tel:` are allowed only as `navigation`.
/// 5. Relative URLs are allowed as `media` and `navigation`, not as
///    `iframe`.
/// 6. Every other scheme (`javascript:`, `file:`, `blob:`, and so on) is
///    rejected.
///
/// Package-internal.
BaselineUrlKind? classifyBaselineUrl(
  Object? url,
  UrlContext context, {
  bool allowSvgDataUrls = false,
}) {
  if (url is! String || url.isEmpty || _unsafeCharacters.hasMatch(url)) {
    return null;
  }
  final String? scheme = _scheme.firstMatch(url)?.group(1)?.toLowerCase();
  if (scheme == null) {
    if (url.startsWith('//')) return null;
    return context == UrlContext.iframe ? null : BaselineUrlKind.relative;
  }
  switch (scheme) {
    case 'http':
    case 'https':
      return _httpWithAuthority.hasMatch(url) && parseUrlHost(url) != null
          ? BaselineUrlKind.http
          : null;
    case 'data':
      if (context != UrlContext.media || !_mediaDataUrl.hasMatch(url)) {
        return null;
      }
      return _svgDataUrl.hasMatch(url) && !allowSvgDataUrls
          ? null
          : BaselineUrlKind.data;
    case 'mailto':
      return context == UrlContext.navigation ? BaselineUrlKind.mailto : null;
    case 'tel':
      return context == UrlContext.navigation ? BaselineUrlKind.tel : null;
    default:
      return null;
  }
}

/// Returns [url] if it passes the baseline checks of [classifyBaselineUrl],
/// or null if it does not.
///
/// Package-internal.
String? checkUrlBaseline(
  Object? url,
  UrlContext context, {
  bool allowSvgDataUrls = false,
}) =>
    classifyBaselineUrl(url, context, allowSvgDataUrls: allowSvgDataUrls) ==
            null
        ? null
        : url! as String;

/// The parsed URL of an absolute `http(s)` [url] with a non-empty host, or
/// null when it can't be parsed or has no host.
///
/// Package-internal.
Uri? parseUrlHost(String url) {
  final Uri? parsed = Uri.tryParse(url);
  if (parsed == null || parsed.host.isEmpty) return null;
  return parsed;
}

/// Checks [url] with the baseline, then [policy], then the baseline again
/// on what the policy returned. A policy that throws blocks the URL.
///
/// Package-internal; components and functions call `sanitizeUrl` on the
/// context they receive instead.
String? applyUrlSecurityPolicy(
  UrlSecurityPolicy policy,
  Object? url,
  UrlContext context, {
  UrlCheckInfo? info,
}) {
  final bool allowSvg = policy.allowSvgDataUrls;
  if (checkUrlBaseline(url, context, allowSvgDataUrls: allowSvg) == null) {
    return null;
  }
  final String? result;
  try {
    result = policy.sanitizeUrl(url! as String, context, info: info);
  } catch (_) {
    return null;
  }
  if (result == null) return null;
  return result == url
      ? result
      : checkUrlBaseline(result, context, allowSvgDataUrls: allowSvg);
}

/// Returns a form of [url] that is safe to log: `scheme://host[:port]` for a
/// URL with a host, `data:<media type>` for a `data:` URL, `relative` for a
/// relative URL, and `<scheme>:` otherwise. The path, query, fragment, user
/// info, and `data:` payload, any of which may carry exfiltrated data, are
/// dropped.
///
/// Package-internal.
String redactUrl(String url) {
  final String? scheme = _scheme.firstMatch(url)?.group(1)?.toLowerCase();
  if (scheme == null) return 'relative';
  if (scheme == 'data') {
    final String? mediaType = _dataMediaType.firstMatch(url)?.group(1);
    return mediaType == null ? 'data:' : 'data:${mediaType.toLowerCase()}';
  }
  // Without `//` (as in `https:evil.example`) the baseline treats a URL as
  // having no host.
  if ((scheme == 'http' || scheme == 'https') &&
      _httpWithAuthority.hasMatch(url) &&
      !_unsafeCharacters.hasMatch(url)) {
    final Uri? parsed = parseUrlHost(url);
    if (parsed != null) {
      return parsed.hasPort
          ? '$scheme://${parsed.host}:${parsed.port}'
          : '$scheme://${parsed.host}';
    }
  }
  return '$scheme:';
}
