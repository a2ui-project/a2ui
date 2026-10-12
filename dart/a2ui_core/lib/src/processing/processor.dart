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

import 'dart:async';

import 'package:json_schema_builder/json_schema_builder.dart';

import '../core/catalog.dart';
import '../core/common.dart';
import '../core/component_model.dart';
import '../core/messages.dart';
import '../core/renderer_capabilities.dart';
import '../core/surface_group_model.dart';
import '../core/surface_model.dart';
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/semver.dart';
import '../rpc/rpc_handler.dart';
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
/// and each batch of components before any of it is applied: duplicate ids
/// within the batch, every component against its catalog's schema, and, when
/// the processor has a [validationConfig], the surface the batch would leave
/// behind (the components already there, with the batch applied on top) as
/// one graph. Without a config the graph is not checked, so a surface may
/// arrive across several messages in any order; see [ValidationConfig].
class MessageProcessor<T extends ComponentApi> {
  final SurfaceGroupModel<T> groupModel;
  final List<Catalog<T, FunctionImplementation>> catalogs;

  /// The protocol version this processor targets by default, or null for
  /// none.
  ///
  /// It does not supply a version for messages. Every message must declare
  /// its own `version`, and a message without one is rejected. Each message is
  /// routed on the version it declares, through [adapterRegistry], and is not
  /// checked against this one.
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

  /// One validator per catalog and protocol version, built on first use.
  final Map<(String, A2uiProtocolVersion),
      PayloadValidator<T, FunctionImplementation>> _validators = {};

  /// Each catalog's child-reference fields, by catalog id, built on first use.
  final Map<String, Map<String, ComponentRefFields>> _refFields = {};

  /// The RPC layer: it answers the `callRendererFunction` messages this
  /// processor receives, settles its `agentFunctionResponse`s, and sends the
  /// `callAgentFunction`s made through [callAgentFunction] or by a surface's
  /// fallback for a function no catalog implements.
  late final RpcHandler rpc = RpcHandler(
    catalogs: catalogs,
    outboundListener: _outboundListener,
    defaultTimeout: _defaultTimeout,
  );

  final OutboundMessageListener? _outboundListener;
  final Duration _defaultTimeout;

  /// [outboundListener] receives every message the RPC layer sends to the
  /// agent, and [defaultTimeout] bounds how long [callAgentFunction] waits
  /// for an answer; see [RpcHandler].
  MessageProcessor({
    required this.catalogs,
    this.defaultVersion,
    this.validationConfig,
    this.commonTypesSchema,
    VersionAdapterRegistry? adapterRegistry,
    void Function(A2uiClientAction)? onAction,
    OutboundMessageListener? outboundListener,
    Duration defaultTimeout = const Duration(seconds: 30),
  })  : adapterRegistry = adapterRegistry ?? VersionAdapterRegistry.standard(),
        groupModel = SurfaceGroupModel<T>(),
        _outboundListener = outboundListener,
        _defaultTimeout = defaultTimeout {
    final A2uiProtocolVersion? target = validationConfig?.targetVersion;
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
  /// catalog it belongs to, then, under a [validationConfig], the surface they
  /// would leave behind: a payload that declares a parent in one
  /// `updateComponents` and its child in a later one needs
  /// [ValidationConfig.allowDanglingReferences], or both in one message, or
  /// no config.
  ///
  /// Throws [A2uiValidationError] for a payload of any other shape, an
  /// envelope that is not a well-formed message of the version it declares, a
  /// version no adapter in [adapterRegistry] serves, a component that does not
  /// match its catalog, or a message [ValidationConfig.allowedMessages] does
  /// not list; [A2uiIntegrityError] for a message naming a surface that does
  /// not exist, a duplicate id, and under a config a missing root, a reference
  /// to no component or an unreachable component; [A2uiRecursionError] under a
  /// config for a cycle or an over-deep chain; and [A2uiCatalogError] for a
  /// catalog this processor does not support, or one whose `protocolVersion`
  /// is missing or incompatible with the message creating a surface.
  ///
  /// A `callRendererFunction` is answered through [rpc] after this returns;
  /// [isUserActivated] tells it whether the payload is being handled within
  /// a user activation, which a function that requires one needs. Use
  /// [processMessagesAsync] to wait for the answer.
  void processMessages(Object? payload, {bool isUserActivated = false}) {
    final List<_RoutedMessage> routed = [
      for (final Object? item in _itemsOf(payload)) _route(item),
    ];
    for (final message in routed) {
      for (final Future<void>? work in _apply(message, isUserActivated)) {
        // Never fails: handleCallRendererFunction answers errors instead.
        if (work != null) unawaited(work);
      }
    }
  }

  /// [processMessages], for messages whose operations complete
  /// asynchronously.
  ///
  /// Completes once every `callRendererFunction` in [payload] has been run
  /// and its `rendererFunctionResponse` emitted; the other operations are
  /// applied as [processMessages] applies them, and a failure of theirs fails
  /// the returned future.
  Future<void> processMessagesAsync(
    Object? payload, {
    bool isUserActivated = false,
  }) async {
    final List<_RoutedMessage> routed = [
      for (final Object? item in _itemsOf(payload)) _route(item),
    ];
    for (final message in routed) {
      for (final Future<void>? work in _apply(message, isUserActivated)) {
        if (work != null) await work;
      }
    }
  }

  /// Sends [call] to the agent on behalf of [surfaceId] and completes with
  /// its result. The same as `rpc.callAgentFunction`, which needs no setup
  /// this processor would otherwise do first.
  Future<Object?> callAgentFunction(
    String surfaceId,
    FunctionCall call, {
    CallOptions? options,
  }) =>
      rpc.callAgentFunction(surfaceId, call, options: options);

  /// Disposes the RPC layer, failing its pending calls, and every surface.
  void dispose() {
    rpc.dispose();
    groupModel.dispose();
  }

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

  /// Applies [message]'s operations in order and returns, for each, the
  /// asynchronous work it started, or null for one that completed in place.
  List<Future<void>?> _apply(_RoutedMessage message, bool isUserActivated) {
    final List<String>? allowed = validationConfig?.allowedMessages;
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
    // and so are checked for every message before it is applied. Part of the
    // validation a config turns on.
    if (validationConfig != null) {
      checkPathsAndRecursion(message.json);
    }

    return [
      for (final InternalOperation operation in message.operations)
        _execute(operation, isUserActivated),
    ];
  }

  Future<void>? _execute(InternalOperation operation, bool isUserActivated) {
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
        // An unknown surface id is a no-op, matching the conformance suite
        // and the TypeScript and Python SDKs.
        groupModel.deleteSurface(operation.surfaceId);
      case CallRendererFunctionOp():
        return _callRendererFunction(operation, isUserActivated);
      case AgentFunctionResponseOp():
        rpc.handleAgentFunctionResponse(
          AgentFunctionResponseMessage(
            version: operation.version.jsonValue,
            response: operation.response,
          ),
        );
    }
    return null;
  }

  /// Hands a `callRendererFunction` to [rpc], against the first surface whose
  /// default catalog is the catalog the call names, else the first surface
  /// that holds the catalog, else the first surface, else no surface at all,
  /// in which case the function runs headless.
  Future<void> _callRendererFunction(
    CallRendererFunctionOp operation,
    bool isUserActivated,
  ) {
    final Object? catalogId = operation.callFunction['catalogId'];
    SurfaceModel<T>? target;
    if (catalogId is String) {
      for (final SurfaceModel<T> surface in groupModel.allSurfaces) {
        if (surface.defaultCatalog?.id == catalogId) {
          target = surface;
          break;
        }
      }
    }
    if (target == null) {
      for (final SurfaceModel<T> surface in groupModel.allSurfaces) {
        target ??= surface;
        if (catalogId is String &&
            surface.availableCatalogs.containsKey(catalogId)) {
          target = surface;
          break;
        }
      }
    }
    return rpc.handleCallRendererFunction(
      CallRendererFunctionMessage(
        version: operation.version.jsonValue,
        functionCallId: operation.functionCallId,
        callFunction: operation.callFunction,
      ),
      surface: target,
      context: ExecutionContext(isUserActivated: isUserActivated),
    );
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
  /// components.
  ///
  /// The inline components are checked before the surface is added, so a
  /// `createSurface` they fail creates nothing.
  void _createSurface(CreateSurfaceOp operation) {
    final Catalog<T, FunctionImplementation>? catalog = _surfaceCatalog(
      operation,
    );
    if (catalog != null) _checkCatalogVersion(catalog, operation);

    if (groupModel.getSurface(operation.surfaceId) != null) {
      throw A2uiIntegrityError(
          'Surface ${operation.surfaceId} already exists.');
    }

    // The theme arrives once, with the surface, so it is checked here rather
    // than on every later message. v1.0 has no theme.
    if (catalog != null &&
        !operation.version.isAtLeast(A2uiProtocolVersion.v1_0)) {
      validatorFor(catalog, version: operation.version)
          .validateTheme(operation.theme);
    }

    final surface = SurfaceModel<T>(
      operation.surfaceId,
      defaultCatalog: catalog,
      availableCatalogs: [
        for (final Catalog<T, FunctionImplementation> candidate in catalogs)
          if (isCatalogVersionCompatible(
            candidate.protocolVersion?.jsonValue,
            operation.version.jsonValue,
          ))
            candidate,
      ],
      theme: operation.theme ?? {},
      sendDataModel: operation.sendDataModel,
      protocolVersion: operation.version.jsonValue,
      rootId: validationConfig?.rootId ?? 'root',
      metadata: operation.metadata,
      callAgentFunction: (call) =>
          rpc.callAgentFunction(operation.surfaceId, call),
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
    try {
      if (operation.dataModel case final Map<String, Object?> dataModel) {
        surface.dataModel.set('/', dataModel);
      }
      if (batch != null) _applyComponents(surface, batch);
    } catch (_) {
      // Do not leave a half-initialized surface registered.
      groupModel.deleteSurface(operation.surfaceId);
      rethrow;
    }
  }

  /// The default catalog of the surface [operation] creates, or null when a
  /// v1.0 message names none.
  ///
  /// From v1.0 `catalogId` is optional on `createSurface`: a surface without
  /// one has no default catalog, so each item on it must name its own, and
  /// one that does not is rejected by [SurfaceModel.resolveCatalog]. There is
  /// no fallback to the catalogs this processor supports, even when it
  /// supports exactly one.
  ///
  /// Throws [A2uiValidationError] for a message before v1.0 that names no
  /// catalog, as those versions require one.
  Catalog<T, FunctionImplementation>? _surfaceCatalog(
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
    return null;
  }

  /// Throws [A2uiCatalogError] unless [catalog] declares a protocol version
  /// compatible with the message creating a surface on it.
  ///
  /// A catalog that declares no version is pre-v1.0 (see
  /// [isCatalogVersionCompatible]): it serves a message below 1.0 and is
  /// rejected for one from 1.0 on.
  void _checkCatalogVersion(
    Catalog<T, FunctionImplementation> catalog,
    CreateSurfaceOp operation,
  ) {
    final String messageVersion = operation.version.jsonValue;
    final String? catalogVersion = catalog.protocolVersion?.jsonValue;
    if (isCatalogVersionCompatible(catalogVersion, messageVersion)) return;
    final declared = catalogVersion == null
        ? 'declares no protocolVersion, so it is pre-v1.0,'
        : "targets protocol version '$catalogVersion',";
    throw A2uiCatalogError(
      "Catalog '${catalog.id}' $declared which is incompatible with the "
      "'$messageVersion' message creating surface '${operation.surfaceId}'.",
      catalogId: catalog.id,
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
    SurfaceModel<T> surface,
    Iterable<String?> componentCatalogIds,
  ) {
    final ids = <String>{
      if (surface.defaultCatalog case final catalog?) catalog.id,
      for (final String? id in componentCatalogIds)
        if (id != null) id,
    };
    final Iterable<Catalog<T, FunctionImplementation>> involved =
        ids.map(surface.resolveCatalog);

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

  /// The composition constraints of the catalogs [components] draw on,
  /// merged the way [_refFieldsFor] merges reference fields.
  Map<String, CompositionRule> _compositionRulesFor(
    SurfaceModel<T> surface,
    Iterable<Map<String, Object?>> components,
  ) {
    final ids = <String>{
      if (surface.defaultCatalog case final catalog?) catalog.id,
      for (final Map<String, Object?> component in components)
        if (component['catalogId'] case final String id) id,
    };
    final Iterable<Catalog<T, FunctionImplementation>> involved =
        ids.map(surface.resolveCatalog);

    final merged = <String, CompositionRule>{};
    for (final catalog in involved) {
      extractCompositionRules(catalog).forEach(
        (String type, CompositionRule rule) =>
            merged.putIfAbsent(type, () => rule),
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
  /// behind is checked as one graph: duplicate ids, then under a
  /// [validationConfig] the root, references that resolve, cycles, depth and
  /// reachability, as its flags require.
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
      surface,
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
    final List<Map<String, Object?>> existing = [
      for (final ComponentModel c in model.all)
        if (!resolved.any((Map<String, Object?> r) => r['id'] == c.id))
          c.toJson(),
    ];
    checkCompositionConstraints(
      resolved,
      refFields,
      _compositionRulesFor(surface, [...resolved, ...existing]),
      existing: existing,
      rootId: surface.rootId,
      surfaceId: surface.id,
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

    final Catalog<T, FunctionImplementation> catalog =
        surface.resolveCatalog(catalogId);
    validatorFor(catalog, version: version).validateComponent(full);
    return full;
  }

  /// The capabilities object this processor's renderer advertises, with one
  /// entry per version in [CapabilitiesOptions.versions].
  ///
  /// Each entry lists the id of every catalog in [catalogs]. With
  /// [CapabilitiesOptions.includeInlineCatalogs] it also carries the catalogs
  /// themselves, shaped for that entry's version as
  /// [A2uiVersionCapabilities.toJson] describes: the legacy inline catalog
  /// below v1.0, the standalone catalog schema document from v1.0.
  ///
  /// Throws [A2uiValidationError] if [CapabilitiesOptions.versions] is empty.
  A2uiRendererCapabilities getRendererCapabilities(
    CapabilitiesOptions options,
  ) {
    if (options.versions.isEmpty) {
      throw A2uiValidationError(
        'At least one protocol version must be provided in '
        'CapabilitiesOptions to generate renderer capabilities.',
      );
    }
    final List<String> catalogIds = List.unmodifiable([
      for (final Catalog<T, FunctionImplementation> catalog in catalogs)
        catalog.id,
    ]);
    final List<CatalogApi> inlineCatalogs =
        options.includeInlineCatalogs ? List.unmodifiable(catalogs) : const [];
    return A2uiRendererCapabilities(
      versions: {
        for (final A2uiProtocolVersion version in options.versions)
          version: A2uiVersionCapabilities(
            supportedCatalogIds: catalogIds,
            inlineCatalogs: inlineCatalogs,
          ),
      },
    );
  }

  /// The data models of the surfaces created with `sendDataModel`, in the
  /// shape of the `a2uiClientDataModel` object the renderer sends with each
  /// message: `{'version': ..., 'surfaces': {<surfaceId>: <data model>}}`.
  ///
  /// With a [version], only surfaces whose protocol version is compatible
  /// with it (see [isCatalogVersionCompatible]) are included, along with
  /// surfaces that record no version. Without one, the version is the one
  /// the surfaces share, or v1.0 when none records a version.
  ///
  /// Returns null when no surface qualifies. Throws [A2uiValidationError] if
  /// [version] is omitted and the surfaces record different versions.
  Map<String, Object?>? getRendererDataModel({A2uiProtocolVersion? version}) {
    final List<SurfaceModel<T>> enabled = [
      for (final SurfaceModel<T> surface in groupModel.allSurfaces)
        if (surface.sendDataModel) surface,
    ];
    if (enabled.isEmpty) return null;

    if (version != null) {
      final surfaces = <String, Object?>{
        for (final SurfaceModel<T> surface in enabled)
          if (surface.protocolVersion == null ||
              isCatalogVersionCompatible(
                surface.protocolVersion!,
                version.jsonValue,
              ))
            surface.id: surface.dataModel.get('/'),
      };
      if (surfaces.isEmpty) return null;
      return {'version': version.jsonValue, 'surfaces': surfaces};
    }

    final Set<String> versions = {
      for (final SurfaceModel<T> surface in enabled)
        if (surface.protocolVersion case final String declared)
          A2uiProtocolVersion.tryParse(declared)?.jsonValue ?? declared,
    };
    if (versions.length > 1) {
      throw A2uiValidationError(
        'Multiple protocol versions detected among active surfaces: '
        '${(versions.toList()..sort()).join(', ')}. Specify a target '
        'protocol version in getRendererDataModel(version).',
      );
    }
    return {
      'version': versions.isEmpty
          ? A2uiProtocolVersion.v1_0.jsonValue
          : versions.single,
      'surfaces': <String, Object?>{
        for (final SurfaceModel<T> surface in enabled)
          surface.id: surface.dataModel.get('/'),
      },
    };
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
