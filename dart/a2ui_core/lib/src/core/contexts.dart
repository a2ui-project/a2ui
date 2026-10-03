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

import 'package:json_schema_builder/json_schema_builder.dart';

import '../primitives/errors.dart';
import '../primitives/reactivity.dart';
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

/// Returns the invoker for the catalog with [catalogId].
///
/// Throws [A2uiCatalogError] when no such catalog is available.
typedef CatalogInvokerResolver = FunctionInvoker Function(String catalogId);

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
  final CatalogInvokerResolver? _invokerForCatalog;
  final ExpressionErrorReporter? _onError;
  final String path;
  final String? protocolVersion;

  /// With [onError], failed invocations are reported and resolve to null.
  /// Without it, the original exception is rethrown.
  ///
  /// A function call naming no `catalogId` runs through [invoke]. One that
  /// names a catalog runs through the invoker [invokerForCatalog] returns for
  /// it; without [invokerForCatalog], such a call fails with
  /// [A2uiCatalogError].
  DataContext(
    this.dataModel,
    FunctionInvoker invoke,
    this.path, {
    ExpressionErrorReporter? onError,
    this.protocolVersion,
    CatalogInvokerResolver? invokerForCatalog,
  })  : _invoke = invoke,
        _onError = onError,
        _invokerForCatalog = invokerForCatalog;

  bool get isV10 {
    final String? v = protocolVersion;
    if (v == null) return false;
    final String core = v.startsWith('v') ? v.substring(1) : v;
    return (int.tryParse(core.split('.').first) ?? 0) >= 1;
  }

  static const Set<String> _reservedDirectives = {'@path', '@call'};

  static bool _isSingleAtKey(String key) =>
      key.startsWith('@') && !key.startsWith('@@');

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
      if (value is Map &&
          value.containsKey('@path') &&
          value['@path'] is String) {
        final pathVal = value['@path'] as String;
        return dataModel.get(resolvePath(pathVal));
      }
      if (value is Map &&
          value.containsKey('@call') &&
          value['@call'] is String) {
        final call = FunctionCall.fromJson(Map<String, dynamic>.from(value));
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = resolveSync(entry.value);
        }
        final Object? result = _evaluateFunction(call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        _validateReservedDirectives(value.keys);
        final result = <String, dynamic>{};
        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final keyStr = entry.key as String;
          final String unescapedKey =
              keyStr.startsWith('@@') ? keyStr.substring(1) : keyStr;
          result[unescapedKey] = resolveSync(entry.value);
        }
        return result;
      }
    } else {
      if (value is Map &&
          value.containsKey('path') &&
          value['path'] is String &&
          !value.containsKey('componentId')) {
        final pathVal = value['path'] as String;
        return dataModel.get(resolvePath(pathVal));
      }
      if (value is Map &&
          value.containsKey('call') &&
          value['call'] is String) {
        final call = FunctionCall.fromJson(Map<String, dynamic>.from(value));
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = resolveSync(entry.value);
        }
        final Object? result = _evaluateFunction(call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        if (!_containsDynamicValue(value)) return value;
        final result = <String, dynamic>{};
        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final keyStr = entry.key as String;
          result[keyStr] = resolveSync(entry.value);
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

  /// Whether a value (typically an array element) contains any dynamic
  /// parts (path bindings or function calls) that require resolution.
  static bool _containsDynamicValue(Object? value) {
    if (value is List) {
      return value.any(_containsDynamicValue);
    }
    if (value is Map) {
      if (value.containsKey('path') ||
          value.containsKey('call') ||
          value.containsKey('@path') ||
          value.containsKey('@call') ||
          value.keys.any((k) => k is String && k.startsWith('@@'))) {
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
      if (value is Map &&
          value.containsKey('@path') &&
          value['@path'] is String) {
        final pathVal = value['@path'] as String;
        return dataModel.watch(resolvePath(pathVal));
      }
      if (value is Map &&
          value.containsKey('@call') &&
          value['@call'] is String) {
        final call = FunctionCall.fromJson(Map<String, dynamic>.from(value));
        return computed(() {
          final args = <String, dynamic>{};
          for (final MapEntry<String, dynamic> entry in call.args.entries) {
            final ReadonlySignal<Object?> resolved = resolveListenable(
              entry.value,
            );
            args[entry.key] = resolved.value;
          }
          final Object? result = _evaluateFunction(call, args);
          if (result is ReadonlySignal) {
            return result.value;
          }
          return result;
        });
      }
      if (value is Map) {
        _validateReservedDirectives(value.keys);
        final entries = <String, ReadonlySignal<Object?>>{
          for (final MapEntry<Object?, Object?> e in value.entries)
            (e.key.toString().startsWith('@@')
                ? e.key.toString().substring(1)
                : e.key.toString()): resolveListenable(e.value),
        };
        return computed(() => {
              for (final e in entries.entries) e.key: e.value.value,
            });
      }
    } else {
      if (value is Map &&
          value.containsKey('path') &&
          value['path'] is String &&
          !value.containsKey('componentId')) {
        final pathVal = value['path'] as String;
        return dataModel.watch(resolvePath(pathVal));
      }
      if (value is Map &&
          value.containsKey('call') &&
          value['call'] is String) {
        final call = FunctionCall.fromJson(Map<String, dynamic>.from(value));
        return computed(() {
          final args = <String, dynamic>{};
          for (final MapEntry<String, dynamic> entry in call.args.entries) {
            final ReadonlySignal<Object?> resolved = resolveListenable(
              entry.value,
            );
            args[entry.key] = resolved.value;
          }
          final Object? result = _evaluateFunction(call, args);
          if (result is ReadonlySignal) {
            return result.value;
          }
          return result;
        });
      }
      if (value is Map) {
        if (!_containsDynamicValue(value)) {
          return signal(value);
        }
        final Map<String, ReadonlySignal<Object?>> entries = {
          for (final MapEntry<Object?, Object?> entry in value.entries)
            entry.key as String: resolveListenable(entry.value),
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
  Object? _evaluateFunction(FunctionCall call, Map<String, dynamic> args) {
    final String name = call.call;
    try {
      final String? catalogId = call.catalogId;
      if (catalogId == null) return _invoke(name, args, this);
      final CatalogInvokerResolver? invokerForCatalog = _invokerForCatalog;
      if (invokerForCatalog == null) {
        throw A2uiCatalogError(
          "Function '$name' names catalog '$catalogId', but this context "
          'has no catalogs to resolve it against.',
          catalogId: catalogId,
        );
      }
      return invokerForCatalog(catalogId)(name, args, this);
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
      invokerForCatalog: _invokerForCatalog,
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
      return {
        'event': {'name': action, 'context': <String, Object?>{}}
      };
    }
    if (action is! Map) return null;
    final map = Map<String, dynamic>.from(action);
    final Object? eventObj = map['event'];
    if (eventObj is Map) {
      final Map<String, dynamic> ev = _resolveActionFields(
        Map<String, dynamic>.from(eventObj),
      );
      return {...map, 'event': ev};
    }
    if (map.containsKey('name')) {
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
          (name, args, context) =>
              surface.resolveCatalog(null).invoke(name, args, context),
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
          invokerForCatalog: (catalogId) =>
              surface.resolveCatalog(catalogId).invoke,
        );

  /// Dispatches an action from the component.
  Future<void> dispatchAction(Map<String, dynamic> action) {
    return surface.dispatchAction(action, componentModel.id);
  }

  /// Returns a context for rendering a child component.
  ComponentContext childContext(String childId, {String? basePath}) {
    final ComponentModel? childModel = surface.componentsModel.get(childId);
    if (childModel == null) {
      throw ArgumentError('Child component not found: $childId');
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
  /// Throws [ArgumentError] when the catalog has no function named [name],
  /// and [A2uiExpressionError] when [args] do not match the function's
  /// argument schema; the function does not run in either case.
  ///
  /// A null argument is an unresolved value, such as a binding to data that
  /// is not there yet, so it is left for the function to handle rather than
  /// checked against the schema.
  Object? invoke(String name, Map<String, dynamic> args, DataContext context) {
    final FunctionImplementation? fn = functions[name];
    if (fn == null) {
      throw ArgumentError('Function not found: $name');
    }
    final List<ValidationError> errors = _argumentErrors(fn, args);
    if (errors.isNotEmpty) {
      throw A2uiExpressionError(
        "Arguments to '$name' do not match its schema in catalog '$id': "
        '${errors.map((e) => e.toErrorString()).join('; ')}',
        expression: name,
        details: args,
      );
    }
    return fn.execute(args, context);
  }

  static List<ValidationError> _argumentErrors(
    FunctionImplementation fn,
    Map<String, dynamic> args,
  ) {
    final Set<String> unresolved = {
      for (final MapEntry<String, dynamic> entry in args.entries)
        if (entry.value == null) entry.key,
    };
    if (unresolved.isEmpty) return fn.argumentSchema.validateSync(args);
    final Map<String, Object?> schema = fn.argumentSchema.value;
    final Object? required = schema['required'];
    return Schema.fromMap({
      ...schema,
      if (required is List)
        'required': [
          for (final Object? key in required)
            if (!unresolved.contains(key)) key,
        ],
    }).validateSync({
      for (final MapEntry<String, dynamic> entry in args.entries)
        if (entry.value != null) entry.key: entry.value,
    });
  }
}
