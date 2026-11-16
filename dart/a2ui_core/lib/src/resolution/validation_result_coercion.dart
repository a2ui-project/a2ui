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

import '../core/validation_result.dart';

export '../core/validation_result.dart' show coerceDynamicBoolean;

/// The `$defs` name of the common `DynamicBoolean` type.
const String _dynamicBooleanDef = 'DynamicBoolean';

/// Whether a JSON schema node references the common `DynamicBoolean` type,
/// written as `common_types.json#/$defs/DynamicBoolean` or as a local
/// `#/$defs/DynamicBoolean` that `common_types.json` supplies.
bool isDynamicBooleanSchema(Object? schema) {
  if (schema is! Map) return false;
  final Object? ref = schema[r'$ref'];
  return ref is String && ref.endsWith('/\$defs/$_dynamicBooleanDef');
}

/// Coerces the values in [value] that [schema] types as `DynamicBoolean`
/// to a `bool` using [coerceDynamicBoolean].
///
/// Follows [schema] through object `properties` and array `items`. Returns
/// [value] itself when nothing is coerced.
Object? coerceValidationResults(Object? schema, Object? value) {
  if (schema is! Map) return value;
  if (isDynamicBooleanSchema(schema)) {
    return coerceDynamicBoolean(value);
  }
  if (value == null) return value;
  final Object? items = schema['items'];
  if (items is Map && value is List) {
    var changed = false;
    final coerced = <Object?>[];
    for (final Object? item in value) {
      final Object? result = coerceValidationResults(items, item);
      if (!identical(result, item)) changed = true;
      coerced.add(result);
    }
    return changed ? coerced : value;
  }
  final Object? properties = schema['properties'];
  if (properties is Map && value is Map) {
    var changed = false;
    final coerced = <String, Object?>{};
    for (final MapEntry<Object?, Object?> entry in value.entries) {
      final Object? result =
          coerceValidationResults(properties[entry.key], entry.value);
      if (!identical(result, entry.value)) changed = true;
      coerced[entry.key.toString()] = result;
    }
    return changed ? coerced : value;
  }
  return value;
}

/// [coerceValidationResults] for a function's resolved arguments, keyed
/// by name, against the function's argument schema.
Map<String, dynamic> coerceValidationResultArgs(
  Map<String, Object?> argumentSchema,
  Map<String, dynamic> args,
) {
  final Object? coerced = coerceValidationResults(argumentSchema, args);
  return coerced is Map<String, Object?> && !identical(coerced, args)
      ? Map<String, dynamic>.from(coerced)
      : args;
}
