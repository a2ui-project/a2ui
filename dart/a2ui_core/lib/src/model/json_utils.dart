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

import 'package:meta/meta.dart';

/// Deeply copies a JSON-compatible [value], breaking in-memory object cycles.
///
/// When [unmodifiable] is `true`, returned maps and lists are unmodifiable.
@internal
Object? deepCopyJson(
  Object? value, {
  bool unmodifiable = false,
  Set<Object>? seen,
}) {
  if (value is Map) {
    final Set<Object> visited = seen ?? Set<Object>.identity();
    if (!visited.add(value)) {
      return unmodifiable ? const <String, Object?>{} : <String, Object?>{};
    }
    try {
      final copy = <String, Object?>{
        for (final MapEntry<Object?, Object?> entry in value.entries)
          '${entry.key}': deepCopyJson(
            entry.value,
            unmodifiable: unmodifiable,
            seen: visited,
          ),
      };
      return unmodifiable ? Map<String, Object?>.unmodifiable(copy) : copy;
    } finally {
      visited.remove(value);
    }
  }
  if (value is List) {
    final Set<Object> visited = seen ?? Set<Object>.identity();
    if (!visited.add(value)) {
      return unmodifiable ? const <Object?>[] : <Object?>[];
    }
    try {
      final copy = <Object?>[
        for (final Object? item in value)
          deepCopyJson(item, unmodifiable: unmodifiable, seen: visited),
      ];
      return unmodifiable ? List<Object?>.unmodifiable(copy) : copy;
    } finally {
      visited.remove(value);
    }
  }
  return value;
}

/// Deeply copies a string-keyed JSON map, breaking in-memory object cycles.
@internal
Map<String, Object?> deepCopyJsonMap(
  Map<String, Object?> map, {
  bool unmodifiable = false,
}) => deepCopyJson(map, unmodifiable: unmodifiable)! as Map<String, Object?>;

/// Deeply compares two JSON-like values or lists/maps of immutable objects.
@internal
bool deepJsonEquals(Object? a, Object? b) {
  if (identical(a, b)) return true;
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!deepJsonEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final MapEntry<Object?, Object?> entry in a.entries) {
      if (!b.containsKey(entry.key) ||
          !deepJsonEquals(entry.value, b[entry.key])) {
        return false;
      }
    }
    return true;
  }
  return a == b;
}

/// Computes a structural hash code consistent with [deepJsonEquals].
@internal
int deepJsonHash(Object? value) {
  if (value is List) return Object.hashAll(value.map(deepJsonHash));
  if (value is Map) {
    return Object.hashAllUnordered(
      value.entries.map((e) => Object.hash(e.key, deepJsonHash(e.value))),
    );
  }
  return value.hashCode;
}
