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
/// Validation runs per message. Envelopes are checked as the payload is
/// parsed, a surface's theme when the surface is created, and each
/// `updateComponents` batch before any of it is applied: duplicate ids within
/// the batch, every component against its catalog's schema, and, when the
/// processor has a [validationConfig], the surface the batch would leave
/// behind (the components already there, with the batch applied on top) as
/// one graph. Without a config the graph is not checked, so a surface may
/// arrive across several messages in any order; see [ValidationConfig].
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

  /// The [commonTypesSchema] the caller passed, if any.
  ///
  /// Without one, each validator resolves against the document for its own
  /// catalog's `protocolVersion`.
  final Map<String, Object?>? _commonTypesOverride;

  /// Which checks each message must pass, or null, the default, for none of
  /// the graph checks.
  ///
  /// With a config, every `updateComponents` must leave its surface a graph
  /// the config's flags accept; [ValidationConfig.strict] requires a root,
  /// references that resolve and every component reachable from the root,
  /// which a surface delivered across several messages satisfies only once
  /// the last of them has arrived. Without a config, duplicate ids within a
  /// batch and the schemas of declared component types are still checked.
  final ValidationConfig? validationConfig;

  /// One validator per catalog, built on first use.
  final Map<String, PayloadValidator<T, FunctionImplementation>> _validators =
      {};

  MessageProcessor({
    required this.catalogs,
    required this.protocolVersion,
    this.validationConfig,
    Map<String, Object?>? commonTypesSchema,
    void Function(A2uiClientAction)? onAction,
  })  : _commonTypesOverride = commonTypesSchema,
        commonTypesSchema = commonTypesSchema ??
            PayloadValidator.commonTypesFor(protocolVersion),
        groupModel = SurfaceGroupModel<T>() {
    final A2uiProtocolVersion? target = validationConfig?.targetVersion;
    if (target != null && target != protocolVersion) {
      throw A2uiValidationError(
        "ValidationConfig.targetVersion is '${target.jsonValue}' but this "
        "processor is built for '${protocolVersion.jsonValue}'.",
      );
    }
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
  ) =>
      _validators.putIfAbsent(
        catalog.id,
        () => PayloadValidator<T, FunctionImplementation>(
          catalog: catalog,
          commonTypesSchema: _commonTypesOverride,
          protocolVersion: protocolVersion,
          // Without a config nothing is being validated against the graph,
          // and an undeclared type is tolerated too.
          config: validationConfig ??
              const ValidationConfig(allowUnknownElements: true),
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
  /// Each message is checked as it is applied, against the surface state the
  /// earlier messages left behind, and a message that fails leaves its surface
  /// as it was. For an `updateComponents` message that means its components
  /// against the catalog each belongs to, then, under a [validationConfig],
  /// the surface it would leave behind: a payload that declares a parent in
  /// one `updateComponents` and its child in a later one needs
  /// [ValidationConfig.allowDanglingReferences], or both in one message, or
  /// no config.
  ///
  /// A caller holding a raw payload parses it first, with
  /// `AgentToRendererMessagePayload.fromJson(payload, protocolVersion: ...)`.
  /// That is a separate step because envelope parsing needs no catalog and no
  /// surface: it is what lets a payload be read before each message is matched
  /// to the surface, and so the catalog, it belongs to.
  ///
  /// Throws [A2uiIntegrityError] for a message naming a surface that does not
  /// exist, a duplicate id, and under a config a missing root, a reference to
  /// no component or an unreachable component; [A2uiRecursionError] under a
  /// config for a cycle or an over-deep chain; [A2uiCatalogError] for a
  /// catalog this processor does not support; and [A2uiValidationError] for a
  /// component that does not match its catalog or a message
  /// [ValidationConfig.allowedMessages] does not list.
  void processMessages(AgentToRendererMessagePayload payload) {
    for (final AgentToRendererMessage message in payload.messages) {
      _processMessage(message);
    }
  }

  /// Alias for [processMessages] for cross-SDK ergonomics.
  void process(AgentToRendererMessagePayload payload) =>
      processMessages(payload);

  /// The envelope fields of a component message, which a [ComponentModel]
  /// holds apart from its properties.
  static const Set<String> _envelopeFields = {
    'id',
    'component',
    'catalogId',
    'metadata',
  };

  /// The catalog one component is checked against.
  ///
  /// Settled in order: the [catalogId] the component names for itself, which
  /// v1.0 allows so that one surface can mix catalogs; then the surface's
  /// default, from `createSurface`; then the sole catalog this processor
  /// supports, which is the agent case, where a catalog is negotiated before
  /// anything is generated.
  ///
  /// Throws [A2uiCatalogError] when none of those settles it. Skipping the
  /// component instead would report a payload valid that nothing had checked.
  Catalog<T, FunctionImplementation> _catalogForComponent(
    String id,
    String? catalogId,
    String? surfaceCatalogId,
  ) {
    final String? declared = catalogId ?? surfaceCatalogId;
    if (declared != null) return catalogFor(declared);
    if (catalogs.length == 1) return catalogs.single;
    throw A2uiCatalogError(
      "Component '$id' names no catalog and its surface has none, so the "
      'catalog to check it against is ambiguous among: '
      '${catalogs.map((c) => c.id).join(', ')}.',
    );
  }

  /// Which properties hold child references, across the catalogs a surface's
  /// components draw on.
  ///
  /// A surface's graph spans every component on it, and from v1.0 those may
  /// come from several catalogs, so the reference fields are merged over all of
  /// them. The surface's own default wins a name two catalogs both declare.
  /// Each catalog's fields come from its [Catalog.refMap], the map the node
  /// resolver mounts children from.
  Map<String, ComponentRefFields> _refFieldsFor(
    String? surfaceCatalogId,
    Iterable<String?> componentCatalogIds,
  ) {
    final ids = <String>{
      if (surfaceCatalogId != null) surfaceCatalogId,
      for (final String? id in componentCatalogIds)
        if (id != null) id,
    };
    final Iterable<Catalog<T, FunctionImplementation>> involved =
        ids.isEmpty ? catalogs : ids.map(catalogFor);

    final merged = <String, ComponentRefFields>{};
    for (final catalog in involved) {
      extractComponentRefFields(catalog).forEach(
        (String type, ComponentRefFields fields) =>
            merged.putIfAbsent(type, () => fields),
      );
    }
    return merged;
  }

  /// The composition constraints of the catalogs [components] draw on,
  /// merged the way [_refFieldsFor] merges reference fields.
  Map<String, CompositionRule> _compositionRulesFor(
    String? surfaceCatalogId,
    Iterable<Map<String, Object?>> components,
  ) {
    final ids = <String>{
      if (surfaceCatalogId != null) surfaceCatalogId,
      for (final Map<String, Object?> component in components)
        if (component['catalogId'] case final String id) id,
    };
    final Iterable<Catalog<T, FunctionImplementation>> involved =
        ids.isEmpty ? catalogs : ids.map(catalogFor);

    final merged = <String, CompositionRule>{};
    for (final catalog in involved) {
      extractCompositionRules(catalog).forEach(
        (String type, CompositionRule rule) =>
            merged.putIfAbsent(type, () => rule),
      );
    }
    return merged;
  }

  void _processMessage(AgentToRendererMessage message) {
    final List<String>? allowed = validationConfig?.allowedMessages;
    if (allowed != null) {
      // Named by type rather than read from `toJson`, which would serialize
      // a whole component batch just to find its key.
      final String name = switch (message) {
        CreateSurfaceMessage() => 'createSurface',
        UpdateComponentsMessage() => 'updateComponents',
        UpdateDataModelMessage() => 'updateDataModel',
        DeleteSurfaceMessage() => 'deleteSurface',
        _ => message.runtimeType.toString(),
      };
      if (!allowed.contains(name)) {
        throw A2uiValidationError(
          "Message '$name' is not permitted by "
          'ValidationConfig.allowedMessages.',
        );
      }
    }

    // Data-model paths and nested function calls, which need no surface state
    // and so are checked for every message before it is applied. Part of the
    // validation a config turns on.
    if (validationConfig != null) {
      final String rawVersion = message.version.isNotEmpty
          ? message.version
          : protocolVersion.jsonValue;
      final String core =
          rawVersion.startsWith('v') ? rawVersion.substring(1) : rawVersion;
      final bool isV1 = (int.tryParse(core.split('.').first) ?? 0) >= 1;
      checkPathsAndRecursion(message, v1: isV1);
    }

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
      message.catalogId ??
          (throw A2uiValidationError(
            "Message 'createSurface' for surface '${message.surfaceId}' names "
            'no catalogId.',
          )),
    );

    if (groupModel.getSurface(message.surfaceId) != null) {
      throw A2uiIntegrityError('Surface ${message.surfaceId} already exists.');
    }

    // The theme arrives once, with the surface, so it is checked here rather
    // than on every later message.
    validatorFor(catalog).validateTheme(message.theme);

    final surface = SurfaceModel<T>(
      message.surfaceId,
      catalog: catalog,
      theme: message.theme ?? {},
      sendDataModel: message.sendDataModel,
      protocolVersion: protocolVersion.jsonValue,
      rootId: validationConfig?.rootId ?? 'root',
    );
    groupModel.addSurface(surface);
  }

  SurfaceModel<T> _surfaceFor(String surfaceId) {
    final SurfaceModel<T>? surface = groupModel.getSurface(surfaceId);
    if (surface == null) {
      throw A2uiIntegrityError('Surface not found for message: $surfaceId');
    }
    return surface;
  }

  void _processUpdateComponents(UpdateComponentsMessage message) {
    final SurfaceModel<T> surface = _surfaceFor(message.surfaceId);
    final SurfaceComponentsModel model = surface.componentsModel;

    // Pass 1: validation.
    //
    // Every component in the batch is resolved to a full entry and checked
    // before any of them is applied, so a batch that is rejected leaves the
    // surface exactly as it was.
    final List<Map<String, Object?>> resolved = [
      for (final Map<String, dynamic> raw in message.components)
        _resolveComponent(raw.cast<String, Object?>(), surface),
    ];

    // The surface this batch would leave behind, as one graph: duplicate ids,
    // then under a config the root, references that resolve, cycles, depth
    // and reachability, as its flags require.
    final Map<String, ComponentRefFields> refFields = _refFieldsFor(
      surface.catalog.id,
      [
        for (final ComponentModel c in model.all) c.catalog,
        for (final Map<String, Object?> c in resolved)
          c['catalogId'] as String?,
      ],
    );
    final ValidationConfig? config = validationConfig;
    if (config == null) {
      checkDuplicateComponentIds(resolved);
    } else {
      model.checkComponentsUpdate(
        resolved,
        config,
        refFields,
        defaultRootId: surface.rootId,
      );
    }

    // Composition constraints (`allowedParents` / `allowedChildren`) over the
    // surface this batch would leave behind. An edge whose child has not
    // arrived yet is skipped, so this holds without a config too.
    final List<Map<String, Object?>> candidate = [
      ...resolved,
      for (final ComponentModel c in model.all)
        if (!resolved.any((Map<String, Object?> r) => r['id'] == c.id))
          c.toJson(),
    ];
    checkCompositionConstraints(
      candidate,
      refFields,
      _compositionRulesFor(surface.catalog.id, candidate),
      surfaceId: surface.id,
    );

    // Pass 2: mutation. Only reached when the whole batch is valid.
    model.refFields = refFields;
    for (final entry in resolved) {
      final id = entry['id']! as String;
      final type = entry['component']! as String;
      final catalogId = entry['catalogId'] as String?;
      final Map<String, Object?>? metadata = switch (entry['metadata']) {
        final Map<Object?, Object?> map => Map<String, Object?>.from(map),
        _ => null,
      };
      final props = <String, dynamic>{
        for (final MapEntry<String, Object?> e in entry.entries)
          if (!_envelopeFields.contains(e.key)) e.key: e.value,
      };

      final ComponentModel? existing = model.get(id);
      if (existing != null &&
          existing.type == type &&
          existing.catalog == catalogId) {
        existing.metadata = metadata;
        existing.properties = props;
        continue;
      }
      // A new component, or one whose type or catalog changed, which is
      // recreated rather than updated in place.
      if (existing != null) model.removeComponent(id);
      model.addComponent(
        ComponentModel(id, type, props, catalog: catalogId, metadata: metadata),
      );
    }
  }

  /// Resolves one `updateComponents` entry to the full component it describes
  /// and checks it against its catalog.
  ///
  /// An entry that omits `component` updates a component the surface already
  /// holds: it keeps that component's type, and its `catalogId` and
  /// `metadata` when it omits those too. Its properties replace the existing
  /// ones, so the entry is checked against the type's schema as it stands.
  ///
  /// An entry that names `component` replaces the component whole: one that
  /// omits `catalogId` belongs to the surface's catalog, so a component that
  /// named a catalog of its own is recreated, as for a change of type.
  Map<String, Object?> _resolveComponent(
    Map<String, Object?> entry,
    SurfaceModel<T> surface,
  ) {
    final Object? id = entry['id'];
    if (id is! String) {
      throw A2uiValidationError("Component missing an 'id'.", details: entry);
    }
    final Object? rawType = entry['component'];
    final Object? rawCatalog = entry['catalogId'];
    final Object? rawMetadata = entry['metadata'];
    if (rawType != null && rawType is! String) {
      throw A2uiValidationError(
        "Component '$id' has a 'component' type that is not a string.",
        details: entry,
      );
    }
    if (rawCatalog != null && rawCatalog is! String) {
      throw A2uiValidationError(
        "Component '$id' has a 'catalogId' that is not a string.",
        details: entry,
      );
    }
    if (rawMetadata != null &&
        (rawMetadata is! Map || rawMetadata.keys.any((k) => k is! String))) {
      // Checked here because a lazy `cast` would let a non-string key escape
      // later as a `TypeError` rather than a payload error.
      throw A2uiValidationError(
        "Component '$id' has 'metadata' that is not an object with string "
        'keys.',
        details: entry,
      );
    }

    final ComponentModel? existing = surface.componentsModel.get(id);
    final partial = rawType == null;
    final String? type = rawType as String? ?? existing?.type;
    if (type == null) {
      throw A2uiValidationError(
        "Cannot create component $id without a 'component' type.",
        details: entry,
      );
    }
    final String? catalogId =
        rawCatalog as String? ?? (partial ? existing?.catalog : null);
    final Object? metadata =
        rawMetadata ?? (partial ? existing?.metadata : null);

    final full = <String, Object?>{
      ...entry,
      'component': type,
      if (catalogId != null) 'catalogId': catalogId,
      if (metadata != null) 'metadata': metadata,
    };

    final Catalog<T, FunctionImplementation> catalog = _catalogForComponent(
      id,
      catalogId,
      surface.catalog.id,
    );
    validatorFor(catalog).validateComponent(full);
    return full;
  }

  void _processUpdateDataModel(UpdateDataModelMessage message) {
    final SurfaceModel<T> surface = _surfaceFor(message.surfaceId);
    surface.dataModel.set(message.path ?? '/', message.value);
  }

  /// Deletes the surface, or does nothing if no surface has that id, matching
  /// the conformance suite and the TypeScript and Python SDKs.
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
      if (components.isNotEmpty) 'components': components,
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

  /// Alias for [getClientDataModel] for cross-SDK ergonomics.
  Map<String, dynamic>? getRendererDataModel() => getClientDataModel();
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
