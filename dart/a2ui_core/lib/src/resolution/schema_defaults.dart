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

/// A copy of [args] with the `default` of each property [schema] declares
/// filled in where [args] has no value for it, at every depth of nested
/// objects that [args] holds.
///
/// A null value counts as absent, as an unresolved argument does. Defaults are
/// read from `properties`, from the members of `allOf`, and through `$ref`
/// pointers into the `$defs` of [schema], which is the shape
/// `resolveSchemaRefs` produces. A nested object that [args] leaves out is not
/// created to hold its defaults.
Map<String, Object?> withSchemaDefaults(
  Map<String, Object?> args,
  Map<String, Object?> schema,
) {
  final Map<String, Object?> defs = switch (schema[r'$defs']) {
    final Map<Object?, Object?> map => map.cast<String, Object?>(),
    _ => const {},
  };
  final result = <String, Object?>{
    for (final MapEntry<String, Object?> entry in args.entries)
      entry.key: _copyJson(entry.value),
  };
  _fillDefaults(result, schema, defs, const {});
  return result;
}

void _fillDefaults(
  Map<String, Object?> target,
  Map<Object?, Object?> schema,
  Map<String, Object?> defs,
  Set<String> visited,
) {
  if (schema['properties'] case final Map<Object?, Object?> properties) {
    for (final MapEntry<Object?, Object?> entry in properties.entries) {
      final Object? key = entry.key;
      final Object? propertySchema = entry.value;
      if (key is! String || propertySchema is! Map<Object?, Object?>) continue;
      final Object? value = target[key];
      if (value == null) {
        final (Object?,)? found = _defaultOf(propertySchema, defs, const {});
        if (found case (final Object? defaultValue,)) {
          target[key] = _copyJson(defaultValue);
        }
      } else if (value is Map<String, Object?>) {
        _fillDefaults(value, propertySchema, defs, const {});
      }
    }
  }
  if (schema[r'$ref'] case final String ref when !visited.contains(ref)) {
    if (_definition(ref, defs) case final Map<Object?, Object?> definition) {
      _fillDefaults(target, definition, defs, {...visited, ref});
    }
  }
  if (schema['allOf'] case final List<Object?> members) {
    for (final Map<Object?, Object?> member
        in members.whereType<Map<Object?, Object?>>()) {
      _fillDefaults(target, member, defs, visited);
    }
  }
}

/// The `default` of [schema], wrapped in a record so that a `default` of null
/// is told apart from none, or null when it declares none.
(Object?,)? _defaultOf(
  Map<Object?, Object?> schema,
  Map<String, Object?> defs,
  Set<String> visited,
) {
  if (schema.containsKey('default')) return (schema['default'],);
  if (schema[r'$ref'] case final String ref when !visited.contains(ref)) {
    if (_definition(ref, defs) case final Map<Object?, Object?> definition) {
      if (_defaultOf(definition, defs, {...visited, ref}) case final found?) {
        return found;
      }
    }
  }
  if (schema['allOf'] case final List<Object?> members) {
    for (final Map<Object?, Object?> member
        in members.whereType<Map<Object?, Object?>>()) {
      if (_defaultOf(member, defs, visited) case final found?) return found;
    }
  }
  return null;
}

/// The definition a `#/$defs/<name>` [ref] names in [defs], or null.
Object? _definition(String ref, Map<String, Object?> defs) {
  const prefix = r'#/$defs/';
  if (!ref.startsWith(prefix)) return null;
  return defs[ref.substring(prefix.length)];
}

/// A modifiable deep copy of the JSON [value], with string map keys.
Object? _copyJson(Object? value) => switch (value) {
  final Map<Object?, Object?> map => <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in map.entries)
      '${entry.key}': _copyJson(entry.value),
  },
  final List<Object?> list => [
    for (final Object? item in list) _copyJson(item),
  ],
  _ => value,
};
