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

import 'dart:collection';

import 'package:a2ui_core/a2ui_core.dart';

import 'catalogs.dart';

/// The `version` values that messages for each protocol version's catalogs
/// state. As in the core's catalog compatibility, v0.9 and v0.9.1 catalogs
/// are interchangeable, so both accept either version.
const Map<A2uiProtocolVersion, Set<String>> _messageVersions = {
  A2uiProtocolVersion.v0_9: {'v0.9', 'v0.9.1'},
  A2uiProtocolVersion.v0_9_1: {'v0.9', 'v0.9.1'},
  A2uiProtocolVersion.v1_0: {'v1.0'},
};

/// Messages are applied one at a time, and a component may name a child that
/// a later message adds, so references, the root and reachability are left
/// to [RendererState.checkTopology]. Unlike [ValidationConfig.relaxed],
/// unknown components are still rejected.
const ValidationConfig _inProgressValidation = ValidationConfig(
  allowDanglingReferences: true,
  allowMissingRoot: true,
  allowOrphanComponents: true,
);

/// Undoes one change to the state.
typedef _Undo = void Function();

/// The agent's mirror of the surfaces a renderer holds.
///
/// The state wraps one `MessageProcessor` and runs the agent's outbound
/// messages through it, so a message is checked against everything the
/// renderer has already received: a reference resolves against the
/// components earlier messages added, and a cycle is found across the whole
/// surface.
///
/// How long a state lives is the one difference between the two ways an
/// agent shows UI:
///
/// - In a chat, each turn shows new UI, so each turn uses a new state.
/// - In a canvas, turns update the same surfaces, so one state lives for the
///   whole conversation and every turn is checked against it.
///
/// A message is applied when it is sent. [apply] is atomic: if a message is
/// rejected, the state is left as it was before the call. [transaction]
/// extends that to several calls, which is how a response parsed whole is
/// applied all or nothing. A streamed response cannot be rolled back, since
/// the renderer has already received what was emitted.
///
/// Being atomic costs what the messages change, not the size of the surfaces
/// they touch. While an [apply] or a transaction is open, the state keeps an
/// undo log: each message records what it replaced, and a failure reverts
/// those records, latest first. A deleted surface is the one change recorded
/// whole, and it is restored by replaying it through the processor. No
/// surface is copied when a message is applied or a transaction opens.
///
/// The state holds the surfaces as they now stand, not the messages that
/// built them. An update to a surface the state never saw created is
/// rejected, as the renderer would reject it.
///
/// The state is authoritative for surfaces and their components. The data
/// model values it holds can drift from the renderer's, since the user edits
/// bound inputs there, but no check depends on them.
class RendererState {
  /// Creates the empty state of a renderer that holds [catalogs].
  ///
  /// Each surface is checked against the catalog its `catalogId` names.
  ///
  /// Throws [A2uiCatalogError] if [catalogs] is empty, or if they target
  /// protocol versions whose messages differ, such as v0.9 and v1.0.
  RendererState(List<CatalogApi> catalogs)
    : this._(catalogs, assumesUnknownSurfaces: false);

  RendererState._(
    List<CatalogApi> catalogs, {
    required bool assumesUnknownSurfaces,
  }) : catalogs = List.unmodifiable(catalogs),
       _protocolVersion = _checkCatalogs(catalogs),
       _assumesUnknownSurfaces = assumesUnknownSurfaces {
    _processor = MessageProcessor<ComponentApi>.forAgent(
      catalogs: this.catalogs,
      defaultVersion: _protocolVersion,
      validationConfig: _inProgressValidation,
    );
  }

  /// The active catalogs, in priority order.
  final List<CatalogApi> catalogs;

  final A2uiProtocolVersion _protocolVersion;

  /// Whether an update to a surface the state never saw created makes an
  /// empty placeholder for it instead of being rejected. Only a state that
  /// checks one payload on its own, with no record of earlier ones, sets it.
  final bool _assumesUnknownSurfaces;

  late final MessageProcessor<ComponentApi> _processor;

  /// The surfaces created as placeholders, whose trees are not checked.
  final Set<String> _assumed = {};

  /// The components each surface added or replaced since its tree was last
  /// checked.
  final Map<String, Set<String>> _changed = {};

  /// How to undo each change made since the outermost open [apply] or
  /// transaction began.
  final List<_Undo> _log = [];

  /// How many [apply] calls and transactions are open.
  int _open = 0;

  /// The ids of the surfaces the renderer holds, in no particular order.
  List<String> get surfaceIds => [
    for (final SurfaceModel<ComponentApi> surface
        in _processor.model.allSurfaces)
      surface.id,
  ];

  /// The surface with [surfaceId], or null. Callers must not modify it.
  SurfaceModel<ComponentApi>? getSurface(String surfaceId) =>
      _processor.model.getSurface(surfaceId);

  /// Checks [messages] against the state and applies them.
  ///
  /// Each message must state a `version` that the catalogs' protocol version
  /// accepts: `v0.9` or `v0.9.1` for v0.9 and v0.9.1 catalogs, and `v1.0` for
  /// v1.0 catalogs. Each component and function call is checked against the
  /// catalog it resolves to, and component ids and cycles against the
  /// surface's components. References, the root and reachability are left to
  /// [checkTopology], since a component may name a child that a later message
  /// adds.
  ///
  /// The call is atomic: if a message is rejected, none of them is applied.
  /// Being atomic costs what the messages change, not the size of the
  /// surfaces they touch.
  ///
  /// Returns the ids of the surfaces the messages create, update or delete,
  /// in the order the messages first name them.
  ///
  /// Throws [A2uiValidationError], or a subclass such as
  /// [A2uiIntegrityError], describing the first problem found if a renderer
  /// in this state would reject a message.
  List<String> apply(Iterable<AgentToRendererMessage> messages) {
    final List<AgentToRendererMessage> payload = messages.toList();
    if (payload.isEmpty) return [];
    for (final (int index, AgentToRendererMessage message) in payload.indexed) {
      _checkMessage(message, index);
    }
    final touched = <String>{};
    _frame(() {
      for (var index = 0; index < payload.length; index++) {
        final String? surfaceId = _applyMessage(payload, index);
        if (surfaceId != null) touched.add(surfaceId);
      }
    });
    return touched.toList();
  }

  /// Checks the whole tree of each surface in [surfaceIds].
  ///
  /// The surface must have its root, and every reference must resolve. Every
  /// component added or replaced since the surface's tree was last checked
  /// must be reachable from the root, within the depth limit. A component
  /// that an update left unreachable, by rewriting its parent's children, is
  /// accepted: the protocol has no message that removes one component, so
  /// replacing part of a canvas always leaves such components behind. A
  /// surface with no components yet passes, since its components may arrive
  /// later. Surfaces that are deleted or assumed are skipped.
  ///
  /// Throws [A2uiValidationError] if a surface's tree is incomplete or
  /// invalid.
  void checkTopology(Iterable<String> surfaceIds) {
    final List<String> ids = LinkedHashSet<String>.of(surfaceIds).toList();
    for (final surfaceId in ids) {
      if (_assumed.contains(surfaceId)) continue;
      final SurfaceModel<ComponentApi>? surface = getSurface(surfaceId);
      if (surface == null) continue;
      final SurfaceComponentsModel components = surface.componentsModel;
      if (components.size == 0) continue;
      final String rootId = surface.rootId;
      final Set<String> reachable = _asValidationError(() {
        components.validateTopology(
          ValidationConfig(rootId: rootId, allowOrphanComponents: true),
        );
        return components.detectCycles(rootId: rootId);
      });
      final List<String> unreachable = [
        for (final String id in _changed[surfaceId] ?? const <String>{})
          if (components.has(id) && !reachable.contains(id)) id,
      ]..sort();
      if (unreachable.isNotEmpty) {
        throw A2uiIntegrityError(
          "Component '${unreachable.first}' is not reachable from '$rootId'",
          componentIds: unreachable,
        );
      }
    }
    for (final surfaceId in ids) {
      // An assumed surface was not checked, so what changed on it stays
      // recorded for the check after it is created.
      if (!_assumed.contains(surfaceId)) _forgetChanged(surfaceId);
    }
  }

  /// Runs [body] atomically and returns what it returns.
  ///
  /// If [body] throws, the state is restored to what it was when [body]
  /// started, and the error propagates. Opening a transaction copies nothing,
  /// and undoing one costs what was applied inside it. Transactions nest: an
  /// inner transaction that fails restores the state to where the inner one
  /// started, and the outer one goes on. [body] must be synchronous: what an
  /// asynchronous body applies after its first `await` is outside the
  /// transaction.
  T transaction<T>(T Function() body) => _frame(body);

  /// Releases the surfaces the state holds. The state cannot be used
  /// afterwards.
  void dispose() => _processor.model.dispose();

  /// Runs [body] and undoes what it changed if it throws.
  ///
  /// The frame is a position in the undo log. A failure reverts the log to
  /// it, so a failed inner frame undoes only what was changed inside it. Once
  /// the outermost frame ends, nothing can be undone any more, and the log is
  /// cleared.
  T _frame<T>(T Function() body) {
    final int mark = _log.length;
    _open++;
    try {
      return body();
    } catch (_) {
      _revert(mark);
      rethrow;
    } finally {
      _open--;
      if (_open == 0) _log.clear();
    }
  }

  /// Undoes the changes logged after [mark], latest first.
  void _revert(int mark) {
    while (_log.length > mark) {
      _log.removeLast()();
    }
  }

  /// Logs how to undo a change, if an [apply] or transaction is open.
  void _record(_Undo undo) {
    if (_open > 0) _log.add(undo);
  }

  // The state's own bookkeeping. Each change goes through one of these, so
  // that it is logged.

  void _setAssumed(String surfaceId, bool assumed) {
    if (_assumed.contains(surfaceId) == assumed) return;
    if (assumed) {
      _assumed.add(surfaceId);
      _record(() => _assumed.remove(surfaceId));
    } else {
      _assumed.remove(surfaceId);
      _record(() => _assumed.add(surfaceId));
    }
  }

  /// Records components a surface added or replaced since its tree was last
  /// checked.
  void _noteChanged(String surfaceId, Iterable<String> componentIds) {
    Set<String>? changed = _changed[surfaceId];
    if (changed == null) {
      changed = _changed[surfaceId] = {};
      _record(() => _changed.remove(surfaceId));
    }
    final Set<String> set = changed;
    final List<String> added = [
      for (final String id in componentIds)
        if (set.add(id)) id,
    ];
    if (added.isNotEmpty) _record(() => set.removeAll(added));
  }

  /// Stops holding what a surface changed against its next tree check.
  void _forgetChanged(String surfaceId) {
    final Set<String>? changed = _changed.remove(surfaceId);
    if (changed == null) return;
    _record(() => _changed[surfaceId] = changed);
  }

  /// Runs [message] through the processor, logging what it replaces.
  ///
  /// The processor checks a message whole before it changes a surface, so a
  /// rejected message changes nothing. Should one fail part way all the same,
  /// what it changed is undone before the error propagates.
  void _process(AgentToRendererMessage message) {
    final _Undo? undo = _open > 0 ? _undoFor(message) : null;
    try {
      _processUnlogged([message]);
    } catch (_) {
      undo?.call();
      rethrow;
    }
    if (undo != null) _record(undo);
  }

  /// Runs [messages] through the processor, logging nothing.
  void _processUnlogged(List<AgentToRendererMessage> messages) =>
      _asValidationError(() => _processor.processMessages(messages));

  /// How to undo [message], read before it is applied, or null when there is
  /// nothing to undo.
  _Undo? _undoFor(AgentToRendererMessage message) {
    final SurfaceGroupModel<ComponentApi> model = _processor.model;
    switch (message) {
      case CreateSurfaceMessage(:final String surfaceId):
        if (model.getSurface(surfaceId) != null) return null;
        return () => model.deleteSurface(surfaceId);
      case DeleteSurfaceMessage(:final String surfaceId):
        final SurfaceModel<ComponentApi>? surface = model.getSurface(surfaceId);
        return surface == null ? null : _surfaceRestorer(surface);
      case UpdateComponentsMessage():
        return _componentsRestorer(message);
      case UpdateDataModelMessage():
        return _dataModelRestorer(message);
      default:
        // Function calls and responses change no surface.
        return null;
    }
  }

  /// Records the components an `updateComponents` adds or replaces.
  ///
  /// The core updates a component in place when the update keeps its type
  /// and catalog, so the record holds a copy of the component's previous
  /// properties and metadata, not the maps the update replaces them with.
  _Undo? _componentsRestorer(UpdateComponentsMessage message) {
    final String surfaceId = message.surfaceId;
    final SurfaceModel<ComponentApi>? surface = getSurface(surfaceId);
    if (surface == null) return null;
    final previous = <_ComponentRecord>[];
    for (final Map<String, Object?> component in message.components) {
      if (component['id'] case final String id) {
        final ComponentModel? existing = surface.componentsModel.get(id);
        previous.add(
          _ComponentRecord(
            id,
            existing,
            existing?.properties,
            existing == null
                ? const {}
                : _deepCopy(existing.properties)! as Map<String, dynamic>,
            _deepCopy(existing?.metadata) as Map<String, Object?>?,
          ),
        );
      }
    }
    if (previous.isEmpty) return null;
    return () {
      // Found again by id: undoing a later delete replays the surface into
      // new objects.
      final SurfaceComponentsModel? components = getSurface(
        surfaceId,
      )?.componentsModel;
      if (components == null) return;
      for (final _ComponentRecord record in previous.reversed) {
        final ComponentModel? existing = record.existing;
        final ComponentModel? current = components.get(record.id);
        if (existing == null) {
          components.removeComponent(record.id);
        } else if (identical(current, existing)) {
          // Left as it was when the message failed before changing it.
          if (identical(current!.properties, record.properties)) continue;
          current.metadata = record.metadata;
          current.properties = record.copy;
        } else {
          // The update replaced the component with one of another type or
          // catalog, and the core disposed of the old one.
          components.removeComponent(record.id);
          components.addComponent(
            ComponentModel(
              record.id,
              existing.type,
              record.copy,
              catalog: existing.catalog,
              metadata: record.metadata,
            ),
          );
        }
      }
    };
  }

  /// Records the data model value an `updateDataModel` replaces.
  ///
  /// Setting a path creates the containers above it that are missing, and
  /// pads a list up to the index it sets, so the record is taken at the first
  /// segment of the path that does not hold a container yet. The value there
  /// is replaced, not changed in place, and every later change to it has a
  /// record of its own, so the record holds the value itself.
  _Undo? _dataModelRestorer(UpdateDataModelMessage message) {
    final String surfaceId = message.surfaceId;
    final SurfaceModel<ComponentApi>? surface = getSurface(surfaceId);
    if (surface == null) return null;
    final List<String> tokens = _pointerTokens(message.path ?? '/');
    final Object? root = surface.dataModel.get('/');
    if (tokens.isEmpty) {
      return () => getSurface(surfaceId)?.dataModel.set('/', root);
    }
    var parent = root;
    for (var depth = 0; depth < tokens.length; depth++) {
      if (parent is! Map<String, Object?> && parent is! List<Object?>) {
        // The write fails before it changes anything.
        return null;
      }
      final String token = tokens[depth];
      final (bool exists, Object? child) = _childOf(parent!, token);
      if (exists &&
          depth < tokens.length - 1 &&
          (child is Map<String, Object?> || child is List<Object?>)) {
        parent = child;
        continue;
      }
      final List<String> parentTokens = tokens.sublist(0, depth);
      final int length = parent is List<Object?> ? parent.length : 0;
      return () {
        final DataModel? dataModel = getSurface(surfaceId)?.dataModel;
        if (dataModel == null) return;
        final String path = _toPointer([...parentTokens, token]);
        final Object? container = dataModel.get(_toPointer(parentTokens));
        if (container is List<Object?>) {
          if (exists) {
            dataModel.set(path, child);
          } else if (container.length > length) {
            // Notifies the slot's subscribers, then drops the padding.
            dataModel.set(path, null);
            container.length = length;
          }
        } else if (container is Map<String, Object?>) {
          // Setting null removes the key.
          dataModel.set(path, child);
          if (exists && child == null) container[token] = null;
        }
      };
    }
    return null;
  }

  /// Records a surface that a message deletes, whole.
  ///
  /// It is restored by replaying it through the processor. A component that
  /// names a catalog of its own keeps its `catalogId`, so a surface whose
  /// components come from several catalogs comes back as it was. The
  /// properties and the data model are copied, since the surface is disposed
  /// of once deleted.
  _Undo _surfaceRestorer(SurfaceModel<ComponentApi> surface) {
    final String surfaceId = surface.id;
    final String version = surface.protocolVersion ?? _defaultVersion;
    final Map<String, dynamic> theme = surface.theme;
    final List<Map<String, Object?>> components = [
      for (final ComponentModel component in surface.componentsModel.values)
        {
          ...(_deepCopy(component.properties)! as Map<String, Object?>),
          'id': component.id,
          'component': component.type,
          if (component.catalog case final String catalogId)
            'catalogId': catalogId,
          if (component.metadata case final Map<String, Object?> metadata)
            'metadata': _deepCopy(metadata),
        },
    ];
    final Object? data = surface.dataModel.get('/');
    final messages = <AgentToRendererMessage>[
      CreateSurfaceMessage(
        version: version,
        surfaceId: surfaceId,
        catalogId: surface.defaultCatalog?.id,
        theme: theme.isEmpty ? null : _deepCopy(theme)! as Map<String, dynamic>,
        sendDataModel: surface.sendDataModel,
        metadata: _deepCopy(surface.metadata) as Map<String, Object?>?,
      ),
      if (components.isNotEmpty)
        UpdateComponentsMessage(
          version: version,
          surfaceId: surfaceId,
          components: components,
        ),
      if (data is! Map || data.isNotEmpty)
        UpdateDataModelMessage(
          version: version,
          surfaceId: surfaceId,
          path: '/',
          value: _deepCopy(data),
        ),
    ];
    return () {
      if (getSurface(surfaceId) != null) return;
      _processUnlogged(messages);
    };
  }

  /// The `version` a restored surface's messages state when the surface
  /// records none.
  String get _defaultVersion => switch (_protocolVersion) {
    A2uiProtocolVersion.v1_0 => 'v1.0',
    _ => 'v0.9',
  };

  /// Applies the message at [index] of [payload] and returns the surface it
  /// targets, if any.
  String? _applyMessage(List<AgentToRendererMessage> payload, int index) {
    final AgentToRendererMessage message = payload[index];
    final String? surfaceId = _target(message);
    if (surfaceId == null) {
      _process(message);
      return null;
    }
    switch (message) {
      case CreateSurfaceMessage():
        _checkCatalogActive(message);
        _process(message);
      case DeleteSurfaceMessage():
        _process(message);
        _setAssumed(surfaceId, false);
        _forgetChanged(surfaceId);
        return surfaceId;
      case _
          when getSurface(surfaceId) == null &&
              _assumes(surfaceId, payload, index):
        _assumeSurface(surfaceId, payload, index);
      case _:
        _process(message);
    }
    _noteChanged(surfaceId, _componentIds(message));
    return surfaceId;
  }

  /// Throws if [message] creates a surface on a catalog that is not active.
  void _checkCatalogActive(CreateSurfaceMessage message) {
    final String? catalogId = message.catalogId;
    if (catalogId == null || catalogs.any((c) => c.id == catalogId)) return;
    throw A2uiValidationError(
      "Surface '${message.surfaceId}' names catalog '$catalogId', which is "
      'not active. Active catalogs: '
      '${catalogs.map((c) => c.id).join(', ')}.',
    );
  }

  /// Whether an update to a surface the state lacks assumes the surface.
  ///
  /// A payload state assumes a surface the payload never named before, but
  /// not one that an earlier message of the payload deleted, nor one that a
  /// later message creates before any message deletes it: a renderer rejects
  /// updates to either, since the surface does not exist yet when they
  /// arrive.
  bool _assumes(
    String surfaceId,
    List<AgentToRendererMessage> payload,
    int index,
  ) {
    if (!_assumesUnknownSurfaces) return false;
    if (payload.take(index).any((m) => _target(m) == surfaceId)) return false;
    for (final AgentToRendererMessage later in payload.skip(index + 1)) {
      if (_target(later) != surfaceId) continue;
      if (later is CreateSurfaceMessage) return false;
      if (later is DeleteSurfaceMessage) break;
    }
    return true;
  }

  /// Creates a placeholder for an unknown surface and applies the update.
  ///
  /// The updates to the surface are the message at [index] and the messages
  /// after it that update the surface, up to one that creates or deletes it.
  /// The surface is created on each catalog that defines every component
  /// those updates add, until one accepts all of them, so a later update can
  /// rule out a catalog that the first one fits. If none does, the error from
  /// the first is thrown. Only the first update is applied here; the others
  /// are applied in turn.
  void _assumeSurface(
    String surfaceId,
    List<AgentToRendererMessage> payload,
    int index,
  ) {
    final AgentToRendererMessage message = payload[index];
    final List<AgentToRendererMessage> updates = _surfaceUpdates(
      surfaceId,
      payload,
      index,
    );
    final Set<String> types = _componentTypes(updates);
    final List<CatalogApi> fitting = [
      for (final CatalogApi catalog in catalogs)
        if (types.every(catalog.components.containsKey)) catalog,
    ];
    final errors = <A2uiValidationError>[];
    for (final CatalogApi catalog
        in fitting.isEmpty ? [catalogs.first] : fitting) {
      final placeholder = CreateSurfaceMessage(
        version: message.version,
        surfaceId: surfaceId,
        catalogId: catalog.id,
      );
      try {
        // A trial on a surface deleted right after, which needs no undo.
        _processUnlogged([placeholder, ...updates]);
      } on A2uiValidationError catch (error) {
        errors.add(error);
        continue;
      } finally {
        _processor.model.deleteSurface(surfaceId);
      }
      _process(placeholder);
      _process(message);
      _setAssumed(surfaceId, true);
      return;
    }
    throw errors.first;
  }

  /// Throws if [message] states a version its catalogs do not accept, or
  /// adds an empty list of components.
  void _checkMessage(AgentToRendererMessage message, int index) {
    final Set<String> accepted = _messageVersions[_protocolVersion]!;
    if (!accepted.contains(message.version)) {
      throw A2uiValidationError(
        "Message $index states version '${message.version}', but the "
        'catalogs target ${_protocolVersion.jsonValue}, whose messages state '
        "${accepted.map((v) => "'$v'").join(' or ')}.",
      );
    }
    if (message is CreateSurfaceMessage &&
        message.components != null &&
        message.components!.isEmpty) {
      throw A2uiValidationError(
        "Message $index (createSurface) has an empty 'components' list.",
      );
    }
    if (message is UpdateComponentsMessage && message.components.isEmpty) {
      throw A2uiValidationError(
        "Message $index (updateComponents) has an empty 'components' list.",
      );
    }
  }
}

/// A state that checks one payload on its own, with no record of earlier
/// ones: an update to a surface it never saw created makes an empty
/// placeholder for it, on the first catalog that defines the components of
/// the payload's updates to it and accepts all of them. A surface that an
/// earlier message of the payload deleted is not assumed again, nor is one
/// that a later message creates before any message deletes it.
///
/// For `validatePayload`; not exported.
RendererState createPayloadState(List<CatalogApi> catalogs) =>
    RendererState._(catalogs, assumesUnknownSurfaces: true);

/// The protocol version [catalogs] target.
A2uiProtocolVersion _checkCatalogs(List<CatalogApi> catalogs) {
  if (catalogs.isEmpty) {
    throw A2uiCatalogError('A renderer state requires at least one catalog.');
  }
  return catalogsProtocolVersion(catalogs);
}

/// Runs [body], throwing the core's errors as validation errors.
///
/// Errors of other kinds, such as a catalog a message names but the
/// processor does not hold, come from the payload too.
T _asValidationError<T>(T Function() body) {
  try {
    return body();
  } on A2uiValidationError {
    rethrow;
  } on A2uiError catch (error) {
    throw A2uiValidationError(error.message, cause: error);
  }
}

/// The surface [message] targets, or null.
String? _target(AgentToRendererMessage message) => switch (message) {
  CreateSurfaceMessage(:final String surfaceId) => surfaceId,
  UpdateComponentsMessage(:final String surfaceId) => surfaceId,
  UpdateDataModelMessage(:final String surfaceId) => surfaceId,
  DeleteSurfaceMessage(:final String surfaceId) => surfaceId,
  _ => null,
};

/// The components [message] adds or replaces.
List<Map<String, Object?>> _components(AgentToRendererMessage message) =>
    switch (message) {
      UpdateComponentsMessage(:final List<Map<String, Object?>> components) =>
        components,
      CreateSurfaceMessage(:final List<Map<String, Object?>>? components) =>
        components ?? const [],
      _ => const [],
    };

/// The ids of the components [message] adds or replaces.
Set<String> _componentIds(AgentToRendererMessage message) => {
  for (final Map<String, Object?> component in _components(message))
    if (component['id'] case final String id) id,
};

/// The updates to [surfaceId] from [index] of [payload] on. They end before
/// the next message that creates or deletes the surface.
List<AgentToRendererMessage> _surfaceUpdates(
  String surfaceId,
  List<AgentToRendererMessage> payload,
  int index,
) {
  final updates = <AgentToRendererMessage>[];
  for (final AgentToRendererMessage message in payload.skip(index)) {
    if (_target(message) != surfaceId) continue;
    if (updates.isNotEmpty &&
        (message is CreateSurfaceMessage || message is DeleteSurfaceMessage)) {
      break;
    }
    updates.add(message);
  }
  return updates;
}

/// The component types [messages] add to their surface.
///
/// Components that name a catalog of their own are left out, since they do
/// not use the surface's catalog.
Set<String> _componentTypes(List<AgentToRendererMessage> messages) => {
  for (final AgentToRendererMessage message in messages)
    for (final Map<String, Object?> component in _components(message))
      if (!component.containsKey('catalogId'))
        if (component['component'] case final String type) type,
};

/// What an `updateComponents` replaced of one component.
class _ComponentRecord {
  const _ComponentRecord(
    this.id,
    this.existing,
    this.properties,
    this.copy,
    this.metadata,
  );

  final String id;

  /// The component the update found, or null if it added a new one.
  final ComponentModel? existing;

  /// The properties map [existing] held, to tell whether the update replaced
  /// it.
  final Map<String, dynamic>? properties;

  /// A copy of [properties].
  final Map<String, dynamic> copy;

  /// A copy of the metadata [existing] held.
  final Map<String, Object?>? metadata;
}

/// A non-negative list index, as a JSON Pointer segment spells it.
final RegExp _index = RegExp(r'^(?:0|[1-9]\d*)$');

/// The unescaped segments of the JSON Pointer [path], as `DataModel` splits
/// it.
List<String> _pointerTokens(String path) => [
  for (final String token in path.split('/'))
    if (token.isNotEmpty) token.replaceAll('~1', '/').replaceAll('~0', '~'),
];

/// The JSON Pointer of [tokens].
String _toPointer(List<String> tokens) => tokens.isEmpty
    ? '/'
    : '/${tokens.map((t) => t.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}';

/// Whether [container] holds the segment [token] of a path, and its value.
(bool, Object?) _childOf(Object container, String token) {
  if (container is List<Object?>) {
    if (!_index.hasMatch(token)) return (false, null);
    final int? index = int.tryParse(token);
    if (index == null || index >= container.length) return (false, null);
    return (true, container[index]);
  }
  if (container is Map<String, Object?> && container.containsKey(token)) {
    return (true, container[token]);
  }
  return (false, null);
}

/// A deep copy of [value], a JSON value.
Object? _deepCopy(Object? value) => switch (value) {
  final Map<Object?, Object?> map => <String, dynamic>{
    for (final MapEntry<Object?, Object?> entry in map.entries)
      entry.key! as String: _deepCopy(entry.value),
  },
  final List<Object?> list => [
    for (final Object? item in list) _deepCopy(item),
  ],
  _ => value,
};
