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

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:flutter/foundation.dart';

import '../primitives/logging.dart';
import '../primitives/simple_items.dart';
import '../utils/stream_extensions.dart';
import 'client_function.dart' as cf;
import 'data_path.dart';

export 'data_path.dart';

/// A contextual view of the main DataModel, used by widgets to resolve
/// relative and absolute paths.
class DataContext implements cf.ExecutionContext {
  /// Creates a [DataContext] for the given [path].
  DataContext(
    this._dataModel,
    this.path, {
    Iterable<cf.ClientFunction>? functions,
  }) : _functions = {
         if (functions != null)
           for (final f in functions) f.name: f,
       };

  DataContext._(this._dataModel, this.path, this._functions);

  final DataModel _dataModel;

  /// The path associated with this context.
  @override
  final DataPath path;

  final Map<String, cf.ClientFunction> _functions;

  /// The underlying data model for this context.
  DataModel get dataModel => _dataModel;

  /// Retrieves a function by name from this context.
  @override
  cf.ClientFunction? getFunction(String name) => _functions[name];

  /// Subscribes to a path, resolving it against the current context.
  @override
  ValueListenable<T?> subscribe<T>(DataPath path) {
    final DataPath absolutePath = resolvePath(path);
    return _dataModel.subscribe<T>(absolutePath);
  }

  /// Subscribes to a path and returns a [Stream].
  @override
  Stream<T?> subscribeStream<T>(DataPath path) {
    late StreamController<T?> controller;
    ValueListenable<T?>? notifier;

    void listener() {
      if (!controller.isClosed) {
        controller.add(notifier!.value);
      }
    }

    controller = StreamController<T?>(
      onListen: () {
        notifier = subscribe<T>(path);
        controller.add(notifier!.value);
        notifier!.addListener(listener);
      },
      onCancel: () {
        final currentNotifier = notifier;
        currentNotifier?.removeListener(listener);
        if (currentNotifier is ChangeNotifier) {
          (currentNotifier as ChangeNotifier).dispose();
        }
        notifier = null;
        controller.close();
      },
    );
    return controller.stream;
  }

  /// Gets a value, resolving the path against the current context.
  @override
  T? getValue<T>(DataPath path) => _dataModel.getValue<T>(resolvePath(path));

  /// Updates the data model, resolving the path against the current context.
  @override
  void update(DataPath path, Object? contents) =>
      _dataModel.update(resolvePath(path), contents);

  /// Creates a new, nested DataContext for a child widget.
  @override
  DataContext nested(DataPath relativePath) =>
      DataContext._(_dataModel, resolvePath(relativePath), _functions);

  /// Resolves a path against the current context's path.
  @override
  DataPath resolvePath(DataPath pathToResolve) =>
      pathToResolve.isAbsolute ? pathToResolve : path.join(pathToResolve);

  /// Resolves any dynamic values (bindings or function calls) in the given
  /// value.
  @override
  Stream<Object?> resolve(Object? value) => _evaluateStream(value);

  Stream<Object?> _evaluateStream(Object? value) {
    if (value is Map) {
      if (value.containsKey('path')) {
        return subscribeStream(DataPath(value['path'] as String));
      }
      if (value.containsKey('call')) {
        return _evaluateFunctionCall(value as JsonMap);
      }
    }
    if (value is Stream) return value.cast<Object?>();
    return Stream.value(value);
  }

  Stream<Object?> _evaluateFunctionCall(JsonMap callDefinition) {
    final name = callDefinition['call'] as String?;
    if (name == null) {
      return Stream.value(null);
    }

    final cf.ClientFunction? func = getFunction(name);
    if (func == null) {
      genUiLogger.warning('Function not found: $name');
      return Stream.value(null);
    }

    final Map<String, Object?> args = {};
    final Object? argsJson = callDefinition['args'];

    if (argsJson is Map) {
      for (final Object? key in argsJson.keys) {
        final argName = key.toString();
        final Object? val = argsJson[key];
        args[argName] = _evaluateStream(val);
      }
    }

    final List<String> keys = args.keys.toList();
    final List<Stream<Object?>> streams = keys.map((key) {
      return args[key]! as Stream<Object?>;
    }).toList();

    final Stream<List<Object?>> combinedStream = streams.isEmpty
        ? Stream.value([])
        : streams.combineLatestAll();

    return combinedStream.switchMap((List<Object?> values) {
      final Map<String, Object?> combinedArgs = {};
      for (var i = 0; i < keys.length; i++) {
        combinedArgs[keys[i]] = values[i];
      }
      return func.execute(combinedArgs, this);
    });
  }

  /// Evaluates a dynamic boolean condition and returns a [Stream<bool>].
  @override
  Stream<bool> evaluateConditionStream(Object? condition) {
    if (condition == null) return Stream.value(false);
    if (condition is bool) return Stream.value(condition);

    final Stream<Object?> resultStream = _evaluateStream(condition);
    return resultStream.map((v) {
      if (v is bool) return v;
      return v != null;
    });
  }
}

/// Resolves a context map definition against a [DataContext].
Future<JsonMap> resolveContext(
  DataContext dataContext,
  JsonMap? contextDefinition,
) async {
  final resolved = <String, Object?>{};
  if (contextDefinition == null) return resolved;

  for (final MapEntry<String, Object?> entry in contextDefinition.entries) {
    final String key = entry.key;
    final Object? value = entry.value;
    resolved[key] = await dataContext.resolve(value).first;
  }
  return resolved;
}

/// Exception thrown when a value in the [DataModel] is not of the expected
/// type.
class DataModelTypeException implements Exception {
  /// Creates a [DataModelTypeException].
  DataModelTypeException({
    required this.path,
    required this.expectedType,
    required this.actualType,
  });

  /// The path where the type mismatch occurred.
  final DataPath path;

  /// The expected type.
  final Type expectedType;

  /// The actual type found.
  final Type actualType;

  @override
  String toString() {
    return 'DataModelTypeException: Expected $expectedType at $path, '
        'but found $actualType';
  }
}

/// Manages the application's data model and provides a subscription-based
/// mechanism for reactive UI updates.
abstract interface class DataModel {
  /// Updates the data model at a specific absolute path and notifies all
  /// relevant subscribers.
  void update(DataPath absolutePath, Object? contents);

  /// Subscribes to a specific absolute path in the data model.
  ValueNotifier<T?> subscribe<T>(DataPath absolutePath);

  /// Binds an external state [source] to a [path] in the DataModel.
  void Function() bindExternalState<T>({
    required DataPath path,
    required ValueListenable<T> source,
    bool twoWay = false,
  });

  /// Disposes resources and bindings.
  void dispose();

  /// Retrieves a static, one-time value from the data model at the
  /// specified absolute path without creating a subscription.
  T? getValue<T>(DataPath absolutePath);
}

/// Standard in-memory implementation of [DataModel]. Facade over
/// `a2ui_core.DataModel`.
class InMemoryDataModel implements DataModel {
  /// Creates an empty in-memory data model.
  InMemoryDataModel() : _core = core.DataModel(), _ownsCore = true;

  /// Wraps an existing core data model.
  @internal
  InMemoryDataModel.wrap(core.DataModel coreDataModel)
    : _core = coreDataModel,
      _ownsCore = false;

  final core.DataModel _core;
  // True when this owns `_core` (created by the default constructor) and must
  // dispose it; false when wrapping a borrowed `core.DataModel` owned by
  // a2ui_core's `SurfaceModel`.
  final bool _ownsCore;
  final List<VoidCallback> _externalSubscriptions = [];

  /// The wrapped core data model. Intended for GenUI internals only.
  @internal
  core.DataModel get coreDataModel => _core;

  @override
  void update(DataPath absolutePath, Object? contents) {
    _core.set(absolutePath.toString(), contents);
  }

  @override
  ValueNotifier<T?> subscribe<T>(DataPath absolutePath) {
    return _SignalNotifier<T>(
      _core.watch<Object?>(absolutePath.toString()),
      absolutePath,
    );
  }

  @override
  void Function() bindExternalState<T>({
    required DataPath path,
    required ValueListenable<T> source,
    bool twoWay = false,
  }) {
    update(path, source.value);

    void onSourceChanged() {
      final T newValue = source.value;
      final T? currentValue = getValue<T>(path);
      if (currentValue != newValue) {
        update(path, newValue);
      }
    }

    source.addListener(onSourceChanged);
    void removeSourceListener() => source.removeListener(onSourceChanged);
    _externalSubscriptions.add(removeSourceListener);

    VoidCallback? removeModelListener;
    if (twoWay) {
      if (source is! ValueNotifier<T>) {
        genUiLogger.warning(
          'bindExternalState: twoWay is true but source is not a '
          'ValueNotifier.',
        );
      } else {
        final ValueNotifier<T> notifier = source;
        final ValueNotifier<T?> subscription = subscribe<T>(path);

        void onModelChanged() {
          final T? modelValue = subscription.value;
          if (modelValue != null && modelValue != notifier.value) {
            notifier.value = modelValue;
          }
        }

        subscription.addListener(onModelChanged);
        removeModelListener = () {
          subscription.removeListener(onModelChanged);
          subscription.dispose();
        };
        _externalSubscriptions.add(removeModelListener);
      }
    }

    return () {
      removeSourceListener();
      _externalSubscriptions.remove(removeSourceListener);

      if (removeModelListener != null) {
        removeModelListener();
        _externalSubscriptions.remove(removeModelListener);
      }
    };
  }

  @override
  void dispose() {
    for (final callback in List<VoidCallback>.of(_externalSubscriptions)) {
      callback();
    }
    _externalSubscriptions.clear();
    if (_ownsCore) {
      _core.dispose();
    }
  }

  @override
  T? getValue<T>(DataPath absolutePath) {
    final Object? value = _core.get(absolutePath.toString());
    if (value != null && value is! T) {
      throw DataModelTypeException(
        path: absolutePath,
        expectedType: T,
        actualType: value.runtimeType,
      );
    }
    return value as T?;
  }
}

/// Bridges a preact_signals [core.ReadonlySignal] to a Flutter
/// [ValueNotifier].
class _SignalNotifier<T> extends ValueNotifier<T?> {
  _SignalNotifier(this._signal, this._path)
    : super(_cast<T>(_signal.peek(), _path)) {
    _disposeEffect = core.effect(() {
      final T? newValue = _cast<T>(_signal.value, _path);
      if (newValue == value) {
        notifyListeners();
      } else {
        value = newValue;
      }
    });
  }

  final core.ReadonlySignal<Object?> _signal;
  final DataPath _path;
  late final void Function() _disposeEffect;
  bool _isDisposed = false;

  static T? _cast<T>(Object? v, DataPath path) {
    if (v != null && v is! T) {
      throw DataModelTypeException(
        path: path,
        expectedType: T,
        actualType: v.runtimeType,
      );
    }
    return v as T?;
  }

  @override
  void dispose() {
    if (_isDisposed) {
      genUiLogger.warning(
        'Attempt to dispose of already disposed notifier',
        '_SignalNotifier.dispose Error',
        StackTrace.current,
      );
      return;
    }
    _isDisposed = true;
    _disposeEffect();
    super.dispose();
  }
}
