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

import 'errors.dart';
import 'semver.dart';

/// A version of the A2UI protocol.
///
/// This SDK implements v0.9, v0.9.1 and v1.0. [fromJson] rejects any other
/// version, and a payload that omits the version.
///
/// Versions are ordered by release, so [compareTo] and [isAtLeast] gate
/// behavior on a minimum version.
enum A2uiProtocolVersion implements Comparable<A2uiProtocolVersion> {
  /// Version 0.9.
  v0_9('v0.9', 0, 9, 0),

  /// Version 0.9.1, which shares the v0.9 message shapes.
  v0_9_1('v0.9.1', 0, 9, 1),

  /// Version 1.0.
  v1_0('v1.0', 1, 0, 0);

  const A2uiProtocolVersion(
      this.jsonValue, this.major, this.minor, this._patch);

  /// The value used for the `version` field on the wire.
  final String jsonValue;

  /// The bare semantic version, such as `'1.0'`: the spelling a catalog
  /// document uses for its `protocolVersion`.
  String get semverValue => jsonValue.substring(1);

  /// The major version number: 0 for v0.9 and v0.9.1, 1 for v1.0.
  final int major;

  /// The minor version number: 9 for v0.9 and v0.9.1, 0 for v1.0.
  final int minor;

  final int _patch;

  /// Compares release order: negative if this version precedes [other],
  /// positive if it follows it, and zero if they are the same version.
  @override
  int compareTo(A2uiProtocolVersion other) {
    if (major != other.major) return major - other.major;
    if (minor != other.minor) return minor - other.minor;
    return _patch - other._patch;
  }

  /// Whether this version is [other] or a later release.
  bool isAtLeast(A2uiProtocolVersion other) => compareTo(other) >= 0;

  /// Parses the `version` field of an A2UI payload.
  ///
  /// Throws [A2uiValidationError] if [value] is absent, is not a string, or
  /// names a version this SDK does not implement.
  static A2uiProtocolVersion fromJson(Object? value, {Object? details}) {
    if (value == null) {
      throw A2uiValidationError(
        "A2UI payloads must declare a 'version' field; this SDK supports "
        'only $supportedVersions.',
        details: details,
      );
    }
    if (value is! String) {
      throw A2uiValidationError(
        "A2UI payloads must have a string 'version' field (got "
        '${value.runtimeType}).',
        details: details,
      );
    }
    return parse(value, details: details);
  }

  /// Parses a protocol version from its wire value, such as `'v1.0'`.
  ///
  /// Throws [A2uiValidationError] if [value] names a version this SDK does
  /// not implement. [details] is attached to the error.
  static A2uiProtocolVersion parse(String value, {Object? details}) {
    final A2uiProtocolVersion? version = tryParse(value);
    if (version != null) return version;
    throw A2uiValidationError(
      "Unsupported A2UI protocol version '$value'; this SDK supports only "
      '$supportedVersions.',
      details: details,
    );
  }

  /// Parses a protocol version from its wire value, returning null when
  /// [value] names one this SDK does not implement.
  ///
  /// Only the exact wire value matches: `'v0.9.1'` is [v0_9_1], and spellings
  /// the envelope schemas reject, such as `'0.9'` or `'v1_0'`, are not
  /// versions. For a version that must be present and supported, use
  /// [fromJson] or [parse], which report why it was rejected.
  static A2uiProtocolVersion? tryParse(String value) {
    for (final A2uiProtocolVersion version in values) {
      if (version.jsonValue == value) return version;
    }
    return null;
  }

  /// Parses a protocol version from a semantic version string, returning null
  /// when [value] is not one or names a version this SDK does not implement.
  ///
  /// This is the lenient reading catalog documents need: `'1.0'`, `'v1.0'`
  /// and `'1.0.0'` are all [v1_0], and a pre-release or build suffix is
  /// ignored. The wire `version` field is stricter; use [tryParse] for it.
  static A2uiProtocolVersion? tryParseSemVer(String value) {
    final (int, int, int)? numbers = releaseNumbers(value);
    if (numbers == null) return null;
    final (int major, int minor, int patch) = numbers;
    for (final A2uiProtocolVersion version in values) {
      if (version.major == major &&
          version.minor == minor &&
          version._patch == patch) {
        return version;
      }
    }
    return null;
  }

  /// The versions this SDK implements, for error messages.
  static String get supportedVersions =>
      values.map((v) => "'${v.jsonValue}'").join(', ');
}
