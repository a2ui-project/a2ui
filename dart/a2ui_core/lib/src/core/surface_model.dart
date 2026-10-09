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

import '../primitives/errors.dart';
import '../primitives/event_notifier.dart';
import '../primitives/semver.dart';
import 'catalog.dart';
import 'common.dart';
import 'component_model.dart';
import 'data_model.dart';
import 'messages.dart';

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

  const A2uiWarning({
    required this.code,
    required this.message,
    this.path,
    this.surfaceId,
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
  final Map<String, dynamic>? metadata;

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
  final AgentFunctionCaller? callAgentFunction;

  final _onAction = EventNotifier<A2uiClientAction>();
  final _onError = EventNotifier<A2uiClientError>();
  final _onWarning = EventNotifier<A2uiWarning>();

  /// Fires whenever an action is dispatched from this surface.
  EventListenable<A2uiClientAction> get onAction => _onAction;

  /// Fires whenever an error occurs on this surface.
  EventListenable<A2uiClientError> get onError => _onError;

  /// Fires whenever a non-fatal warning occurs on this surface.
  EventListenable<A2uiWarning> get onWarning => _onWarning;

  /// Creates a surface whose items resolve against [defaultCatalog] or, when
  /// they name one, against a catalog in [availableCatalogs].
  ///
  /// [defaultCatalog] is added to [availableCatalogs] when it is not already
  /// there. `MessageProcessor` passes its catalogs filtered to the surface's
  /// protocol version.
  ///
  /// Throws [A2uiCatalogError] when two different catalogs share an id, or
  /// when a catalog's [Catalog.protocolVersion] is incompatible with
  /// [protocolVersion]: one surface cannot mix protocol versions.
  SurfaceModel(
    this.id, {
    this.defaultCatalog,
    Iterable<Catalog<T, FunctionImplementation>> availableCatalogs = const [],
    this.theme = const {},
    this.sendDataModel = false,
    this.protocolVersion,
    this.rootId = 'root',
    this.metadata,
    this.callAgentFunction,
  })  : availableCatalogs = Map.unmodifiable(
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
        componentsModel = SurfaceComponentsModel(catalog: defaultCatalog);

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
  /// a sole available catalog.
  ///
  /// Throws [A2uiCatalogResolutionError] when [catalogId] is not in
  /// [availableCatalogs], or when it is null and the surface has no default.
  Catalog<T, FunctionImplementation> resolveCatalog(String? catalogId) {
    if (catalogId != null) {
      return availableCatalogs[catalogId] ??
          (throw A2uiCatalogResolutionError(
            "Catalog '$catalogId' is not supported by surface '$id'.",
            catalogId: catalogId,
          ));
    }
    return defaultCatalog ??
        (throw A2uiCatalogResolutionError(
          "Surface '$id' has no default catalog, so an item that names no "
          'catalogId cannot be resolved.',
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
    String sourceComponentId,
  ) async {
    final Map<String, dynamic> event;
    if (payload.containsKey('event') && payload['event'] is Map) {
      event = Map<String, dynamic>.from(payload['event'] as Map);
    } else if (payload.containsKey('name')) {
      event = payload;
    } else {
      await dispatchError(
        A2uiClientError(
          code: 'INVALID_ACTION',
          surfaceId: id,
          message: "Invalid action payload in component '$sourceComponentId': "
              'missing event or action name.',
          details: payload,
        ),
      );
      return;
    }

    final Object? name = event['name'];
    if (name is! String || name.isEmpty) {
      await dispatchError(
        A2uiClientError(
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
    final action = A2uiClientAction(
      name: name,
      surfaceId: id,
      sourceComponentId: sourceComponentId,
      timestamp: DateTime.now().toUtc(),
      context: context,
      userMessage: event['userMessage'] is String
          ? event['userMessage'] as String
          : null,
      catalogId: catalogId is String && catalogId.isNotEmpty ? catalogId : null,
    );
    _onAction.emit(action);
    // Only event payloads are emitted; functionCall payloads are not
    // dispatched here.
  }

  /// Dispatches an error from this surface.
  Future<void> dispatchError(A2uiClientError error) async {
    _onError.emit(error);
  }

  /// Emits [warning] on [onWarning], stamped with this surface's id.
  Future<void> dispatchWarning(A2uiWarning warning) async {
    _onWarning.emit(
      A2uiWarning(
        code: warning.code,
        message: warning.message,
        path: warning.path,
        surfaceId: id,
      ),
    );
  }

  /// Disposes of the surface and its resources.
  void dispose() {
    dataModel.dispose();
    componentsModel.dispose();
    _onAction.dispose();
    _onError.dispose();
    _onWarning.dispose();
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
