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

/// Marks a test describing behaviour the DIRECT_JSON prompt generator does not
/// implement yet. Remove the skip alongside the implementation.
const String pendingPromptGenerator =
    'DirectJsonPromptGenerator.generate is not implemented yet.';

void main() {
  group('DirectJsonFormatFactory', () {
    test('builds a format bound to the given catalogs', () {
      final DirectJsonFormat<CatalogComponent, CatalogFunction> format =
          const DirectJsonFormatFactory<CatalogComponent, CatalogFunction>()
              .createFormat([smallCatalog()]);

      expect(
        format,
        isA<DirectJsonFormat<CatalogComponent, CatalogFunction>>(),
      );
      expect(format.catalogs, hasLength(1));
      expect(format.catalogs.single.components.keys, contains('Text'));
    });

    test('passes examples through to the prompt generator', () {
      final examples = <String, List<A2uiMessage>>{
        'a login form': [
          CreateSurfaceMessage(surfaceId: 's1', catalogId: basicCatalogId),
        ],
      };

      final DirectJsonFormat<CatalogComponent, CatalogFunction> format =
          const DirectJsonFormatFactory<CatalogComponent, CatalogFunction>()
              .createFormat([smallCatalog()], examples: examples);

      expect(format.promptGenerator.examples, same(examples));
    });

    test('passes the allowed message list through to the prompt generator', () {
      final DirectJsonFormat<CatalogComponent, CatalogFunction> format =
          const DirectJsonFormatFactory<CatalogComponent, CatalogFunction>(
            allowedMessages: ['createSurface', 'updateComponents'],
          ).createFormat([smallCatalog()]);

      expect(format.promptGenerator.allowedMessages, [
        'createSurface',
        'updateComponents',
      ]);
    });
  });

  group('DirectJsonFormat', () {
    test('creates a fresh parser for each turn', () {
      final format = DirectJsonFormat<CatalogComponent, CatalogFunction>([
        smallCatalog(),
      ]);

      final Parser first = format.createParser();
      final Parser second = format.createParser();

      expect(first, isA<DirectJsonParser<CatalogComponent, CatalogFunction>>());
      expect(identical(first, second), isFalse);
    });

    test('binds the parser to the format catalogs', () {
      final SchemaCatalog catalog = smallCatalog();
      final format = DirectJsonFormat<CatalogComponent, CatalogFunction>([
        catalog,
      ]);

      final parser =
          format.createParser()
              as DirectJsonParser<CatalogComponent, CatalogFunction>;

      expect(parser.catalogs.single, same(catalog));
    });

    test('exposes one prompt generator', () {
      final format = DirectJsonFormat<CatalogComponent, CatalogFunction>([
        smallCatalog(),
      ]);

      expect(identical(format.promptGenerator, format.promptGenerator), isTrue);
    });
  });

  group('DirectJsonPromptGenerator', () {
    test('holds the catalogs it will describe', () {
      final generator =
          DirectJsonPromptGenerator<CatalogComponent, CatalogFunction>([
            smallCatalog(),
          ]);

      expect(generator.catalogs, hasLength(1));
      expect(generator.examples, isNull);
      expect(generator.allowedMessages, isNull);
    });

    test(
      'embeds the catalog schema in an a2ui_schema block',
      () {
        final generator =
            DirectJsonPromptGenerator<CatalogComponent, CatalogFunction>([
              basicCatalog(),
            ]);

        final String prompt = generator.generate();

        expect(prompt, contains(a2uiSchemaOpenTag));
        expect(prompt, contains(a2uiSchemaCloseTag));
        expect(prompt, contains('"Card"'));
        expect(prompt, contains('"TextField"'));
        expect(prompt, contains('"required"'));
      },
      skip: pendingPromptGenerator,
    );

    test(
      'instructs the model to emit payloads inside a2ui-json tags',
      () {
        final generator =
            DirectJsonPromptGenerator<CatalogComponent, CatalogFunction>([
              smallCatalog(),
            ]);

        final String prompt = generator.generate();

        expect(prompt, contains(a2uiJsonOpenTag));
        expect(prompt, contains(a2uiJsonCloseTag));
      },
      skip: pendingPromptGenerator,
    );

    test(
      'describes only the components a pruned catalog still declares',
      () {
        final SchemaCatalog pruned =
            ComponentPruningTransformer<CatalogComponent, CatalogFunction>([
              'Text',
            ]).transform(smallCatalog());

        final String prompt =
            DirectJsonPromptGenerator<CatalogComponent, CatalogFunction>([
              pruned,
            ]).generate();

        expect(prompt, contains('"Text"'));
        expect(prompt, isNot(contains('"Button"')));
      },
      skip: pendingPromptGenerator,
    );

    test('renders the example turns it was given', () {
      final generator =
          DirectJsonPromptGenerator<CatalogComponent, CatalogFunction>(
            [smallCatalog()],
            examples: {
              'a greeting': [
                CreateSurfaceMessage(
                  surfaceId: 's1',
                  catalogId: basicCatalogId,
                ),
              ],
            },
          );

      final String prompt = generator.generate();

      expect(prompt, contains('a greeting'));
      expect(prompt, contains('createSurface'));
    }, skip: pendingPromptGenerator);

    test(
      'restricts the described envelopes to the allowed messages',
      () {
        final generator =
            DirectJsonPromptGenerator<CatalogComponent, CatalogFunction>(
              [smallCatalog()],
              allowedMessages: ['createSurface'],
            );

        final String prompt = generator.generate();

        expect(prompt, contains('createSurface'));
        expect(prompt, isNot(contains('deleteSurface')));
      },
      skip: pendingPromptGenerator,
    );

    test('describes the protocol version it targets', () {
      final String prompt =
          DirectJsonPromptGenerator<CatalogComponent, CatalogFunction>([
            smallCatalog(),
          ]).generate();

      expect(prompt, contains('v0.9'));
    }, skip: pendingPromptGenerator);
  });

  group('DIRECT_JSON constants', () {
    test('name the sentinel tags the format uses', () {
      expect(a2uiJsonOpenTag, '<a2ui-json>');
      expect(a2uiJsonCloseTag, '</a2ui-json>');
      expect(a2uiSchemaOpenTag, '<a2ui_schema>');
      expect(a2uiSchemaCloseTag, '</a2ui_schema>');
    });

    test('list the string keys that may be healed mid-stream', () {
      expect(defaultProgressiveKeys, contains('text'));
      expect(defaultProgressiveKeys, contains('label'));
      expect(defaultProgressiveKeys, contains('literalString'));
      expect(defaultProgressiveKeys, isNot(contains('component')));
    });
  });
}
