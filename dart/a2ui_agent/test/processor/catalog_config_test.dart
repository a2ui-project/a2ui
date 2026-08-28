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

void main() {
  group('CatalogConfig', () {
    test('returns the pristine catalog when no transformer is configured', () {
      final SchemaCatalog catalog = smallCatalog();
      final CatalogConfig<CatalogComponent, CatalogFunction> config =
          CatalogConfig(catalog);

      expect(config.transformers, isEmpty);
      expect(config.transformedCatalog.components.keys.toSet(), {
        'Text',
        'Card',
        'Button',
      });
    });

    test('applies its transformers in order', () {
      final SchemaCatalogConfig config = SchemaCatalogConfig(
        smallCatalog(),
        transformers: [
          ComponentPruningTransformer(['Text', 'Card']),
          ComponentPruningTransformer(['Text']),
        ],
      );

      expect(config.transformedCatalog.components.keys, ['Text']);
    });

    test('narrows components and functions independently', () {
      final SchemaCatalogConfig config = SchemaCatalogConfig(
        smallCatalog(),
        transformers: [
          ComponentPruningTransformer(['Text']),
          FunctionPruningTransformer(['required']),
        ],
      );

      final SchemaCatalog transformed = config.transformedCatalog;
      expect(transformed.components.keys, ['Text']);
      expect(transformed.functions.keys, ['required']);
    });

    test('leaves the pristine catalog untouched', () {
      final SchemaCatalog catalog = smallCatalog();
      CatalogConfig<CatalogComponent, CatalogFunction>(
        catalog,
        transformers: [
          ComponentPruningTransformer(['Text']),
        ],
      ).transformedCatalog;

      expect(catalog.components.keys.toSet(), {'Text', 'Card', 'Button'});
    });

    test('recomputes the transformed catalog on each read', () {
      final SchemaCatalogConfig config = SchemaCatalogConfig(
        smallCatalog(),
        transformers: [
          ComponentPruningTransformer(['Text']),
        ],
      );

      expect(
        identical(config.transformedCatalog, config.transformedCatalog),
        isFalse,
      );
    });

    test('loads a catalog from disk', () {
      final CatalogConfig<CatalogComponent, CatalogFunction> config =
          CatalogConfig.fromPath(basicCatalogFile());

      expect(config.catalog.id, basicCatalogId);
      expect(config.transformers, isEmpty);
    });

    test('loads a catalog from disk with transformers attached', () {
      final CatalogConfig<CatalogComponent, CatalogFunction> config =
          CatalogConfig.fromPath(
            basicCatalogFile(),
            transformers: [
              ComponentPruningTransformer(['Text', 'Card']),
            ],
            catalogId: basicCatalogId,
            protocolVersion: A2uiProtocolVersion.v0_9,
          );

      expect(config.transformedCatalog.components.keys.toSet(), {
        'Text',
        'Card',
      });
    });

    test('reports a catalog id that conflicts with the file', () {
      expect(
        () => CatalogConfig.fromPath(
          basicCatalogFile(),
          catalogId: 'https://example.com/other.json',
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });
}
