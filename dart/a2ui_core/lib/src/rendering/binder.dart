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

import 'package:collection/collection.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../core/common.dart';
import '../core/component_model.dart';
import '../core/contexts.dart';
import '../primitives/reactivity.dart';
import '../primitives/reference_schema.dart';
import 'resolved_binding.dart';

/// Represents the intended runtime behavior of a property parsed from
/// its schema.
enum Behavior { dynamic, action, structural, checkable, static, object, array }

class BehaviorNode {
  final Behavior type;
  final Map<String, BehaviorNode>? shape;
  final BehaviorNode? element;

  BehaviorNode(this.type, {this.shape, this.element});
}

/// An unresolved child reference and the data scope it would render against.
///
/// The binder uses these values for both static `ChildList` arrays and expanded
/// templates. The node resolver replaces supported reference positions with
/// mounted nodes, but publishes these descriptors unchanged in nested positions
/// it does not resolve. A descriptor is not a mounted node and owns no
/// lifecycle.
///
/// Unlike TypeScript's binder, which leaves static child arrays as id strings,
/// Dart uses the same scoped descriptor for static lists and templates.
class ChildNode {
  /// The referenced component id.
  final String id;

  /// The absolute data path for this reference's component instance.
  final String basePath;

  ChildNode(this.id, this.basePath);

  @override
  bool operator ==(Object other) =>
      other is ChildNode && id == other.id && basePath == other.basePath;

  @override
  int get hashCode => Object.hash(id, basePath);

  Map<String, dynamic> toJson() => {'id': id, 'basePath': basePath};
}

/// Takes a component's raw JSON properties (which may contain data
/// bindings, function calls, and action definitions) and resolves them
/// into concrete values (strings, callbacks, child lists, etc). The
/// resolved output updates automatically when underlying data changes.
class GenericBinder {
  final ComponentContext context;
  final Schema schema;
  late final BehaviorNode _behaviorTree;
  late final ReferenceSchemaReader _schemaReader;

  late final Signal<Map<String, dynamic>> _resolvedProps;
  final List<void Function()> _subscriptions = [];
  bool _isConnected = false;
  bool _disposed = false;

  // Actions resolve to closures, which downstream value comparison cannot
  // inspect; reusing the closure while the raw payload is unchanged keeps
  // unchanged action props identical across rebuilds.
  final Map<String, ({Object? raw, Future<void> Function() closure})>
  _actionClosures = {};
  static const DeepCollectionEquality _deepEquals = DeepCollectionEquality();

  ReadonlySignal<Map<String, dynamic>> get resolvedProps => _resolvedProps;

  GenericBinder(this.context, this.schema) {
    _schemaReader = ReferenceSchemaReader(
      schema.value,
      document: context.surface.catalog.catalogSchema,
    );
    _behaviorTree = _scrapeSchemaBehavior(schema.value);
    _resolvedProps = signal<Map<String, dynamic>>({});
    connect();
  }

  /// Connects to the component model for updates. No-op after [dispose].
  void connect() {
    if (_isConnected || _disposed) return;
    _isConnected = true;
    context.componentModel.onUpdated.addListener(_onComponentUpdated);
    _rebuildAllBindings();
  }

  void _onComponentUpdated(ComponentModel _) => _rebuildAllBindings();

  void _rebuildAllBindings() {
    if (_disposed) return;
    batch(() {
      _disposeSubscriptions();

      final Map<String, dynamic> props = context.componentModel.properties;
      final Object? next = _resolveAndBind(props, _behaviorTree, [], false);
      if (!_disposed) {
        _resolvedProps.value = next as Map<String, dynamic>;
      }
    });
  }

  void _disposeSubscriptions() {
    final List<void Function()> subscriptions = List.of(_subscriptions);
    _subscriptions.clear();
    for (final dispose in subscriptions) {
      dispose();
    }
  }

  // subscribe evaluates synchronously. Evaluation may dispose this binder
  // before subscribe returns its cleanup; never acquire that cleanup afterward.
  void _subscribe(
    ReadonlySignal<Object?> source,
    void Function(Object?) onValue,
  ) {
    if (_disposed) return;
    final void Function() unsubscribe = source.subscribe((value) {
      if (!_disposed) onValue(value);
    });
    if (_disposed) {
      unsubscribe();
    } else {
      _subscriptions.add(unsubscribe);
    }
  }

  Object? _resolveAndBind(
    Object? value,
    BehaviorNode behavior,
    List<String> path,
    bool isSync,
  ) {
    if (_disposed) return null;
    if (value == null) {
      return behavior.type == Behavior.dynamic
          ? const ResolvedBinding<Object?>(null)
          : null;
    }

    switch (behavior.type) {
      case Behavior.dynamic:
        final ReadonlySignal<Object?> sig = context.dataContext
            .resolveListenable(value);
        final String? boundPath = value is Map && value.containsKey('path')
            ? value['path'] as String
            : null;
        ResolvedBinding<Object?> wrap(Object? current) {
          final Object? snapshot = _snapshotBindingValue(current);
          return boundPath == null
              ? ResolvedBinding<Object?>(snapshot)
              : WritableBinding<Object?>(
                  snapshot,
                  (newValue) => context.dataContext.set(boundPath, newValue),
                  boundPath,
                );
        }
        if (!isSync) {
          _subscribe(sig, (newValue) {
            _updateDeepValue(path, wrap(newValue));
          });
        }
        return _disposed ? null : wrap(sig.value);

      case Behavior.action:
        final String cacheKey = path.join('/');
        final ({Object? raw, Future<void> Function() closure})? cached =
            _actionClosures[cacheKey];
        if (cached != null && _deepEquals.equals(cached.raw, value)) {
          return cached.closure;
        }
        Future<void> closure() async {
          final Object? resolved = _resolveActionPayload(value);
          final Map<String, dynamic> resolvedAction;
          if (resolved is Map) {
            resolvedAction = Map<String, dynamic>.from(resolved);
          } else {
            resolvedAction = {
              'event': {'name': value.toString()},
            };
          }
          await context.dispatchAction(resolvedAction);
        }

        _actionClosures[cacheKey] = (raw: value, closure: closure);
        return closure;

      case Behavior.structural:
        if (value is Map &&
            value.containsKey('path') &&
            value.containsKey('componentId')) {
          final tpl = ChildListTemplate.fromJson(
            Map<String, dynamic>.from(value),
          );
          final ReadonlySignal<Object?> sig = context.dataContext
              .resolveListenable({'path': tpl.path});

          List<ChildNode> resolveChildren(Object? val) {
            final List<Object?> list = val is List ? val.cast<Object?>() : [];
            final DataContext nestedCtx = context.dataContext.nested(tpl.path);
            return List.generate(
              list.length,
              (i) => ChildNode(
                tpl.componentId,
                nestedCtx.resolvePath(i.toString()),
              ),
            );
          }

          if (!isSync) {
            _subscribe(sig, (newValue) {
              _updateDeepValue(path, resolveChildren(newValue));
            });
          }
          return _disposed ? null : resolveChildren(sig.value);
        }
        if (value is List) {
          return value
              .map((id) => ChildNode(id.toString(), context.dataContext.path))
              .toList();
        }
        return value;

      case Behavior.checkable:
        final List<Object?> rules = value is List ? value.cast<Object?>() : [];
        final List<bool> results = List.filled(rules.length, true);
        final List<String> messages = rules
            .cast<Map<String, dynamic>>()
            .map((r) => r['message']?.toString() ?? 'Validation failed')
            .toList();

        void updateValidationState() {
          final errors = <String>[];
          for (var i = 0; i < results.length; i++) {
            if (!results[i]) errors.add(messages[i]);
          }
          final List<String> parentPath = path.sublist(0, path.length - 1);
          _updateDeepValue([...parentPath, 'isValid'], errors.isEmpty);
          _updateDeepValue([...parentPath, 'validationErrors'], errors);
        }

        for (var i = 0; i < rules.length; i++) {
          if (_disposed) return null;
          final Object? condition =
              (rules[i] as Map<String, dynamic>)['condition'] ?? rules[i];
          final ReadonlySignal<Object?> sig = context.dataContext
              .resolveListenable(condition);
          results[i] = sig.value == true;

          if (!isSync) {
            final idx = i;
            _subscribe(sig, (newValue) {
              results[idx] = newValue == true;
              updateValidationState();
            });
          }
        }

        // Return original rules for 'checks' property
        return value;

      case Behavior.object:
        if (value is! Map) return value;
        final result = <String, dynamic>{};
        final Map<String, BehaviorNode> shape = behavior.shape ?? {};

        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final key = entry.key as String;
          final BehaviorNode childBehavior =
              shape[key] ?? BehaviorNode(Behavior.static);
          result[key] = _resolveAndBind(entry.value, childBehavior, [
            ...path,
            key,
          ], isSync);
        }

        // Dynamic props always have a binding, including omitted values. Only
        // visit objects already present; absent static containers stay absent.
        for (final MapEntry<String, BehaviorNode> entry in shape.entries) {
          if (entry.value.type == Behavior.dynamic &&
              !result.containsKey(entry.key)) {
            result[entry.key] = const ResolvedBinding<Object?>(null);
          }
        }

        // Inject validation properties if 'checks' is present in shape
        if (!_disposed &&
            shape.containsKey('checks') &&
            result.containsKey('checks')) {
          final List<Object?> rules =
              (value['checks'] as List?)?.cast<Object?>() ?? [];
          var isValid = true;
          final errors = <String>[];
          final List<Map<String, dynamic>> typedRules = rules
              .cast<Map<String, dynamic>>();
          for (final rule in typedRules) {
            if (_disposed) return null;
            final Object? condition = rule['condition'] ?? rule;
            final Object? val = context.dataContext.resolveSync(condition);
            if (val != true) {
              isValid = false;
              errors.add(rule['message']?.toString() ?? 'Validation failed');
            }
          }
          result['isValid'] = isValid;
          result['validationErrors'] = errors;
        }

        return result;

      case Behavior.array:
        if (value is! List) return value;
        final BehaviorNode elementBehavior =
            behavior.element ?? BehaviorNode(Behavior.static);
        return value
            .asMap()
            .entries
            .map(
              (e) => _resolveAndBind(e.value, elementBehavior, [
                ...path,
                e.key.toString(),
              ], isSync),
            )
            .toList();

      case Behavior.static:
        return value;
    }
  }

  /// Resolves an action payload for dispatch: a `{path}` or `{call}` object
  /// at any depth resolves through the data context, and the surrounding
  /// literal structure is preserved. Unlike dynamic-value resolution, the
  /// walk is deep, because an action nests its dynamic values inside the
  /// event structure (e.g. `event.context` entries).
  Object? _resolveActionPayload(Object? value) {
    if (value is Map) {
      if (value.containsKey('path') || value.containsKey('call')) {
        return context.dataContext.resolveSync(value);
      }
      return <String, Object?>{
        for (final MapEntry<Object?, Object?> entry in value.entries)
          entry.key as String: _resolveActionPayload(entry.value),
      };
    }
    if (value is List) {
      return value.map(_resolveActionPayload).toList();
    }
    return value;
  }

  void _updateDeepValue(List<String> path, Object? newValue) {
    if (_disposed) return;
    _resolvedProps.value = _cloneAndUpdate(
      _resolvedProps.value,
      path,
      newValue,
    );
  }

  Map<String, dynamic> _cloneAndUpdate(
    Map<String, dynamic> map,
    List<String> path,
    Object? newValue,
  ) {
    if (path.isEmpty) return newValue as Map<String, dynamic>;

    final result = Map<String, dynamic>.from(map);
    Object? current = result;

    for (var i = 0; i < path.length - 1; i++) {
      final String key = path[i];
      if (current is Map) {
        current[key] = current[key] is Map
            ? Map<String, dynamic>.from(current[key] as Map)
            : (current[key] is List
                  ? List<Object?>.from(current[key] as Iterable)
                  : <String, dynamic>{});
        current = current[key];
      } else if (current is List) {
        final int idx = int.parse(key);
        current[idx] = current[idx] is Map
            ? Map<String, dynamic>.from(current[idx] as Map)
            : (current[idx] is List
                  ? List<Object?>.from(current[idx] as Iterable)
                  : <String, dynamic>{});
        current = current[idx];
      }
    }

    final String lastKey = path.last;
    if (current is Map) {
      current[lastKey] = newValue;
    } else if (current is List) {
      current[int.parse(lastKey)] = newValue;
    }

    return result;
  }

  BehaviorNode _scrapeSchemaBehavior(
    Object? schema, [
    String? propertyName,
    Set<Object>? ancestors,
  ]) {
    if (propertyName == 'checks') return BehaviorNode(Behavior.checkable);
    final Set<Object> visiting = Set.identity()..addAll(ancestors ?? {});
    if (schema == null || !visiting.add(schema)) {
      return BehaviorNode(Behavior.static);
    }
    final List<Map<String, Object?>> schemasToInspect = _schemaReader.schemas(
      schema,
    );
    if (_schemaReader.referenceKind(schemasToInspect) is ListRef) {
      return BehaviorNode(Behavior.structural);
    }
    // A recursive local alias can point back through a property or array.
    // Those deeper occurrences stay literal rather than expanding forever.
    if (schemasToInspect.any((node) => ancestors?.contains(node) ?? false)) {
      return BehaviorNode(Behavior.static);
    }
    visiting.addAll(schemasToInspect);

    bool hasEvent = schemasToInspect.any(
      (s) =>
          s['properties'] != null && (s['properties'] as Map)['event'] != null,
    );
    bool hasFunctionCall = schemasToInspect.any(
      (s) =>
          s['properties'] != null &&
          (s['properties'] as Map)['functionCall'] != null,
    );
    if (hasEvent || hasFunctionCall) return BehaviorNode(Behavior.action);

    bool hasPath = schemasToInspect.any(
      (s) =>
          s['properties'] != null &&
          (s['properties'] as Map)['path'] != null &&
          (s['properties'] as Map)['componentId'] == null,
    );
    if (hasPath) return BehaviorNode(Behavior.dynamic);

    final Map<String, Object?> allProperties = _schemaReader.properties(
      schemasToInspect,
    );
    final bool isObject = schemasToInspect.any((s) => s['type'] == 'object');
    if (isObject || allProperties.isNotEmpty) {
      final shape = <String, BehaviorNode>{};
      for (final MapEntry<String, dynamic> entry in allProperties.entries) {
        shape[entry.key] = _scrapeSchemaBehavior(
          entry.value,
          entry.key,
          visiting,
        );
      }
      return BehaviorNode(Behavior.object, shape: shape);
    }

    final Object? items = _schemaReader.items(schemasToInspect);
    if (items != null) {
      return BehaviorNode(
        Behavior.array,
        element: _scrapeSchemaBehavior(items, null, visiting),
      );
    }

    return BehaviorNode(Behavior.static);
  }

  /// Permanently disconnects this binder, including an interrupted rebuild.
  /// Later [connect] calls cannot reactivate it. Idempotent.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    context.componentModel.onUpdated.removeListener(_onComponentUpdated);
    _disposeSubscriptions();
  }
}

/// Copies container values so later data-model writes cannot mutate an
/// already-emitted binding or hide a change from binding value comparison.
/// Copies are recursively unmodifiable; opaque values keep their identity.
Object? _snapshotBindingValue(Object? value) {
  if (value is List) {
    return List<Object?>.unmodifiable(value.map(_snapshotBindingValue));
  }
  if (value is Map<String, Object?>) {
    return UnmodifiableMapView(
      value.map((key, item) => MapEntry(key, _snapshotBindingValue(item))),
    );
  }
  if (value is Map) {
    return UnmodifiableMapView(
      value.map((key, item) => MapEntry(key, _snapshotBindingValue(item))),
    );
  }
  return value;
}
