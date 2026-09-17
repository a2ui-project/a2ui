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

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:a2ui_flutter/src/model/a2ui_schemas.dart';
import 'package:a2ui_flutter/src/model/catalog.dart';
import 'package:a2ui_flutter/src/model/catalog_item.dart';
import 'package:a2ui_flutter/src/model/ui_models.dart';
import 'package:a2ui_flutter/src/primitives/simple_items.dart';
import 'package:a2ui_flutter/test/validation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import 'message_builders.dart';

/// Validates the examples in the catalog items in the catalog.
void validateCatalogExamples(
  Catalog catalog, [
  List<Catalog> additionalCatalogs = const [],
]) {
  final mergedCatalog = Catalog([
    ...catalog.items,
    ...additionalCatalogs.expand((c) => c.items),
  ]);
  final Schema schema = A2uiSchemas.updateComponentsSchema(mergedCatalog);

  for (final CatalogItem item in catalog.items) {
    group('CatalogItem ${item.name}', () {
      for (var i = 0; i < item.exampleData.length; i++) {
        test('example $i is valid', () async {
          final String exampleJsonString = item.exampleData[i]();
          final List<Object?> exampleData;
          try {
            exampleData = jsonDecode(exampleJsonString) as List<Object?>;
          } catch (e) {
            fail(
              'Example $i for ${item.name} failed to parse as a JSON list: $e',
            );
          }

          final List<Component> components = exampleData
              .map((e) => Component.fromJson(e as JsonMap))
              .toList();

          expect(
            components.any((c) => c.id == 'root'),
            isTrue,
            reason: 'Example must have a component with id "root"',
          );

          final core.UpdateComponentsMessage surfaceUpdate = updateComponents(
            surfaceId: 'test-surface',
            components: components.map((c) => c.toJson()).toList(),
          );

          final SchemaRegistry registry = createSchemaRegistryWithCommonTypes();

          final List<ValidationError> validationErrors = await schema.validate(
            surfaceUpdate.toJson(),
            schemaRegistry: registry,
          );
          expect(validationErrors, isEmpty);
        });
      }
    });
  }
}
