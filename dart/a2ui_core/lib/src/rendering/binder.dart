// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'package:json_schema_builder/json_schema_builder.dart';

import '../core/common.dart';
import '../core/component_model.dart';
import '../core/contexts.dart';
import '../primitives/reactivity.dart';

/// Represents the intended runtime behavior of a property parsed from
/// its schema.
enum Behavior { dynamic, action, structural, checkable, static, object, array }

class BehaviorNode {
  final Behavior type;
  final Map<String, BehaviorNode>? shape;
  final BehaviorNode? element;

  BehaviorNode(this.type, {this.shape, this.element});
}

class ChildNode {
  final String id;
  final String basePath;
  ChildNode(this.id, this.basePath);

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

  late final Signal<Map<String, dynamic>> _resolvedProps;
  final List<void Function()> _subscriptions = [];
  bool _isConnected = false;

  ReadonlySignal<Map<String, dynamic>> get resolvedProps => _resolvedProps;

  GenericBinder(this.context, this.schema) {
    _behaviorTree = _scrapeSchemaBehavior(schema);
    _resolvedProps = signal<Map<String, dynamic>>({});
    connect();
  }

  /// Connects to the component model for updates.
  void connect() {
    if (_isConnected) return;
    _isConnected = true;
    context.componentModel.onUpdated.addListener(_onComponentUpdated);
    _rebuildAllBindings();
  }

  void _onComponentUpdated(ComponentModel _) => _rebuildAllBindings();

  void _rebuildAllBindings() {
    _disposeSubscriptions();

    final Map<String, dynamic> props = context.componentModel.properties;
    _resolvedProps.value =
        _resolveAndBind(props, _behaviorTree, [], false)
            as Map<String, dynamic>;
  }

  void _disposeSubscriptions() {
    for (final void Function() dispose in _subscriptions) {
      dispose();
    }
    _subscriptions.clear();
  }

  Object? _resolveAndBind(
    Object? value,
    BehaviorNode behavior,
    List<String> path,
    bool isSync,
  ) {
    if (value == null) return null;

    switch (behavior.type) {
      case Behavior.dynamic:
        final ReadonlySignal<Object?> sig = context.dataContext
            .resolveListenable(value);
        if (!isSync) {
          _subscriptions.add(
            sig.subscribe((newValue) {
              _updateDeepValue(path, newValue);
            }),
          );
        }
        return sig.value;

      case Behavior.action:
        return () async {
          final Object? resolved = context.dataContext.resolveSync(value);
          final Map<String, dynamic> resolvedAction;
          if (resolved is Map) {
            resolvedAction = Map<String, dynamic>.from(resolved);
          } else {
            resolvedAction = {
              'event': {'name': value.toString()},
            };
          }
          await context.dispatchAction(resolvedAction);
        };

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
            _subscriptions.add(
              sig.subscribe((newValue) {
                _updateDeepValue(path, resolveChildren(newValue));
              }),
            );
          }
          return resolveChildren(sig.value);
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
          final Object? condition =
              (rules[i] as Map<String, dynamic>)['condition'] ?? rules[i];
          final ReadonlySignal<Object?> sig = context.dataContext
              .resolveListenable(condition);
          results[i] = sig.value == true;

          if (!isSync) {
            final idx = i;
            _subscriptions.add(
              sig.subscribe((newValue) {
                results[idx] = newValue == true;
                updateValidationState();
              }),
            );
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

        // Inject validation properties if 'checks' is present in shape
        if (shape.containsKey('checks') && result.containsKey('checks')) {
          final List<Object?> rules =
              (value['checks'] as List?)?.cast<Object?>() ?? [];
          var isValid = true;
          final errors = <String>[];
          final List<Map<String, dynamic>> typedRules = rules
              .cast<Map<String, dynamic>>();
          for (final rule in typedRules) {
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

        // Add setters for dynamic properties
        for (final MapEntry<String, BehaviorNode> entry in shape.entries) {
          if (entry.value.type == Behavior.dynamic) {
            final String key = entry.key;
            final setterName = 'set${key[0].toUpperCase()}${key.substring(1)}';
            final Object? rawValue = value[key];
            if (rawValue is Map && rawValue.containsKey('path')) {
              result[setterName] = (Object? newValue) {
                context.dataContext.set(rawValue['path'] as String, newValue);
              };
            }
          }
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

  void _updateDeepValue(List<String> path, Object? newValue) {
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

  BehaviorNode _scrapeSchemaBehavior(Schema schema, [String? propertyName]) {
    final Map<String, Object?> map = schema.value;

    if (propertyName == 'checks') return BehaviorNode(Behavior.checkable);

    // Recursively collect all schemas from allOf/anyOf/oneOf
    final List<Map<String, dynamic>> schemasToInspect = [];
    void collectSchemas(Map<String, dynamic> s) {
      schemasToInspect.add(s);
      if (s['allOf'] is List) {
        for (final sub in s['allOf'] as List) {
          if (sub is Map) collectSchemas(sub.cast<String, dynamic>());
        }
      }
      if (s['anyOf'] is List) {
        for (final sub in s['anyOf'] as List) {
          if (sub is Map) collectSchemas(sub.cast<String, dynamic>());
        }
      }
      if (s['oneOf'] is List) {
        for (final sub in s['oneOf'] as List) {
          if (sub is Map) collectSchemas(sub.cast<String, dynamic>());
        }
      }
    }

    collectSchemas(map.cast<String, dynamic>());

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

    bool hasStructural = schemasToInspect.any(
      (s) =>
          s['properties'] != null &&
          (s['properties'] as Map)['componentId'] != null &&
          (s['properties'] as Map)['path'] != null,
    );
    if (hasStructural) return BehaviorNode(Behavior.structural);

    final Object? type = map['type'];
    final Map<String, dynamic> allProperties = {};
    for (final s in schemasToInspect) {
      if (s['properties'] is Map) {
        allProperties.addAll((s['properties'] as Map).cast<String, dynamic>());
      }
    }

    if (type == 'object' || allProperties.isNotEmpty) {
      final shape = <String, BehaviorNode>{};
      for (final MapEntry<String, dynamic> entry in allProperties.entries) {
        shape[entry.key] = _scrapeSchemaBehavior(
          Schema.fromMap(entry.value as Map<String, Object?>),
          entry.key,
        );
      }
      return BehaviorNode(Behavior.object, shape: shape);
    }

    if (type == 'array') {
      final Object? items = map['items'];
      if (items is Map) {
        return BehaviorNode(
          Behavior.array,
          element: _scrapeSchemaBehavior(
            Schema.fromMap(items as Map<String, Object?>),
          ),
        );
      }
    }

    return BehaviorNode(Behavior.static);
  }

  void dispose() {
    _disposeSubscriptions();
    context.componentModel.onUpdated.removeListener(_onComponentUpdated);
  }
}
