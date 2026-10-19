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
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart' as v1_0;
import 'package:a2ui_flutter/v0_9/basic_catalog.dart' as v0_9;
import 'package:flutter_test/flutter_test.dart';

/// Checks that [catalog] carries [spec] and is made of [components], every
/// component [spec] declares.
void _expectCatalog(
  CatalogImplementation catalog,
  CatalogApi spec,
  List<ComponentImplementation> components,
) {
  expect([
    for (final c in components) c.name,
  ], unorderedEquals(spec.components.keys));
  expect(catalog.id, spec.id);
  expect(catalog.schemaId, spec.schemaId);
  expect(catalog.title, spec.title);
  expect(catalog.description, spec.description);
  expect(catalog.protocolVersion, spec.protocolVersion);
  expect(catalog.instructions, spec.instructions);
  expect(catalog.themeSchema, same(spec.themeSchema));
  expect(catalog.components.values, unorderedEquals(components));
  expect(catalog.functions.keys, unorderedEquals(spec.functions.keys));
  for (final MapEntry(:key, :value) in catalog.functions.entries) {
    expect(value.returnType, spec.functions[key]!.returnType, reason: key);
  }
  for (final component in components) {
    expect(component.schema, same(spec.components[component.name]!.schema));
  }
}

void main() {
  test('basicCatalog is the v1.0 basic catalog, without a theme', () {
    final CatalogImplementation catalog = v1_0.basicCatalog();
    _expectCatalog(catalog, v1_0.BasicComponents.api, v1_0.BasicComponents.all);
    expect(catalog.id, BasicCatalog.v1_0Id);
    expect(catalog.protocolVersion, A2uiProtocolVersion.v1_0);
    expect(catalog.themeSchema, isNull);
  });

  test('the v0_9 basicCatalog is the v0.9 basic catalog', () {
    final CatalogImplementation catalog = v0_9.basicCatalog();
    _expectCatalog(catalog, v0_9.BasicComponents.api, v0_9.BasicComponents.all);
    expect(catalog.id, BasicCatalog.v0_9Id);
    expect(catalog.themeSchema, isNotNull);
  });
}
