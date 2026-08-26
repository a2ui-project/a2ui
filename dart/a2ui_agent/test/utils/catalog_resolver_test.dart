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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import '../test_catalogs.dart';

/// Marks a test describing behaviour `resolveCatalogs` does not implement yet.
/// Remove the skip alongside the implementation.
const String pendingResolver = 'resolveCatalogs is not implemented yet.';

const String smallCatalogId = 'https://example.com/small.json';

List<SchemaCatalogConfig> registered() => [
  CatalogConfig(basicCatalog()),
  CatalogConfig(smallCatalog()),
];

void main() {
  group('resolveCatalogs', () {
    test('selects the catalog the renderer declares', () {
      final List<Catalog<CatalogComponent, CatalogFunction>> catalogs =
          resolveCatalogs(
            registered(),
            A2uiRendererCapabilities.forCatalogIds([smallCatalogId]),
          );

      expect(catalogs.map((c) => c.id), [smallCatalogId]);
    }, skip: pendingResolver);

    test('selects every catalog the renderer and agent share', () {
      final List<Catalog<CatalogComponent, CatalogFunction>> catalogs =
          resolveCatalogs(
            registered(),
            A2uiRendererCapabilities.forCatalogIds([
              smallCatalogId,
              basicCatalogId,
            ]),
          );

      expect(catalogs.map((c) => c.id).toSet(), {
        basicCatalogId,
        smallCatalogId,
      });
    }, skip: pendingResolver);

    test('returns catalogs in agent preference order', () {
      final List<Catalog<CatalogComponent, CatalogFunction>> catalogs =
          resolveCatalogs(
            registered(),
            A2uiRendererCapabilities.forCatalogIds([
              smallCatalogId,
              basicCatalogId,
            ]),
          );

      expect(catalogs.map((c) => c.id), [basicCatalogId, smallCatalogId]);
    }, skip: pendingResolver);

    test(
      'falls back to the first registered catalog when none is declared',
      () {
        final List<Catalog<CatalogComponent, CatalogFunction>> catalogs =
            resolveCatalogs(
              registered(),
              A2uiRendererCapabilities.forCatalogIds(const []),
            );

        expect(catalogs.map((c) => c.id), [basicCatalogId]);
      },
      skip: pendingResolver,
    );

    test('returns transformed catalogs, not pristine ones', () {
      final List<Catalog<ComponentApi, FunctionApi>> catalogs = resolveCatalogs(
        [
          CatalogConfig(
            basicCatalog(),
            transformers: [
              ComponentPruningTransformer(['Text', 'Card']),
            ],
          ),
        ],
        A2uiRendererCapabilities.forCatalogIds([basicCatalogId]),
      );

      expect(catalogs.single.components.keys.toSet(), {'Text', 'Card'});
    }, skip: pendingResolver);

    test('ignores inline catalogs unless the agent accepts them', () {
      final capabilities = A2uiRendererCapabilities(
        v0_9: A2uiVersionCapabilities(
          supportedCatalogIds: const [],
          inlineCatalogs: [smallCatalog(id: 'https://example.com/inline.json')],
        ),
      );

      final List<Catalog<CatalogComponent, CatalogFunction>> catalogs =
          resolveCatalogs(registered(), capabilities);

      expect(
        catalogs.map((c) => c.id),
        isNot(contains('https://example.com/inline.json')),
      );
    }, skip: pendingResolver);

    test('includes inline catalogs when the agent accepts them', () {
      final capabilities = A2uiRendererCapabilities(
        v0_9: A2uiVersionCapabilities(
          supportedCatalogIds: const [],
          inlineCatalogs: [smallCatalog(id: 'https://example.com/inline.json')],
        ),
      );

      final List<Catalog<CatalogComponent, CatalogFunction>> catalogs =
          resolveCatalogs(
            registered(),
            capabilities,
            acceptsInlineCatalogs: true,
          );

      expect(
        catalogs.map((c) => c.id),
        contains('https://example.com/inline.json'),
      );
    }, skip: pendingResolver);

    test('rejects a renderer that shares no catalog with the agent', () {
      expect(
        () => resolveCatalogs(
          registered(),
          A2uiRendererCapabilities.forCatalogIds([
            'https://example.com/unknown.json',
          ]),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    }, skip: pendingResolver);

    test('rejects an agent with no registered catalogs', () {
      expect(
        () => resolveCatalogs(
          <SchemaCatalogConfig>[],
          A2uiRendererCapabilities.forCatalogIds([basicCatalogId]),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    }, skip: pendingResolver);
  });
}
