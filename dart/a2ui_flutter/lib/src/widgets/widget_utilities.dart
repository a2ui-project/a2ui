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

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../model/data_model.dart';
import '../primitives/logging.dart';

export '../model/data_model.dart' show resolveContext;

/// A builder widget that simplifies handling of nullable `ValueListenable`s.
///
/// Listens to a `ValueListenable<T?>` and rebuilds its child whenever the
/// value changes. Returns `SizedBox.shrink()` for null; otherwise calls
/// [builder] with the non-null value.
class OptionalValueBuilder<T> extends StatelessWidget {
  /// The `ValueListenable` to listen to.
  final ValueListenable<T?> listenable;

  /// The builder function to call when the value is not `null`.
  final Widget Function(BuildContext context, T value) builder;

  /// Creates an `OptionalValueBuilder`.
  const OptionalValueBuilder({
    super.key,
    required this.listenable,
    required this.builder,
  });

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<T?>(
      valueListenable: listenable,
      builder: (context, value, _) {
        if (value == null) return const SizedBox.shrink();
        return builder(context, value);
      },
    );
  }
}

/// A widget that binds to a value in the [DataContext] and rebuilds when it
/// changes.
///
/// Subclasses provide type-specific conversion via [BoundValueState.convert].
abstract class BoundValue<T> extends StatefulWidget {
  /// Creates a [BoundValue].
  const BoundValue({
    super.key,
    required this.dataContext,
    required this.value,
    required this.builder,
  });

  /// The [DataContext] to resolve the value against.
  final DataContext dataContext;

  /// The value definition (literal, path, or function call).
  final Object? value;

  /// The builder function to call when the value changes.
  final Widget Function(BuildContext context, T? value) builder;

  @override
  State<BoundValue<T>> createState();
}

/// Backing state for [BoundValue].
///
/// Resolves the value to a [ValueListenable] and rebuilds with a
/// [ValueListenableBuilder]. A `{path: ...}` value reads from the data model, a
/// `{call: ...}` value adapts a stream, and anything else is a constant. Each
/// value is passed through [convert].
abstract class BoundValueState<T, W extends BoundValue<T>> extends State<W> {
  ValueListenable<Object?>? _listenable;
  StreamSubscription<Object?>? _streamSubscription;

  @override
  void initState() {
    super.initState();
    _setup();
  }

  @override
  void didUpdateWidget(W oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value != oldWidget.value ||
        widget.dataContext != oldWidget.dataContext) {
      _teardown();
      _setup();
    }
  }

  @override
  void dispose() {
    _teardown();
    super.dispose();
  }

  void _setup() {
    final Object? raw = widget.value;
    if (raw is Map && raw['path'] is String) {
      _listenable = widget.dataContext.subscribe<Object?>(
        DataPath(raw['path'] as String),
      );
    } else if (raw is Map && raw.containsKey('call')) {
      final notifier = ValueNotifier<Object?>(null);
      _streamSubscription = widget.dataContext
          .resolve(raw)
          .listen(
            (Object? value) => notifier.value = value,
            onError: (Object error) {
              genUiLogger.warning('Error in Bound stream', error);
            },
          );
      _listenable = notifier;
    } else {
      _listenable = ValueNotifier<Object?>(raw);
    }
  }

  void _teardown() {
    _streamSubscription?.cancel();
    _streamSubscription = null;
    final ValueListenable<Object?>? listenable = _listenable;
    if (listenable is ChangeNotifier) {
      (listenable as ChangeNotifier).dispose();
    }
    _listenable = null;
  }

  /// Converts a raw resolved value into the typed [T?].
  T? convert(Object? value);

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<Object?>(
      valueListenable: _listenable!,
      builder: (context, raw, _) => widget.builder(context, convert(raw)),
    );
  }
}

/// Binds to a [String] value.
class BoundString extends BoundValue<String> {
  /// Creates a [BoundString].
  const BoundString({
    super.key,
    required super.dataContext,
    required super.value,
    required super.builder,
  });

  @override
  State<BoundString> createState() => _BoundStringState();
}

class _BoundStringState extends BoundValueState<String, BoundString> {
  @override
  String? convert(Object? value) => value?.toString();
}

/// Binds to a [bool] value.
class BoundBool extends BoundValue<bool> {
  /// Creates a [BoundBool].
  const BoundBool({
    super.key,
    required super.dataContext,
    required super.value,
    required super.builder,
  });

  @override
  State<BoundBool> createState() => _BoundBoolState();
}

class _BoundBoolState extends BoundValueState<bool, BoundBool> {
  @override
  bool? convert(Object? value) {
    if (value is bool) return value;
    if (value is String) {
      if (value.toLowerCase() == 'true') return true;
      if (value.toLowerCase() == 'false') return false;
    }
    if (value is num) return value != 0;
    return null;
  }
}

/// Binds to a [num] value.
class BoundNumber extends BoundValue<num> {
  /// Creates a [BoundNumber].
  const BoundNumber({
    super.key,
    required super.dataContext,
    required super.value,
    required super.builder,
  });

  @override
  State<BoundNumber> createState() => _BoundNumberState();
}

class _BoundNumberState extends BoundValueState<num, BoundNumber> {
  @override
  num? convert(Object? value) {
    if (value is num) return value;
    if (value is String) return num.tryParse(value);
    return null;
  }
}

/// Binds to a [List] of objects.
class BoundList extends BoundValue<List<Object?>> {
  /// Creates a [BoundList].
  const BoundList({
    super.key,
    required super.dataContext,
    required super.value,
    required super.builder,
  });

  @override
  State<BoundList> createState() => _BoundListState();
}

class _BoundListState extends BoundValueState<List<Object?>, BoundList> {
  @override
  List<Object?>? convert(Object? value) {
    if (value is List) return value.cast<Object?>();
    return null;
  }
}

/// Binds to any [Object] value.
class BoundObject extends BoundValue<Object> {
  /// Creates a [BoundObject].
  const BoundObject({
    super.key,
    required super.dataContext,
    required super.value,
    required super.builder,
  });

  @override
  State<BoundObject> createState() => _BoundObjectState();
}

class _BoundObjectState extends BoundValueState<Object, BoundObject> {
  @override
  Object? convert(Object? value) => value;
}
