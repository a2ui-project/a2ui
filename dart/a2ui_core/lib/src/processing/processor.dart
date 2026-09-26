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
import '../core/component_model.dart';
import '../core/messages.dart';
import '../core/surface_group_model.dart';
import '../core/surface_model.dart';
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../validation/component_graph.dart';
import '../validation/component_refs.dart';
import '../validation/validation_config.dart';
import '../validation/validator.dart';

/// The central processor for A2UI messages on renderer side.
///
/// It consumes the agent-to-renderer messages
/// (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`)
/// and builds the surface state a renderer draws from. An agent can also run
/// it headlessly, to evaluate the UI its own payload would produce.
///
/// Not to be confused with the Agent SDK's `A2uiRequestProcessor`, which runs
/// the other way: it parses model output into the payloads this consumes.
///
/// This is the entry point for validation as well as for processing, because
/// it is what holds every supported [catalogs] entry and can therefore decide
/// which catalog each item belongs to. [PayloadValidator] checks one component,
/// function call or theme against one catalog; the processor resolves that
/// catalog per item and calls [validatorFor] for it. That split is what lets a
/// surface mix catalogs, which v1.0 allows through the `catalogId` a component
/// or function call may carry to override the surface-level default.
///
/// [processMessages] is the entry point for both sides. It takes an
/// [AgentToRendererMessagePayload] — a batch of parsed messages, a lone
/// message, or raw decoded JSON — and applies it to the surface state,
/// checking each message against the surface it joins as it goes, so graph
/// checks resolve references against what the surface already holds. An agent
/// checks its own output the same way, over a processor it keeps for the
/// session: the state it builds up is what makes an incremental update
/// checkable rather than waved through.
///
/// Validation is phased rather than a single pass: envelopes are checked as
/// the payload is parsed, a surface's theme when the surface is created, each
/// batch of components against its catalog and against the merged graph as the
/// batch arrives, and every surface the payload created as one graph once the
/// payload has been applied in full. That last pass is what [validationConfig]
/// governs: a root, references that resolve and components reachable from the
/// root are the three things a message cannot answer on arrival, because a
/// payload may declare a parent before its child.
class MessageProcessor<T extends ComponentApi> {
  final SurfaceGroupModel<T> groupModel;
  final List<Catalog<T, FunctionImplementation>> catalogs;

  /// The protocol version this processor accepts, on envelopes and in the
  /// validators it builds.
  ///
  /// Required rather than defaulted: a default would silently move every
  /// caller onto the next protocol version the day this SDK implements one.
  final A2uiProtocolVersion protocolVersion;

  /// The shared `common_types.json` definitions the validators resolve
  /// against.
  ///
  /// Defaults to the copy this package publishes for [protocolVersion]; pass
  /// a different document to override it, or an empty map to leave the shared
  /// types unchecked.
  final Map<String, Object?> commonTypesSchema;

  /// Which graph checks a surface must pass once a payload is applied.
  ///
  /// Defaults to [ValidationConfig.strict], which is what a payload carrying a
  /// whole render must satisfy. A caller whose transport delivers one surface
  /// across several payloads relaxes the checks that span them; see
  /// [ValidationConfig].
  final ValidationConfig validationConfig;

  /// One validator per catalog, built on first use.
  final Map<String, PayloadValidator<T, FunctionImplementation>> _validators =
      {};

  MessageProcessor({
    required this.catalogs,
    required this.protocolVersion,
    this.validationConfig = ValidationConfig.strict,
    Map<String, Object?>? commonTypesSchema,
    void Function(A2uiClientAction)? onAction,
  }) : commonTypesSchema =
           commonTypesSchema ??
           PayloadValidator.commonTypesFor(protocolVersion),
       groupModel = SurfaceGroupModel<T>() {
    if (onAction != null) {
      groupModel.onAction.addListener(onAction);
    }
  }

  /// The validator for [catalog].
  ///
  /// A component belongs to exactly one catalog, so a validator is scoped to
  /// one rather than handed the whole supported set. The processor is what
  /// routes each item to the right one, which is what keeps a component of one
  /// catalog from passing on a surface whose default is another, and what lets
  /// a v1.0 surface mix catalogs.
  ///
  /// Built once per catalog and reused. The validator caches resolved
  /// component schemas, which a fresh instance per batch would rebuild on
  /// every message.
  PayloadValidator<T, FunctionImplementation> validatorFor(
    Catalog<T, FunctionImplementation> catalog,
  ) => _validators.putIfAbsent(
    catalog.id,
    () => PayloadValidator<T, FunctionImplementation>(
      catalog: catalog,
      commonTypesSchema: commonTypesSchema,
      protocolVersion: protocolVersion,
    ),
  );

  /// The supported catalog with [catalogId].
  ///
  /// Throws [A2uiCatalogError] when this processor supports no such catalog,
  /// which for a renderer means the agent named a catalog outside the
  /// capabilities it advertised.
  Catalog<T, FunctionImplementation> catalogFor(String catalogId) {
    for (final Catalog<T, FunctionImplementation> catalog in catalogs) {
      if (catalog.id == catalogId) return catalog;
    }
    throw A2uiCatalogError(
      "Catalog '$catalogId' is not supported by this processor. Supported: "
      '${catalogs.map((c) => c.id).join(', ')}.',
      catalogId: catalogId,
    );
  }

  /// Processes a payload, applying each message to the surface it names.
  ///
  /// Checks run in two passes, because they answer at different times.
  ///
  /// As each message is applied: its components against the catalog they
  /// belong to, and the merged graph for duplicate ids, self-references,
  /// cycles and over-deep chains. No later message can make any of those
  /// right, so they are checked where they arrive and are not configurable.
  ///
  /// Once every message is applied: each surface the payload created is
  /// checked as a whole graph, for the root, for references that resolve and
  /// for components reachable from the root. These are deferred because a
  /// payload may declare a parent before its child — the basic catalog's
  /// `00_incremental` example does exactly that — so they answer for the
  /// surface the payload leaves behind rather than for each message in turn.
  /// [validationConfig] governs which of the three run.
  ///
  /// A surface this payload only updates is not checked that way: v0.9 names
  /// the catalog on `createSurface` alone, so a payload that does not create
  /// the surface is an incremental update, and the render it belongs to is not
  /// this payload's to complete. A caller streaming one surface across several
  /// payloads relaxes the same checks through [validationConfig].
  ///
  /// A caller holding a raw payload parses it first, with
  /// `AgentToRendererMessagePayload.fromJson(payload, protocolVersion: ...)`.
  /// That is a separate step because envelope parsing needs no catalog and no
  /// surface: it is what lets a payload be read before each message is matched
  /// to the surface, and so the catalog, it belongs to.
  ///
  /// Throws [A2uiIntegrityError] for a missing root, a duplicate id or a
  /// reference to no component, [A2uiRecursionError] for a cycle or an
  /// over-deep chain, and [A2uiValidationError] for a component that does not
  /// match its catalog.
  void processMessages(AgentToRendererMessagePayload payload) {
    final created = <String>{};
    for (final AgentToRendererMessage message in payload.messages) {
      _processMessage(message);
      if (message is CreateSurfaceMessage) created.add(message.surfaceId);
      if (message is DeleteSurfaceMessage) created.remove(message.surfaceId);
    }
    for (final surfaceId in created) {
      _checkSurfaceGraph(surfaceId);
    }
  }

  /// Checks the graph one surface holds, under [validationConfig].
  ///
  /// Runs once a payload that created the surface has been applied in full,
  /// so a reference is resolved against everything the payload declared rather
  /// than against what had arrived when the reference did.
  void _checkSurfaceGraph(String surfaceId) {
    final SurfaceModel<T>? surface = groupModel.getSurface(surfaceId);
    if (surface == null) return;

    final List<Map<String, Object?>> components = [
      for (final ComponentModel c in surface.componentsModel.all) c.toJson(),
    ];
    // A surface may carry only a theme. Nothing was rendered, so there is no
    // root to require and nothing to be unreachable from it.
    if (components.isEmpty) return;

    final Map<String, ComponentRefFields> refFields = _refFieldsFor(
      surface.catalog.id,
      components,
    );
    checkComponentIntegrity(
      components,
      refFields,
      requireRoot: !validationConfig.allowMissingRoot,
      // An empty set, not null: every reference must be satisfied by the
      // surface itself. Null would skip reference checking altogether.
      knownIds: validationConfig.allowDanglingReferences
          ? null
          : const <String>{},
    );
    checkComponentTopology(
      components,
      refFields,
      requireRoot: !validationConfig.allowMissingRoot,
      allowOrphans: validationConfig.allowOrphanComponents,
    );
  }

  /// The catalog one component is checked against.
  ///
  /// Settled in order: the `catalogId` the component names for itself, which
  /// v1.0 allows so that one surface can mix catalogs; then the surface's
  /// default, from `createSurface`; then the sole catalog this processor
  /// supports, which is the agent case, where a catalog is negotiated before
  /// anything is generated.
  ///
  /// Throws [A2uiCatalogError] when none of those settles it. Skipping the
  /// component instead would report a payload valid that nothing had checked.
  Catalog<T, FunctionImplementation> _catalogForComponent(
    Map<String, Object?> component,
    String? surfaceCatalogId,
  ) {
    final Object? declared = component['catalogId'] ?? surfaceCatalogId;
    if (declared is String) return catalogFor(declared);
    if (catalogs.length == 1) return catalogs.single;
    throw A2uiCatalogError(
      "Component '${component['id']}' names no catalog and the payload does "
      'not create its surface, so the catalog to check it against is '
      'ambiguous among: ${catalogs.map((c) => c.id).join(', ')}.',
    );
  }

  /// Which properties hold child references, across the catalogs a surface's
  /// components draw on.
  ///
  /// A surface's graph spans every component on it, and from v1.0 those may
  /// come from several catalogs, so the reference fields are merged over all of
  /// them. The surface's own default wins a name two catalogs both declare.
  Map<String, ComponentRefFields> _refFieldsFor(
    String? surfaceCatalogId,
    Iterable<Map<String, Object?>> components,
  ) {
    final ids = <String>{
      if (surfaceCatalogId != null) surfaceCatalogId,
      for (final Map<String, Object?> component in components)
        if (component['catalogId'] case final String id) id,
    };
    final Iterable<Catalog<T, FunctionImplementation>> involved = ids.isEmpty
        ? catalogs
        : ids.map(catalogFor);

    final merged = <String, ComponentRefFields>{};
    for (final catalog in involved) {
      validatorFor(catalog).componentRefFields.forEach(
        (String type, ComponentRefFields fields) =>
            merged.putIfAbsent(type, () => fields),
      );
    }
    return merged;
  }

  void _processMessage(AgentToRendererMessage message) {
    // Data-model paths and nested function calls, which need no surface state
    // and so are checked for every message before it is applied.
    checkPathsAndRecursion(message.toJson());

    if (message is CreateSurfaceMessage) {
      _processCreateSurface(message);
    } else if (message is UpdateComponentsMessage) {
      _processUpdateComponents(message);
    } else if (message is UpdateDataModelMessage) {
      _processUpdateDataModel(message);
    } else if (message is DeleteSurfaceMessage) {
      _processDeleteSurface(message);
    }
  }

  void _processCreateSurface(CreateSurfaceMessage message) {
    final Catalog<T, FunctionImplementation> catalog = catalogFor(
      message.catalogId,
    );

    if (groupModel.getSurface(message.surfaceId) != null) {
      throw A2uiStateError('Surface ${message.surfaceId} already exists.');
    }

    // The theme arrives once, with the surface, so it is checked here rather
    // than on every later message.
    validatorFor(catalog).validateTheme(message.theme);

    final surface = SurfaceModel<T>(
      message.surfaceId,
      catalog: catalog,
      theme: message.theme ?? {},
      sendDataModel: message.sendDataModel,
    );
    groupModel.addSurface(surface);
  }

  void _processUpdateComponents(UpdateComponentsMessage message) {
    final SurfaceModel<T>? surface = groupModel.getSurface(message.surfaceId);
    if (surface == null) {
      throw A2uiStateError('Surface not found: ${message.surfaceId}');
    }

    // Pass 1: validation.
    //
    // Every component in the batch is checked before any of them is applied,
    // so a batch that is rejected leaves the surface exactly as it was. Without
    // this, a valid component followed by an invalid one was committed before
    // the error surfaced, leaving the surface in a half-updated state that no
    // message describes.
    for (final Map<String, dynamic> compJson in message.components) {
      final id = compJson['id'] as String?;
      final type = compJson['component'] as String?;

      if (id == null) {
        throw A2uiValidationError("Component missing an 'id'.");
      }

      final ComponentModel? existing = surface.componentsModel.get(id);
      if (existing == null && type == null) {
        throw A2uiValidationError(
          "Cannot create component $id without a 'component' type.",
        );
      }

      // A component that names a type is checked against its own catalog
      // here, while the batch can still be rejected whole. That is the
      // surface's default catalog unless the component names one of its own,
      // which v1.0 allows. A component that names no type is an update to one
      // this surface already holds, which the catalog was consulted for when
      // it first arrived.
      if (type != null) {
        final Catalog<T, FunctionImplementation> catalog = _catalogForComponent(
          compJson.cast<String, Object?>(),
          surface.catalog.id,
        );
        validatorFor(catalog).validateComponent(compJson);
      }
    }

    final List<Map<String, Object?>> incoming = [
      for (final Map<String, dynamic> c in message.components)
        c.cast<String, Object?>(),
    ];
    final List<Map<String, Object?>> existing = [
      for (final ComponentModel c in surface.componentsModel.all) c.toJson(),
    ];

    // The batch as a graph, against the surface it is about to join: duplicate
    // ids, references that name no component here or on the surface, cycles
    // and over-deep chains. Resolving against the surface is what a payload on
    // its own cannot do, so an incremental update is checked here rather than
    // waved through.
    _validateComponentBatch(surface, incoming, existing);

    // Pass 2: mutation. Only reached when the whole batch is valid.
    for (final Map<String, dynamic> compJson in message.components) {
      final id = compJson['id'] as String;
      final type = compJson['component'] as String?;

      final ComponentModel? existing = surface.componentsModel.get(id);
      final props = Map<String, dynamic>.from(compJson)
        ..remove('id')
        ..remove('component');

      if (existing != null) {
        if (type != null && type != existing.type) {
          // Recreate if type changes
          surface.componentsModel.removeComponent(id);
          surface.componentsModel.addComponent(ComponentModel(id, type, props));
        } else {
          existing.properties = props;
        }
      } else {
        surface.componentsModel.addComponent(ComponentModel(id, type!, props));
      }
    }
  }

  /// Checks one batch of components against the surface that will receive it.
  ///
  /// [incoming] is the batch; [existing] is what the surface already holds, as
  /// `ComponentModel.toJson` renders it.
  ///
  /// Checks what a single batch can settle on its own: that it declares no id
  /// twice, and that it closes no cycle and no over-deep chain. Cycles and
  /// depth are measured over the merged graph rather than the batch alone, so
  /// a batch that closes a loop through existing components fails here too.
  ///
  /// Whether a reference resolves is not among them, because a payload may
  /// declare a parent before its child; [processMessages] answers that for the
  /// surface the whole payload leaves behind.
  ///
  /// Throws [A2uiIntegrityError] for a duplicate id, and [A2uiRecursionError]
  /// for a cycle or an over-deep chain.
  void _validateComponentBatch(
    SurfaceModel<T> surface,
    List<Map<String, Object?>> incoming,
    List<Map<String, Object?>> existing,
  ) {
    final Map<String, ComponentRefFields> refFields = _refFieldsFor(
      surface.catalog.id,
      [...existing, ...incoming],
    );
    checkComponentIntegrity(
      incoming,
      refFields,
      // The root may arrive in a later message, so its absence is not an
      // error at this point; the surface is not yet claimed to be complete.
      requireRoot: false,
      // Nor is a reference to a component the surface does not yet hold. A
      // payload may declare a parent before its child — the basic catalog's
      // `00_incremental` example does exactly that — so a reference resolves
      // against what the surface ends up holding, not against what it holds at
      // the moment the batch arrives. [processMessages] makes that check once
      // the payload has been applied in full.
      knownIds: null,
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

  void _processUpdateDataModel(UpdateDataModelMessage message) {
    final SurfaceModel<T>? surface = groupModel.getSurface(message.surfaceId);
    if (surface == null) {
      throw A2uiStateError('Surface not found: ${message.surfaceId}');
    }

    surface.dataModel.set(message.path ?? '/', message.value);
  }

  void _processDeleteSurface(DeleteSurfaceMessage message) {
    groupModel.deleteSurface(message.surfaceId);
  }

  /// Generates client capabilities.
  Map<String, dynamic> getClientCapabilities({
    bool includeInlineCatalogs = false,
  }) {
    final v09 = <String, dynamic>{
      'supportedCatalogIds': catalogs.map((c) => c.id).toList(),
    };

    if (includeInlineCatalogs) {
      v09['inlineCatalogs'] = catalogs.map(_generateInlineCatalog).toList();
    }

    return {'v0.9': v09};
  }

  Map<String, dynamic> _generateInlineCatalog(
    Catalog<T, FunctionImplementation> catalog,
  ) {
    final components = <String, dynamic>{};
    for (final MapEntry<String, T> entry in catalog.components.entries) {
      final Map<String, dynamic> jsonSchema = entry.value.schema.toJsonMap();
      _processRefs(jsonSchema);

      // Wrap in A2UI envelope
      components[entry.key] = {
        'allOf': [
          {'\$ref': 'common_types.json#/\$defs/ComponentCommon'},
          {
            'properties': {
              'component': {'const': entry.key},
              ...?(jsonSchema['properties'] as Map<String, dynamic>?),
            },
            'required': ['component', ...?(jsonSchema['required'] as List?)],
          },
        ],
      };
    }

    final List<Map<String, Object>> functions = catalog.functions.values.map((
      f,
    ) {
      final Map<String, dynamic> jsonSchema = f.argumentSchema.toJsonMap();
      _processRefs(jsonSchema);
      return {
        'name': f.name,
        'returnType': f.returnType.jsonValue,
        'parameters': jsonSchema,
      };
    }).toList();

    Map<String, dynamic>? theme;
    if (catalog.themeSchema != null) {
      theme = catalog.themeSchema!.toJsonMap();
      _processRefs(theme);
      theme = theme['properties'] as Map<String, dynamic>?;
    }

    return {
      'catalogId': catalog.id,
      'components': components,
      if (functions.isNotEmpty) 'functions': functions,
      if (theme != null) 'theme': theme,
    };
  }

  void _processRefs(Object? node) {
    if (node is! Map) return;

    if (node['description'] is String &&
        (node['description'] as String).startsWith('REF:')) {
      final desc = node['description'] as String;
      final List<String> parts = desc.substring(4).split('|');
      final String ref = parts[0];
      final String? actualDesc = parts.length > 1 ? parts[1] : null;

      node.clear();
      node['\$ref'] = ref;
      if (actualDesc != null) {
        node['description'] = actualDesc;
      }
      return;
    }

    node.forEach((key, value) {
      if (value is Map) {
        _processRefs(value);
      } else if (value is List) {
        for (final Object? item in value) {
          if (item is Map) {
            _processRefs(item);
          }
        }
      }
    });
  }

  /// Aggregates data models for surfaces with sendDataModel enabled.
  Map<String, dynamic>? getClientDataModel() {
    final surfaces = <String, dynamic>{};
    for (final SurfaceModel<T> surface in groupModel.allSurfaces) {
      if (surface.sendDataModel) {
        surfaces[surface.id] = surface.dataModel.get('/');
      }
    }

    if (surfaces.isEmpty) return null;

    return {'version': 'v0.9', 'surfaces': surfaces};
  }
}

extension SchemaExtension on Schema {
  Map<String, dynamic> toJsonMap() => _deepCopy(value);

  static Map<String, dynamic> _deepCopy(Map<dynamic, dynamic> map) {
    return map.map((key, value) {
      if (value is Map) {
        return MapEntry(key as String, _deepCopy(value));
      }
      if (value is List) {
        return MapEntry(
          key as String,
          value.map((item) => item is Map ? _deepCopy(item) : item).toList(),
        );
      }
      return MapEntry(key as String, value);
    });
  }
}
