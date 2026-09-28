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

/// A class for handling JSON Pointer (RFC 6901) paths.
class DataPath {
  final List<String> segments;

  DataPath(this.segments);

  /// Parses a JSON Pointer string into a [DataPath].
  factory DataPath.parse(String path) {
    if (path.isEmpty || path == '/') {
      return DataPath([]);
    }

    var normalized = path;
    if (path.startsWith('/')) {
      normalized = path.substring(1);
    }

    if (normalized.endsWith('/')) {
      normalized = normalized.substring(0, normalized.length - 1);
    }

    if (normalized.isEmpty) {
      return DataPath([]);
    }

    final List<String> segments = normalized.split('/').map((s) {
      return s.replaceAll('~1', '/').replaceAll('~0', '~');
    }).toList();

    return DataPath(segments);
  }

  /// The number of segments in the path.
  int get length => segments.length;

  /// Whether the path is empty (points to the root).
  bool get isEmpty => segments.isEmpty;

  /// Whether the path starts with a slash (is absolute).
  bool get isAbsolute =>
      true; // All parsed paths are treated as absolute for now in our context

  /// Joins this path with another path or segment.
  DataPath append(Object? other) {
    if (other is DataPath) {
      return DataPath([...segments, ...other.segments]);
    } else if (other is String) {
      if (other.startsWith('/')) {
        return DataPath.parse(other);
      }
      return DataPath([...segments, ...DataPath.parse(other).segments]);
    }
    return DataPath([...segments, other.toString()]);
  }

  /// Returns the parent path.
  DataPath? get parent {
    if (segments.isEmpty) return null;
    return DataPath(segments.sublist(0, segments.length - 1));
  }

  @override
  String toString() {
    if (segments.isEmpty) return '/';
    return '/${segments.map((s) => s.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}';
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DataPath &&
          const ListEquality<String>().equals(segments, other.segments);

  @override
  int get hashCode => const ListEquality<String>().hash(segments);
}
