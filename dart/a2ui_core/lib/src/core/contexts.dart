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

import '../primitives/errors.dart';
import '../primitives/reactivity.dart';
import '../validation/component_graph.dart' show maxFunctionCallArgs;
import 'catalog.dart';
import 'common.dart';
import 'component_model.dart';
import 'data_model.dart';
import 'messages.dart';
import 'surface_model.dart';

/// A function that invokes a catalog function by name.
typedef FunctionInvoker = Object? Function(
  String name,
  Map<String, dynamic> args,
  DataContext context,
);

/// Reports a failed function evaluation without depending on a surface.
typedef ExpressionErrorReporter = void Function(A2uiExpressionError error);

/// Provides data access relative to a specific path in the DataModel.
///
/// Similar to a working directory: a DataContext scoped to `/users/0`
/// lets components use relative paths like `name` instead of absolute
/// paths like `/users/0/name`. Also evaluates data bindings and
/// function calls.
class DataContext {
  final DataModel dataModel;
  final FunctionInvoker _invoke;
  final ExpressionErrorReporter? _onError;
  final String path;
  final String? protocolVersion;

  /// With [onError], failed invocations are reported and resolve to null.
  /// Without it, the original exception is rethrown.
  DataContext(
    this.dataModel,
    this._invoke,
    this.path, {
    ExpressionErrorReporter? onError,
    this.protocolVersion,
  }) : _onError = onError;

  bool get isV10 {
    final String? v = protocolVersion;
    if (v == null) return false;
    final String core = v.startsWith('v') ? v.substring(1) : v;
    return (int.tryParse(core.split('.').first) ?? 0) >= 1;
  }

  /// Returns a data-binding map for [path] using the key required by the
  /// active protocol version (`{'@path': path}` in v1.0+, `{'path': path}` in
  /// pre-v1.0).
  Map<String, Object?> bindingFor(String path) => isV10
      ? <String, Object?>{'@path': path}
      : <String, Object?>{'path': path};

  /// Whether [value] is a data-binding object under this context's protocol
  /// version.
  ///
  /// From v1.0, a data binding is `{'@path': '<pointer>'}`. Before v1.0 it is
  /// `{'path': '<pointer>'}` without a `componentId` sibling, which would make
  /// it a `ChildListTemplate` instead.
  bool isDataBinding(Object? value) {
    if (value is! Map) return false;
    return isV10
        ? value['@path'] is String
        : value['path'] is String && !value.containsKey('componentId');
  }

  /// Whether [value] is a function-call object under this context's protocol
  /// version.
  ///
  /// From v1.0, a function call is `{'@call': '<name>', ...}`. Before v1.0 it
  /// is `{'call': '<name>', ...}`.
  bool isFunctionCall(Object? value) {
    if (value is! Map) return false;
    return isV10 ? value['@call'] is String : value['call'] is String;
  }

  /// Rewrites [part], a node of a parsed `${...}` expression, into the
  /// dynamic-value shape this context resolves.
  ///
  /// `ExpressionParser` always emits `{path}` and `{call, args, returnType}`
  /// nodes. Before v1.0 those are already the resolvable shape and [part] is
  /// returned unchanged. From v1.0 a path node becomes [bindingFor] of its
  /// path, a call node becomes `{'@call', 'args', 'returnType'}` with its
  /// arguments rewritten recursively, and lists and other maps are rewritten
  /// element by element.
  Object? adaptExpressionPart(Object? part) {
    if (!isV10) return part;
    if (part is List) {
      return [for (final Object? item in part) adaptExpressionPart(item)];
    }
    if (part is! Map) return part;
    if (part['path'] is String &&
        !part.containsKey('componentId') &&
        !part.containsKey('@path')) {
      return bindingFor(part['path'] as String);
    }
    if (part['call'] is String && !part.containsKey('@call')) {
      final Object? rawArgs = part['args'];
      return <String, Object?>{
        '@call': part['call'],
        'args': <String, Object?>{
          if (rawArgs is Map)
            for (final MapEntry<Object?, Object?> entry in rawArgs.entries)
              entry.key.toString(): adaptExpressionPart(entry.value),
        },
        'returnType': part['returnType'] ?? 'any',
      };
    }
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in part.entries)
        entry.key.toString(): adaptExpressionPart(entry.value),
    };
  }

  static const Set<String> _reservedDirectives = {'@path', '@call'};

  static bool _isSingleAtKey(String key) =>
      key.startsWith('@') && !key.startsWith('@@');

  static Map<String, dynamic> _asStringKeyedMap(Map<Object?, Object?> map) {
    if (map is Map<String, dynamic>) {
      return map;
    }
    final result = <String, dynamic>{};
    for (final MapEntry<Object?, Object?> entry in map.entries) {
      final Object? key = entry.key;
      if (key is! String) {
        throw A2uiValidationError(
          'Dynamic map keys must be Strings, got ${key.runtimeType}.',
        );
      }
      result[key] = entry.value;
    }
    return result;
  }

  void _validateReservedDirectives(Iterable<Object?> keys) {
    for (final key in keys) {
      if (key is String &&
          _isSingleAtKey(key) &&
          !_reservedDirectives.contains(key)) {
        throw A2uiValidationError(
          "Unrecognized reserved protocol directive '$key' in v1.0 dynamic "
          'object. Reserved keys must be in '
          '${_reservedDirectives.join(", ")}, '
          "or escaped with prefix doubling (e.g. '@$key').",
        );
      }
    }
  }

  String resolvePath(String relativePath) {
    if (relativePath.startsWith('/')) return relativePath;
    final String trimmedBase = path.length > 1 && path.endsWith('/')
        ? path.substring(0, path.length - 1)
        : (path.isEmpty ? '/' : path);
    if (relativePath.isEmpty || relativePath == '.') return trimmedBase;

    final base = trimmedBase == '/' ? '' : trimmedBase;
    return '$base/$relativePath';
  }

  /// Returns the evaluated result of a dynamic value (literal, data binding,
  /// or function call) at the current moment. Does not create subscriptions.
  ///
  /// An array or map payload resolves per element, since a dynamic value may
  /// be nested at any depth inside literal structure. A payload holding no
  /// bindings or calls is returned as-is rather than copied.
  Object? resolveSync(Object? value) {
    if (isV10) {
      if (value is Map && value.containsKey('@path')) {
        final binding = DataBinding.fromJson(_asStringKeyedMap(value));
        return dataModel.get(resolvePath(binding.path));
      }
      if (value is Map && value.containsKey('@call')) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value));
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = resolveSync(entry.value);
        }
        final Object? result = _evaluateFunction(call.call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        _validateReservedDirectives(stringMap.keys);
        if (!_containsDynamicValue(value)) return value;
        final result = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in stringMap.entries) {
          final String keyStr = entry.key;
          final String unescapedKey =
              keyStr.startsWith('@@') ? keyStr.substring(1) : keyStr;
          result[unescapedKey] = resolveSync(entry.value);
        }
        return result;
      }
    } else {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['path'] as String;
        return dataModel.get(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value as Map));
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = resolveSync(entry.value);
        }
        final Object? result = _evaluateFunction(call.call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        if (!_containsDynamicValue(value)) return value;
        final result = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in stringMap.entries) {
          result[entry.key] = resolveSync(entry.value);
        }
        return result;
      }
    }
    if (value is List) {
      if (!_containsDynamicValue(value)) {
        return value;
      }
      return value.map(resolveSync).toList();
    }
    return value;
  }

  /// Whether a value (typically an array element or map) contains any dynamic
  /// parts (path bindings, function calls, or v1.0 `@` directives/escapes)
  /// that require resolution or unescaping in the current protocol mode.
  bool _containsDynamicValue(Object? value) {
    if (value is List) {
      return value.any(_containsDynamicValue);
    }
    if (value is Map) {
      if (isDataBinding(value) || isFunctionCall(value)) {
        return true;
      }
      if (isV10 && value.keys.any((k) => k is String && k.startsWith('@'))) {
        return true;
      }
      return value.values.any(_containsDynamicValue);
    }
    return false;
  }

  /// Returns a reactive signal that re-evaluates a dynamic value
  /// whenever its underlying data dependencies change. Array and map
  /// payloads resolve per entry, mirroring [resolveSync].
  ReadonlySignal<Object?> resolveListenable(Object? value) {
    if (isV10) {
      if (value is Map && value.containsKey('@path')) {
        final binding = DataBinding.fromJson(_asStringKeyedMap(value));
        return dataModel.watch(resolvePath(binding.path));
      }
      if (value is Map && value.containsKey('@call')) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value));
        final Map<String, ReadonlySignal<Object?>> argSignals = {
          for (final MapEntry<String, dynamic> entry in call.args.entries)
            entry.key: resolveListenable(entry.value),
        };
        return computed(() {
          final args = <String, dynamic>{
            for (final MapEntry<String, ReadonlySignal<Object?>> entry
                in argSignals.entries)
              entry.key: entry.value.value,
          };
          final Object? result = _evaluateFunction(call.call, args);
          if (result is ReadonlySignal) {
            return result.value;
          }
          return result;
        });
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        _validateReservedDirectives(stringMap.keys);
        if (!_containsDynamicValue(value)) {
          return signal(value);
        }
        final entries = <String, ReadonlySignal<Object?>>{
          for (final MapEntry<String, dynamic> e in stringMap.entries)
            (e.key.startsWith('@@') ? e.key.substring(1) : e.key):
                resolveListenable(e.value),
        };
        return computed(() => {
              for (final e in entries.entries) e.key: e.value.value,
            });
      }
    } else {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['path'] as String;
        return dataModel.watch(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value as Map));
        final Map<String, ReadonlySignal<Object?>> argSignals = {
          for (final MapEntry<String, dynamic> entry in call.args.entries)
            entry.key: resolveListenable(entry.value),
        };
        return computed(() {
          final args = <String, dynamic>{
            for (final MapEntry<String, ReadonlySignal<Object?>> entry
                in argSignals.entries)
              entry.key: entry.value.value,
          };
          final Object? result = _evaluateFunction(call.call, args);
          if (result is ReadonlySignal) {
            return result.value;
          }
          return result;
        });
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        if (!_containsDynamicValue(value)) {
          return signal(value);
        }
        final Map<String, ReadonlySignal<Object?>> entries = {
          for (final MapEntry<String, dynamic> entry in stringMap.entries)
            entry.key: resolveListenable(entry.value),
        };
        return computed(
          () => {
            for (final MapEntry<String, ReadonlySignal<Object?>> entry
                in entries.entries)
              entry.key: entry.value.value,
          },
        );
      }
    }
    if (value is List) {
      if (!_containsDynamicValue(value)) {
        return signal(value);
      }
      final List<ReadonlySignal<Object?>> items =
          value.map(resolveListenable).toList();
      return computed(() => [for (final item in items) item.value]);
    }
    return signal(value);
  }

  /// Invokes a function, reporting a failure only when a reporter was supplied.
  Object? _evaluateFunction(String name, Map<String, dynamic> args) {
    try {
      if (args.length > maxFunctionCallArgs) {
        throw A2uiExpressionError(
          "Function call '$name' exceeds maximum allowed arguments count "
          '($maxFunctionCallArgs)',
          expression: name,
        );
      }
      return _invoke(name, args, this);
    } catch (error) {
      final ExpressionErrorReporter? onError = _onError;
      if (onError == null) rethrow;
      onError(
        error is A2uiExpressionError
            ? error
            : A2uiExpressionError(
                error is A2uiError ? error.message : error.toString(),
                expression: name,
              ),
      );
      return null;
    }
  }

  DataContext nested(String relativePath) {
    return DataContext(
      dataModel,
      _invoke,
      resolvePath(relativePath),
      onError: _onError,
      protocolVersion: protocolVersion,
    );
  }

  void set(String relativePath, Object? value) {
    dataModel.set(resolvePath(relativePath), value);
  }

  /// Resolves an action payload by evaluating dynamic values in its context and
  /// userMessage.
  Map<String, dynamic>? resolveAction(Object? action) {
    if (action == null) return null;
    if (action is String) {
      if (action.isEmpty) return null;
      return {
        'event': {'name': action, 'context': <String, Object?>{}}
      };
    }
    if (action is! Map) return null;
    final map = Map<String, dynamic>.from(action);
    final Object? eventObj = map['event'];
    if (eventObj is Map) {
      final Object? name = eventObj['name'];
      if (name is! String || name.isEmpty) return null;
      final Map<String, dynamic> ev = _resolveActionFields(
        Map<String, dynamic>.from(eventObj),
      );
      return {...map, 'event': ev};
    }
    if (map.containsKey('name')) {
      final Object? name = map['name'];
      if (name is! String || name.isEmpty) return null;
      return _resolveActionFields(map);
    }
    return null;
  }

  Map<String, dynamic> _resolveActionFields(Map<String, dynamic> map) {
    final result = Map<String, dynamic>.from(map);
    final Object? ctx = result['context'];
    if (ctx is Map) {
      result['context'] = <String, Object?>{
        for (final MapEntry<Object?, Object?> e in ctx.entries)
          e.key.toString(): resolveSync(e.value),
      };
    } else {
      result['context'] = <String, Object?>{};
    }
    if (result.containsKey('userMessage')) {
      result['userMessage'] = resolveSync(result['userMessage']);
    }
    return result;
  }
}

/// Context provided to components during rendering.
class ComponentContext {
  final SurfaceModel surface;
  final ComponentModel componentModel;
  final DataContext dataContext;

  /// By default, expression errors are dispatched immediately on the surface.
  /// Supply [onError] to control their reporting policy instead.
  ComponentContext(
    this.surface,
    this.componentModel, {
    String? basePath,
    ExpressionErrorReporter? onError,
  }) : dataContext = DataContext(
          surface.dataModel,
          surface.catalog.invoke,
          basePath ?? '/',
          onError: onError ??
              (error) {
                surface.dispatchError(
                  A2uiClientError(
                    code: 'EXPRESSION_ERROR',
                    surfaceId: surface.id,
                    message: error.message,
                    details: error.details,
                  ),
                );
              },
          protocolVersion: surface.protocolVersion,
        );

  /// Dispatches an action from the component.
  Future<void> dispatchAction(Map<String, dynamic> action) {
    return surface.dispatchAction(action, componentModel.id);
  }

  /// Returns a context for rendering a child component.
  ///
  /// Throws [A2uiStateError] if [childId] does not exist on the surface or if
  /// [basePath] is not an absolute JSON Pointer path starting with `/`.
  ComponentContext childContext(String childId, {String? basePath}) {
    if (basePath != null && !basePath.startsWith('/')) {
      throw A2uiStateError(
        "Base path for child context must be absolute (start with '/'), "
        "got '$basePath'.",
      );
    }
    final ComponentModel? childModel = surface.componentsModel.get(childId);
    if (childModel == null) {
      throw A2uiStateError('Child component not found: $childId');
    }
    return ComponentContext(
      surface,
      childModel,
      basePath: basePath ?? dataContext.path,
      onError: dataContext._onError,
    );
  }
}

extension CatalogInvokerExtension
    on Catalog<ComponentApi, FunctionImplementation> {
  /// Invokes a catalog function by name with the given arguments.
  ///
  /// Throws [A2uiCatalogError] if [name] is not registered in this catalog.
  Object? invoke(String name, Map<String, dynamic> args, DataContext context) {
    final FunctionImplementation? fn = functions[name];
    if (fn == null) {
      throw A2uiCatalogError('Function not found: $name', catalogId: id);
    }
    return fn.execute(args, context);
  }
}
