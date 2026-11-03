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

/// Reads the `ValidationResult` values in [value] that [schema] types as
/// `DynamicBoolean` by their validity.
///
/// From v1.0 the validation functions return a [ValidationResult] rather
/// than a boolean, and the specification defines `DynamicBoolean` as a
/// boolean, a binding, or a call returning a boolean or a validation result
/// object, coerced to its `valid` boolean. A resolved value that is such a
/// result, or a map carrying a `valid` key, is therefore replaced by its
/// validity (see [ValidationResult.validityOf]) wherever [schema] asks for a
/// `DynamicBoolean`, and left alone everywhere else.
///
/// Follows [schema] through object `properties` and array `items`. Returns
/// [value] itself when nothing is coerced.
Object? coerceValidationResults(Object? schema, Object? value) {
  if (schema is! Map || value == null) return value;
  if (isDynamicBooleanSchema(schema)) {
    return ValidationResult.validityOf(value) ?? value;
  }
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
