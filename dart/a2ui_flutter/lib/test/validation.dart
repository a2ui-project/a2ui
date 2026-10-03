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

import 'dart:convert';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../src/model/a2ui_schemas.dart';
import '../src/model/catalog.dart';
import '../src/model/catalog_item.dart' show CatalogItem;

import '../src/primitives/constants.dart';
import '../src/primitives/embedded_schemas.g.dart';
import '../src/primitives/simple_items.dart';

/// A class to represent a validation error in a catalog item example.
class ExampleValidationError {
  /// The index of the example in the `exampleData` list.
  final int exampleIndex;

  /// The error message.
  final String message;

  /// The underlying cause of the error, if any.
  final Object? cause;

  /// Creates a new [ExampleValidationError].
  ExampleValidationError(this.exampleIndex, this.message, {this.cause});

  @override
  String toString() {
    var result = 'Validation error in example $exampleIndex: $message';
    if (cause != null) {
      result += '\nCause: $cause';
    }
    return result;
  }
}

/// Validates the examples for a single catalog item.
///
/// The [item] is the [CatalogItem] to validate.
/// The [catalog] is the full catalog used for context, including any
/// additional catalogs.
///
/// Returns a list of validation errors. An empty list means success.
Future<List<ExampleValidationError>> validateCatalogItemExamples(
  CatalogItem item,
  Catalog catalog,
) async {
  final Schema schema = A2uiSchemas.updateComponentsSchema(catalog);
  final errors = <ExampleValidationError>[];

  for (var i = 0; i < item.exampleData.length; i++) {
    final String exampleJsonString = item.exampleData[i]();
    final List<Object?> exampleData;
    try {
      exampleData = jsonDecode(exampleJsonString) as List<Object?>;
    } catch (e) {
      errors.add(
        ExampleValidationError(i, 'Failed to parse as a JSON list', cause: e),
      );
      continue;
    }

    final List<Map<String, Object?>> components = exampleData
        .cast<JsonMap>()
        .map(Map<String, Object?>.from)
        .toList();

    if (components.every((c) => c['id'] != 'root')) {
      errors.add(
        ExampleValidationError(
          i,
          'Example must have a component with id "root"',
        ),
      );
    }

    final Map<String, Object?> surfaceUpdate = {
      surfaceIdKey: 'test-surface',
      'components': components,
    };

    final SchemaRegistry registry = createSchemaRegistryWithCommonTypes();

    final List<ValidationError> validationErrors = await schema.validate(
      surfaceUpdate,
      schemaRegistry: registry,
    );
    if (validationErrors.isNotEmpty) {
      errors.add(
        ExampleValidationError(
          i,
          'Schema validation failed',
          cause: validationErrors,
        ),
      );
    }
  }
  return errors;
}

/// Creates a [SchemaRegistry] pre-populated with the common types schema.
SchemaRegistry createSchemaRegistryWithCommonTypes() {
  final commonTypesSchema = Schema.fromMap(
    jsonDecode(commonTypesSchemaJson) as Map<String, Object?>,
  );
  final registry = SchemaRegistry();
  registry.addSchema(Uri.parse(commonTypesSchemaId), commonTypesSchema);
  return registry;
}
