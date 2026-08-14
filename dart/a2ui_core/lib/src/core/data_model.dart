// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../primitives/data_path.dart';
import '../primitives/errors.dart';
import '../primitives/reactivity.dart';

/// The maximum list index that auto-vivification will expand to.
///
/// Prevents OOM from paths like `/data/999999999` which would otherwise
/// allocate a billion-element list.
const int maxAutoVivifyIndex = 10000;

/// A standalone, observable data store representing the client-side state.
/// It handles JSON Pointer path resolution and reactive signal management.
class DataModel {
  Object? _data;
  final Map<String, WeakReference<Signal<Object?>>> _signals = {};

  DataModel([Object? initialData]) : _data = initialData ?? <String, Object?>{};

  /// Synchronously gets data at a specific JSON pointer path.
  Object? get(String path) {
    final dataPath = DataPath.parse(path);
    if (dataPath.isEmpty) return _data;

    Object? currentNode = _data;
    for (final String segment in dataPath.segments) {
      if (currentNode == null) return null;
      if (currentNode is Map<String, Object?>) {
        currentNode = currentNode[segment];
      } else if (currentNode is List<Object?>) {
        final int? index = int.tryParse(segment);
        if (index == null || index < 0 || index >= currentNode.length) {
          return null;
        }
        currentNode = currentNode[index];
      } else {
        return null;
      }
    }
    return currentNode;
  }

  /// Updates data at a specific path and notifies subscribers.
  void set(String path, Object? value) {
    final dataPath = DataPath.parse(path);

    batch(() {
      if (dataPath.isEmpty) {
        _data = value;
      } else {
        _data ??= <String, Object?>{};
        Object? current = _data;
        for (var i = 0; i < dataPath.segments.length - 1; i++) {
          final String segment = dataPath.segments[i];
          final String nextSegment = dataPath.segments[i + 1];
          final isNextNumeric = int.tryParse(nextSegment) != null;

          if (current is Map<String, Object?>) {
            if (!current.containsKey(segment) || current[segment] == null) {
              current[segment] = isNextNumeric
                  ? <Object?>[]
                  : <String, Object?>{};
            }
            current = current[segment];
          } else if (current is List<Object?>) {
            final int? index = int.tryParse(segment);
            if (index == null) {
              throw A2uiDataError(
                "Cannot use non-numeric segment '$segment' on a list.",
                path: path,
              );
            }
            if (index < 0 || index > maxAutoVivifyIndex) {
              throw A2uiDataError(
                'List index out of bounds: $index (max $maxAutoVivifyIndex)',
                path: path,
              );
            }
            while (current.length <= index) {
              current.add(null);
            }
            if (current[index] == null) {
              current[index] = isNextNumeric
                  ? <Object?>[]
                  : <String, Object?>{};
            }
            current = current[index];
          } else {
            throw A2uiDataError(
              "Cannot set path '$path': intermediate segment '$segment' is a "
              'primitive.',
              path: path,
            );
          }
        }

        final String lastSegment = dataPath.segments.last;
        if (current is Map<String, Object?>) {
          if (value == null) {
            current.remove(lastSegment);
          } else {
            current[lastSegment] = value;
          }
        } else if (current is List<Object?>) {
          final int? index = int.tryParse(lastSegment);
          if (index == null) {
            throw A2uiDataError(
              "Cannot use non-numeric segment '$lastSegment' on a list.",
              path: path,
            );
          }
          if (index < 0 || index > maxAutoVivifyIndex) {
            throw A2uiDataError(
              'List index out of bounds: $index (max $maxAutoVivifyIndex)',
              path: path,
            );
          }
          while (current.length <= index) {
            current.add(null);
          }
          current[index] = value;
        }
      }

      _notifyPathAndRelated(dataPath);
    });
  }

  /// Returns a [ReadonlySignal] for a specific path.
  /// Internally cached using a [WeakReference] to prevent leaks.
  ReadonlySignal<T?> watch<T>(String path) {
    final normalizedPath = DataPath.parse(path).toString();
    final WeakReference<Signal<Object?>>? ref = _signals[normalizedPath];
    if (ref != null) {
      final Signal<Object?>? sig = ref.target;
      if (sig != null) {
        return sig as ReadonlySignal<T?>;
      }
    }

    final Signal<T?> sig = signal<T?>(get(normalizedPath) as T?);
    _signals[normalizedPath] = WeakReference(sig as Signal<Object?>);
    _pruneSignals();
    return sig;
  }

  void _notifyPathAndRelated(DataPath dataPath) {
    final changedPath = dataPath.toString();
    final String changedDescendantPrefix = _descendantPrefix(changedPath);
    for (final String entryPath in _signals.keys.toList()) {
      if (changedPath == entryPath ||
          entryPath.startsWith(changedDescendantPrefix) ||
          changedPath.startsWith(_descendantPrefix(entryPath))) {
        _getAndNotify(entryPath);
      }
    }
  }

  static String _descendantPrefix(String path) => path == '/' ? '/' : '$path/';

  void _getAndNotify(String path) {
    final WeakReference<Signal<Object?>>? ref = _signals[path];
    if (ref == null) return;

    final Signal<Object?>? sig = ref.target;
    if (sig == null) {
      _signals.remove(path);
      return;
    }

    final Object? newValue = get(path);
    // Force notification even if the value is the same reference, because
    // mutable containers (Maps/Lists) may have changed in place.
    sig.set(newValue, force: true);
  }

  void _pruneSignals() {
    _signals.removeWhere((key, ref) => ref.target == null);
  }

  void dispose() {
    _signals.clear();
  }
}
