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
import '../primitives/semver.dart';
import '../validation/component_graph.dart';
import '../validation/component_refs.dart';
import '../validation/validation_config.dart';
import '../validation/validator.dart';
import 'adapters/version_adapter.dart';
import 'operations.dart';

/// One message of a payload, routed: the JSON it arrived as and the
/// operations its version's adapter mapped it onto.
typedef _RoutedMessage = ({
  Map<String, Object?> json,
  List<InternalOperation> operations,
});

/// An `updateComponents` batch that passed every check, ready to apply.
typedef _CheckedBatch = ({
  List<Map<String, Object?>> resolved,
  Map<String, ComponentRefFields> refFields,
});

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
/// Each message is routed on the protocol version it declares: the
/// [adapterRegistry] picks the [VersionAdapter] for that version, which maps
/// the message onto version-independent [InternalOperation]s, and the
/// processor executes those. One processor therefore holds surfaces of
/// different versions side by side, each recording its own
/// [SurfaceModel.protocolVersion].
///
/// This is the entry point for validation as well as for processing, because
/// it is what holds every supported [catalogs] entry and can therefore decide
/// which catalog each item belongs to. [PayloadValidator] checks one component,
/// function call or theme against one catalog; the processor resolves that
/// catalog per item and calls [validatorFor] for it. That split is what lets a
/// surface mix catalogs, which v1.0 allows through the `catalogId` a component
/// or function call may carry to override the surface-level default.
///
/// [processMessages] is the entry point for both sides. It takes raw decoded
/// JSON or parsed messages and applies them to the surface state, checking
/// each message against the surface it joins as it goes, so graph checks
/// resolve references against what the surface already holds. An agent checks
/// its own output the same way, over a processor it keeps for the session: the
/// state it builds up is what makes an incremental update checkable rather
/// than waved through.
///
/// Validation runs per message. Envelopes are checked as the payload is
/// parsed, a surface's theme and catalog version when the surface is created,
/// and each batch of components twice before any of it is applied: every
/// component against its catalog's schema, then the surface the batch would
/// leave behind (the components already there, with the batch applied on top)
/// as one graph. [validationConfig] governs which graph checks run; see
/// [ValidationConfig].
///
/// Graph checks run even under [ValidationConfig.none], which turns off only
/// the schema checks: duplicate ids, cycles and depth always, and the root,
/// references and reachability as [ValidationConfig.none]'s strict flags
/// require. That is stricter than TypeScript, whose processor skips every
/// check without a config, and matches Python.
class MessageProcessor<T extends ComponentApi> {
  final SurfaceGroupModel<T> groupModel;
  final List<Catalog<T, FunctionImplementation>> catalogs;

  /// The protocol version this processor assumes where no message declares
  /// one, or null for none.
  ///
  /// Messages are not checked against it: each is routed on the version it
  /// declares, through [adapterRegistry].
  final A2uiProtocolVersion? defaultVersion;

  /// The adapters messages are routed through, one per protocol version.
  ///
  /// Defaults to [VersionAdapterRegistry.standard].
  final VersionAdapterRegistry adapterRegistry;

  /// The shared `common_types.json` definitions the validators resolve
  /// against, for every protocol version, or null to use the copy this package
  /// publishes for each message's version.
  ///
  /// Pass an empty map to leave the shared types unchecked.
  final Map<String, Object?>? commonTypesSchema;

  /// Which checks each message must pass.
  ///
  /// Defaults to [ValidationConfig.strict]: every `updateComponents` must
  /// leave its surface a complete graph, with a root, references that resolve
  /// and every component reachable from the root. A caller whose transport
  /// delivers one surface across several messages relaxes the checks that span
  /// them; see [ValidationConfig].
  final ValidationConfig validationConfig;

  /// One validator per catalog and protocol version, built on first use.
  final Map<(String, A2uiProtocolVersion),
      PayloadValidator<T, FunctionImplementation>> _validators = {};

  /// Each catalog's child-reference fields, by catalog id, built on first use.
  final Map<String, Map<String, ComponentRefFields>> _refFields = {};

  MessageProcessor({
    required this.catalogs,
    this.defaultVersion,
    this.validationConfig = ValidationConfig.strict,
    this.commonTypesSchema,
    VersionAdapterRegistry? adapterRegistry,
    void Function(A2uiClientAction)? onAction,
  })  : adapterRegistry = adapterRegistry ?? VersionAdapterRegistry.standard(),
        groupModel = SurfaceGroupModel<T>() {
    final A2uiProtocolVersion? target = validationConfig.targetVersion;
    final A2uiProtocolVersion? defaultVersion = this.defaultVersion;
    if (target != null && defaultVersion != null && target != defaultVersion) {
      throw A2uiValidationError(
        "ValidationConfig.targetVersion is '${target.jsonValue}' but this "
        "processor defaults to '${defaultVersion.jsonValue}'.",
      );
    }
    if (onAction != null) {
      groupModel.onAction.addListener(onAction);
    }
  }

  /// The validator for [catalog] under protocol [version].
  ///
  /// A component belongs to exactly one catalog, so a validator is scoped to
  /// one rather than handed the whole supported set. The processor is what
  /// routes each item to the right one, which is what keeps a component of one
  /// catalog from passing on a surface whose default is another, and what lets
  /// a v1.0 surface mix catalogs.
  ///
  /// Built once per catalog and version and reused. The validator caches
  /// resolved component schemas, which a fresh instance per batch would
  /// rebuild on every message.
  ///
  /// Throws [A2uiValidationError] when this package publishes no
  /// `common_types.json` for [version] and [commonTypesSchema] is null.
  PayloadValidator<T, FunctionImplementation> validatorFor(
    Catalog<T, FunctionImplementation> catalog, {
    required A2uiProtocolVersion version,
  }) =>
      _validators.putIfAbsent(
        (catalog.id, version),
        () => PayloadValidator<T, FunctionImplementation>(
          catalog: catalog,
          commonTypesSchema: commonTypesSchema,
          protocolVersion: version,
          allowUnknownElements: validationConfig.allowUnknownElements,
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
  /// [payload] may be raw decoded JSON — a lone envelope, a list of
  /// envelopes, or the `{messages: [...]}` wrapper — or parsed messages: an
  /// [AgentToRendererMessagePayload], a lone [AgentToRendererMessage], or a
  /// list of them. A list may mix the two forms. A null payload and an empty
  /// list are an empty batch.
  ///
  /// Every message is parsed and mapped onto operations before any is
  /// applied, so a malformed envelope anywhere in the payload rejects it
  /// whole. Each message is then checked as it is applied, against the
  /// surface state the earlier messages left behind, and a message that fails
  /// leaves its surface as it was. For components that means each against the
  /// catalog it belongs to, then the surface they would leave behind against
  /// [validationConfig]: a payload that declares a parent in one
  /// `updateComponents` and its child in a later one needs
  /// [ValidationConfig.allowDanglingReferences], or both in one message.
  ///
  /// Throws [A2uiValidationError] for a payload of any other shape, an
  /// envelope that is not a well-formed message of the version it declares, a
  /// version no adapter in [adapterRegistry] serves, a component that does not
  /// match its catalog, or a message [ValidationConfig.allowedMessages] does
  /// not list; [A2uiIntegrityError] for a message naming a surface that does
  /// not exist, a missing root, a duplicate id, a reference to no component or
  /// an unreachable component; [A2uiRecursionError] for a cycle or an
  /// over-deep chain; and [A2uiCatalogError] for a catalog this processor does
  /// not support, or one whose `protocolVersion` is missing or incompatible
  /// with the message creating a surface.
  void processMessages(Object? payload) {
    final List<_RoutedMessage> routed = [
      for (final Object? item in _itemsOf(payload)) _route(item),
    ];
    for (final message in routed) {
      _apply(message);
    }
  }

  /// [processMessages], for messages whose operations complete
  /// asynchronously.
  ///
  /// No operation completes asynchronously yet, so this completes once
  /// [processMessages] returns, and fails with what it throws.
  Future<void> processMessagesAsync(Object? payload) async =>
      processMessages(payload);

  /// Alias for [processMessages] for cross-SDK ergonomics.
  void process(Object? payload) => processMessages(payload);

  /// The items [payload] carries, each a raw envelope or a parsed message.
  static List<Object?> _itemsOf(Object? payload) => switch (payload) {
        null => const [],
        final AgentToRendererMessagePayload batch => batch.messages,
        final AgentToRendererMessage message => [message],
        final List<Object?> list => list,
        final Map<Object?, Object?> wrapper
            when wrapper.containsKey('messages') =>
          switch (wrapper['messages']) {
            final List<Object?> list => list,
            _ => throw A2uiValidationError(
                "Payload field 'messages' must be a list of envelopes.",
                details: wrapper,
              ),
          },
        final Map<Object?, Object?> envelope => [envelope],
        _ => throw A2uiValidationError(
            'Payload must be an envelope, a list of envelopes, or a '
            '{messages: [...]} wrapper; got ${payload.runtimeType}.',
          ),
      };

  /// Maps one payload item onto operations through the adapter for the
  /// version it declares.
  _RoutedMessage _route(Object? item) {
    switch (item) {
      case final AgentToRendererMessage message:
        return (
          json: message.toJson(),
          operations:
              adapterRegistry.resolveMessage(message).operationsFor(message),
        );
      case final Map<Object?, Object?> envelope
          when envelope.keys.every((key) => key is String):
        final Map<String, Object?> json = envelope.cast<String, Object?>();
        return (
          json: json,
          operations: adapterRegistry.resolve(json).toOperations(json),
        );
      default:
        throw A2uiValidationError(
          'Each message must be a JSON object with string keys; got '
          '${item.runtimeType}.',
          details: item,
        );
    }
  }

  void _apply(_RoutedMessage message) {
    final List<String>? allowed = validationConfig.allowedMessages;
    if (allowed != null) {
      for (final InternalOperation operation in message.operations) {
        if (!allowed.contains(operation.messageType)) {
          throw A2uiValidationError(
            "Message '${operation.messageType}' is not permitted by "
            'ValidationConfig.allowedMessages.',
          );
        }
      }
    }

    // Data-model paths and nested function calls, which need no surface state
    // and so are checked for every message before it is applied.
    checkPathsAndRecursion(message.json);

    for (final InternalOperation operation in message.operations) {
      _execute(operation);
    }
  }

  void _execute(InternalOperation operation) {
    switch (operation) {
      case CreateSurfaceOp():
        _createSurface(operation);
      case UpdateComponentsOp():
        _updateComponents(operation);
      case UpdateDataModelOp():
        _surfaceFor(operation.surfaceId)
            .dataModel
            .set(operation.path ?? '/', operation.value);
      case DeleteSurfaceOp():
        _surfaceFor(operation.surfaceId);
        groupModel.deleteSurface(operation.surfaceId);
      case CallRendererFunctionOp():
      case AgentFunctionResponseOp():
        // Function calls across the wire are answered by an RPC layer, which
        // this processor does not have; the operations change no surface.
        break;
    }
  }

  /// The envelope fields of a component message, which a [ComponentModel]
  /// holds apart from its properties.
  static const Set<String> _envelopeFields = {
    'id',
    'component',
    'catalogId',
    'metadata',
  };

  /// Creates a surface: its data model first, as one root write, then its
  /// components, then its metadata.
  ///
  /// The inline components are checked before the surface is added, so a
  /// `createSurface` they fail creates nothing.
  void _createSurface(CreateSurfaceOp operation) {
    final Catalog<T, FunctionImplementation> catalog = _surfaceCatalog(
      operation,
    );
    _checkCatalogVersion(catalog, operation);

    if (groupModel.getSurface(operation.surfaceId) != null) {
      throw A2uiIntegrityError(
          'Surface ${operation.surfaceId} already exists.');
    }

    // The theme arrives once, with the surface, so it is checked here rather
    // than on every later message. v1.0 has no theme.
    if (validationConfig.validateSchemas &&
        !operation.version.isAtLeast(A2uiProtocolVersion.v1_0)) {
      validatorFor(catalog, version: operation.version)
          .validateTheme(operation.theme);
    }

    final surface = SurfaceModel<T>(
      operation.surfaceId,
      catalog: catalog,
      theme: operation.theme ?? {},
      sendDataModel: operation.sendDataModel,
      protocolVersion: operation.version.jsonValue,
      rootId: validationConfig.rootId ?? 'root',
    );

    _CheckedBatch? batch;
    final List<Map<String, Object?>>? components = operation.components;
    if (components != null && components.isNotEmpty) {
      try {
        batch = _checkComponents(surface, components, operation.version);
      } catch (_) {
        surface.dispose();
        rethrow;
      }
    }

    groupModel.addSurface(surface);
    if (operation.dataModel case final Map<String, Object?> dataModel) {
      surface.dataModel.set('/', dataModel);
    }
    if (batch != null) _applyComponents(surface, batch);
    surface.metadata = operation.metadata;
  }

  /// The default catalog of the surface [operation] creates.
  ///
  /// Throws [A2uiValidationError] for a message before v1.0 that names no
  /// catalog, and [A2uiCatalogError] for a v1.0 message that names none when
  /// this processor supports more than one.
  Catalog<T, FunctionImplementation> _surfaceCatalog(
    CreateSurfaceOp operation,
  ) {
    if (operation.catalogId case final String catalogId) {
      return catalogFor(catalogId);
    }
    if (!operation.version.isAtLeast(A2uiProtocolVersion.v1_0)) {
      throw A2uiValidationError(
        "Message 'createSurface' for surface '${operation.surfaceId}' names "
        'no catalogId.',
      );
    }
    // From v1.0 a surface may name no catalog. Until a surface can exist
    // without a default catalog, it takes the sole one this processor
    // supports.
    if (catalogs.length == 1) return catalogs.single;
    throw A2uiCatalogError(
      "Message 'createSurface' for surface '${operation.surfaceId}' names no "
      'catalogId, and this processor supports several: '
      '${catalogs.map((c) => c.id).join(', ')}.',
    );
  }

  /// Throws [A2uiCatalogError] unless [catalog] declares a protocol version
  /// compatible with the message creating a surface on it.
  ///
  /// Fails closed: a catalog that declares no version is rejected rather than
  /// assumed to match.
  void _checkCatalogVersion(
    Catalog<T, FunctionImplementation> catalog,
    CreateSurfaceOp operation,
  ) {
    final String messageVersion = operation.version.jsonValue;
    final String? catalogVersion = catalog.protocolVersion;
    if (catalogVersion == null) {
      throw A2uiCatalogError(
        "Catalog '${catalog.id}' declares no protocolVersion, so it cannot be "
        "checked against the '$messageVersion' message creating surface "
        "'${operation.surfaceId}'.",
        catalogId: catalog.id,
      );
    }
    if (!isCatalogVersionCompatible(catalogVersion, messageVersion)) {
      throw A2uiCatalogError(
        "Catalog '${catalog.id}' targets protocol version '$catalogVersion', "
        "which is incompatible with the '$messageVersion' message creating "
        "surface '${operation.surfaceId}'.",
        catalogId: catalog.id,
      );
    }
  }

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
      _refFields
          .putIfAbsent(catalog.id, () => extractComponentRefFields(catalog))
          .forEach(
            (String type, ComponentRefFields fields) =>
                merged.putIfAbsent(type, () => fields),
          );
    }
    return merged;
  }

  SurfaceModel<T> _surfaceFor(String surfaceId) {
    final SurfaceModel<T>? surface = groupModel.getSurface(surfaceId);
    if (surface == null) {
      throw A2uiIntegrityError('Surface not found for message: $surfaceId');
    }
    return surface;
  }

  void _updateComponents(UpdateComponentsOp operation) {
    final SurfaceModel<T> surface = _surfaceFor(operation.surfaceId);
    _applyComponents(
      surface,
      _checkComponents(surface, operation.components, operation.version),
    );
  }

  /// Checks a batch of [components] for [surface], changing nothing.
  ///
  /// Every component in the batch is resolved to a full entry and checked
  /// before any of them is applied, so a batch that is rejected leaves the
  /// surface exactly as it was. Then the surface this batch would leave
  /// behind is checked as one graph: duplicate ids, the root, references that
  /// resolve, cycles, depth and reachability, as [validationConfig] requires.
  _CheckedBatch _checkComponents(
    SurfaceModel<T> surface,
    List<Map<String, Object?>> components,
    A2uiProtocolVersion version,
  ) {
    final SurfaceComponentsModel model = surface.componentsModel;
    final List<Map<String, Object?>> resolved = [
      for (final Map<String, Object?> raw in components)
        _resolveComponent(raw, surface, version),
    ];

    final Map<String, ComponentRefFields> refFields = _refFieldsFor(
      surface.catalog.id,
      [
        for (final ComponentModel c in model.all) c.catalog,
        for (final Map<String, Object?> c in resolved)
          c['catalogId'] as String?,
      ],
    );
    model.checkComponentsUpdate(
      resolved,
      validationConfig,
      refFields,
      defaultRootId: surface.rootId,
    );
    return (resolved: resolved, refFields: refFields);
  }

  /// Applies a [batch] that [_checkComponents] accepted.
  void _applyComponents(SurfaceModel<T> surface, _CheckedBatch batch) {
    final SurfaceComponentsModel model = surface.componentsModel;
    model.refFields = batch.refFields;
    for (final Map<String, Object?> entry in batch.resolved) {
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

  /// Resolves one component entry to the full component it describes and
  /// checks it against its catalog under protocol [version].
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
    A2uiProtocolVersion version,
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
    if (validationConfig.validateSchemas) {
      validatorFor(catalog, version: version).validateComponent(full);
    }
    return full;
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
