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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

void main() {
  group('Catalog', () {
    test('has a catalogId', () {
      final catalog = Catalog([
        BasicCatalogItems.text,
      ], catalogId: 'test_catalog');
      expect(catalog.catalogId, 'test_catalog');
    });

    testWidgets('buildWidget finds and builds the correct widget', (
      WidgetTester tester,
    ) async {
      final catalog = Catalog([
        BasicCatalogItems.column,
        BasicCatalogItems.text,
      ]);
      final widgetData = {
        'children': [
          {'id': 'child1'},
        ],
      };

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return catalog.buildWidget(
                  CatalogItemContext(
                    id: 'col1',
                    type: 'Column',
                    data: widgetData,
                    buildChild: (_, [_]) =>
                        const Text(''), // Mock child builder
                    dispatchEvent: (UiEvent event) {},
                    buildContext: context,
                    dataContext: DataContext(
                      InMemoryDataModel(),
                      DataPath.root,
                    ),
                    getComponent: (String componentId) => null,
                    getCatalogItem: (String type) => null,
                    surfaceId: 'surfaceId',
                    reportError: (e, s) {},
                  ),
                );
              },
            ),
          ),
        ),
      );
      expect(find.byType(Column), findsOneWidget);
      final Column column = tester.widget<Column>(find.byType(Column));
      expect(column.children.length, 1);
    });

    testWidgets('buildWidget throws StateError for unknown widget type', (
      WidgetTester tester,
    ) async {
      final catalog = const Catalog([]);
      final Map<String, Object> data = {
        'id': 'text1',
        'unknown_widget': {'text': 'hello'},
      };

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                expect(
                  () => catalog.buildWidget(
                    CatalogItemContext(
                      id: 'text1',
                      type: 'unknown_widget',
                      data: data,
                      buildChild: (_, [_]) => const SizedBox(),
                      dispatchEvent: (UiEvent event) {},
                      buildContext: context,
                      dataContext: DataContext(
                        InMemoryDataModel(),
                        DataPath.root,
                      ),
                      getComponent: (String componentId) => null,
                      getCatalogItem: (String type) => null,
                      surfaceId: 'surfaceId',
                      reportError: (e, s) {},
                    ),
                  ),
                  throwsA(isA<CatalogItemNotFoundException>()),
                );
                return const SizedBox();
              },
            ),
          ),
        ),
      );
    });

    test('schema generation is correct', () {
      final catalog = Catalog([
        BasicCatalogItems.text,
        BasicCatalogItems.button,
      ]);
      final schema = catalog.definition as ObjectSchema;

      expect(schema.properties?.containsKey('components'), isTrue);
      expect(schema.properties?.containsKey('styles'), isTrue);

      final componentsSchema = schema.properties!['components'] as ObjectSchema;
      final Map<String, Schema> componentProperties =
          componentsSchema.properties!;

      expect(componentProperties.keys, contains('Text'));
      expect(componentProperties.keys, contains('Button'));
    });

    group('copyWith', () {
      test('preserves systemPromptFragments when not specified', () {
        final catalog = Catalog(
          [BasicCatalogItems.text],
          systemPromptFragments: ['fragment one', 'fragment two'],
        );
        final Catalog copy = catalog.copyWith(
          newItems: [BasicCatalogItems.button],
        );
        expect(copy.systemPromptFragments, ['fragment one', 'fragment two']);
      });

      test('replaces systemPromptFragments when specified', () {
        final catalog = Catalog(
          [BasicCatalogItems.text],
          systemPromptFragments: ['old fragment'],
        );
        final Catalog copy = catalog.copyWith(
          systemPromptFragments: ['new fragment'],
        );
        expect(copy.systemPromptFragments, ['new fragment']);
      });

      test('propagates empty systemPromptFragments by default', () {
        final catalog = Catalog([BasicCatalogItems.text]);
        final Catalog copy = catalog.copyWith();
        expect(copy.systemPromptFragments, isEmpty);
      });
    });

    group('copyWithout', () {
      test('preserves systemPromptFragments when not specified', () {
        final catalog = Catalog(
          [BasicCatalogItems.text, BasicCatalogItems.button],
          systemPromptFragments: ['fragment one', 'fragment two'],
        );
        final Catalog copy = catalog.copyWithout(
          itemsToRemove: [BasicCatalogItems.button],
        );
        expect(copy.systemPromptFragments, ['fragment one', 'fragment two']);
      });

      test('replaces systemPromptFragments when specified', () {
        final catalog = Catalog(
          [BasicCatalogItems.text],
          systemPromptFragments: ['old fragment'],
        );
        final Catalog copy = catalog.copyWithout(
          systemPromptFragments: ['new fragment'],
        );
        expect(copy.systemPromptFragments, ['new fragment']);
      });

      test('propagates empty systemPromptFragments by default', () {
        final catalog = Catalog([BasicCatalogItems.text]);
        final Catalog copy = catalog.copyWithout();
        expect(copy.systemPromptFragments, isEmpty);
      });
    });

    group('catalog ID aliases', () {
      test('default to empty', () {
        const catalog = Catalog([], catalogId: 'test_catalog');
        expect(catalog.catalogIdAliases, isEmpty);
      });

      test('matchesId accepts the canonical ID and every alias', () {
        const catalog = Catalog(
          [],
          catalogId: 'canonical',
          catalogIdAliases: ['legacy', 'older'],
        );

        expect(catalog.matchesId('canonical'), isTrue);
        expect(catalog.matchesId('legacy'), isTrue);
        expect(catalog.matchesId('older'), isTrue);
      });

      test('matchesId rejects an unrelated ID', () {
        const catalog = Catalog(
          [],
          catalogId: 'canonical',
          catalogIdAliases: ['legacy'],
        );

        expect(catalog.matchesId('someone_elses_catalog'), isFalse);
        expect(catalog.matchesId(''), isFalse);
      });

      test(
        'matchesId falls back to effectiveCatalogId for inline catalogs',
        () {
          final catalog = Catalog([BasicCatalogItems.text]);

          expect(catalog.matchesId(catalog.effectiveCatalogId), isTrue);
          expect(catalog.matchesId('inline_catalog_0'), isFalse);
        },
      );

      test('copyWith preserves aliases when none are given', () {
        const catalog = Catalog(
          [],
          catalogId: 'canonical',
          catalogIdAliases: ['legacy'],
        );

        expect(catalog.copyWith().catalogIdAliases, ['legacy']);
      });

      test('copyWith replaces aliases when given', () {
        const catalog = Catalog(
          [],
          catalogId: 'canonical',
          catalogIdAliases: ['legacy'],
        );

        final Catalog copy = catalog.copyWith(catalogIdAliases: ['other']);

        expect(copy.catalogIdAliases, ['other']);
        expect(copy.matchesId('legacy'), isFalse);
        expect(copy.matchesId('other'), isTrue);
      });

      test('copyWithout preserves aliases when none are given', () {
        const catalog = Catalog(
          [],
          catalogId: 'canonical',
          catalogIdAliases: ['legacy'],
        );

        expect(catalog.copyWithout().catalogIdAliases, ['legacy']);
      });

      test('copyWithout replaces aliases when given', () {
        const catalog = Catalog(
          [],
          catalogId: 'canonical',
          catalogIdAliases: ['legacy'],
        );

        final Catalog copy = catalog.copyWithout(catalogIdAliases: []);

        expect(copy.catalogIdAliases, isEmpty);
        expect(copy.matchesId('legacy'), isFalse);
        expect(copy.matchesId('canonical'), isTrue);
      });
    });

    test('toCapabilitiesJson generates correct structure', () {
      final catalog = Catalog(
        [BasicCatalogItems.text, BasicCatalogItems.button],
        functions: [const RegexFunction()],
      );

      final JsonMap json = catalog.toCapabilitiesJson();

      expect(json.containsKey('catalogId'), isTrue);
      // Because we didn't specify one, it generates a fallback one
      expect(
        (json['catalogId'] as String).startsWith('inline_catalog_'),
        isTrue,
      );

      expect(json.containsKey('components'), isTrue);
      final components = json['components'] as JsonMap;
      expect(components.containsKey('Text'), isTrue);
      expect(components.containsKey('Button'), isTrue);

      // Check that components map directly to schemas, not inside 'properties'
      final textSchema = components['Text'] as JsonMap;
      expect(textSchema['type'], 'object');
      expect(textSchema.containsKey('properties'), isTrue);

      expect(json.containsKey('functions'), isTrue);
      final functions = json['functions'] as List<dynamic>;
      expect(functions.length, 1);
      final firstFunc = functions.first as JsonMap;
      expect(firstFunc['name'], 'regex');
      expect(firstFunc['description'], isNotEmpty);
      expect(firstFunc['returnType'], 'boolean');
      expect(firstFunc.containsKey('parameters'), isTrue);
    });
  });
}
