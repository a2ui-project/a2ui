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
import 'package:flutter/foundation.dart';

/// Represents a path in the data model, either absolute or relative.
@immutable
final class DataPath {
  /// Creates a [DataPath] from a string representation.
  factory DataPath(String path) {
    if (path == _separator) return root;
    final List<String> segments = path
        .split(_separator)
        .where((s) => s.isNotEmpty)
        .toList();
    return DataPath._(segments, path.startsWith(_separator));
  }

  const DataPath._(this.segments, this.isAbsolute);

  /// The segments of the path.
  final List<String> segments;

  /// Whether the path is absolute (starts with a separator).
  final bool isAbsolute;

  static const String _separator = '/';

  /// The root path.
  static const DataPath root = DataPath._([], true);

  /// The last segment of the path.
  String get basename => segments.isEmpty ? '' : segments.last;

  /// The path without the last segment.
  DataPath get dirname {
    if (segments.isEmpty) return this;
    return DataPath._(segments.sublist(0, segments.length - 1), isAbsolute);
  }

  /// Joins this path with another path.
  DataPath join(DataPath other) {
    if (isAbsolute && other.isAbsolute) {
      throw ArgumentError('Cannot join two absolute paths: $this and $other');
    }
    if (other.isAbsolute) {
      return other;
    }
    return DataPath._([...segments, ...other.segments], isAbsolute);
  }

  /// Returns whether this path starts with the other path.
  bool startsWith(DataPath other) {
    if (other.isAbsolute && !isAbsolute) {
      return false;
    }
    if (other.segments.length > segments.length) {
      return false;
    }
    for (var i = 0; i < other.segments.length; i++) {
      if (segments[i] != other.segments[i]) {
        return false;
      }
    }
    return true;
  }

  @override
  String toString() {
    final String path = segments.join(_separator);
    return isAbsolute ? '$_separator$path' : path;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DataPath &&
          runtimeType == other.runtimeType &&
          isAbsolute == other.isAbsolute &&
          listEquals(segments, other.segments);

  @override
  int get hashCode =>
      Object.hash(isAbsolute, const DeepCollectionEquality().hash(segments));
}
