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

import 'dart:convert';

import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:meta/meta.dart';

import '../core/catalog.dart';
import '../core/messages.dart';
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import 'common_types.g.dart';
import 'component_refs.dart';
import 'schema_resolution.dart';

/// Checks one component, one function call, or one theme against one catalog.
///
/// Lives in `a2ui_core` because renderers and agents check the same payloads
/// against the same catalogs. Implements v0.9 only: [checkVersion] and
/// [parseMessages] reject any other version, or none.
///
/// A validator is scoped to a single [catalog], and validates a single item
/// against it. It deliberately does not walk a payload: from v1.0 a surface
/// may mix catalogs, because a component and a function call each carry an
/// optional `catalogId` that overrides the surface-level default. Deciding
/// which catalog an item belongs to is therefore a per-item question that only
/// something holding every supported catalog can answer, which is
/// `MessageProcessor`. It resolves the catalog for each item and calls the
/// validator for it, so a payload spanning several catalogs is checked
/// item by item rather than rejected.
///
/// Both sides, agent and renderer, reach it through `MessageProcessor`:
/// `MessageProcessor.validatePayload` checks a payload on its own, which is
/// what an agent has before it sends anything, and
/// `MessageProcessor.processMessages` checks each message against the surface
/// state it holds.
///
/// Every entry point is synchronous. Component schemas reach the validator
/// with their references already inlined by `resolveSchemaRefs`, so schema
/// validation runs through `Schema.validateSync` and never performs I/O. A
/// caller can therefore validate inside a synchronous message-processing path.
class PayloadValidator<C extends ComponentApi, F extends FunctionApi> {
  /// The catalog items are validated against.
  ///
  /// Every component, function call and theme this validator is given is
  /// checked against this catalog. Routing an item to the validator for its
  /// own catalog is the caller's job; see the class comment.
  final Catalog<C, F> catalog;

  /// The protocol version this validator accepts.
  final A2uiProtocolVersion protocolVersion;

  /// The shared `common_types.json` definitions this validator resolves
  /// against.
  ///
  /// Catalogs reference this document for `ChildList`, `DynamicString` and
  /// the other shared types, so [validateComponent] needs it to check them. It
  /// defaults to [commonTypesFor] of [protocolVersion], the copy this package
  /// publishes; pass a different document to override it, or an empty map to
  /// leave the shared types unchecked.
  final Map<String, Object?> commonTypesSchema;

  /// Child-referencing properties of [catalog], derived on first use.
  Map<String, ComponentRefFields>? _refFields;

  /// [catalog]'s component schemas with their `$ref`s inlined, on first use.
  Map<String, Schema>? _resolvedComponents;

  /// [catalog]'s function argument schemas with their `$ref`s inlined, on
  /// first use.
  Map<String, Schema>? _resolvedFunctions;

  PayloadValidator({
    required this.catalog,
    required this.protocolVersion,
    Map<String, Object?>? commonTypesSchema,
  }) : commonTypesSchema = commonTypesSchema ?? commonTypesFor(protocolVersion);

  /// The `common_types.json` document this package publishes for [version].
  ///
  /// A copy of `specification/<version>/json/common_types.json`, embedded at
  /// build time by `tool/generate_common_types.dart` so that a package
  /// installed from pub.dev can resolve the shared types without reading the
  /// specification repository. Each call returns a fresh document, so a caller
  /// may edit the result.
  static Map<String, Object?> commonTypesFor(A2uiProtocolVersion version) =>
      switch (version) {
        A2uiProtocolVersion.v0_9 =>
          jsonDecode(commonTypesV0_9Json) as Map<String, Object?>,
      };

  /// Creates a validator for [version].
  ///
  /// Throws [A2uiValidationError] for any version this SDK does not
  /// implement.
  factory PayloadValidator.forVersion(
    Object? version, {
    required Catalog<C, F> catalog,
    Map<String, Object?>? commonTypesSchema,
  }) => PayloadValidator<C, F>(
    catalog: catalog,
    commonTypesSchema: commonTypesSchema,
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

  /// Parses payload envelopes into typed messages, without a catalog.
  ///
  /// An envelope declares its protocol version and exactly one update type;
  /// neither depends on a catalog. A caller therefore parses a payload before
  /// it knows which surface, and so which catalog, each message belongs to,
  /// which is what lets `MessageProcessor` route messages afterwards.
  ///
  /// Static for that reason: parsing needs no catalog, so it needs no
  /// validator.
  ///
  /// Throws [A2uiValidationError] for any envelope that is not a well-formed
  /// message of [protocolVersion], including one carrying more than a single
  /// update type.
  static List<A2uiMessage> parseMessages(
    List<Map<String, Object?>> payload, {
    required A2uiProtocolVersion protocolVersion,
  }) {
    final messages = <A2uiMessage>[];
    for (final envelope in payload) {
      final A2uiProtocolVersion version = A2uiProtocolVersion.fromJson(
        envelope['version'],
        details: envelope,
      );
      if (version != protocolVersion) {
        throw A2uiValidationError(
          "Payload declares version '${version.jsonValue}' but this SDK "
          "accepts only '${protocolVersion.jsonValue}'.",
          details: envelope,
        );
      }
      messages.add(A2uiMessage.fromJson(Map<String, dynamic>.from(envelope)));
    }
    return messages;
  }

  /// Checks one component against [catalog]'s schema for its type.
  ///
  /// The caller decides which catalog the component belongs to; this checks it
  /// against the one catalog this validator holds.
  ///
  /// Throws [A2uiValidationError] if the component names no type, names one
  /// the catalog does not declare, or does not match its schema.
  void validateComponent(Map<String, Object?> component) {
    final Object? type = component['component'];
    if (type is! String) {
      throw A2uiValidationError(
        "Component '${component['id']}' does not name a component type.",
        details: component,
      );
    }
    final Schema? schema = _resolvedComponentSchemas[type];
    if (schema == null) {
      throw A2uiValidationError(
        "Catalog '${catalog.id}' declares no component named '$type'.",
        details: component,
      );
    }

    final List<ValidationError> errors = schema.validateSync(component);
    if (errors.isNotEmpty) {
      throw A2uiValidationError(
        "Component '${component['id']}' does not match the '$type' schema in "
        "catalog '${catalog.id}': "
        '${errors.map((e) => e.toErrorString()).join('; ')}',
        details: component,
      );
    }
  }

  /// Checks one function call's arguments against [catalog]'s schema for it.
  ///
  /// [name] is the function, [args] the arguments the call passes. As with
  /// [validateComponent], the caller decides which catalog the call belongs
  /// to: from v1.0 a call carries an optional `catalogId` of its own.
  ///
  /// Throws [A2uiValidationError] if the catalog declares no such function or
  /// the arguments do not match its schema.
  void validateFunction(String name, Map<String, Object?> args) {
    final Schema? schema = _resolvedFunctionSchemas[name];
    if (schema == null) {
      throw A2uiValidationError(
        "Catalog '${catalog.id}' declares no function named '$name'.",
        details: args,
      );
    }

    final List<ValidationError> errors = schema.validateSync(args);
    if (errors.isNotEmpty) {
      throw A2uiValidationError(
        "Call to '$name' does not match the argument schema in catalog "
        "'${catalog.id}': "
        '${errors.map((e) => e.toErrorString()).join('; ')}',
        details: args,
      );
    }
  }

  /// Checks a surface's theme against [catalog]'s theme schema.
  ///
  /// A catalog that declares no theme schema constrains nothing, so any theme
  /// passes. A null [theme] is the surface declaring none, which is always
  /// allowed.
  ///
  /// Throws [A2uiValidationError] if the theme does not match the schema.
  void validateTheme(Map<String, Object?>? theme) {
    final Schema? schema = catalog.themeSchema;
    if (schema == null || theme == null) return;

    final List<ValidationError> errors = schema.validateSync(theme);
    if (errors.isNotEmpty) {
      throw A2uiValidationError(
        "Theme does not match the theme schema in catalog '${catalog.id}': "
        '${errors.map((e) => e.toErrorString()).join('; ')}',
        details: theme,
      );
    }
  }

  /// Which properties of [catalog]'s components hold child references.
  ///
  /// Graph checks span a whole surface, and from v1.0 a surface may hold
  /// components from several catalogs, so the walk itself belongs to
  /// `MessageProcessor`, which merges this map across the catalogs a surface
  /// draws on. Derived on first use and cached.
  @internal
  Map<String, ComponentRefFields> get componentRefFields =>
      _refFields ??= extractComponentRefFields(catalog);

  Map<String, Schema> get _resolvedComponentSchemas => _resolvedComponents ??= {
    for (final MapEntry<String, C> entry in catalog.components.entries)
      entry.key: _resolve(entry.value.schema),
  };

  Map<String, Schema> get _resolvedFunctionSchemas => _resolvedFunctions ??= {
    for (final MapEntry<String, F> entry in catalog.functions.entries)
      entry.key: _resolve(entry.value.argumentSchema),
  };

  Schema _resolve(Schema schema) => Schema.fromMap(
    resolveSchemaRefs(
      schema.value,
      catalog.catalogSchema,
      commonTypes: commonTypesSchema,
    ),
  );
}
