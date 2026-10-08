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
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final CatalogApi spec = BasicComponents.api;

  test('BasicComponents.all implements every component of the spec', () {
    expect([
      for (final c in BasicComponents.all) c.name,
    ], unorderedEquals(spec.components.keys));
  });

  test('basicCatalog carries the spec catalog and its implementations', () {
    final WidgetCatalog catalog = basicCatalog();
    expect(catalog.id, BasicCatalog.v0_9Id);
    expect(catalog.schemaId, spec.schemaId);
    expect(catalog.title, spec.title);
    expect(catalog.description, spec.description);
    expect(catalog.themeSchema, same(spec.themeSchema));
    expect(catalog.components.values, unorderedEquals(BasicComponents.all));
    expect(catalog.functions.keys, unorderedEquals(spec.functions.keys));
  });
}
