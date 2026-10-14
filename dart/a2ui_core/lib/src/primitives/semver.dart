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

/// Version string comparison and catalog version compatibility.
///
/// Mirrors `typescript/web_core` (`common/semver.ts` and
/// `isCatalogVersionCompatible` in `processing/adapters/base.ts`) and
/// `python/a2ui_core` (`processing/adapters/base.py`), so all three SDKs agree
/// on which catalogs can serve a message.
library;

import 'package:meta/meta.dart';

/// For each protocol version a message may declare (key), the protocol
/// versions a catalog may declare in its `protocolVersion` and still serve
/// that message (value), beyond an exact match.
///
/// Keyed and valued by canonical version (see [_canonical]). v0.9 and v0.9.1
/// share their message shapes, so each serves the other.
const Map<String, Set<String>> _catalogCompatibility = {
  '0.8': {'0.8'},
  '0.9': {'0.9', '0.9.1'},
  '0.9.1': {'0.9.1', '0.9'},
  '1.0': {'1.0'},
};

/// SemVer 2.0.0, extended with an optional leading `v` or `V` and an optional
/// patch number.
final RegExp _semverPattern = RegExp(
  r'^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?'
  r'(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)'
  r'(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?'
  r'(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$',
);

final RegExp _numericIdentifier = RegExp(r'^\d+$');

/// A parsed semantic version. Build metadata is dropped from [prerelease] and
/// kept only in [build], since it does not affect precedence.
final class _SemVer {
  const _SemVer(
      this.major, this.minor, this.patch, this.prerelease, this.build);

  final int major;
  final int minor;
  final int patch;
  final List<String> prerelease;
  final List<String> build;
}

/// [version] trimmed, without a leading `v` or `V`, and with underscores in
/// the release segment read as dots, so `'v0_9_1'` becomes `'0.9.1'`.
///
/// The pre-release and build suffixes are kept as written.
String _normalize(String version) {
  final String text = version.trim().replaceFirst(RegExp('^[vV]'), '');
  final int split = text.indexOf(RegExp('[-+]'));
  final int end = split == -1 ? text.length : split;
  return '${text.substring(0, end).replaceAll('_', '.')}${text.substring(end)}';
}

/// Parses [version] after [_normalize], or returns null when it is not a
/// semantic version.
_SemVer? _parse(String version) {
  final RegExpMatch? match = _semverPattern.firstMatch(_normalize(version));
  if (match == null) return null;
  return _SemVer(
    int.parse(match.group(1)!),
    int.parse(match.group(2)!),
    match.group(3) == null ? 0 : int.parse(match.group(3)!),
    match.group(4)?.split('.') ?? const [],
    match.group(5)?.split('.') ?? const [],
  );
}

/// The canonical spelling of [version]: `major.minor` for a plain release
/// with a zero patch (`'1.0'`), and the full version otherwise (`'0.9.1'`,
/// `'1.0.0-beta.1'`). Null when [version] is not a semantic version.
String? _canonical(String version) {
  final _SemVer? parsed = _parse(version);
  if (parsed == null) return null;
  if (parsed.patch == 0 && parsed.prerelease.isEmpty && parsed.build.isEmpty) {
    return '${parsed.major}.${parsed.minor}';
  }
  final pre =
      parsed.prerelease.isEmpty ? '' : '-${parsed.prerelease.join('.')}';
  final build = parsed.build.isEmpty ? '' : '+${parsed.build.join('.')}';
  return '${parsed.major}.${parsed.minor}.${parsed.patch}$pre$build';
}

/// Whether a catalog declaring protocol [catalogVersion] can serve messages
/// declaring [messageVersion].
///
/// Spellings are normalized first, so `'v1.0'`, `'V1.0'`, `'1.0'`, `'1.0.0'`
/// and `'v1_0'` are all the same version. Then:
///
/// - Equal versions are compatible.
/// - v0.9 and v0.9.1 are compatible with each other.
/// - From 1.0, versions with the same major number are compatible: `'1.0'`
///   serves `'1.1'`, but not `'2.0'`.
/// - Below 1.0, a minor release is a breaking release, so `'0.8'`, `'0.9'` and
///   `'0.10'` are mutually incompatible.
///
/// A string that is not a semantic version (a custom identifier such as
/// `'custom'`) matches only the same identifier, ignoring a leading `v` or
/// `V`. An empty string matches nothing.
///
/// A null [catalogVersion] is an unversioned catalog, which predates the
/// field and so is pre-v1.0: it serves any message below 1.0 and none from
/// 1.0 on. Catalogs targeting v1.0 or later must declare their version.
bool isCatalogVersionCompatible(String? catalogVersion, String messageVersion) {
  if (messageVersion.isEmpty) return false;
  if (catalogVersion == null) {
    final _SemVer? message = _parse(messageVersion);
    return message != null && message.major < 1;
  }
  if (catalogVersion.isEmpty) return false;
  final String? catalogCanonical = _canonical(catalogVersion);
  final String? messageCanonical = _canonical(messageVersion);
  if (catalogCanonical != null && messageCanonical != null) {
    if (catalogCanonical == messageCanonical) return true;
    if (_catalogCompatibility[messageCanonical]?.contains(catalogCanonical) ??
        false) {
      return true;
    }
    final _SemVer catalog = _parse(catalogVersion)!;
    final _SemVer message = _parse(messageVersion)!;
    return catalog.major >= 1 && catalog.major == message.major;
  }
  final String normalizedCatalog = _normalize(catalogVersion);
  return normalizedCatalog.isNotEmpty &&
      normalizedCatalog == _normalize(messageVersion);
}

/// Compares two version strings by SemVer 2.0.0 precedence.
///
/// Returns a negative number if [a] precedes [b], a positive number if it
/// follows it, and zero if they have equal precedence. Spellings are
/// normalized as in [isCatalogVersionCompatible], a missing patch number is
/// zero, a pre-release precedes its release, and build metadata is ignored.
///
/// A string that is not a semantic version precedes every version, and two
/// such strings compare equal.
int compareVersions(String a, String b) {
  final _SemVer? versionA = _parse(a);
  final _SemVer? versionB = _parse(b);
  if (versionA == null) return versionB == null ? 0 : -1;
  if (versionB == null) return 1;
  if (versionA.major != versionB.major) return versionA.major - versionB.major;
  if (versionA.minor != versionB.minor) return versionA.minor - versionB.minor;
  if (versionA.patch != versionB.patch) return versionA.patch - versionB.patch;
  return _comparePrerelease(versionA.prerelease, versionB.prerelease);
}

/// Whether [version] is [minimum] or later by [compareVersions] precedence.
///
/// A null [version], or one that is not a semantic version, is never at least
/// [minimum]. Spellings are normalized as in [isCatalogVersionCompatible], so
/// `isVersionAtLeast('1.0', 'v1.0')` is true.
bool isVersionAtLeast(String? version, String minimum) =>
    version != null && compareVersions(version, minimum) >= 0;

/// The release numbers of [version] as `(major, minor, patch)`, or null when
/// it is not a semantic version.
///
/// Spellings are normalized as in [isCatalogVersionCompatible], a missing
/// patch number is zero, and pre-release and build suffixes are dropped, so
/// `'v1.0'`, `'1.0.0'` and `'1.0.0-rc.1'` all give `(1, 0, 0)`.
@internal
(int major, int minor, int patch)? releaseNumbers(String version) {
  final _SemVer? parsed = _parse(version);
  if (parsed == null) return null;
  return (parsed.major, parsed.minor, parsed.patch);
}

/// Compares pre-release identifier lists (SemVer 2.0.0 rules 11.3 and 11.4).
int _comparePrerelease(List<String> a, List<String> b) {
  if (a.isEmpty || b.isEmpty) {
    // A release outranks any of its pre-releases.
    return (a.isEmpty ? 1 : 0) - (b.isEmpty ? 1 : 0);
  }
  final int shared = a.length < b.length ? a.length : b.length;
  for (var i = 0; i < shared; i++) {
    final int diff = _comparePrereleaseIdentifier(a[i], b[i]);
    if (diff != 0) return diff;
  }
  return a.length - b.length;
}

/// Compares one pre-release identifier pair: numeric identifiers compare
/// numerically and precede alphanumeric ones, which compare in ASCII order.
int _comparePrereleaseIdentifier(String a, String b) {
  final bool numericA = _numericIdentifier.hasMatch(a);
  final bool numericB = _numericIdentifier.hasMatch(b);
  if (numericA && numericB) {
    // Numeric identifiers have no leading zeros, so the longer one is larger.
    if (a.length != b.length) return a.length - b.length;
    return a.compareTo(b);
  }
  if (numericA) return -1;
  if (numericB) return 1;
  return a.compareTo(b);
}
