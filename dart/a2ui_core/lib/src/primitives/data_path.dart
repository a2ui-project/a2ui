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

import 'errors.dart';

/// A class for handling JSON Pointer (RFC 6901) paths.
class DataPath {
  /// The canonical root path (`/`).
  static final DataPath root = DataPath(const []);

  static const Set<String> _forbiddenKeys = {
    '__proto__',
    'constructor',
    'prototype',
  };

  static final RegExp _invalidEscapePattern = RegExp(r'~(?![01])');

  final List<String> segments;

  /// Whether the path starts with a slash (is absolute).
  final bool isAbsolute;

  DataPath(List<String> segments, {this.isAbsolute = true})
      : segments = List<String>.unmodifiable(_validateSegments(segments));

  static List<String> _validateSegments(
    List<String> segments, [
    String? rawPath,
  ]) {
    for (final segment in segments) {
      if (_forbiddenKeys.contains(segment)) {
        final pathContext = rawPath != null ? " in path '$rawPath'" : '';
        throw A2uiDataError(
          "Forbidden path segment '$segment'$pathContext.",
          path: rawPath ?? segment,
        );
      }
    }
    return segments;
  }

  /// Parses a JSON Pointer string into a [DataPath].
  factory DataPath.parse(String path) {
    if (_invalidEscapePattern.hasMatch(path)) {
      throw A2uiDataError(
        "Invalid escape sequence in path '$path': "
        "'~' must be followed by '0' or '1'.",
        path: path,
      );
    }

    if (path.isEmpty || path == '/') {
      return DataPath(const []);
    }

    final bool isAbsolute = path.startsWith('/');
    final List<String> segments = path
        .split('/')
        .where((s) => s.isNotEmpty)
        .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'))
        .toList();

    _validateSegments(segments, path);
    return DataPath(segments, isAbsolute: isAbsolute);
  }

  /// The number of segments in the path.
  int get length => segments.length;

  /// Whether the path is empty (points to the root).
  bool get isEmpty => segments.isEmpty;

  /// Joins this path with another path or segment.
  DataPath append(Object other) {
    if (other is DataPath) {
      return DataPath(
        [...segments, ...other.segments],
        isAbsolute: isAbsolute,
      );
    } else if (other is String) {
      return DataPath(
        [...segments, ...DataPath.parse(other).segments],
        isAbsolute: isAbsolute,
      );
    }
    final segment = other.toString();
    return DataPath(
      [...segments, segment],
      isAbsolute: isAbsolute,
    );
  }

  /// Returns the parent path.
  DataPath? get parent {
    if (segments.isEmpty) return null;
    return DataPath(
      segments.sublist(0, segments.length - 1),
      isAbsolute: isAbsolute,
    );
  }

  @override
  String toString() {
    if (segments.isEmpty) return isAbsolute ? '/' : '';
    final String joined = segments
        .map((s) => s.replaceAll('~', '~0').replaceAll('/', '~1'))
        .join('/');
    return isAbsolute ? '/$joined' : joined;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DataPath &&
          isAbsolute == other.isAbsolute &&
          const ListEquality<String>().equals(segments, other.segments);

  @override
  int get hashCode =>
      Object.hash(isAbsolute, const ListEquality<String>().hash(segments));
}
