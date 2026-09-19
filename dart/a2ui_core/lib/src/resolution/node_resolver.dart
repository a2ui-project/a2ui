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
import 'dart:collection';
import 'dart:convert';

import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:logging/logging.dart';

import '../core/catalog.dart';
import '../core/component_model.dart';
import '../core/contexts.dart';
import '../core/messages.dart';
import '../core/surface_model.dart';
import '../primitives/errors.dart';
import '../primitives/reactivity.dart';
import '../rendering/binder.dart';
import 'component_node.dart';
import 'ref_fields.dart';

final _log = Logger('a2ui_core.resolution');

const String _rootComponentId = 'root';
const String _rootDataPath = '/';
// Structured slots and parent identity keep payload delimiters out of keys.
typedef _ChildSlot = (String, int?, String?);
typedef _EdgeKey = (ComponentNode?, _ChildSlot, String, String);
typedef _DiagnosticScope = (String componentId, String dataPath);

// Retain the reservation with the queued diagnostic so dropping an aborted
// update releases only undelivered codes, not newer or reported scopes.
class _QueuedError {
  final A2uiClientError error;
  final _DiagnosticScope? scope;
  final Set<String>? codes;

  const _QueuedError(this.error, {this.scope, this.codes});
}

const _EdgeKey _rootEdgeKey = (null, ('root', null, null), 'root', '/');

class _NodeRecord<T extends ComponentApi> {
  final MutableComponentNode<T> node;
  final _EdgeKey edgeKey;

  /// Ordinal among same-component, same-scope siblings, baked into the id.
  final int occurrence;

  /// The node whose props reference this one; null for the root.
  final MutableComponentNode<T>? parent;
  final RefFields refFields;
  final ComponentModel? componentModel;

  /// The deduplication entry this cyclic stand-in belongs to. Retirement must
  /// not clear a newer entry installed by a reentrant repair or replacement.
  final Set<String>? diagnosticCodes;
  GenericBinder? binder;
  void Function()? binderUnsubscribe;

  /// Children this node currently references, keyed by edge. This parent
  /// owns their disposal.
  Map<_EdgeKey, MutableComponentNode<T>> childEdges = {};

  /// Component IDs for which this node registered itself as a pending parent.
  final Set<String> registeredPendingChildIds = {};

  _NodeRecord({
    required this.node,
    required this.edgeKey,
    required this.occurrence,
    required this.parent,
    required this.refFields,
    this.componentModel,
    this.diagnosticCodes,
  });
}

/// Turns a surface's flat component map into a live tree of resolved
/// [ComponentNode]s rooted at [rootNode]. Child references become
/// [ComponentNode] objects, template `ChildList`s spawn one node per array
/// item, not-yet-arrived components appear as placeholder nodes and are
/// replaced at the same child position, and every node's subscriptions are
/// torn down when its parent stops referencing it or the resolver is
/// disposed.
///
/// Child references are recognized by wire `$ref` pointers, Dart `REF:`
/// descriptions, local aliases, and structural `ChildList` shapes (an object
/// schema declaring `componentId` and `path`). An unmarked string property is
/// not a child reference.
///
/// Supported positions are top-level single references, top-level `ChildList`
/// markers or structural unions, top-level arrays of component-id references,
/// and arrays of objects whose properties are single-component references.
/// Deeper single references (including plain arrays of ids) remain strings;
/// deeper `ChildList` values remain unresolved [ChildNode] descriptors with
/// their per-item data scope. The first publication of such a descriptor logs
/// one warning per resolver and property path, with array indices grouped as
/// `[]`.
///
/// Node identity is parent-scoped: each referencing position gets its own
/// node, so one component id mounted at two positions yields two nodes and
/// dropping one position never tears down the other.
///
/// Unknown-type and cycle diagnostics are deduplicated per code, component id,
/// and data path. Deleting the component, resolving a node at that scope, or
/// removing a cyclic edge rearms its diagnostics. Expression errors are not
/// deduplicated.
///
/// Diagnostics associated with a tree update are delivered synchronously after
/// its ownership and props are committed. If expression evaluation produces no
/// changed binding value and therefore no tree update, its diagnostic is
/// delivered in a fallback microtask. Disposal cancels pending diagnostics.
class NodeResolver<T extends ComponentApi> {
  final SurfaceModel<T> _surface;

  final Signal<ComponentNode<T>?> _rootNode = signal(null);

  /// The resolved root of the tree; null until the root component arrives.
  ReadonlySignal<ComponentNode<T>?> get rootNode => _rootNode;

  final Map<MutableComponentNode<T>, _NodeRecord<T>> _records = {};
  final Map<_EdgeKey, MutableComponentNode<T>> _nodesByEdge = {};
  final Map<String, Set<MutableComponentNode<T>>> _nodesByComponentId = {};

  /// Parents holding a placeholder for a component id, awaiting its arrival.
  final Map<String, Set<MutableComponentNode<T>>> _pendingParents = {};

  late final void Function(ComponentModel) _onCreatedListener;
  late final void Function(String) _onDeletedListener;
  _NodeRecord<T>? _rootRecord;
  bool _disposed = false;
  bool _disposeRequested = false;
  int _updateDepth = 0;
  bool _dispatchingErrors = false;
  bool _errorFlushScheduled = false;
  final Queue<_QueuedError> _pendingErrors = Queue();
  final Map<_DiagnosticScope, Set<String>> _dispatchedErrors = {};
  final Queue<String> _pendingWarnings = Queue();
  final Set<String> _warnedReferencePaths = {};

  /// Builds a resolver over [_surface], subscribing to its component model and
  /// resolving the existing tree if a root is already present.
  ///
  /// The owner must call [dispose] on this resolver before disposing the
  /// surface. The resolver holds listeners on the surface's component model
  /// and unregisters them on its own disposal, so tearing the surface down
  /// first leaves those listeners attached to a disposed model.
  NodeResolver(this._surface) {
    _onCreatedListener = (component) {
      _runUpdate(() => _onComponentCreated(component));
    };
    _onDeletedListener = (id) {
      _runUpdate(() => _onComponentDeleted(id));
    };
    _surface.componentsModel.onCreated.addListener(_onCreatedListener);
    _surface.componentsModel.onDeleted.addListener(_onDeletedListener);

    _runUpdate(() {
      if (_surface.componentsModel.get(_rootComponentId) != null) {
        _buildRoot();
      }
    });
  }

  // Error listeners can synchronously change the model. Commit the entire
  // update, including root publication and binder subscriptions, before
  // dispatching diagnostics so a listener cannot reenter a half-built tree.
  void _runUpdate(void Function() update) {
    if (_disposed) {
      return;
    }
    _updateDepth++;
    try {
      batch(update);
    } catch (_) {
      _discardPendingErrors();
      _pendingWarnings.clear();
      rethrow;
    } finally {
      _updateDepth--;
      if (_updateDepth == 0) {
        if (_disposeRequested) {
          dispose();
        } else {
          _flushErrors();
        }
      }
    }
  }

  // Record the condition when queued, not when delivered: sibling edges can
  // discover it before the tree update reaches its diagnostic boundary.
  void _reportOnce(
    String code,
    String componentId,
    String dataPath,
    String message,
  ) {
    final Set<String> codes = _dispatchedErrors.putIfAbsent((
      componentId,
      dataPath,
    ), () => {});
    if (!codes.add(code)) return;
    _pendingErrors.add(
      _QueuedError(
        A2uiClientError(code: code, surfaceId: _surface.id, message: message),
        scope: (componentId, dataPath),
        codes: codes,
      ),
    );
  }

  void _clearDispatched(String componentId, String dataPath) {
    _dispatchedErrors.remove((componentId, dataPath));
  }

  void _reportExpressionError(A2uiExpressionError error) {
    if (_disposed) return;
    _pendingErrors.add(
      _QueuedError(
        A2uiClientError(
          code: 'EXPRESSION_ERROR',
          surfaceId: _surface.id,
          message: error.message,
          details: error.details,
        ),
      ),
    );
    if (_updateDepth == 0 && !_dispatchingErrors && !_errorFlushScheduled) {
      // Normally drained synchronously once the rebuild finishes; a rebuild
      // that changes no binding value emits nothing, so schedule a fallback.
      _errorFlushScheduled = true;
      scheduleMicrotask(() {
        _errorFlushScheduled = false;
        if (!_disposed) _flushErrors();
      });
    }
  }

  void _discardPendingErrors() {
    for (final _QueuedError queued in _pendingErrors) {
      final Set<String>? codes = queued.codes;
      if (codes != null && identical(_dispatchedErrors[queued.scope], codes)) {
        codes.remove(queued.error.code);
        if (codes.isEmpty) _dispatchedErrors.remove(queued.scope);
      }
    }
    _pendingErrors.clear();
  }

  void _flushErrors() {
    if (_disposed || _dispatchingErrors) {
      return;
    }
    _dispatchingErrors = true;
    try {
      while (_pendingErrors.isNotEmpty || _pendingWarnings.isNotEmpty) {
        if (_pendingErrors.isNotEmpty) {
          _surface.dispatchError(_pendingErrors.removeFirst().error);
        } else {
          _log.warning(_pendingWarnings.removeFirst());
        }
      }
    } finally {
      _discardPendingErrors();
      _pendingWarnings.clear();
      _dispatchingErrors = false;
    }
  }

  /// Number of live nodes (including placeholders). Exposed for tests and
  /// devtools.
  int get activeNodeCount => _records.length;

  bool get disposed => _disposed;

  /// Tears down the whole tree and stops tracking the surface. Idempotent.
  /// During an update, teardown finishes at that update's outer boundary,
  /// before control returns to the caller that initiated the update.
  void dispose() {
    if (_disposed) {
      return;
    }
    if (_updateDepth != 0) {
      _disposeRequested = true;
      return;
    }
    _disposed = true;
    _disposeRequested = false;
    batch(() {
      _surface.componentsModel.onCreated.removeListener(_onCreatedListener);
      _surface.componentsModel.onDeleted.removeListener(_onDeletedListener);
      _rootRecord = null;
      _rootNode.value = null;
      for (final MutableComponentNode<T> node in List.of(_records.keys)) {
        _disposeNode(node);
      }
      _pendingParents.clear();
      _dispatchedErrors.clear();
      _pendingErrors.clear();
      _pendingWarnings.clear();
      _warnedReferencePaths.clear();
    });
  }

  /// No-op while a root record exists; root deletion clears it so a re-sent
  /// root rebuilds.
  void _buildRoot() {
    if (_rootRecord != null || _disposed || _disposeRequested) {
      return;
    }
    final MutableComponentNode<T> node = _createNode(
      _rootComponentId,
      _rootDataPath,
      _rootEdgeKey,
      null,
    );
    if (node.disposed || !_records.containsKey(node)) return;
    _rootRecord = _records[node];
    _rootNode.value = node;
  }

  void _onComponentCreated(ComponentModel component) {
    if (_disposed) {
      return;
    }
    // An earlier listener may have removed the component during this event.
    // Reconcile against current model state, not a stale creation notification.
    if (_surface.componentsModel.get(component.id) == null) {
      return;
    }
    if (component.id == _rootComponentId) {
      _buildRoot();
    }
    final Set<MutableComponentNode<T>>? waiting = _pendingParents.remove(
      component.id,
    );
    if (waiting != null) {
      for (final MutableComponentNode<T> parent in waiting) {
        final _NodeRecord<T>? record = _records[parent];
        if (record != null && !parent.disposed) {
          _materialize(record);
        }
      }
    }
  }

  void _onComponentDeleted(String id) {
    if (_disposed) {
      return;
    }
    _dispatchedErrors.removeWhere((scope, _) => scope.$1 == id);
    final Set<MutableComponentNode<T>>? affected = _nodesByComponentId[id];
    if (affected == null) {
      return;
    }
    final parentsToRefresh = <MutableComponentNode<T>>{};
    var rootDeleted = false;
    for (final MutableComponentNode<T> node in List.of(affected)) {
      final _NodeRecord<T>? record = _records[node];
      if (record == null) {
        continue;
      }
      if (record.parent != null) {
        parentsToRefresh.add(record.parent!);
      } else {
        rootDeleted = true;
      }
    }
    if (rootDeleted && _rootRecord != null) {
      // An earlier deletion listener may already have replaced the model.
      final ComponentModel? model = _surface.componentsModel.get(id);
      if (model == null || !identical(_rootRecord!.componentModel, model)) {
        final MutableComponentNode<T> oldRoot = _rootRecord!.node;
        _rootRecord = null;
        _rootNode.value = null;
        _disposeNode(oldRoot);
        // A destruction listener may already have rebuilt the root. Reconcile
        // current model state and do not overwrite that listener's root.
        if (_surface.componentsModel.get(_rootComponentId) != null) {
          _buildRoot();
        }
      }
    }
    for (final parent in parentsToRefresh) {
      final _NodeRecord<T>? record = _records[parent];
      if (record != null && !parent.disposed) {
        _materialize(record);
      }
    }
  }

  /// Creates a node for one (componentId, dataPath) edge. A missing
  /// component definition yields a placeholder node and registers the parent
  /// for a refresh when the definition arrives.
  MutableComponentNode<T> _createNode(
    String componentId,
    String dataPath,
    _EdgeKey edgeKey,
    MutableComponentNode<T>? parent, {
    int occurrence = 1,
  }) {
    final ComponentModel? model = _surface.componentsModel.get(componentId);
    if (model == null) {
      final _NodeRecord<T> record = _registerNode(
        _placeholderNode(
          componentId,
          dataPath,
          NodeState.pending,
          occurrence: occurrence,
        ),
        edgeKey: edgeKey,
        parent: parent,
        occurrence: occurrence,
        refFields: const {},
      );
      if (parent != null) {
        _pendingParents.putIfAbsent(componentId, () => {}).add(parent);
        _records[parent]?.registeredPendingChildIds.add(componentId);
      }
      return record.node;
    }

    final T? api = _surface.catalog.components[model.type];
    if (api == null) {
      _reportOnce(
        'UNKNOWN_COMPONENT_TYPE',
        componentId,
        dataPath,
        "Component '$componentId' has type '${model.type}', which is "
            "not in catalog '${_surface.catalog.id}'.",
      );
      return _registerNode(
        _placeholderNode(
          componentId,
          dataPath,
          NodeState.unknownType,
          type: model.type,
          occurrence: occurrence,
        ),
        edgeKey: edgeKey,
        parent: parent,
        occurrence: occurrence,
        refFields: const {},
        componentModel: model,
      ).node;
    }

    _clearDispatched(componentId, dataPath);
    final Schema schema = api.schema;
    final _NodeRecord<T> record = _registerNode(
      MutableComponentNode<T>(
        _instanceIdFor(componentId, dataPath, occurrence),
        componentId,
        model.type,
        dataPath,
        const {},
        api,
      ),
      edgeKey: edgeKey,
      parent: parent,
      occurrence: occurrence,
      refFields: extractRefFields(
        schema,
        document: _surface.catalog.catalogSchema,
      ),
      componentModel: model,
    );
    final GenericBinder binder;
    try {
      binder = GenericBinder(
        ComponentContext(
          _surface,
          model,
          basePath: dataPath,
          onError: _reportExpressionError,
        ),
        schema,
      );
    } catch (_) {
      _disposeNode(record.node);
      rethrow;
    }
    if (_disposed || !identical(_records[record.node], record)) {
      binder.dispose();
      return record.node;
    }
    record.binder = binder;
    final void Function() unsubscribe;
    // subscribe fires synchronously with the current value, which seeds the
    // first materialization. That seeding can throw, so the partially
    // registered record has to be torn down before the exception reaches the
    // caller.
    try {
      unsubscribe = binder.resolvedProps.subscribe((_) {
        _runUpdate(() => _materialize(record));
      });
    } catch (_) {
      binder.dispose();
      _disposeNode(record.node);
      rethrow;
    }
    if (_disposed || !identical(_records[record.node], record)) {
      unsubscribe();
      binder.dispose();
    } else {
      record.binderUnsubscribe = unsubscribe;
    }
    return record.node;
  }

  MutableComponentNode<T> _placeholderNode(
    String componentId,
    String dataPath,
    NodeState state, {
    String type = placeholderType,
    int occurrence = 1,
  }) {
    return MutableComponentNode<T>(
      _instanceIdFor(componentId, dataPath, occurrence),
      componentId,
      type,
      dataPath,
      const {},
      null,
      state,
    );
  }

  _NodeRecord<T> _registerNode(
    MutableComponentNode<T> node, {
    required _EdgeKey edgeKey,
    required MutableComponentNode<T>? parent,
    required int occurrence,
    required RefFields refFields,
    ComponentModel? componentModel,
  }) {
    final record = _NodeRecord<T>(
      node: node,
      edgeKey: edgeKey,
      parent: parent,
      occurrence: occurrence,
      refFields: refFields,
      componentModel: componentModel,
      diagnosticCodes: node.state == NodeState.cyclic
          ? _dispatchedErrors[(node.componentId, node.dataPath)]
          : null,
    );
    _records[node] = record;
    _nodesByEdge[edgeKey] = node;
    _nodesByComponentId.putIfAbsent(node.componentId, () => {}).add(node);
    return record;
  }

  /// Returns the node for a child edge, reusing the cached node when the
  /// edge is unchanged and replacing it (placeholder upgrade or downgrade,
  /// id change, type change) when it is not.
  MutableComponentNode<T> _childNode(
    String componentId,
    String dataPath,
    _EdgeKey edgeKey,
    MutableComponentNode<T> parent,
    int occurrence,
  ) {
    final MutableComponentNode<T>? existing = _nodesByEdge[edgeKey];
    if (_isCyclic(componentId, dataPath, parent)) {
      // Node identity is parent-scoped, so a cyclic payload would otherwise
      // recurse forever; render the repeated reference as a placeholder.
      if (existing != null &&
          !existing.disposed &&
          existing.isPlaceholder &&
          _records[existing]?.occurrence == occurrence) {
        return existing;
      }
      _reportOnce(
        'CYCLIC_REFERENCE',
        componentId,
        dataPath,
        "Component '$componentId' at '$dataPath' is referenced by one "
            'of its own descendants; rendering a placeholder instead.',
      );
      return _registerNode(
        _placeholderNode(
          componentId,
          dataPath,
          NodeState.cyclic,
          occurrence: occurrence,
        ),
        edgeKey: edgeKey,
        parent: parent,
        occurrence: occurrence,
        refFields: const {},
      ).node;
    }
    if (existing != null && !existing.disposed) {
      final ComponentModel? model = _surface.componentsModel.get(componentId);
      final T? api = model == null
          ? null
          : _surface.catalog.components[model.type];
      // A placeholder stays up to date only while its own state's
      // preconditions hold, so a pending node whose definition arrives with
      // an unknown type is replaced (once) by an unknown-type node, and
      // either kind resolves when the type gains a catalog entry. Resolved
      // and unknown-type nodes must still refer to the current model. A node
      // whose sibling ordinal changed is rebuilt to keep ids distinct.
      final bool upToDate =
          existing.componentId == componentId &&
          existing.dataPath == dataPath &&
          _records[existing]?.occurrence == occurrence &&
          (existing.isPlaceholder
              ? (model == null && existing.state == NodeState.pending) ||
                    (model != null &&
                        api == null &&
                        existing.state == NodeState.unknownType &&
                        identical(_records[existing]?.componentModel, model))
              : model != null &&
                    existing.type == model.type &&
                    identical(_records[existing]?.componentModel, model));
      if (upToDate) {
        if (existing.state == NodeState.pending) {
          // Another creation listener may have removed the component before
          // this resolver saw it. Keep waiting for its next arrival.
          _pendingParents.putIfAbsent(componentId, () => {}).add(parent);
          _records[parent]?.registeredPendingChildIds.add(componentId);
        }
        return existing;
      }
    }
    return _createNode(
      componentId,
      dataPath,
      edgeKey,
      parent,
      occurrence: occurrence,
    );
  }

  /// True when (componentId, dataPath) already appears in the parent chain.
  bool _isCyclic(
    String componentId,
    String dataPath,
    MutableComponentNode<T> parent,
  ) {
    for (
      MutableComponentNode<T>? node = parent;
      node != null;
      node = _records[node]?.parent
    ) {
      if (node.componentId == componentId && node.dataPath == dataPath) {
        return true;
      }
    }
    return false;
  }

  /// Rebuilds a node's resolved props from its binder output: child
  /// reference properties become live [ComponentNode]s, children this parent
  /// no longer references are disposed, and unchanged values keep reference
  /// identity so the shallow comparison in [MutableComponentNode.setProps]
  /// stays exact.
  void _materialize(_NodeRecord<T> record) {
    if (record.node.disposed || !identical(_records[record.node], record)) {
      return;
    }
    final Map<String, Object?> raw =
        record.binder?.resolvedProps.peek() ?? const {};
    final next = Map<String, Object?>.from(raw);
    final newEdges = <_EdgeKey, MutableComponentNode<T>>{};
    // Ordinals are local to this parent and recomputed in child order.
    final occurrences = <(String, String), int>{};

    MutableComponentNode<T> resolveChild(
      _ChildSlot slot,
      String componentId,
      String dataPath,
    ) {
      final occurrenceKey = (componentId, dataPath);
      final int occurrence = (occurrences[occurrenceKey] ?? 0) + 1;
      occurrences[occurrenceKey] = occurrence;
      final _EdgeKey edgeKey = (record.node, slot, componentId, dataPath);
      final MutableComponentNode<T> child = _childNode(
        componentId,
        dataPath,
        edgeKey,
        record.node,
        occurrence,
      );
      newEdges[edgeKey] = child;
      return child;
    }

    for (final MapEntry<String, RefKind> field in record.refFields.entries) {
      final String key = field.key;
      final Object? value = next[key];
      switch (field.value) {
        case SingleRef():
          if (value is String && value.isNotEmpty) {
            next[key] = resolveChild(
              (key, null, null),
              value,
              record.node.dataPath,
            );
          }
        case ListRef():
          if (value is! List) {
            break;
          }
          final int count = value.length > maxDynamicChildListSize
              ? maxDynamicChildListSize
              : value.length;
          next[key] = List<Object?>.generate(count, (index) {
            final Object? item = value[index];
            if (item is ChildNode) {
              return resolveChild((key, index, null), item.id, item.basePath);
            }
            if (item is String && item.isNotEmpty) {
              return resolveChild(
                (key, index, null),
                item,
                record.node.dataPath,
              );
            }
            return item;
          });
        case NestedRef(:final Set<String> keys, :final bool includesIds):
          if (value is! List) {
            break;
          }
          next[key] = List<Object?>.generate(value.length, (index) {
            final Object? item = value[index];
            if (includesIds && item is String && item.isNotEmpty) {
              return resolveChild(
                (key, index, null),
                item,
                record.node.dataPath,
              );
            }
            if (item is! Map) {
              return item;
            }
            Map<String, Object?>? resolved;
            for (final subKey in keys) {
              final Object? childId = item[subKey];
              if (childId is String && childId.isNotEmpty) {
                resolved ??= Map<String, Object?>.from(item);
                resolved[subKey] = resolveChild(
                  (key, index, subKey),
                  childId,
                  record.node.dataPath,
                );
              }
            }
            return resolved ?? item;
          });
      }
    }

    if (!identical(_records[record.node], record)) return;
    final retired = <MutableComponentNode<T>>[];
    for (final MapEntry<_EdgeKey, MutableComponentNode<T>> edge
        in record.childEdges.entries) {
      if (identical(newEdges[edge.key], edge.value)) {
        continue;
      }
      final MutableComponentNode<T> child = edge.value;
      retired.add(child);
      if (child.isPlaceholder) {
        final bool stillWaiting = newEdges.values.any(
          (other) =>
              other.isPlaceholder && other.componentId == child.componentId,
        );
        if (!stillWaiting) {
          final Set<MutableComponentNode<T>>? waiting =
              _pendingParents[child.componentId];
          if (waiting != null) {
            waiting.remove(record.node);
            if (waiting.isEmpty) {
              _pendingParents.remove(child.componentId);
            }
          }
        }
      }
    }
    record.childEdges = newEdges;

    final NodeProps previous = record.node.props.peek();
    for (final String key in List.of(next.keys)) {
      next[key] = _stabilize(previous[key], next[key]);
    }
    record.node.setProps(UnmodifiableMapView(next));
    if (!record.node.disposed) {
      _queueUnresolvedReferenceWarnings(next);
    }
    // Includes same-key placeholder replacements. Their callbacks must see
    // the committed replacement, not their own already-disposed predecessor.
    for (final child in retired) {
      _disposeNode(child);
    }
  }

  /// Finds descriptors left after supported child references were materialized.
  /// Do not traverse mounted nodes or binding values: each node owns its props,
  /// and only literal maps and lists can contain unresolved structural output.
  void _queueUnresolvedReferenceWarnings(NodeProps props) {
    void visit(Object? value, String path) {
      if (value is ChildNode) {
        if (_warnedReferencePaths.add(path)) {
          _pendingWarnings.add(
            'Unresolved child reference at $path: this nested ChildList '
            'retains scoped descriptors and is not mounted as nodes.',
          );
        }
      } else if (value is List) {
        for (final Object? item in value) {
          // The descriptor belongs to the list property, not an item slot.
          visit(item, item is ChildNode ? path : '$path[]');
        }
      } else if (value is Map) {
        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final key = entry.key as String;
          final segment = _simplePropertyName.hasMatch(key)
              ? '${path.isEmpty ? '' : '.'}$key'
              : '[${jsonEncode(key)}]';
          visit(entry.value, '$path$segment');
        }
      }
    }

    visit(props, '');
  }

  /// Disposes a node and, through parent-scoped ownership, its subtree.
  void _disposeNode(MutableComponentNode<T> node) {
    if (node.disposed) {
      return;
    }
    final _NodeRecord<T>? record = _records.remove(node);
    if (record == null) return;
    final List<MutableComponentNode<T>> children = List.of(
      record.childEdges.values,
    );
    record.childEdges.clear();
    record.binderUnsubscribe?.call();
    record.binderUnsubscribe = null;
    record.binder?.dispose();
    if (identical(_nodesByEdge[record.edgeKey], node)) {
      _nodesByEdge.remove(record.edgeKey);
    }
    final Set<MutableComponentNode<T>>? byId =
        _nodesByComponentId[node.componentId];
    if (byId != null) {
      byId.remove(node);
      if (byId.isEmpty) {
        _nodesByComponentId.remove(node.componentId);
      }
    }
    for (final String pendingId in record.registeredPendingChildIds) {
      final Set<MutableComponentNode<T>>? waiting = _pendingParents[pendingId];
      if (waiting != null) {
        waiting.remove(node);
        if (waiting.isEmpty) {
          _pendingParents.remove(pendingId);
        }
      }
    }
    if (node.state == NodeState.cyclic) {
      // Replacements are committed before retired nodes are disposed. A new
      // cyclic stand-in on this same edge still represents the old condition;
      // retiring its predecessor must not erase the replacement's key.
      final MutableComponentNode<T>? replacement = _nodesByEdge[record.edgeKey];
      if ((replacement == null || replacement.state != NodeState.cyclic) &&
          identical(
            _dispatchedErrors[(node.componentId, node.dataPath)],
            record.diagnosticCodes,
          )) {
        _clearDispatched(node.componentId, node.dataPath);
      }
    }
    for (final child in children) {
      _disposeNode(child);
    }
    node.dispose();
  }
}

final _simplePropertyName = RegExp(r'^[a-zA-Z_][a-zA-Z_0-9]*$');

const _idPartEscapes = {
  '~': '~0',
  '#': '~1',
  '[': '~2',
  ']': '~3',
  '>': '~4',
  '@': '~5',
};

/// Escapes id parts in one pass so literal suffixes and scopes cannot collide
/// with composed ids.
String _escapeIdPart(String part) => part.replaceAllMapped(
  RegExp(r'[~#\[\]>@]'),
  (match) => _idPartEscapes[match[0]]!,
);

String _instanceIdFor(String componentId, String dataPath, int occurrence) {
  String trimmed = dataPath.replaceAll(RegExp(r'/+$'), '');
  if (trimmed.isEmpty) {
    trimmed = _rootDataPath;
  }
  final String base = dataPath == _rootDataPath
      ? _escapeIdPart(componentId)
      : '${_escapeIdPart(componentId)}-[${_escapeIdPart(trimmed)}]';
  return occurrence > 1 ? '$base#$occurrence' : base;
}

/// Returns `prev` whenever `next` is structurally identical to it, so
/// unchanged props keep reference identity across rebuilds. Mounted nodes,
/// actions and opaque values retain identity; bindings and scoped references
/// compare by value. Changed containers are detached and made unmodifiable.
/// Binding wrappers already contain snapshots, so they are not traversed.
Object? _stabilize(Object? prev, Object? next) {
  if (sameValue(prev, next)) {
    return prev;
  }
  if (next is List) {
    final List<Object?>? previous = prev is List ? prev : null;
    bool allSame = previous != null && previous.length == next.length;
    final out = List<Object?>.generate(next.length, (index) {
      final bool hadValue = previous != null && index < previous.length;
      final Object? oldValue = hadValue ? previous[index] : null;
      final Object? stabilized = _stabilize(oldValue, next[index]);
      if (!hadValue || !sameValue(stabilized, oldValue)) {
        allSame = false;
      }
      return stabilized;
    });
    return allSame ? prev : UnmodifiableListView(out);
  }
  if (next is Map) {
    final Map<Object?, Object?>? previous = prev is Map ? prev : null;
    bool allSame = previous != null && previous.length == next.length;
    final out = <String, Object?>{};
    for (final MapEntry<Object?, Object?> entry in next.entries) {
      final key = entry.key as String;
      final Object? oldValue = previous?[key];
      final Object? stabilized = _stabilize(oldValue, entry.value);
      out[key] = stabilized;
      if (previous == null ||
          !previous.containsKey(key) ||
          !sameValue(stabilized, oldValue)) {
        allSame = false;
      }
    }
    return allSame ? prev : UnmodifiableMapView(out);
  }
  return next;
}
