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
/// Both sides, agent and renderer, are meant to use it, through different
/// entry points. [validate] checks a payload on its own, which is what an
/// agent has before it sends anything to the renderer. Renderer
/// calls the per-message entry points instead, checking each batch against
/// the surface state it holds.
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
/// component with id `root`, every reference must name a component
/// the payload declares, and every component must be reachable from the root.
/// A payload that only updates components is incremental, so it may reference
/// components the client already holds; duplicate ids, self-references and
/// cycles still fail.
class A2uiValidator<C extends ComponentApi, F extends FunctionApi> {
  /// The catalogs payloads are validated against, keyed by catalog id.
  final Map<String, Catalog<C, F>> catalogs;

  /// The protocol version this validator accepts.
  final A2uiProtocolVersion protocolVersion;

  /// The shared `common_types.json` definitions this validator resolves
  /// against.
  ///
  /// Catalogs reference this document for `ChildList`, `DynamicString` and
  /// the other shared types, so [validateAgainstCatalogs] needs it to check
  /// them. It defaults to [commonTypesFor] of [protocolVersion], the copy this
  /// package publishes; pass a different document to override it, or an empty
  /// map to leave the shared types unchecked.
  final Map<String, Object?> commonTypesSchema;

  /// Child-referencing properties per catalog id, derived on first use.
  final Map<String, Map<String, ComponentRefFields>> _refFields = {};

  /// Component schemas with their `$ref`s inlined, keyed by catalog id.
  final Map<String, Map<String, Schema>> _resolvedComponents = {};

  A2uiValidator({
    List<Catalog<C, F>> catalogs = const [],
    Map<String, Object?>? commonTypesSchema,
    this.protocolVersion = A2uiProtocolVersion.v0_9,
  }) : catalogs = {for (final Catalog<C, F> c in catalogs) c.id: c},
       commonTypesSchema = commonTypesSchema ?? commonTypesFor(protocolVersion);

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
  void validateStructure(
    List<A2uiMessage> messages, {
    Map<String, String> surfaceCatalogs = const {},
  }) {
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
          knownIds: null,
        );
      }
    }

    for (final MapEntry<String, _SurfacePayload> entry in _groupBySurface(
      messages,
    ).entries) {
      final _SurfacePayload surface = entry.value;
      if (surface.components.isEmpty) continue;

      final Map<String, ComponentRefFields> refFields = _refFieldsFor(
        _catalogFor(entry.key, surface, surfaceCatalogs),
      );
      checkComponentIntegrity(
        surface.components,
        refFields,
        requireRoot: surface.created,
        // A payload that creates the surface must satisfy every reference
        // itself. One that does not cannot know what the client already
        // holds, so `MessageProcessor` makes that check instead.
        knownIds: surface.created ? const <String>{} : null,
      );
      checkComponentTopology(
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
  /// A surface the payload only updates carries no catalog id, because v0.9
  /// declares one on `createSurface` alone. Name it in [surfaceCatalogs],
  /// keyed by surface id; a caller that sent the `createSurface` knows it.
  /// Without it, a validator holding one catalog uses that catalog and one
  /// holding several throws rather than leave the components unchecked.
  void validateAgainstCatalogs(
    List<A2uiMessage> messages, {
    Map<String, String> surfaceCatalogs = const {},
  }) {
    final Map<String, _SurfacePayload> surfaces = _groupBySurface(messages);

    for (final MapEntry<String, _SurfacePayload> entry in surfaces.entries) {
      final Catalog<C, F> catalog = _catalogFor(
        entry.key,
        entry.value,
        surfaceCatalogs,
      );
      for (final Map<String, Object?> component in entry.value.components) {
        validateComponent(component, catalog);
      }
    }
  }

  /// Validates a complete payload: envelopes, then structure, then catalog
  /// schemas.
  ///
  /// Returns the parsed messages, and throws as the individual steps do.
  List<A2uiMessage> validate(
    List<Map<String, Object?>> payload, {
    Map<String, String> surfaceCatalogs = const {},
  }) {
    final List<A2uiMessage> messages = parseMessages(payload);
    validateStructure(messages, surfaceCatalogs: surfaceCatalogs);
    validateAgainstCatalogs(messages, surfaceCatalogs: surfaceCatalogs);
    return messages;
  }

  /// Checks one batch of components against the surface that will receive it.
  ///
  /// [incoming] is the batch; [existing] is what the surface already holds, as
  /// `ComponentModel.toJson` renders it. References resolve against both, so a
  /// batch may point at a component the client already has while a reference
  /// to nothing at all is still caught — a check [validateStructure] cannot
  /// make, because a payload does not carry the surface's history.
  ///
  /// Cycles and depth are measured over the merged graph rather than the batch
  /// alone, so a batch that closes a loop through existing components fails
  /// here too.
  ///
  /// Visible only so `MessageProcessor` can run it while a batch can still be
  /// rejected whole.
  ///
  /// Throws [A2uiIntegrityError] for a duplicate id or a reference to no
  /// component, and [A2uiRecursionError] for a cycle or an over-deep chain.
  @internal
  void validateComponentBatch(
    List<Map<String, Object?>> incoming,
    List<Map<String, Object?>> existing,
    Catalog<C, F> catalog,
  ) {
    final Map<String, ComponentRefFields> refFields = _refFieldsFor(catalog);
    checkComponentIntegrity(
      incoming,
      refFields,
      // The root may arrive in a later message, so its absence is not an
      // error at this point; the surface is not yet claimed to be complete.
      requireRoot: false,
      knownIds: {
        for (final Map<String, Object?> component in existing)
          if (component['id'] is String) component['id']! as String,
      },
    );
    checkComponentTopology(
      [...existing, ...incoming],
      refFields,
      requireRoot: false,
      // A component left unreachable by an update is the residue of a
      // replacement rather than a defect.
      allowOrphans: true,
    );
  }

  /// Checks a surface's theme against [catalog]'s theme schema.
  ///
  /// A catalog that declares no theme schema constrains nothing, so any theme
  /// passes. A null [theme] is the surface declaring none, which is always
  /// allowed.
  ///
  /// Visible only so `MessageProcessor` can check a theme when the surface is
  /// created, which is the only point the theme arrives.
  ///
  /// Throws [A2uiValidationError] if the theme does not match the schema.
  @internal
  void validateTheme(Map<String, Object?>? theme, Catalog<C, F> catalog) {
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

  /// Checks one component against [catalog]'s schema for its type.
  ///
  /// Visible only so `MessageProcessor` can validate a component as it
  /// arrives, rather than only as part of a whole payload. Outside this
  /// package, validate through [validate] or a `MessageProcessor` holding a
  /// validator, not through this.
  ///
  /// Throws [A2uiValidationError] if the component names no type, names one
  /// the catalog does not declare, or does not match its schema.
  @internal
  void validateComponent(
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
  /// The catalog a surface's components are checked against.
  ///
  /// Settled in order: the id the payload declares on `createSurface`, then
  /// the id [surfaceCatalogs] gives for a surface the payload only updates,
  /// then the sole catalog when this validator holds one.
  ///
  /// Throws [A2uiCatalogError] when none of those settles it. Skipping the
  /// surface instead would report a payload valid that nothing had checked.
  Catalog<C, F> _catalogFor(
    String surfaceId,
    _SurfacePayload surface,
    Map<String, String> surfaceCatalogs,
  ) {
    final String? declared = surface.catalogId ?? surfaceCatalogs[surfaceId];
    if (declared != null) {
      final Catalog<C, F>? catalog = catalogs[declared];
      if (catalog != null) return catalog;
      throw A2uiCatalogError(
        "Unknown catalog '$declared'. This validator holds: "
        '${catalogs.keys.join(', ')}.',
        catalogId: declared,
      );
    }
    if (catalogs.length == 1) return catalogs.values.first;
    throw A2uiCatalogError(
      "Cannot tell which catalog surface '$surfaceId' uses: the payload does "
      'not create it, so it carries no catalog id, and this validator holds '
      '${catalogs.length} catalogs. Pass surfaceCatalogs to name it, or use '
      'MessageProcessor, which tracks the catalog each surface was created '
      'with.',
    );
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
