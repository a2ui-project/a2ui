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

import 'package:json_schema_builder/json_schema_builder.dart';

import '../primitives/a2ui_validation_exception.dart';
import '../primitives/simple_items.dart';

/// Validates a set of A2UI components against a catalog [schema].
///
/// Throws [A2uiValidationException] on the first component that fails. State
/// is not rolled back.
Future<void> validateComponents({
  required String surfaceId,
  required Iterable<({String id, String type, JsonMap json})> components,
  required Schema schema,
  required SchemaRegistry registry,
}) async {
  final List<Map<String, Object?>> allowedSchemas = _extractAllowedSchemas(
    schema.value,
  );
  if (allowedSchemas.isEmpty) return;

  for (final component in components) {
    var matched = false;
    final errors = <String>[];

    for (final s in allowedSchemas) {
      if (_schemaMatchesType(s, component.type)) {
        try {
          final List<ValidationError> validationErrors = await Schema.fromMap(
            s,
          ).validate(component.json, schemaRegistry: registry);
          if (validationErrors.isNotEmpty) {
            throw A2uiValidationException(
              validationErrors.join('; '),
              surfaceId: surfaceId,
              path: '/components/${component.id}',
            );
          }
          matched = true;
          break;
        } catch (e) {
          errors.add(e.toString());
        }
      }
    }

    if (!matched) {
      if (errors.isNotEmpty) {
        throw A2uiValidationException(
          'Validation failed for component ${component.id} '
          '(${component.type}): ${errors.join("; ")}',
          surfaceId: surfaceId,
          path: '/components/${component.id}',
        );
      }
      throw A2uiValidationException(
        'Unknown component type: ${component.type}',
        surfaceId: surfaceId,
        path: '/components/${component.id}',
      );
    }
  }
}

List<Map<String, Object?>> _extractAllowedSchemas(
  Map<String, Object?> schemaMap,
) {
  if (schemaMap.containsKey('oneOf')) {
    return (schemaMap['oneOf'] as List).cast<Map<String, Object?>>();
  }
  if (schemaMap.containsKey('properties') &&
      (schemaMap['properties'] as Map).containsKey('components')) {
    final componentsProp =
        (schemaMap['properties'] as Map)['components'] as Map<String, Object?>;
    if (componentsProp.containsKey('items')) {
      final items = componentsProp['items'] as Map<String, Object?>;
      if (items.containsKey('oneOf')) {
        return (items['oneOf'] as List).cast<Map<String, Object?>>();
      }
      return [items];
    }
    if (componentsProp.containsKey('properties')) {
      return (componentsProp['properties'] as Map).values
          .cast<Map<String, Object?>>()
          .toList();
    }
  }
  return const [];
}

bool _schemaMatchesType(Map<String, Object?> schema, String type) {
  if (schema case {
    'properties': {'component': Map<String, Object?> compProp},
  }) {
    return switch (compProp) {
      {'const': String constType} when constType == type => true,
      {'enum': List<Object?> enums} when enums.contains(type) => true,
      _ => false,
    };
  }
  return false;
}
