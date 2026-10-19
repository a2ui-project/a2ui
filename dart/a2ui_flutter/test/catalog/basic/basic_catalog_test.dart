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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/basic_catalog.dart' as v1_0;
import 'package:a2ui_flutter/v0_9.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final CatalogApi spec = BasicComponents.api;

  test('BasicComponents.all implements every component of the spec', () {
    expect([
      for (final c in BasicComponents.all) c.name,
    ], unorderedEquals(spec.components.keys));
  });

  test('the v0.9 basicCatalog carries the spec catalog and its components', () {
    final CatalogImplementation catalog = basicCatalog();
    expect(catalog.id, BasicCatalog.v0_9Id);
    expect(catalog.schemaId, spec.schemaId);
    expect(catalog.title, spec.title);
    expect(catalog.description, spec.description);
    expect(catalog.protocolVersion, spec.protocolVersion);
    expect(catalog.instructions, spec.instructions);
    expect(catalog.themeSchema, same(spec.themeSchema));
    expect(catalog.components.values, unorderedEquals(BasicComponents.all));
    expect(catalog.functions.keys, unorderedEquals(spec.functions.keys));
  });

  test(
    'the v1.0 basicCatalog carries the v1.0 catalog and the shared builders',
    () {
      final Catalog<ComponentApi, FunctionImplementation> v1 =
          BasicCatalog.v1_0();
      final CatalogImplementation catalog = v1_0.basicCatalog();
      expect(catalog.id, BasicCatalog.v1_0Id);
      expect(catalog.protocolVersion, A2uiProtocolVersion.v1_0);
      expect(catalog.schemaId, v1.schemaId);
      expect(catalog.instructions, v1.instructions);
      expect(catalog.themeSchema, isNull);
      expect(catalog.functions.keys, unorderedEquals(v1.functions.keys));
      for (final ComponentImplementation basic in BasicComponents.all) {
        final ComponentImplementation component =
            catalog.components[basic.name]!;
        expect(component.builder, same(basic.builder));
        expect(component.schema.value, v1.components[basic.name]!.schema.value);
      }
    },
  );
}
