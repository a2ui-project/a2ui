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

import 'test_catalogs.dart';

void main() {
  group('ComponentPruningTransformer', () {
    test('keeps only the allowed components', () {
      final transformer = ComponentPruningTransformer(['Text', 'Card']);

      final SchemaCatalog pruned = transformer.transform(smallCatalog());

      expect(pruned.components.keys.toSet(), {'Text', 'Card'});
      expect(pruned.functions.keys.toSet(), {'required', 'email'});
    });

    test('ignores allowlist entries the catalog does not declare', () {
      final transformer = ComponentPruningTransformer(['Text', 'NotInCatalog']);

      expect(transformer.transform(smallCatalog()).components.keys, ['Text']);
    });

    test('preserves the catalog identity', () {
      final SchemaCatalog source = smallCatalog();
      final SchemaCatalog pruned = ComponentPruningTransformer([
        'Text',
      ]).transform(source);

      // A transformer narrows what a catalog offers; it does not rename it,
      // which is why capabilities advertise the pristine id.
      expect(pruned.id, source.id);
      expect(pruned.schemaId, source.schemaId);
      expect(pruned.title, source.title);
    });

    test('does not mutate the source catalog', () {
      final SchemaCatalog source = smallCatalog();
      ComponentPruningTransformer(['Text']).transform(source);

      expect(source.components.keys.toSet(), {'Text', 'Card', 'Button'});
    });

    test('narrows the anyComponent union in the rendered document', () {
      final SchemaCatalog pruned = ComponentPruningTransformer([
        'Text',
      ]).transform(smallCatalog());

      final oneOf =
          ((pruned.catalogSchema[r'$defs']! as Map)['anyComponent']!
                  as Map)['oneOf']!
              as List;
      expect(oneOf.map((e) => (e! as Map)[r'$ref']), ['#/components/Text']);
    });

    test('prunes the published basic catalog', () {
      final SchemaCatalog pruned = ComponentPruningTransformer([
        'Card',
        'Column',
        'Text',
        'TextField',
        'Button',
      ]).transform(basicCatalog());

      expect(pruned.components.keys.toSet(), {
        'Card',
        'Column',
        'Text',
        'TextField',
        'Button',
      });
      expect(pruned.components.containsKey('Video'), isFalse);
    });

    test('exposes the allowlist as an unmodifiable set', () {
      final transformer = ComponentPruningTransformer(['Text']);

      expect(transformer.allowedComponents, {'Text'});
      expect(
        () => transformer.allowedComponents.add('Card'),
        throwsUnsupportedError,
      );
    });
  });

  group('FunctionPruningTransformer', () {
    test('keeps only the allowed functions', () {
      final SchemaCatalog pruned = FunctionPruningTransformer([
        'required',
      ]).transform(smallCatalog());

      expect(pruned.functions.keys, ['required']);
      expect(pruned.components.keys.toSet(), {'Text', 'Card', 'Button'});
    });

    test('ignores allowlist entries the catalog does not declare', () {
      final SchemaCatalog pruned = FunctionPruningTransformer([
        'required',
        'notAFunction',
      ]).transform(smallCatalog());

      expect(pruned.functions.keys, ['required']);
    });

    test('narrows the anyFunction union in the rendered document', () {
      final SchemaCatalog pruned = FunctionPruningTransformer([
        'email',
      ]).transform(smallCatalog());

      final oneOf =
          ((pruned.catalogSchema[r'$defs']! as Map)['anyFunction']!
                  as Map)['oneOf']!
              as List;
      expect(oneOf.map((e) => (e! as Map)[r'$ref']), ['#/functions/email']);
    });

    test('exposes the allowlist as an unmodifiable set', () {
      final transformer = FunctionPruningTransformer(['required']);

      expect(transformer.allowedFunctions, {'required'});
      expect(
        () => transformer.allowedFunctions.add('email'),
        throwsUnsupportedError,
      );
    });
  });

  group('CatalogTransformer composition', () {
    test('transformers chain to narrow both components and functions', () {
      final transformers = <CatalogTransformer>[
        ComponentPruningTransformer(['Text']),
        FunctionPruningTransformer(['required']),
      ];

      SchemaCatalog current = smallCatalog();
      for (final transformer in transformers) {
        current = transformer.transform(current);
      }

      expect(current.components.keys, ['Text']);
      expect(current.functions.keys, ['required']);
    });
  });
}
