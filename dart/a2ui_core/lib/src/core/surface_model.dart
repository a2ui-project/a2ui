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
import 'dart:convert';

import '../primitives/errors.dart';
import '../primitives/event_notifier.dart';
import '../primitives/reactivity.dart';
import '../primitives/semver.dart';
import '../primitives/uax31.dart';
import '../resolution/data_context.dart' show disposeSurfaceAgentCalls;
import '../security/url_security_policy.dart';
import 'catalog.dart';
import 'common.dart';
import 'component_model.dart';
import 'data_model.dart';
import 'messages.dart';
import 'metadata.dart';

/// A non-fatal condition on a surface, emitted on [SurfaceModel.onWarning].
class A2uiWarning {
  /// A machine-readable code, such as `'MISSING_DATA_BINDING'`.
  final String code;

  /// A human-readable explanation.
  final String message;

  /// The absolute data model path the warning concerns, if any.
  final String? path;

  /// The surface the warning came from. [SurfaceModel.dispatchWarning] sets
  /// it.
  final String? surfaceId;

  /// Further machine-readable detail, if any. A `URL_BLOCKED` warning carries
  /// `redactedUrl` (the scheme and host, a `data:` media type, or the scheme
  /// alone, never the full URL), `context`, and the [UrlCheckInfo] fields
  /// that are known.
  final Map<String, Object?>? details;

  const A2uiWarning({
    required this.code,
    required this.message,
    this.path,
    this.surfaceId,
    this.details,
  });

  @override
  String toString() => 'A2uiWarning($code: $message)';
}

/// Sends a function call the surface cannot run locally to the agent, as a
/// `callAgentFunction`, and completes with the agent's result.
///
/// Fails with an `A2uiRpcError` when the agent reports an error, the call
/// times out, or the message cannot be sent.
typedef AgentFunctionCaller = Future<Object?> Function(FunctionCall call);

/// The state model for a single UI surface.
class SurfaceModel<T extends ComponentApi> {
  final String id;

  /// The catalog that resolves components and function calls naming no
  /// `catalogId` of their own.
  ///
  /// Null when the surface was created without a catalog, in which case every
  /// item must name its catalog (see [resolveCatalog]).
  final Catalog<T, FunctionImplementation>? defaultCatalog;

  /// Every catalog an item on this surface may name by `catalogId`, keyed by
  /// id, including [defaultCatalog].
  final Map<String, Catalog<T, FunctionImplementation>> availableCatalogs;

  /// Surface-level metadata from `createSurface`, holding at most an
  /// `extensions` object.
  Map<String, Object?>? get metadata => _metadata.peek();

  /// Replaces the surface's metadata envelope.
  ///
  /// Validates UAX #31 extension keys, stores a deep unmodifiable copy, and
  /// notifies [metadataSignal] and [onMetadataChanged] only when the value
  /// changes by deep structural equality.
  set metadata(Map<String, Object?>? next) {
    validateMetadata(next);
    final Map<String, Object?>? cloned = cloneMetadata(next);
    if (sameMetadata(_metadata.peek(), cloned)) return;
    _metadata.value = cloned;
    _onMetadataChanged.emit(cloned);
  }

  /// Read-only reactive signal tracking the surface's metadata envelope.
  late final ReadonlySignal<Map<String, Object?>?> metadataSignal = computed(
    () => _metadata.value,
  );

  /// Read-only view of the `extensions` dictionary inside [metadata], if any.
  Map<String, Object?>? get extensions =>
      switch (_metadata.peek()?['extensions']) {
        final Map<String, Object?> ext => ext,
        _ => null,
      };

  /// Fires whenever the surface's metadata changes.
  EventSource<Map<String, Object?>?> get onMetadataChanged =>
      _onMetadataChanged;

  late final Signal<Map<String, Object?>?> _metadata;
  final _onMetadataChanged = EventNotifier<Map<String, Object?>?>();

  final Map<String, dynamic> theme;
  final bool sendDataModel;
  final String? protocolVersion;

  /// The id of the component this surface's tree is rooted at.
  ///
  /// `root` unless set otherwise. `NodeResolver` builds the tree from it, and
  /// `MessageProcessor` checks for it when `ValidationConfig.rootId` is null.
  final String rootId;

  final DataModel dataModel;
  final SurfaceComponentsModel componentsModel;

  /// Sends a function call this surface cannot resolve locally to the agent.
  ///
  /// On a v1.0 surface, a dynamic value, check, or action naming a function
  /// no available catalog implements is routed here instead of failing. Null,
  /// the default, keeps such a call a local `EXPRESSION_ERROR`.
  /// `MessageProcessor` wires it to its `RpcHandler`.
  ///
  /// Once this surface is disposed, the caller sends nothing: each call
  /// fails with an `A2uiRpcError` whose code is [RpcErrorCode.cancelled],
  /// which is not reported.
  AgentFunctionCaller? get callAgentFunction {
    final AgentFunctionCaller? caller = _callAgentFunction;
    if (caller == null) return null;
    return (call) => _disposed
        ? Future<Object?>.error(
            A2uiRpcError(
              "Surface '$id' has been disposed.",
              RpcErrorCode.cancelled,
            ),
          )
        : caller(call);
  }

  final AgentFunctionCaller? _callAgentFunction;

  /// How many settled agent call answers the surface keeps, so a binding
  /// that evaluates again with the same arguments reads the answer instead
  /// of sending the call again. The oldest answer is evicted first; calls
  /// still waiting for an answer don't count.
  final int maxAgentCallCacheEntries;

  /// Decides which URLs components and functions on this surface may load,
  /// open, or embed. Set once at construction: `MessageProcessor` passes its
  /// `urlSecurityPolicy`, and a surface created without one uses
  /// [PermissiveUrlSecurityPolicy].
  ///
  /// Components and functions don't read it directly: they call
  /// `sanitizeUrl` on the context they receive, and the resolver filters
  /// properties annotated as URLs.
  final UrlSecurityPolicy urlSecurityPolicy;

  /// Opens the URLs `openUrl` was allowed to open, in place of the callback
  /// the basic catalog was built with. Set once at construction from
  /// `MessageProcessor`'s `openUrlHandler`.
  final OpenUrlCallback? openUrlHandler;

  /// Keys of blocked URLs already reported, oldest first, so each is
  /// reported once.
  final Set<String> _reportedBlockedUrls = <String>{};

  final _onAction = EventNotifier<A2uiRendererAction>();
  final _onError = EventNotifier<A2uiRendererError>();
  final _onWarning = EventNotifier<A2uiWarning>();
  bool _disposed = false;

  /// Whether [dispose] has been called. A disposed surface sends no agent
  /// calls: [callAgentFunction] fails each with an `A2uiRpcError` whose code
  /// is [RpcErrorCode.cancelled], which is not reported.
  bool get isDisposed => _disposed;

  /// Fires whenever an action is dispatched from this surface.
  EventSource<A2uiRendererAction> get onAction => _onAction;

  /// Fires whenever an error occurs on this surface.
  ///
  /// Each error arrives a microtask after the [dispatchError] call that
  /// reported it, in dispatch order, so a later message may already have fixed
  /// what it describes. Errors dispatched before the surface is disposed still
  /// arrive, and later ones are dropped.
  EventSource<A2uiRendererError> get onError => _onError;

  /// Fires whenever a non-fatal warning occurs on this surface.
  ///
  /// Warnings arrive in the same order and at the same moments as [onError]
  /// errors, interleaved with them.
  EventSource<A2uiWarning> get onWarning => _onWarning;

  /// Creates a surface whose items resolve against [defaultCatalog] or, when
  /// they name one, against a catalog in [availableCatalogs].
  ///
  /// [defaultCatalog] is added to [availableCatalogs] when it is not already
  /// there. `MessageProcessor` passes its catalogs filtered to the surface's
  /// protocol version.
  ///
  /// Throws [A2uiCatalogError] when two different catalogs share an id, or
  /// when a catalog's [Catalog.protocolVersion] is incompatible with
  /// [protocolVersion]: one surface cannot mix protocol versions. Throws
  /// [ArgumentError] when [maxAgentCallCacheEntries] is less than 1.
  ///
  /// [urlSecurityPolicy] and [openUrlHandler] apply to every component and
  /// function on the surface; see [sanitizeUrl].
  SurfaceModel(
    this.id, {
    this.defaultCatalog,
    Iterable<Catalog<T, FunctionImplementation>> availableCatalogs = const [],
    this.theme = const {},
    this.sendDataModel = false,
    this.protocolVersion,
    this.rootId = 'root',
    Map<String, Object?>? metadata,
    AgentFunctionCaller? callAgentFunction,
    this.maxAgentCallCacheEntries = 256,
    this.urlSecurityPolicy = defaultUrlSecurityPolicy,
    this.openUrlHandler,
  })  : _callAgentFunction = callAgentFunction,
        availableCatalogs = Map.unmodifiable(
          _indexCatalogs(
            id,
            protocolVersion,
            [
              if (defaultCatalog != null) defaultCatalog,
              ...availableCatalogs,
            ],
          ),
        ),
        dataModel = DataModel(),
        componentsModel = SurfaceComponentsModel(catalog: defaultCatalog) {
    if (maxAgentCallCacheEntries < 1) {
      throw ArgumentError.value(
        maxAgentCallCacheEntries,
        'maxAgentCallCacheEntries',
        'Must be at least 1.',
      );
    }
    validateMetadata(metadata);
    _metadata = signal(cloneMetadata(metadata));
  }

  /// Sets a single extension entry at `metadata['extensions'][key]`.
  ///
  /// Passing `null` for [value] stores a JSON `null` under [key]. Use
  /// [removeExtension] to delete an extension key.
  void setExtension(String key, Object? value) {
    if (!isValidUax31Identifier(key)) {
      throw A2uiValidationError(
        "Invalid metadata extension key '$key': must be a valid "
        'UAX #31 identifier.',
      );
    }
    final Map<String, Object?> current = _metadata.peek() ?? const {};
    final Map<String, Object?> currentExt = switch (current['extensions']) {
      final Map<String, Object?> ext => ext,
      _ => const {},
    };
    if (currentExt.containsKey(key) && sameJsonValue(currentExt[key], value)) {
      return;
    }
    final nextExt = <String, Object?>{...currentExt, key: value};
    final nextMeta = <String, Object?>{...current, 'extensions': nextExt};
    final Map<String, Object?>? cloned = cloneMetadata(nextMeta);
    _metadata.value = cloned;
    _onMetadataChanged.emit(cloned);
  }

  /// Removes an extension entry at `metadata['extensions'][key]`.
  ///
  /// When the last extension key is removed and no other keys exist on
  /// [metadata], resets [metadata] to `null`.
  void removeExtension(String key) {
    final Map<String, Object?>? current = _metadata.peek();
    if (current == null) return;
    final Object? rawExt = current['extensions'];
    if (rawExt is! Map<String, Object?> || !rawExt.containsKey(key)) {
      return;
    }
    final nextExt = Map<String, Object?>.of(rawExt)..remove(key);
    final otherKeys = Map<String, Object?>.of(current)..remove('extensions');
    final Map<String, Object?>? nextMeta;
    if (nextExt.isEmpty) {
      nextMeta = otherKeys.isEmpty ? null : otherKeys;
    } else {
      nextMeta = <String, Object?>{...otherKeys, 'extensions': nextExt};
    }
    final Map<String, Object?>? cloned = cloneMetadata(nextMeta);
    _metadata.value = cloned;
    _onMetadataChanged.emit(cloned);
  }

  static Map<String, Catalog<T, FunctionImplementation>>
      _indexCatalogs<T extends ComponentApi>(
    String surfaceId,
    String? protocolVersion,
    Iterable<Catalog<T, FunctionImplementation>> catalogs,
  ) {
    final byId = <String, Catalog<T, FunctionImplementation>>{};
    for (final catalog in catalogs) {
      final Catalog<T, FunctionImplementation>? existing = byId[catalog.id];
      if (existing != null) {
        if (identical(existing, catalog)) continue;
        throw A2uiCatalogError(
          "Surface '$surfaceId' was given two catalogs with id "
          "'${catalog.id}'.",
          catalogId: catalog.id,
        );
      }
      final String? catalogVersion = catalog.protocolVersion?.jsonValue;
      if (protocolVersion != null &&
          !isCatalogVersionCompatible(catalogVersion, protocolVersion)) {
        final described = catalogVersion == null
            ? "unversioned catalog '${catalog.id}'"
            : "catalog '${catalog.id}' ($catalogVersion)";
        throw A2uiCatalogError(
          'Protocol version mismatch: cannot mix $described with surface '
          'version $protocolVersion.',
          catalogId: catalog.id,
        );
      }
      byId[catalog.id] = catalog;
    }
    return byId;
  }

  /// The catalog a component or function call resolves against.
  ///
  /// [catalogId] is the id the item names for itself. The order is the one
  /// v1.0 specifies: the named catalog, which must be in
  /// [availableCatalogs]; otherwise [defaultCatalog]. There is no fallback to
  /// a sole available catalog. An empty [catalogId] names a catalog too.
  /// [subject] names the item in the error, such as `"Component 'root'"`.
  ///
  /// Throws [A2uiCatalogResolutionError] when [catalogId] is not in
  /// [availableCatalogs], or when it is null and the surface has no default.
  Catalog<T, FunctionImplementation> resolveCatalog(
    String? catalogId, {
    String subject = 'Item',
  }) {
    if (catalogId != null) {
      return availableCatalogs[catalogId] ??
          (throw A2uiCatalogResolutionError(
            'Catalog not found: $catalogId. $subject names a catalog surface '
            "'$id' does not have. "
            "Available: ${availableCatalogs.keys.join(', ')}.",
            catalogId: catalogId,
          ));
    }
    return defaultCatalog ??
        (throw A2uiCatalogResolutionError(
          "$subject names no catalogId and surface '$id' has no default "
          'catalogId.',
        ));
  }

  /// Emits an agent-bound action from this surface on [onAction].
  ///
  /// The [payload] is either `{'event': {'name': ..., 'context': ...,
  /// 'userMessage': ...}}` or the same fields without the `event` wrapper.
  /// Its values must already be resolved against the data model.
  ///
  /// Any other payload, including a `functionCall` or `call` action, or an
  /// event whose `name` is missing, empty, or not a string, is reported on
  /// [onError] with code `'INVALID_ACTION'` and not emitted on [onAction].
  /// Local function actions run in `GenericBinder`, which calls this method
  /// only for actions that go to the agent.
  Future<void> dispatchAction(
    Map<String, dynamic> payload,
    String sourceComponentId, {
    Map<String, Object?>? metadata,
  }) async {
    validateMetadata(metadata);
    final Map<String, dynamic> event;
    if (payload.containsKey('event') && payload['event'] is Map) {
      event = Map<String, dynamic>.from(payload['event'] as Map);
    } else if (payload.containsKey('name')) {
      event = payload;
    } else {
      await dispatchError(
        A2uiRendererError(
          code: 'INVALID_ACTION',
          surfaceId: id,
          message: "Invalid action payload in component '$sourceComponentId': "
              'missing event or action name.',
          details: payload,
        ),
      );
      return;
    }
    final Object? payloadMetadata =
        event.containsKey('metadata') ? event['metadata'] : payload['metadata'];
    final A2uiMetadata? clonedMetadata = mergeActionMetadata(
      payloadMetadata,
      metadata,
    );

    final Object? name = event['name'];
    if (name is! String || name.isEmpty) {
      await dispatchError(
        A2uiRendererError(
          code: 'INVALID_ACTION',
          surfaceId: id,
          message: "Invalid action payload in component '$sourceComponentId': "
              'action name must be a non-empty string.',
          details: payload,
        ),
      );
      return;
    }

    final Object? rawContext = event['context'];
    final Map<String, dynamic> context;
    if (rawContext is Map) {
      final Object? detached = _detach(rawContext);
      context = detached is Map<String, dynamic>
          ? detached
          : <String, dynamic>{
              for (final MapEntry<Object?, Object?> entry in rawContext.entries)
                entry.key.toString(): _detach(entry.value),
            };
    } else {
      context = const <String, dynamic>{};
    }

    final Object? catalogId = event['catalogId'] ?? payload['catalogId'];
    final action = A2uiRendererAction(
      name: name,
      surfaceId: id,
      sourceComponentId: sourceComponentId,
      timestamp: DateTime.now().toUtc(),
      context: context,
      userMessage: event['userMessage'] is String
          ? event['userMessage'] as String
          : null,
      catalogId: catalogId is String && catalogId.isNotEmpty ? catalogId : null,
      metadata: clonedMetadata,
    );
    _onAction.emit(action);
    // Only event payloads are emitted; functionCall payloads are not
    // dispatched here.
  }

  /// Emits [error] on [onError] in a microtask, so listeners never run
  /// inside the call that found it. Completes once the microtask is
  /// scheduled.
  Future<void> dispatchError(A2uiRendererError error) async {
    if (_disposed) return;
    scheduleMicrotask(() => _onError.emit(error));
  }

  /// Emits [warning] on [onWarning] in a microtask, stamped with this
  /// surface's id. Completes once the microtask is scheduled.
  Future<void> dispatchWarning(A2uiWarning warning) async {
    if (_disposed) return;
    final stamped = A2uiWarning(
      code: warning.code,
      message: warning.message,
      path: warning.path,
      surfaceId: id,
      details: warning.details,
    );
    scheduleMicrotask(() => _onWarning.emit(stamped));
  }

  /// Checks [url] against the built-in baseline and [urlSecurityPolicy],
  /// and returns the URL to use (possibly rewritten), or null when it is
  /// blocked.
  ///
  /// A blocked URL is reported once as a `URL_BLOCKED` warning on
  /// [onWarning], whose [A2uiWarning.details] carry a redacted form of the
  /// URL (`redactedUrl`), its `context`, and the known [info] fields. The
  /// full URL is never reported, since its path or query may hold the data
  /// being exfiltrated.
  ///
  /// Components and functions usually call `sanitizeUrl` on their
  /// `ComponentContext` or `DataContext`, which fill in [info]. This surface
  /// fills in its own ID.
  String? sanitizeUrl(String url, UrlContext context, {UrlCheckInfo? info}) {
    final UrlCheckInfo fullInfo =
        (info ?? const UrlCheckInfo()).merge(UrlCheckInfo(surfaceId: id));
    final String? result = applyUrlSecurityPolicy(
      urlSecurityPolicy,
      url,
      context,
      info: fullInfo,
    );
    if (result == null) _reportBlockedUrl(url, context, fullInfo);
    return result;
  }

  void _reportBlockedUrl(String url, UrlContext context, UrlCheckInfo info) {
    if (_disposed) return;
    final String key = jsonEncode([
      url,
      context.jsonValue,
      info.componentId,
      info.propertyName,
      info.functionName,
    ]);
    if (!_reportedBlockedUrls.add(key)) return;
    if (_reportedBlockedUrls.length > _maxReportedBlockedUrls) {
      // Forgets the oldest report; a set iterates in insertion order.
      _reportedBlockedUrls.remove(_reportedBlockedUrls.first);
    }
    final source = info.propertyName != null
        ? "property '${info.propertyName}'"
            "${info.componentId != null ? " of '${info.componentId}'" : ''}"
        : info.functionName != null
            ? "function '${info.functionName}'"
            : 'a component';
    // The full URL may carry the data being exfiltrated in its path or
    // query, so only a redacted form leaves the surface.
    final String redactedUrl = redactUrl(url);
    dispatchWarning(
      A2uiWarning(
        code: 'URL_BLOCKED',
        message: 'The URL security policy blocked a ${context.jsonValue} URL '
            '($redactedUrl) in $source.',
        details: {
          ...info.toJson(),
          'redactedUrl': redactedUrl,
          'context': context.jsonValue,
        },
      ),
    );
  }

  /// The most blocked URLs a surface remembers, to report each only once.
  static const int _maxReportedBlockedUrls = 256;

  /// Disposes of the surface and its resources.
  void dispose() {
    _disposed = true;
    _reportedBlockedUrls.clear();
    disposeSurfaceAgentCalls(this);
    dataModel.dispose();
    componentsModel.dispose();
    _onMetadataChanged.dispose();
    _onAction.dispose();
    // Reports dispatched before this still reach their listeners.
    scheduleMicrotask(() {
      _onError.dispose();
      _onWarning.dispose();
    });
  }
}

/// Copies maps and lists, so an action listener cannot reach the component or
/// data model the payload was resolved from.
Object? _detach(Object? value) => switch (value) {
      Map() when value.keys.every((key) => key is String) => <String, dynamic>{
          for (final MapEntry<Object?, Object?> entry in value.entries)
            entry.key as String: _detach(entry.value),
        },
      Map() => <Object?, Object?>{
          for (final MapEntry<Object?, Object?> entry in value.entries)
            entry.key: _detach(entry.value),
        },
      List() => <Object?>[for (final Object? item in value) _detach(item)],
      _ => value,
    };
