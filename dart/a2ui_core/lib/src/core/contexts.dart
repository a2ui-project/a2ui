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

/// Reports a data binding whose absolute [path] does not exist in the data
/// model when the binding is resolved.
typedef MissingDataReporter = void Function(String path);

/// The deepest nesting of lists, maps, and function arguments that
/// [DataContext] resolves inside one dynamic value. Deeper payloads fail with
/// an [A2uiExpressionError] instead of exhausting the call stack.
const int maxDynamicValueDepth = 1000;

/// A live subscription to a dynamic value, returned by
/// [DataContext.subscribeDynamicValue].
abstract interface class DataSubscription {
  /// The latest resolved value.
  Object? get value;

  /// Stops change notifications. Idempotent.
  void unsubscribe();
}

class _SignalDataSubscription implements DataSubscription {
  final ReadonlySignal<Object?> _signal;
  void Function()? _dispose;

  _SignalDataSubscription(this._signal);

  @override
  Object? get value => _signal.peek();

  @override
  void unsubscribe() {
    final void Function()? dispose = _dispose;
    _dispose = null;
    dispose?.call();
  }
}

/// Provides data access relative to a specific path in the DataModel.
///
/// Similar to a working directory: a DataContext scoped to `/users/0`
/// lets components use relative paths like `name` instead of absolute
/// paths like `/users/0/name`. Also evaluates data bindings and
/// function calls.
///
/// Contexts form a chain through [parent]: a component's context links to
/// the context of the component that references it, and a template child's
/// context records its iteration [index]. The v1.0 `@index` system function
/// reads that chain.
class DataContext {
  final DataModel dataModel;
  final FunctionInvoker _invoke;
  final CatalogInvokerResolver? _invokerForCatalog;
  final ExpressionErrorReporter? _onError;
  final MissingDataReporter? _onMissingData;
  final Set<String> _warnedPaths;
  final String path;
  final String? protocolVersion;

  /// The context this one was derived from, or null for a root context.
  final DataContext? parent;

  final int? _explicitIndex;

  /// With [onError], failed invocations are reported and resolve to null.
  /// Without it, the original exception is rethrown.
  ///
  /// A function call naming no `catalogId` runs through [invoke]. One that
  /// names a catalog runs through the invoker [invokerForCatalog] returns for
  /// it; without [invokerForCatalog], such a call fails with
  /// [A2uiCatalogError].
  ///
  /// [index] is the collection iteration index when this context scopes a
  /// template child. [onMissingData] is called once per absolute path, per
  /// chain of contexts sharing a root, when a data binding names a path that
  /// does not exist; it defaults to [parent]'s reporter.
  DataContext(
    this.dataModel,
    FunctionInvoker invoke,
    this.path, {
    ExpressionErrorReporter? onError,
    this.protocolVersion,
    CatalogInvokerResolver? invokerForCatalog,
    this.parent,
    int? index,
    MissingDataReporter? onMissingData,
  })  : _invoke = invoke,
        _onError = onError,
        _invokerForCatalog = invokerForCatalog,
        _explicitIndex = index,
        _onMissingData = onMissingData ?? parent?._onMissingData,
        _warnedPaths = parent?._warnedPaths ?? <String>{};

  /// The 0-based iteration index of the nearest enclosing collection
  /// template, or null outside any template.
  ///
  /// Walks this context and its ancestors, taking the first explicit index,
  /// or else the first path whose last segment is a non-negative integer.
  int? get index {
    for (DataContext? ctx = this; ctx != null; ctx = ctx.parent) {
      final int? explicit = ctx._explicitIndex;
      if (explicit != null) return explicit;
      final String last = ctx.path.split('/').lastWhere(
            (segment) => segment.isNotEmpty,
            orElse: () => '',
          );
      // tryParse: a digit run too long for an int is not an index.
      final int? parsed = _digits.hasMatch(last) ? int.tryParse(last) : null;
      if (parsed != null) return parsed;
    }
    return null;
  }

  static final RegExp _digits = RegExp(r'^\d+$');

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
  Object? resolveSync(Object? value) => _resolveSync(value, 0);

  Object? _resolveSync(Object? value, int depth) {
    if (depth > maxDynamicValueDepth) {
      _reportDepthExceeded();
      return null;
    }
    if (isV10) {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['@path'] as String;
        return _readBinding(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(
          Map<String, dynamic>.from(value as Map),
        );
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = _resolveSync(entry.value, depth + 1);
        }
        final Object? result = _evaluateFunction(call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        _validateReservedDirectives(value.keys);
        if (!_containsDynamicValue(value, depth)) return value;
        final result = <String, dynamic>{};
        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final keyStr = entry.key as String;
          final String unescapedKey =
              keyStr.startsWith('@@') ? keyStr.substring(1) : keyStr;
          result[unescapedKey] = _resolveSync(entry.value, depth + 1);
        }
        return result;
      }
    } else {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['path'] as String;
        return _readBinding(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(
          Map<String, dynamic>.from(value as Map),
        );
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = _resolveSync(entry.value, depth + 1);
        }
        final Object? result = _evaluateFunction(call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        if (!_containsDynamicValue(value, depth)) return value;
        final result = <String, dynamic>{};
        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final keyStr = entry.key as String;
          result[keyStr] = _resolveSync(entry.value, depth + 1);
        }
        return result;
      }
    }
    if (value is List) {
      if (!_containsDynamicValue(value, depth)) {
        return value;
      }
      return [for (final item in value) _resolveSync(item, depth + 1)];
    }
    return value;
  }

  /// Whether a value (typically an array element or map) contains any dynamic
  /// parts (path bindings, function calls, or v1.0 `@` directives/escapes)
  /// that require resolution or unescaping in the current protocol mode.
  ///
  /// Past [maxDynamicValueDepth] it reports true, so resolution reaches the
  /// depth guard instead of returning the payload unchecked.
  bool _containsDynamicValue(Object? value, int depth) {
    if (depth > maxDynamicValueDepth) return true;
    if (value is List) {
      return value.any((item) => _containsDynamicValue(item, depth + 1));
    }
    if (value is Map) {
      if (isDataBinding(value) || isFunctionCall(value)) {
        return true;
      }
      if (isV10 && value.keys.any((k) => k is String && k.startsWith('@'))) {
        return true;
      }
      return value.values.any((item) => _containsDynamicValue(item, depth + 1));
    }
    return false;
  }

  /// Returns a reactive signal that re-evaluates a dynamic value
  /// whenever its underlying data dependencies change. Array and map
  /// payloads resolve per entry, mirroring [resolveSync].
  ReadonlySignal<Object?> resolveListenable(Object? value) =>
      _resolveListenable(value, 0);

  ReadonlySignal<Object?> _resolveListenable(Object? value, int depth) {
    if (depth > maxDynamicValueDepth) {
      _reportDepthExceeded();
      return signal(null);
    }
    if (isV10) {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['@path'] as String;
        return _watchBinding(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(
          Map<String, dynamic>.from(value as Map),
        );
        final Map<String, ReadonlySignal<Object?>> argSignals = {
          for (final MapEntry<String, dynamic> entry in call.args.entries)
            entry.key: _resolveListenable(entry.value, depth + 1),
        };
        return computed(() {
          final args = <String, dynamic>{
            for (final MapEntry<String, ReadonlySignal<Object?>> entry
                in argSignals.entries)
              entry.key: entry.value.value,
          };
          final Object? result = _evaluateFunction(call, args);
          if (result is ReadonlySignal) {
            return result.value;
          }
          return result;
        });
      }
      if (value is Map) {
        _validateReservedDirectives(value.keys);
        if (!_containsDynamicValue(value, depth)) {
          return signal(value);
        }
        final entries = <String, ReadonlySignal<Object?>>{
          for (final MapEntry<Object?, Object?> e in value.entries)
            (e.key.toString().startsWith('@@')
                ? e.key.toString().substring(1)
                : e.key.toString()): _resolveListenable(e.value, depth + 1),
        };
        return computed(() => {
              for (final e in entries.entries) e.key: e.value.value,
            });
      }
    } else {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['path'] as String;
        return _watchBinding(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(
          Map<String, dynamic>.from(value as Map),
        );
        final Map<String, ReadonlySignal<Object?>> argSignals = {
          for (final MapEntry<String, dynamic> entry in call.args.entries)
            entry.key: _resolveListenable(entry.value, depth + 1),
        };
        return computed(() {
          final args = <String, dynamic>{
            for (final MapEntry<String, ReadonlySignal<Object?>> entry
                in argSignals.entries)
              entry.key: entry.value.value,
          };
          final Object? result = _evaluateFunction(call, args);
          if (result is ReadonlySignal) {
            return result.value;
          }
          return result;
        });
      }
      if (value is Map) {
        if (!_containsDynamicValue(value, depth)) {
          return signal(value);
        }
        final Map<String, ReadonlySignal<Object?>> entries = {
          for (final MapEntry<Object?, Object?> entry in value.entries)
            entry.key as String: _resolveListenable(entry.value, depth + 1),
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
      if (!_containsDynamicValue(value, depth)) {
        return signal(value);
      }
      final List<ReadonlySignal<Object?>> items = [
        for (final item in value) _resolveListenable(item, depth + 1),
      ];
      return computed(() => [for (final item in items) item.value]);
    }
    return signal(value);
  }

  /// Invokes a function, reporting a failure only when a reporter was supplied.
  Object? _evaluateFunction(FunctionCall call, Map<String, dynamic> args) {
    final String name = call.call;
    try {
      // A universal v1.0 system function: catalogs cannot define '@' names.
      if (isV10 && name == _indexFunctionName) return _evaluateIndex(args);
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

  static const String _indexFunctionName = '@index';

  /// Evaluates `@index`: the iteration [index] plus the optional `offset`.
  Object? _evaluateIndex(Map<String, dynamic> args) {
    final Object? offset = args['offset'];
    if (offset != null && (offset is! num || !offset.isFinite)) {
      throw A2uiExpressionError(
        "Argument 'offset' of '$_indexFunctionName' must be a finite number, "
        'got $offset.',
        expression: _indexFunctionName,
      );
    }
    final int? current = index;
    if (current == null) {
      throw A2uiValidationError(
        '$_indexFunctionName function can only be evaluated inside a '
        'collection template iteration scope.',
      );
    }
    return offset == null ? current : current + (offset as num);
  }

  void _reportDepthExceeded() {
    final error = A2uiExpressionError(
      'Maximum dynamic value nesting depth exceeded ($maxDynamicValueDepth).',
    );
    final ExpressionErrorReporter? onError = _onError;
    if (onError == null) throw error;
    onError(error);
  }

  Object? _readBinding(String absolutePath) {
    _checkMissing(absolutePath);
    return dataModel.get(absolutePath);
  }

  ReadonlySignal<Object?> _watchBinding(String absolutePath) {
    _checkMissing(absolutePath);
    return dataModel.watch(absolutePath);
  }

  void _checkMissing(String absolutePath) {
    final MissingDataReporter? report = _onMissingData;
    if (report == null ||
        dataModel.has(absolutePath) ||
        !_warnedPaths.add(absolutePath)) {
      return;
    }
    report(absolutePath);
  }

  /// Resolves [value] like [resolveListenable] and calls [onChange] with each
  /// later value until [DataSubscription.unsubscribe]. The current value is
  /// available from [DataSubscription.value]; [onChange] is not called for
  /// it.
  DataSubscription subscribeDynamicValue(
    Object? value,
    void Function(Object? value) onChange,
  ) {
    final ReadonlySignal<Object?> source = resolveListenable(value);
    final subscription = _SignalDataSubscription(source);
    var initial = true;
    subscription._dispose = source.subscribe((next) {
      if (!initial) onChange(next);
    });
    initial = false;
    return subscription;
  }

  /// Returns a context scoped to [relativePath] whose [parent] is this
  /// context. Pass [index] when the new context scopes a collection template
  /// item.
  DataContext childContext(String relativePath, {int? index}) {
    return DataContext(
      dataModel,
      _invoke,
      resolvePath(relativePath),
      onError: _onError,
      protocolVersion: protocolVersion,
      invokerForCatalog: _invokerForCatalog,
      parent: this,
      index: index,
    );
  }

  /// Returns a child context scoped to [relativePath], without an index.
  DataContext nested(String relativePath) => childContext(relativePath);

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
  ///
  /// [parentDataContext] links this component's data context to the context
  /// of the component that references it, and [index] records its position
  /// in a collection template. Without [parentDataContext], bindings to
  /// missing data are dispatched as `MISSING_DATA_BINDING` warnings on the
  /// surface unless [onMissingData] is supplied; with it, the parent's
  /// reporter applies by default.
  ComponentContext(
    this.surface,
    this.componentModel, {
    String? basePath,
    ExpressionErrorReporter? onError,
    DataContext? parentDataContext,
    int? index,
    MissingDataReporter? onMissingData,
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
          parent: parentDataContext,
          index: index,
          onMissingData: onMissingData ??
              (parentDataContext == null
                  ? (path) {
                      surface.dispatchWarning(missingDataBindingWarning(path));
                    }
                  : null),
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
      parentDataContext: dataContext,
    );
  }
}

/// The `MISSING_DATA_BINDING` warning for a binding to the absent [path].
A2uiWarning missingDataBindingWarning(String path) => A2uiWarning(
      code: 'MISSING_DATA_BINDING',
      path: path,
      message: "Data binding path '$path' does not exist in the data model; "
          'it resolves to null.',
    );

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
