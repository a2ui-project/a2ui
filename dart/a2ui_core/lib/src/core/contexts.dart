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
import 'catalog.dart';
import 'common.dart';
import 'component_model.dart';
import 'data_model.dart';
import 'messages.dart';
import 'surface_model.dart';

/// A function that invokes a catalog function by name.
typedef FunctionInvoker =
    Object? Function(
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

  /// With [onError], failed invocations are reported and resolve to null.
  /// Without it, the original exception is rethrown; reactive reads follow
  /// the signal library's exception handling.
  DataContext(
    this.dataModel,
    this._invoke,
    this.path, {
    ExpressionErrorReporter? onError,
  }) : _onError = onError;

  String resolvePath(String relativePath) {
    if (relativePath.startsWith('/')) return relativePath;
    if (relativePath == '' || relativePath == '.') return path;

    final String base = path == '/'
        ? ''
        : (path.endsWith('/') ? path.substring(0, path.length - 1) : path);
    return '$base/$relativePath';
  }

  /// Returns the evaluated result of a dynamic value (literal, data binding,
  /// or function call) at the current moment. Does not create subscriptions.
  ///
  /// An array payload resolves per element, since a function argument may be
  /// a list of dynamic values. Any other literal, including a map without a
  /// top-level `path` or `call`, passes through untouched.
  Object? resolveSync(Object? value) {
    if (value is Map && value.containsKey('path')) {
      return dataModel.get(resolvePath(value['path'] as String));
    }
    if (value is Map && value.containsKey('call')) {
      final call = FunctionCall.fromJson(Map<String, dynamic>.from(value));
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
    return value is Map &&
        (value.containsKey('path') || value.containsKey('call'));
  }

  /// Returns a reactive signal that re-evaluates a dynamic value
  /// whenever its underlying data dependencies change. Array payloads
  /// resolve per element, mirroring [resolveSync].
  ReadonlySignal<Object?> resolveListenable(Object? value) {
    if (value is Map && value.containsKey('path')) {
      return dataModel.watch(resolvePath(value['path'] as String));
    }
    if (value is Map && value.containsKey('call')) {
      final call = FunctionCall.fromJson(Map<String, dynamic>.from(value));
      return computed(() {
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          final ReadonlySignal<Object?> resolved = resolveListenable(
            entry.value,
          );
          args[entry.key] = resolved.value;
        }
        final Object? result = _evaluateFunction(call.call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      });
    }
    if (value is List) {
      if (!_containsDynamicValue(value)) {
        return signal(value);
      }
      final List<ReadonlySignal<Object?>> elements = value
          .map(resolveListenable)
          .toList();
      return computed(() => elements.map((element) => element.value).toList());
    }
    return signal(value);
  }

  /// Invokes a function, reporting a failure only when a reporter was supplied.
  Object? _evaluateFunction(String name, Map<String, dynamic> args) {
    try {
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
    );
  }

  void set(String relativePath, Object? value) {
    dataModel.set(resolvePath(relativePath), value);
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
         onError:
             onError ??
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
  Object? invoke(String name, Map<String, dynamic> args, DataContext context) {
    final FunctionImplementation? fn = functions[name];
    if (fn == null) {
      throw A2uiExpressionError(
        "Function not found in catalog '$id': $name",
        expression: name,
      );
    }
    return fn.execute(args, context);
  }
}
