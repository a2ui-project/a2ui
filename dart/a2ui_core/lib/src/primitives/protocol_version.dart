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

/// A version of the A2UI protocol.
///
/// This SDK implements v0.9 only; [fromJson] rejects anything else, and a
/// payload that omits the version.
enum A2uiProtocolVersion {
  /// Version 0.9, and the schema-compatible v0.9.1, which shares its wire
  /// value.
  v0_9('v0.9');

  const A2uiProtocolVersion(this.jsonValue);

  /// The value used for the `version` field on the wire.
  final String jsonValue;

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
    final A2uiProtocolVersion? version = tryParse(value);
    if (version != null) return version;
    throw A2uiValidationError(
      "Unsupported A2UI protocol version '$value'; this SDK supports only "
      '$supportedVersions.',
      details: details,
    );
  }

  /// Parses a protocol version, returning null when [value] names one this
  /// SDK does not implement.
  ///
  /// For a version that must be present and supported, use [fromJson], which
  /// reports why it was rejected.
  static A2uiProtocolVersion? tryParse(String value) {
    for (final A2uiProtocolVersion version in values) {
      if (version.jsonValue == value) return version;
    }
    return null;
  }

  /// The versions this SDK implements, for error messages.
  static String get supportedVersions =>
      values.map((v) => "'${v.jsonValue}'").join(', ');
}
