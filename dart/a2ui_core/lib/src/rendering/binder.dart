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
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;

import '../core/common.dart';
import '../core/component_model.dart';
import '../core/contexts.dart';
import '../core/messages.dart';
import '../core/validation_result.dart';
import '../primitives/reactivity.dart';
import '../primitives/reference_schema.dart';
import '../resolution/resolved_binding.dart';

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
/// The binder emits one per entry of a static `ChildList` array or expanded
/// template, up to [maxDynamicChildListSize]. A descriptor is not a mounted
/// node and owns no lifecycle.
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
/// into [ResolvedBinding] wrappers or literal shapes. The
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

  // Actions resolve to closures, which cannot be compared by value; reusing
  // the closure while the raw payload is unchanged keeps unchanged action
  // props identical across rebuilds.
  final Map<String, ({Object? raw, Future<void> Function() closure})>
      _actionClosures = {};
  static const DeepCollectionEquality _deepEquals = DeepCollectionEquality();

  /// The live properties for the component. Dynamic properties resolve to
  /// [ResolvedBinding] wrappers: a read-only [ResolvedBinding] for literals
  /// and function calls, a [WritableBinding] for path bindings, and a read-only
  /// null binding for omitted or null dynamic properties, including within
  /// existing nested objects and arrays. Absent or null non-dynamic containers
  /// are not synthesized. A path binding to missing data is still a
  /// [WritableBinding] whose value is null.
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
  // The initial synchronous pass captures initialValue without invoking
  // onValue, avoiding writes to stale _resolvedProps during a rebuild.
  Object? _subscribe(
    ReadonlySignal<Object?> source,
    void Function(Object?) onValue,
  ) {
    if (_disposed) return null;
    Object? initialValue;
    var isInitial = true;
    final void Function() unsubscribe = source.subscribe((value) {
      if (isInitial) {
        isInitial = false;
        initialValue = value;
        return;
      }
      if (!_disposed) onValue(value);
    });
    if (_disposed) {
      unsubscribe();
      return null;
    }
    _subscriptions.add(unsubscribe);
    return initialValue;
  }

  Object? _resolveAndBind(
    Object? value,
    BehaviorNode behavior,
    List<String> path,
    bool isSync, {
    Map<String, dynamic>? parentResult,
  }) {
    if (_disposed) return null;
    if (value == null) {
      return behavior.type == Behavior.dynamic
          ? const ResolvedBinding<Object?>(null)
          : null;
    }

    switch (behavior.type) {
      case Behavior.dynamic:
        final bool isV10 = context.dataContext.isV10;
        final ReadonlySignal<Object?> sig =
            context.dataContext.resolveListenable(value);
        // When the protocol's binding key is present (without `componentId` in
        // pre-v1.0), cast its value to `String` so a malformed non-string path
        // (such as `{'path': 42}`) throws `TypeError` during materialization.
        final String? boundPath = value is Map &&
                (isV10
                    ? value.containsKey('@path')
                    : (value.containsKey('path') &&
                        !value.containsKey('componentId')))
            ? (value[isV10 ? '@path' : 'path'] as String)
            : null;
        ResolvedBinding<Object?> wrap(Object? current) {
          final Object? snapshot = _snapshotBindingValue(current);
          return boundPath == null
              ? ResolvedBinding<Object?>(snapshot)
              : WritableBinding<Object?>(
                  snapshot,
                  (newValue) => context.dataContext.set(
                    boundPath,
                    _mutableCopy(newValue),
                  ),
                  boundPath,
                );
        }
        final Object? current = isSync
            ? sig.value
            : _subscribe(sig, (newValue) {
                _updateDeepValue(path, wrap(newValue));
              });
        return _disposed ? null : wrap(current);

      case Behavior.action:
        final String cacheKey = path.join('/');
        final ({Object? raw, Future<void> Function() closure})? cached =
            _actionClosures[cacheKey];
        if (cached != null && _deepEquals.equals(cached.raw, value)) {
          return cached.closure;
        }
        Future<void> closure() async {
          // The v0.9.1 and v1.0 `Action` schemas define only the
          // `{functionCall: {call, args}}` and `{event: {name, ...}}` forms.
          // The unwrapped `{call, args}` and `{name, ...}` forms are also
          // accepted on purpose, to match the TypeScript web_core binder.
          if (value is Map) {
            final Object? fc =
                value['functionCall'] is Map ? value['functionCall'] : value;
            if (context.dataContext.isFunctionCall(fc)) {
              await _runLocalFunction(Map<String, dynamic>.from(fc as Map));
              return;
            }
          }
          final Object? resolved = _resolveEventAction(
            context.dataContext,
            value,
          );
          if (resolved is Map) {
            await context.dispatchAction(Map<String, dynamic>.from(resolved));
          } else {
            await context.surface.dispatchError(
              A2uiClientError(
                code: 'INVALID_ACTION',
                surfaceId: context.surface.id,
                message: 'Invalid action payload in component '
                    "'${context.componentModel.id}': $value",
                details: value,
              ),
            );
          }
        }

        _actionClosures[cacheKey] = (raw: value, closure: closure);
        return closure;

      case Behavior.structural:
        if (value is Map &&
            value['path'] is String &&
            value['componentId'] is String &&
            value.keys.every((k) => k is String)) {
          final tpl = ChildListTemplate.fromJson(
            Map<String, dynamic>.from(value),
          );
          final ReadonlySignal<Object?> sig = context.dataContext
              .resolveListenable(context.dataContext.bindingFor(tpl.path));

          List<ChildNode> resolveChildren(Object? val) {
            final List<Object?> list = val is List ? val.cast<Object?>() : [];
            final DataContext nestedCtx = context.dataContext.nested(tpl.path);
            final int count = list.length > maxDynamicChildListSize
                ? maxDynamicChildListSize
                : list.length;
            return List.generate(
              count,
              (i) => ChildNode(
                tpl.componentId,
                nestedCtx.resolvePath(i.toString()),
              ),
            );
          }

          final Object? current = isSync
              ? sig.value
              : _subscribe(sig, (newValue) {
                  _updateDeepValue(path, resolveChildren(newValue));
                });
          return _disposed ? null : resolveChildren(current);
        }
        if (value is List) {
          return value
              .take(maxDynamicChildListSize)
              .map((id) => ChildNode(id.toString(), context.dataContext.path))
              .toList();
        }
        return value;

      case Behavior.checkable:
        if (value is! List) {
          context.surface.dispatchError(
            A2uiClientError(
              code: 'VALIDATION_FAILED',
              surfaceId: context.surface.id,
              path: '/${path.join('/')}',
              message:
                  'Expected "checks" to be a List, got ${value.runtimeType}.',
            ),
          );
          if (!_disposed && parentResult != null) {
            parentResult['isValid'] = true;
            parentResult['validationErrors'] = const <String>[];
            parentResult['validationResults'] = const <ValidationResult>[];
          }
          return value;
        }
        final List<Object?> rules = value.cast<Object?>();
        final ruleResults = <ValidationResult>[];

        void applyValidationState(
          void Function(String key, Object value) write,
        ) {
          final failedResults = <ValidationResult>[
            for (final ValidationResult r in ruleResults)
              if (!r.valid) r,
          ];
          final errors = <String>[
            for (final ValidationResult r in failedResults)
              if ((r.severity ?? 'error') == 'error')
                r.message ?? 'Validation failed',
          ];
          write('isValid', errors.isEmpty);
          write('validationErrors', errors);
          write('validationResults', failedResults);
        }

        void updateValidationState() {
          final List<String> parentPath =
              path.isEmpty ? const [] : path.sublist(0, path.length - 1);
          batch(() {
            applyValidationState(
              (key, val) => _updateDeepValue([...parentPath, key], val),
            );
          });
        }

        for (var i = 0; i < rules.length; i++) {
          if (_disposed) return null;
          final Object? rawRule = rules[i];
          if (rawRule is! Map || rawRule.keys.any((k) => k is! String)) {
            context.surface.dispatchError(
              A2uiClientError(
                code: 'VALIDATION_FAILED',
                surfaceId: context.surface.id,
                path: '/${[...path, i.toString()].join('/')}',
                message: 'Check rule at index $i in component '
                    "'${context.componentModel.id}' must be an object, "
                    'got ${rawRule.runtimeType}.',
              ),
            );
            continue;
          }
          final Object? condition =
              rawRule.containsKey('condition') ? rawRule['condition'] : rawRule;
          final Object? rawMessage = rawRule['message'];
          final fallbackMessage =
              (rawMessage != null && rawMessage.toString().isNotEmpty)
                  ? rawMessage.toString()
                  : 'Validation failed';

          final int slot = ruleResults.length;
          ruleResults.add(const ValidationResult(valid: true));

          final Object? initialVal = isSync
              ? context.dataContext.resolveSync(condition)
              : _subscribe(
                  context.dataContext.resolveListenable(condition),
                  (newValue) {
                    ruleResults[slot] = ValidationResult.fromEvaluation(
                      newValue,
                      fallbackMessage: fallbackMessage,
                    );
                    updateValidationState();
                  },
                );
          if (_disposed) return null;
          ruleResults[slot] = ValidationResult.fromEvaluation(
            initialVal,
            fallbackMessage: fallbackMessage,
          );
        }

        if (!_disposed && parentResult != null) {
          applyValidationState((key, val) => parentResult[key] = val);
        }

        // Return original rules for 'checks' property
        return value;

      case Behavior.object:
        if (value is! Map) return value;
        final result = <String, dynamic>{};
        final Map<String, BehaviorNode> shape = behavior.shape ?? {};

        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final Object? rawKey = entry.key;
          if (rawKey is! String) continue;
          final String key = rawKey;
          final BehaviorNode childBehavior =
              shape[key] ?? BehaviorNode(Behavior.static);
          result[key] = _resolveAndBind(
            entry.value,
            childBehavior,
            [...path, key],
            isSync,
            parentResult: result,
          );
        }

        // Dynamic props always have a binding, including omitted values. Only
        // visit objects already present; absent static containers stay absent.
        for (final MapEntry<String, BehaviorNode> entry in shape.entries) {
          if (entry.value.type == Behavior.dynamic &&
              !result.containsKey(entry.key)) {
            result[entry.key] = const ResolvedBinding<Object?>(null);
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
              (e) => _resolveAndBind(
                  e.value,
                  elementBehavior,
                  [
                    ...path,
                    e.key.toString(),
                  ],
                  isSync),
            )
            .toList();

      case Behavior.static:
        return value;
    }
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

    if (_schemaReader.isCheckable(schemasToInspect)) {
      return BehaviorNode(Behavior.checkable);
    }

    if (_schemaReader.referencesType(schemasToInspect, 'Action')) {
      return BehaviorNode(Behavior.action);
    }
    if (const [
      'DynamicValue',
      'DynamicString',
      'DynamicNumber',
      'DynamicBoolean',
      'DynamicStringList',
    ].any((type) => _schemaReader.referencesType(schemasToInspect, type))) {
      return BehaviorNode(Behavior.dynamic);
    }

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

    final bool isV10 = context.dataContext.isV10;
    bool hasPath = schemasToInspect.any(
      (s) =>
          s['properties'] != null &&
          (isV10
              ? (s['properties'] as Map)['@path'] != null
              : (s['properties'] as Map)['path'] != null) &&
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

  /// Runs a local function action against the component's data context.
  ///
  /// A function that throws, returns a failing `Future`, or is missing from
  /// the catalog is reported through `SurfaceModel.dispatchError`, so the
  /// error does not escape a renderer callback that doesn't await the action.
  Future<void> _runLocalFunction(Map<String, dynamic> functionCall) async {
    try {
      final Object? result = context.dataContext.resolveSync(functionCall);
      if (result is Future<Object?>) await result;
    } catch (e) {
      final Object? fnName = functionCall['@call'] ?? functionCall['call'];
      await context.surface.dispatchError(
        A2uiClientError(
          code: 'EXECUTION_ERROR',
          surfaceId: context.surface.id,
          message: "Local function '$fnName' failed in component "
              "'${context.componentModel.id}': $e",
        ),
      );
    }
  }

  Object? _resolveEventAction(DataContext dataContext, Object? value) {
    final Map<String, dynamic>? direct = dataContext.resolveAction(value);
    if (direct != null) return direct;
    if (dataContext.isDataBinding(value)) {
      return dataContext.resolveAction(dataContext.resolveSync(value));
    }
    return null;
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

/// The maximum number of children a `ChildList` expands to, whether a static id
/// array or a template bound to a very large array, bounding resource use.
const int maxDynamicChildListSize = 10000;

/// Copies container values handed to [WritableBinding.set], so a published
/// unmodifiable snapshot written back, or a partial copy still holding one,
/// is stored as a mutable container. Maps keep their keys, and a map with only
/// string keys is copied as a `Map<String, Object?>`. Opaque values keep their
/// identity.
Object? _mutableCopy(Object? value) {
  if (value is List) {
    return <Object?>[for (final Object? item in value) _mutableCopy(item)];
  }
  if (value is Map && value.keys.every((key) => key is String)) {
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in value.entries)
        entry.key as String: _mutableCopy(entry.value),
    };
  }
  if (value is Map) {
    return <Object?, Object?>{
      for (final MapEntry<Object?, Object?> entry in value.entries)
        entry.key: _mutableCopy(entry.value),
    };
  }
  return value;
}

/// Copies container values so later data-model writes cannot mutate an
/// already-emitted binding or hide a change from binding value comparison.
/// Copies are recursively unmodifiable; opaque values keep their identity.
Object? _snapshotBindingValue(Object? value) {
  if (value is List) {
    return List<Object?>.unmodifiable(value.map(_snapshotBindingValue));
  }
  // Keeps the Map<String, Object?> type, which the untyped branch would lose.
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
