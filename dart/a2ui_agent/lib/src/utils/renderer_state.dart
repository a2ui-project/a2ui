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

/// A surface as it was before a frame first changed it.
class _SurfaceSnapshot {
  const _SurfaceSnapshot(this.surface, this.assumed, this.changed);

  /// A copy of the surface, or null if it did not exist.
  final SurfaceModel<ComponentApi>? surface;
  final bool assumed;
  final Set<String>? changed;
}

/// What a failed [RendererState.apply] or transaction restores.
class _Frame {
  final Map<String, _SurfaceSnapshot> surfaces = {};
}

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

  final List<_Frame> _frames = [];

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
      if (!_assumed.contains(surfaceId) &&
          (_changed[surfaceId]?.isNotEmpty ?? false)) {
        _save(surfaceId);
        _changed.remove(surfaceId);
      }
    }
  }

  /// Runs [body] atomically and returns what it returns.
  ///
  /// If [body] throws, the state is restored to what it was when [body]
  /// started, and the error propagates. [body] must be synchronous: what an
  /// asynchronous body applies after its first `await` is outside the
  /// transaction.
  T transaction<T>(T Function() body) => _frame(body);

  /// Releases the surfaces the state holds. The state cannot be used
  /// afterwards.
  void dispose() => _processor.model.dispose();

  T _frame<T>(T Function() body) {
    final frame = _Frame();
    _frames.add(frame);
    try {
      return body();
    } catch (_) {
      _rollback(frame);
      rethrow;
    } finally {
      _frames.removeLast();
    }
  }

  void _rollback(_Frame frame) {
    final SurfaceGroupModel<ComponentApi> model = _processor.model;
    for (final MapEntry<String, _SurfaceSnapshot>(
          key: String surfaceId,
          value: _SurfaceSnapshot snapshot,
        )
        in frame.surfaces.entries) {
      model.deleteSurface(surfaceId);
      if (snapshot.surface case final SurfaceModel<ComponentApi> surface) {
        // The snapshot may be shared with an outer frame, so a copy of it
        // goes live and the snapshot itself stays as it was.
        model.addSurface(_cloneSurface(surface));
      }
      if (snapshot.assumed) {
        _assumed.add(surfaceId);
      } else {
        _assumed.remove(surfaceId);
      }
      if (snapshot.changed case final Set<String> changed) {
        _changed[surfaceId] = {...changed};
      } else {
        _changed.remove(surfaceId);
      }
    }
  }

  /// Snapshots a surface for every open frame, before the surface changes.
  void _save(String surfaceId) {
    final List<_Frame> frames = [
      for (final _Frame frame in _frames)
        if (!frame.surfaces.containsKey(surfaceId)) frame,
    ];
    if (frames.isEmpty) return;
    final SurfaceModel<ComponentApi>? surface = getSurface(surfaceId);
    final Set<String>? changed = _changed[surfaceId];
    final snapshot = _SurfaceSnapshot(
      surface == null ? null : _cloneSurface(surface),
      _assumed.contains(surfaceId),
      changed == null ? null : {...changed},
    );
    for (final frame in frames) {
      frame.surfaces[surfaceId] = snapshot;
    }
  }

  /// Runs [messages] through the processor.
  void _process(List<AgentToRendererMessage> messages) =>
      _asValidationError(() => _processor.processMessages(messages));

  /// Applies the message at [index] of [payload] and returns the surface it
  /// targets, if any.
  String? _applyMessage(List<AgentToRendererMessage> payload, int index) {
    final AgentToRendererMessage message = payload[index];
    final String? surfaceId = _target(message);
    if (surfaceId == null) {
      _process([message]);
      return null;
    }
    _save(surfaceId);
    switch (message) {
      case CreateSurfaceMessage():
        _checkCatalogActive(message);
        _process([message]);
      case DeleteSurfaceMessage():
        _process([message]);
        _assumed.remove(surfaceId);
        _changed.remove(surfaceId);
        return surfaceId;
      case _
          when getSurface(surfaceId) == null &&
              _assumes(surfaceId, payload, index):
        _assumeSurface(surfaceId, payload, index);
      case _:
        _process([message]);
    }
    _changed.putIfAbsent(surfaceId, () => {}).addAll(_componentIds(message));
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
        _process([placeholder, ...updates]);
      } on A2uiValidationError catch (error) {
        errors.add(error);
        continue;
      } finally {
        _processor.model.deleteSurface(surfaceId);
      }
      _process([placeholder, message]);
      _assumed.add(surfaceId);
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

/// A copy of [surface]'s state in a new surface that shares its catalogs.
SurfaceModel<ComponentApi> _cloneSurface(SurfaceModel<ComponentApi> surface) {
  final clone = SurfaceModel<ComponentApi>(
    surface.id,
    defaultCatalog: surface.defaultCatalog,
    availableCatalogs: surface.availableCatalogs.values,
    theme: _deepCopy(surface.theme)! as Map<String, dynamic>,
    sendDataModel: surface.sendDataModel,
    protocolVersion: surface.protocolVersion,
    rootId: surface.rootId,
    metadata: _deepCopy(surface.metadata) as Map<String, dynamic>?,
    callAgentFunction: surface.callAgentFunction,
  );
  clone.dataModel.set('/', _deepCopy(surface.dataModel.get('/')));
  for (final ComponentModel component in surface.componentsModel.values) {
    clone.componentsModel.addComponent(
      ComponentModel(
        component.id,
        component.type,
        _deepCopy(component.properties)! as Map<String, dynamic>,
        catalog: component.catalog,
        metadata: _deepCopy(component.metadata) as Map<String, Object?>?,
      ),
    );
  }
  return clone;
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
