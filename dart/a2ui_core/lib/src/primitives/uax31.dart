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

/// Identifiers permitted by the v1.0 specification, per UAX #31.
///
/// The pattern matches `specification/v1_0/json/common_types.json`, which uses
/// `XID_Start` and `XID_Continue` rather than the unprefixed `ID_Start` and
/// `ID_Continue`. An initial `_` is also accepted to match TypeScript's
/// `UAX31_IDENTIFIER` and Python's `str.isidentifier()`.
final RegExp _uax31Identifier = RegExp(
  r'^[\p{XID_Start}_]\p{XID_Continue}*$',
  unicode: true,
);

/// Checks whether [value] is a valid A2UI UAX #31 identifier.
///
/// When [allowLeadingAt] is `true`, a single leading `@` is permitted and
/// stripped before matching, accommodating reserved system-function prefixes
/// such as `@index`. Only one leading `@` is allowed, so `@@index` and a bare
/// `@` are rejected.
bool isValidUax31Identifier(String value, {bool allowLeadingAt = false}) {
  if (value.isEmpty) return false;
  final String candidate =
      allowLeadingAt && value.startsWith('@') ? value.substring(1) : value;
  if (candidate.isEmpty) return false;
  return _uax31Identifier.hasMatch(candidate);
}

/// Asserts that [name] satisfies UAX #31 identifier rules.
///
/// Unlike TypeScript and Python, [allowLeadingAt] defaults to `false` so
/// component and property identifiers reject leading `@` unless explicitly
/// enabled for system functions (such as `@index`).
///
/// Throws an [A2uiCatalogError] when [name] is not a valid UAX #31 identifier.
void assertUax31Identifier(
  String name, {
  String context = 'Identifier',
  bool allowLeadingAt = false,
}) {
  if (!isValidUax31Identifier(name, allowLeadingAt: allowLeadingAt)) {
    final suffix = context.endsWith("'$name'") ? '' : ": '$name'";
    throw A2uiCatalogError('Invalid UAX #31 $context$suffix');
  }
}
