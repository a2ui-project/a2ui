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

import '../core/catalog.dart';
import '../core/messages.dart';
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';

/// Validates A2UI payloads against the protocol schemas and a set of catalogs.
///
/// Lives in `a2ui_core` because renderers and agents validate the same
/// payloads against the same catalogs. Implements v0.9 only: [checkVersion]
/// and [parseMessages] reject any other version, or none.
///
/// The deep checks ([validateStructure], [validateAgainstCatalogs]) are not
/// implemented yet and throw [UnimplementedError], as does [validate].
class A2uiValidator<C extends ComponentApi, F extends FunctionApi> {
  /// The catalogs payloads are validated against, keyed by catalog id.
  final Map<String, Catalog<C, F>> catalogs;

  /// The protocol version this validator accepts.
  final A2uiProtocolVersion protocolVersion;

  A2uiValidator({
    List<Catalog<C, F>> catalogs = const [],
    this.protocolVersion = A2uiProtocolVersion.v0_9,
  }) : catalogs = {for (final Catalog<C, F> c in catalogs) c.id: c};

  /// Creates a validator for [version].
  ///
  /// Throws [A2uiValidationError] for any version this SDK does not
  /// implement.
  factory A2uiValidator.forVersion(
    Object? version, {
    List<Catalog<C, F>> catalogs = const [],
  }) => A2uiValidator<C, F>(
    catalogs: catalogs,
    protocolVersion: A2uiProtocolVersion.fromJson(version),
  );

  /// Checks the `version` field of one payload envelope.
  ///
  /// Throws [A2uiValidationError] if it is missing or is not the version this
  /// validator accepts.
  A2uiProtocolVersion checkVersion(Map<String, Object?> envelope) {
    final A2uiProtocolVersion version = A2uiProtocolVersion.fromJson(
      envelope['version'],
      details: envelope,
    );
    if (version != protocolVersion) {
      throw A2uiValidationError(
        "Payload declares version '${version.jsonValue}' but this validator "
        "accepts only '${protocolVersion.jsonValue}'.",
        details: envelope,
      );
    }
    return version;
  }

  /// Parses payload envelopes into typed messages.
  ///
  /// Throws [A2uiValidationError] for any envelope that is not a well-formed
  /// message of the accepted version.
  List<A2uiMessage> parseMessages(List<Map<String, Object?>> payload) {
    final messages = <A2uiMessage>[];
    for (final envelope in payload) {
      checkVersion(envelope);
      messages.add(A2uiMessage.fromJson(Map<String, dynamic>.from(envelope)));
    }
    return messages;
  }

  /// Checks that a message sequence forms a valid component graph: unique
  /// ids, reachability, no dangling references, no cycles, depth within cap.
  ///
  /// Throws [A2uiIntegrityError] for graph defects and [A2uiRecursionError]
  /// for cycles and depth overruns.
  void validateStructure(List<A2uiMessage> messages) {
    throw UnimplementedError('A2uiValidator.validateStructure');
  }

  /// Checks each component and function call against its surface's catalog.
  ///
  /// Throws [A2uiCatalogError] if a message names a catalog this validator
  /// does not hold, and [A2uiValidationError] for schema violations.
  Future<void> validateAgainstCatalogs(List<A2uiMessage> messages) {
    throw UnimplementedError('A2uiValidator.validateAgainstCatalogs');
  }

  /// Validates a complete payload: envelopes, then structure, then catalog
  /// schemas.
  ///
  /// Returns the parsed messages, and throws as the individual steps do.
  Future<List<A2uiMessage>> validate(List<Map<String, Object?>> payload) async {
    final List<A2uiMessage> messages = parseMessages(payload);
    validateStructure(messages);
    await validateAgainstCatalogs(messages);
    return messages;
  }
}
