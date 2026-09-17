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

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/src/model/catalog.dart' show allCoreCatalogsFor;
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('allCoreCatalogsFor', () {
    test('returns a single core catalog when there are no aliases', () {
      final catalog = Catalog([BasicCatalogItems.text], catalogId: 'canonical');

      final List<core.Catalog<core.ComponentApi, core.FunctionImplementation>>
      cores = allCoreCatalogsFor(catalog);

      expect(cores, hasLength(1));
      expect(cores.single.id, 'canonical');
    });

    test('returns one core catalog per alias, plus the canonical one', () {
      final catalog = Catalog(
        [BasicCatalogItems.text],
        catalogId: 'canonical',
        catalogIdAliases: const ['legacy', 'older'],
      );

      final List<core.Catalog<core.ComponentApi, core.FunctionImplementation>>
      cores = allCoreCatalogsFor(catalog);

      expect(cores.map((c) => c.id), ['canonical', 'legacy', 'older']);
    });

    test('exposes the same components under every ID', () {
      final catalog = Catalog(
        [BasicCatalogItems.text, BasicCatalogItems.button],
        catalogId: 'canonical',
        catalogIdAliases: const ['legacy'],
      );

      final List<core.Catalog<core.ComponentApi, core.FunctionImplementation>>
      cores = allCoreCatalogsFor(catalog);

      final Iterable<String> canonicalNames = cores.first.components.keys;
      expect(canonicalNames, containsAll(<String>['Text', 'Button']));
      for (final core.Catalog<core.ComponentApi, core.FunctionImplementation>
          aliasCatalog
          in cores.skip(1)) {
        expect(aliasCatalog.components.keys, canonicalNames);
      }
    });

    test('deduplicates an alias that repeats the canonical ID', () {
      final catalog = Catalog(
        [BasicCatalogItems.text],
        catalogId: 'canonical',
        catalogIdAliases: const ['canonical', 'legacy'],
      );

      final List<core.Catalog<core.ComponentApi, core.FunctionImplementation>>
      cores = allCoreCatalogsFor(catalog);

      expect(cores.map((c) => c.id), ['canonical', 'legacy']);
    });

    test('deduplicates repeated aliases', () {
      final catalog = Catalog(
        [BasicCatalogItems.text],
        catalogId: 'canonical',
        catalogIdAliases: const ['legacy', 'legacy'],
      );

      final List<core.Catalog<core.ComponentApi, core.FunctionImplementation>>
      cores = allCoreCatalogsFor(catalog);

      expect(cores.map((c) => c.id), ['canonical', 'legacy']);
    });

    test('uses effectiveCatalogId for a catalog without an explicit ID', () {
      final catalog = Catalog([BasicCatalogItems.text]);

      final List<core.Catalog<core.ComponentApi, core.FunctionImplementation>>
      cores = allCoreCatalogsFor(catalog);

      expect(cores.single.id, catalog.effectiveCatalogId);
      expect(cores.single.id, startsWith('inline_catalog_'));
    });
  });

  group('basic catalog IDs', () {
    test('basicCatalogId is the canonical spec URL', () {
      expect(
        basicCatalogId,
        'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      );
    });

    test('the basic catalog matches both the canonical and legacy IDs', () {
      final Catalog catalog = BasicCatalogItems.asCatalog();

      expect(catalog.catalogId, basicCatalogId);
      expect(catalog.matchesId(basicCatalogId), isTrue);
      // ignore: deprecated_member_use_from_same_package
      expect(catalog.matchesId(legacyBasicCatalogId), isTrue);
    });

    test('the basic catalog rules prompt advertises the canonical ID', () {
      expect(BasicCatalogItems.basicCatalogRules, contains(basicCatalogId));
      // ignore: deprecated_member_use_from_same_package
      expect(
        BasicCatalogItems.basicCatalogRules,
        isNot(contains(legacyBasicCatalogId)),
      );
    });
  });
}
