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

import '../primitives/cancellation.dart';
import '../primitives/reactivity.dart';
import 'catalog.dart';
import 'common.dart';
import 'data_model.dart';

/// A function implementation that can be registered with a catalog.
abstract class FunctionImplementation extends FunctionApi {
  const FunctionImplementation({
    required super.name,
    required super.argumentSchema,
    super.returnType,
  });

  /// Executes the function. Can return a static value or a [ReadonlySignal].
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]);
}

/// A function that invokes a catalog function by name.
typedef FunctionInvoker =
    Object? Function(
      String name,
      Map<String, dynamic> args,
      DataContext context,
    );

/// Provides data access relative to a specific path in the DataModel.
///
/// Similar to a working directory: a DataContext scoped to `/users/0`
/// lets components use relative paths like `name` instead of absolute
/// paths like `/users/0/name`. Also evaluates data bindings and
/// function calls.
class DataContext {
  final DataModel dataModel;
  final FunctionInvoker _invoke;
  final String path;

  DataContext(this.dataModel, this._invoke, this.path);

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
      final Object? result = _invoke(call.call, args, this);
      if (result is ReadonlySignal) {
        return result.value;
      }
      return result;
    }
    if (value is Map) {
      final result = <String, dynamic>{};
      for (final MapEntry<Object?, Object?> entry in value.entries) {
        result[entry.key as String] = resolveSync(entry.value);
      }
      return result;
    }
    if (value is List) {
      return value.map(resolveSync).toList();
    }
    return value;
  }

  /// Returns a reactive signal that re-evaluates a dynamic value
  /// whenever its underlying data dependencies change.
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
        final Object? result = _invoke(call.call, args, this);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      });
    }
    return signal(value);
  }

  DataContext nested(String relativePath) {
    return DataContext(dataModel, _invoke, resolvePath(relativePath));
  }

  void set(String relativePath, Object? value) {
    dataModel.set(resolvePath(relativePath), value);
  }
}

extension CatalogInvokerExtension
    on Catalog<ComponentApi, FunctionImplementation> {
  /// Invokes a catalog function by name with the given arguments.
  Object? invoke(String name, Map<String, dynamic> args, DataContext context) {
    final FunctionImplementation? fn = functions[name];
    if (fn == null) {
      throw ArgumentError('Function not found: $name');
    }
    return fn.execute(args, context);
  }
}
