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

import 'package:json_schema_builder/json_schema_builder.dart';

import '../core/catalog.dart';
import '../core/messages.dart';
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import 'component_graph.dart';
import 'component_refs.dart';
import 'schema_resolution.dart';

/// Everything one surface declares across a payload.
class _SurfacePayload {
  /// Whether the payload creates the surface, making it a full render.
  bool created = false;

  /// The catalog the payload names for the surface, when it creates it.
  String? catalogId;

  /// Components declared for the surface, in the order they arrive.
  final List<Map<String, Object?>> components = [];

  /// How many `updateComponents` messages the payload sends the surface.
  int updates = 0;

  /// Whether the payload declares the whole surface in one message, so every
  /// component it declares should be reachable from the root.
  ///
  /// Once a payload revises the surface across several messages, a component
  /// left unreachable is the residue of a replacement rather than a defect:
  /// the `31_incremental-dashboard` example in the basic catalog swaps a
  /// loading placeholder out for the panel it was standing in for, and the
  /// placeholder is meant to be dropped.
  bool get isSingleRender => created && updates == 1;

  /// Where each id sits in [components].
  final Map<String, int> _positions = {};

  /// Merges one message's components in.
  ///
  /// A later message that repeats an id replaces that component rather than
  /// adding a second one: re-sending a component is how a surface is updated
  /// in place, which the `00_incremental` and `31_incremental-dashboard`
  /// examples in the basic catalog both do. Repeating an id *within* one
  /// message is a contradiction, and is caught before this merge.
  void merge(List<Map<String, Object?>> incoming) {
    updates++;
    for (final component in incoming) {
      final Object? id = component['id'];
      if (id is! String) {
        components.add(component);
        continue;
      }
      final int? at = _positions[id];
      if (at == null) {
        _positions[id] = components.length;
        components.add(component);
      } else {
        components[at] = component;
      }
    }
  }
}

/// Validates A2UI payloads against the protocol schemas and a set of catalogs.
///
/// Lives in `a2ui_core` because renderers and agents validate the same
/// payloads against the same catalogs. Implements v0.9 only: [checkVersion]
/// and [parseMessages] reject any other version, or none.
///
/// Every entry point is synchronous. Component schemas reach the validator
/// with their references already inlined by `resolveSchemaRefs`, so schema
/// validation runs through `Schema.validateSync` and never performs I/O. A
/// caller can therefore validate inside a synchronous message-processing path.
///
/// Validation runs in three stages, which [validate] performs in order:
/// [parseMessages] checks envelopes, [validateStructure] checks the component
/// graph, and [validateAgainstCatalogs] checks each component against its
/// catalog's schema.
///
/// A payload that creates a surface is a full render: it must declare a
/// component with id [rootComponentId], every reference must name a component
/// the payload declares, and every component must be reachable from the root.
/// A payload that only updates components is incremental, so it may reference
/// components the client already holds; duplicate ids, self-references and
/// cycles still fail.
class A2uiValidator<C extends ComponentApi, F extends FunctionApi> {
  /// The catalogs payloads are validated against, keyed by catalog id.
  final Map<String, Catalog<C, F>> catalogs;

  /// The protocol version this validator accepts.
  final A2uiProtocolVersion protocolVersion;

  /// The shared `common_types.json` definitions, when the caller has them.
  ///
  /// Catalogs reference this document for `ChildList`, `DynamicString` and
  /// the other shared types. Supplying it lets [validateAgainstCatalogs]
  /// enforce those definitions; without it they are treated as unconstrained,
  /// because this SDK never fetches a schema over the network.
  final Map<String, Object?>? commonTypesSchema;

  /// Child-referencing properties per catalog id, derived on first use.
  final Map<String, Map<String, ComponentRefFields>> _refFields = {};

  /// Component schemas with their `$ref`s inlined, keyed by catalog id.
  final Map<String, Map<String, Schema>> _resolvedComponents = {};

  A2uiValidator({
    List<Catalog<C, F>> catalogs = const [],
    this.commonTypesSchema,
    this.protocolVersion = A2uiProtocolVersion.v0_9,
  }) : catalogs = {for (final Catalog<C, F> c in catalogs) c.id: c};

  /// Creates a validator for [version].
  ///
  /// Throws [A2uiValidationError] for any version this SDK does not
  /// implement.
  factory A2uiValidator.forVersion(
    Object? version, {
    List<Catalog<C, F>> catalogs = const [],
    Map<String, Object?>? commonTypesSchema,
  }) => A2uiValidator<C, F>(
    catalogs: catalogs,
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
  /// Throws [A2uiIntegrityError] for graph defects, [A2uiRecursionError] for
  /// cycles and depth overruns, and [A2uiValidationError] for a malformed
  /// data-model path.
  void validateStructure(List<A2uiMessage> messages) {
    for (final message in messages) {
      checkPathsAndRecursion(message.toJson());
      // Two components sharing an id in one message contradict each other.
      // The same id in a later message updates the component instead, so
      // duplicates are looked for per message, before the merge below.
      if (message is UpdateComponentsMessage) {
        checkComponentIntegrity(
          message.components,
          const {},
          requireRoot: false,
          allowDangling: true,
        );
      }
    }

    for (final MapEntry<String, _SurfacePayload> entry in _groupBySurface(
      messages,
    ).entries) {
      final _SurfacePayload surface = entry.value;
      if (surface.components.isEmpty) continue;

      final Map<String, ComponentRefFields> refFields = _refFieldsFor(
        _catalogFor(surface),
      );
      checkComponentIntegrity(
        surface.components,
        refFields,
        requireRoot: surface.created,
        allowDangling: !surface.created,
      );
      analyzeComponentTopology(
        surface.components,
        refFields,
        requireRoot: surface.created,
        allowOrphans: !surface.isSingleRender,
      );
    }
  }

  /// Checks each component and function call against its surface's catalog.
  ///
  /// Throws [A2uiCatalogError] if a message names a catalog this validator
  /// does not hold, and [A2uiValidationError] for schema violations.
  ///
  /// A surface the payload does not create carries no catalog id, so its
  /// components are checked only when this validator holds exactly one
  /// catalog. A validator has no client state to look the surface up in.
  void validateAgainstCatalogs(List<A2uiMessage> messages) {
    final Map<String, _SurfacePayload> surfaces = _groupBySurface(messages);

    for (final _SurfacePayload surface in surfaces.values) {
      final String? catalogId = surface.catalogId;
      if (catalogId != null && !catalogs.containsKey(catalogId)) {
        throw A2uiCatalogError(
          "Unknown catalog '$catalogId'. This validator holds: "
          '${catalogs.keys.join(', ')}.',
          catalogId: catalogId,
        );
      }
    }

    for (final _SurfacePayload surface in surfaces.values) {
      final Catalog<C, F>? catalog = _catalogFor(surface);
      if (catalog == null) continue;
      for (final Map<String, Object?> component in surface.components) {
        _validateComponent(component, catalog);
      }
    }
  }

  /// Validates a complete payload: envelopes, then structure, then catalog
  /// schemas.
  ///
  /// Returns the parsed messages, and throws as the individual steps do.
  List<A2uiMessage> validate(List<Map<String, Object?>> payload) {
    final List<A2uiMessage> messages = parseMessages(payload);
    validateStructure(messages);
    validateAgainstCatalogs(messages);
    return messages;
  }

  void _validateComponent(
    Map<String, Object?> component,
    Catalog<C, F> catalog,
  ) {
    final Object? type = component['component'];
    if (type is! String) {
      throw A2uiValidationError(
        "Component '${component['id']}' does not name a component type.",
        details: component,
      );
    }
    final Schema? schema = _resolvedComponentSchemas(catalog)[type];
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

  /// Groups a payload's messages by surface, in arrival order.
  Map<String, _SurfacePayload> _groupBySurface(List<A2uiMessage> messages) {
    final surfaces = <String, _SurfacePayload>{};
    _SurfacePayload payloadFor(String id) =>
        surfaces.putIfAbsent(id, _SurfacePayload.new);

    for (final message in messages) {
      switch (message) {
        case CreateSurfaceMessage(:final surfaceId, :final catalogId):
          payloadFor(surfaceId)
            ..created = true
            ..catalogId = catalogId;
        case UpdateComponentsMessage(:final surfaceId, :final components):
          payloadFor(surfaceId).merge(components);
        case DeleteSurfaceMessage(:final surfaceId):
          // A surface deleted within the payload takes its components with
          // it, so what came before is not part of the graph any more.
          surfaces.remove(surfaceId);
        default:
          break;
      }
    }
    return surfaces;
  }

  /// The catalog a surface's components belong to, when it can be determined.
  Catalog<C, F>? _catalogFor(_SurfacePayload surface) {
    final String? catalogId = surface.catalogId;
    if (catalogId != null) return catalogs[catalogId];
    return catalogs.length == 1 ? catalogs.values.first : null;
  }

  Map<String, ComponentRefFields> _refFieldsFor(Catalog<C, F>? catalog) {
    if (catalog == null) return const {};
    return _refFields.putIfAbsent(
      catalog.id,
      () => extractComponentRefFields(catalog),
    );
  }

  Map<String, Schema> _resolvedComponentSchemas(Catalog<C, F> catalog) =>
      _resolvedComponents.putIfAbsent(catalog.id, () {
        final Map<String, Object?> document = catalog.catalogSchema;
        return {
          for (final MapEntry<String, C> entry in catalog.components.entries)
            entry.key: Schema.fromMap(
              resolveSchemaRefs(
                entry.value.schema.value,
                document,
                commonTypes: commonTypesSchema,
              ),
            ),
        };
      });
}
