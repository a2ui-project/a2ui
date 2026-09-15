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

import 'package:logging/logging.dart';

import '../core/catalog.dart';
import '../primitives/event_notifier.dart';
import '../primitives/reactivity.dart';
import '../rendering/binder.dart' show ChildNode;
import '../rendering/resolved_binding.dart';

final _log = Logger('a2ui_core.resolution');

/// The `type` of a pending or cyclic placeholder node.
const String placeholderType = 'Placeholder';

/// Why a node is or is not resolved:
///
/// - [resolved]: a real component with a catalog entry;
///   [ComponentNode.impl] is set.
/// - [pending]: the component definition has not arrived; replaced at the same
///   child position when it does.
/// - [unknownType]: the definition arrived but its type has no catalog
///   entry; an `UNKNOWN_COMPONENT_TYPE` error was dispatched.
/// - [cyclic]: the reference repeats one of the node's own ancestors; a
///   `CYCLIC_REFERENCE` error was dispatched.
enum NodeState {
  resolved('resolved'),
  pending('pending'),
  unknownType('unknown-type'),
  cyclic('cyclic');

  /// The value used in serialized trees, matching the TypeScript node states.
  final String jsonValue;

  const NodeState(this.jsonValue);
}

/// Resolved node properties, keyed by the component's schema property names.
typedef NodeProps = Map<String, Object?>;

/// One resolved component instance in the rendered tree.
///
/// A node's [props] hold resolved values: a [ResolvedBinding]
/// (snapshot plus optional write) for each dynamic value, ready-to-call
/// closures for actions, and live [ComponentNode] references (or lists of
/// them) for supported child-reference positions. Deeper single references
/// remain id strings, and deeper `ChildList` values remain scoped [ChildNode]
/// descriptors, not mounted nodes. To traverse the tree, follow child
/// references from the resolver's root.
///
/// Emission contract: [props] emits when this node's own resolved properties
/// change, including when a child *reference* is replaced (a placeholder
/// upgrade, a deletion, a list change). It does not emit when a child's
/// internal properties change; subscribe to the child's [props] for that.
///
/// The resolver creates, updates, and disposes nodes; application code reads
/// them through this interface. [MutableComponentNode] is the only
/// implementation.
abstract interface class ComponentNode<T extends ComponentApi> {
  /// Identifier for this node in the rendered tree, distinct among siblings.
  /// The component id at the root data scope; for template-spawned items the
  /// scoped data path is appended (e.g. `item-card-[/items/0]`). Repeated
  /// references to the same component at the same data path gain a `#n`
  /// suffix (e.g. `item-card#2`). Id parts are escaped so literal ids cannot
  /// collide with suffixed or scoped forms. The id is not globally unique.
  ///
  /// Positional instance ids are not stable data-item keys across array
  /// insertions or reorders.
  String get instanceId;

  /// The component id from the payload.
  String get componentId;

  /// The declared component type, including for unknown types, or
  /// `'Placeholder'` for pending and cyclic nodes.
  String get type;

  /// The data model scope this node resolves against, e.g. `/items/0`.
  String get dataPath;

  /// The resolved catalog entry for [type]; null while a placeholder.
  T? get impl;

  /// Why this node is or is not resolved.
  NodeState get state;

  /// Resolved, reactive properties. Read without subscribing via `peek()`.
  ///
  /// Published JSON containers, including binding values and the outer props
  /// map, are detached, unmodifiable snapshots. Write through
  /// [WritableBinding.set] or invoke action closures instead of mutating them.
  ///
  /// See [ResolvedBinding] for omitted and null dynamic-property behavior.
  ReadonlySignal<NodeProps> get props;

  /// Fires exactly once, when this node is disposed. Listener failures are
  /// logged individually and do not interrupt the remaining teardown.
  /// Listeners added during or after destruction notification are not called.
  EventListenable<void> get onDestroyed;

  bool get disposed;

  /// True for any unresolved stand-in ([state] other than
  /// [NodeState.resolved]). A placeholder holds the child position with
  /// empty props; when its component becomes resolvable, the resolver
  /// disposes it and replaces it at the same child position with a real node;
  /// the parent emits once.
  bool get isPlaceholder;

  /// Registers teardown work to run when this node is disposed.
  /// Work registered during the cleanup pass runs after already queued work.
  /// After that pass, registration runs the cleanup immediately, including
  /// inside [onDestroyed] listeners. Failures are logged without propagating.
  void addCleanup(void Function() cleanup);

  /// Serializes the resolved tree for debugging and headless assertions.
  /// Child nodes serialize recursively, bindings serialize as their
  /// snapshot value, and action closures serialize as the string
  /// `'<Action>'`.
  Map<String, Object?> toJson();
}

/// The write side and only implementation of [ComponentNode]. Not exported
/// from the package barrel: the resolver constructs, updates, and disposes
/// nodes; application code sees the read-only interface.
final class MutableComponentNode<T extends ComponentApi>
    implements ComponentNode<T> {
  @override
  final String instanceId;

  @override
  final String componentId;

  @override
  final String type;

  @override
  final String dataPath;

  @override
  final T? impl;

  @override
  final NodeState state;

  final Signal<NodeProps> _props;

  @override
  ReadonlySignal<NodeProps> get props => _props;

  final _onDestroyed = _DestructionListeners();

  @override
  EventListenable<void> get onDestroyed => _onDestroyed;

  // Null once the cleanup pass has finished, before destruction notification.
  List<void Function()>? _cleanups = [];
  bool _disposed = false;

  MutableComponentNode(
    this.instanceId,
    this.componentId,
    this.type,
    this.dataPath,
    NodeProps initialProps, [
    this.impl,
    this.state = NodeState.resolved,
  ]) : _props = signal(initialProps);

  @override
  bool get disposed => _disposed;

  @override
  bool get isPlaceholder => state != NodeState.resolved;

  @override
  void addCleanup(void Function() cleanup) {
    final List<void Function()>? cleanups = _cleanups;
    if (cleanups == null) {
      _runCleanup(cleanup);
    } else {
      cleanups.add(cleanup);
    }
  }

  /// Replaces the resolved props, emitting only if a shallow comparison shows
  /// a change. Callers must keep unchanged values reference-identical; the
  /// shallow comparison is exact only under that invariant.
  void setProps(NodeProps next) {
    if (_disposed) {
      return;
    }
    final NodeProps previous = _props.peek();
    if (!_shallowEqual(previous, next)) {
      _props.value = next;
    }
  }

  /// Tears down this node: runs registered cleanups, then fires
  /// [onDestroyed]. Work appended during the cleanup pass runs in that same
  /// pass, after already queued work; registration afterward runs immediately.
  /// Idempotent, including while a cleanup is running.
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    final List<void Function()> cleanups = _cleanups!;
    // Index iteration includes appended work without invalidating an iterator.
    for (var i = 0; i < cleanups.length; i++) {
      _runCleanup(cleanups[i]);
    }
    _cleanups = null;
    _onDestroyed.notify(instanceId);
  }

  void _runCleanup(void Function() cleanup) {
    try {
      cleanup();
    } catch (error, stackTrace) {
      // A failing cleanup must not prevent the remaining ones from running.
      _log.severe(
        'ComponentNode cleanup error ($instanceId)',
        error,
        stackTrace,
      );
    }
  }

  @override
  Map<String, Object?> toJson() {
    if (isPlaceholder) {
      return {'id': componentId, 'type': type, 'state': state.jsonValue};
    }
    final serialized = <String, Object?>{'id': componentId, 'type': type};
    for (final MapEntry<String, Object?> entry in _props.peek().entries) {
      serialized[entry.key] = _serializeValue(entry.value);
    }
    return serialized;
  }
}

// Destruction must attempt every listener. Keep this policy local to nodes:
// ordinary EventNotifier events still propagate listener exceptions unchanged.
class _DestructionListeners implements EventListenable<void> {
  final List<void Function(void)> _listeners = [];

  @override
  void addListener(void Function(void) listener) => _listeners.add(listener);

  @override
  void removeListener(void Function(void) listener) =>
      _listeners.remove(listener);

  void notify(String instanceId) {
    final List<void Function(void)> listeners = List.of(_listeners);
    _listeners.clear();
    for (final listener in listeners) {
      try {
        listener(null);
      } catch (error, stackTrace) {
        _log.severe(
          'ComponentNode destruction listener error ($instanceId)',
          error,
          stackTrace,
        );
      }
    }
    _listeners.clear();
  }
}

/// Whether two prop values count as unchanged for the shallow comparison in
/// [MutableComponentNode.setProps]: reference identity, with value equality
/// for primitives (equal strings are not always [identical], so identity
/// alone would report equal-value updates as changes), bindings and unresolved
/// child-reference descriptors.
bool sameValue(Object? a, Object? b) {
  if (identical(a, b)) return true;
  if (a is String && b is String) return a == b;
  if (a is num && b is num) return a == b;
  if (a is bool && b is bool) return a == b;
  if (a is ResolvedBinding && b is ResolvedBinding) return a == b;
  if (a is ChildNode && b is ChildNode) return a == b;
  return false;
}

Object? _serializeValue(Object? value) {
  if (value is ComponentNode) {
    return value.toJson();
  }
  if (value is ChildNode) {
    return value.toJson();
  }
  if (value is ResolvedBinding) {
    return _serializeValue(value.value);
  }
  if (value is Function) {
    return '<Action>';
  }
  if (value is List) {
    return value.map(_serializeValue).toList();
  }
  if (value is Map) {
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in value.entries)
        entry.key as String: _serializeValue(entry.value),
    };
  }
  return value;
}

bool _shallowEqual(NodeProps a, NodeProps b) {
  if (identical(a, b)) {
    return true;
  }
  if (a.length != b.length) {
    return false;
  }
  for (final MapEntry<String, Object?> entry in a.entries) {
    if (!b.containsKey(entry.key) || !sameValue(entry.value, b[entry.key])) {
      return false;
    }
  }
  return true;
}
