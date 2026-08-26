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

/// Marks a test describing behaviour the request processor does not implement
/// yet. Remove the skip alongside the implementation.
const String pendingProcessor =
    'A2uiRequestProcessor.parseResponse is not implemented yet.';

/// Marks a test describing prompt rendering, which the DIRECT_JSON prompt
/// generator does not implement yet.
const String pendingPrompt =
    'DirectJsonPromptGenerator.generate is not implemented yet.';

A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor({
  List<SchemaCatalog>? catalogs,
  Map<String, List<A2uiMessage>>? examples,
  InferenceFormatFactory<CatalogComponent, CatalogFunction>? factory,
}) => A2uiRequestProcessor<CatalogComponent, CatalogFunction>(
  activeCatalogs: catalogs ?? [basicCatalog()],
  examples: examples,
  formatFactory: factory,
);

const String surfacePayload =
    '[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": '
    '"$basicCatalogId"}}]';

void main() {
  group('A2uiRequestProcessor configuration', () {
    test('exposes the negotiated catalogs', () {
      expect(processor().activeCatalogs.single.id, basicCatalogId);
    });

    test('defaults to the DIRECT_JSON format', () {
      expect(
        processor().format,
        isA<DirectJsonFormat<CatalogComponent, CatalogFunction>>(),
      );
    });

    test('accepts a format factory override', () {
      expect(
        processor(factory: const ExpressFormatFactory()).format,
        isA<ExpressFormat<CatalogComponent, CatalogFunction>>(),
      );
    });

    test('builds a validator over the negotiated catalogs', () {
      expect(processor().validator.catalogs.keys, [basicCatalogId]);
      expect(processor().validator.protocolVersion, A2uiProtocolVersion.v0_9);
    });

    test('exposes the example turns', () {
      final examples = <String, List<A2uiMessage>>{
        'a greeting': [
          CreateSurfaceMessage(surfaceId: 's1', catalogId: basicCatalogId),
        ],
      };

      expect(processor(examples: examples).examples, same(examples));
    });

    test('creates a fresh parser per turn', () {
      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> p =
          processor();
      final Parser first = p.createParser();

      expect(first, isA<DirectJsonParser<CatalogComponent, CatalogFunction>>());
      expect(identical(first, p.createParser()), isFalse);
    });

    test('binds the parser to the negotiated catalogs', () {
      final parser =
          processor().createParser()
              as DirectJsonParser<CatalogComponent, CatalogFunction>;

      expect(parser.catalogs.single.id, basicCatalogId);
    });
  });

  group('A2uiRequestProcessor.promptSnippet', () {
    test('describes the negotiated catalogs', () {
      final String snippet = processor().promptSnippet;

      expect(snippet, contains(a2uiJsonOpenTag));
      expect(snippet, contains('"Card"'));
      expect(snippet, contains('"TextField"'));
    }, skip: pendingPrompt);

    test('describes only what a pruned catalog still declares', () {
      final SchemaCatalog pruned =
          ComponentPruningTransformer<CatalogComponent, CatalogFunction>([
            'Text',
          ]).transform(basicCatalog());

      final String snippet = processor(catalogs: [pruned]).promptSnippet;

      expect(snippet, contains('"Text"'));
      expect(snippet, isNot(contains('"Video"')));
    }, skip: pendingPrompt);
  });

  group('A2uiRequestProcessor.parseResponse', () {
    test(
      'returns conversational text and compiled payloads in order',
      () {
        final List<ResponsePart> parts = processor().parseResponse(
          'Here you go.\n'
          '$a2uiJsonOpenTag$surfacePayload$a2uiJsonCloseTag\n'
          'Anything else?',
        );

        expect(parts, hasLength(3));
        expect(parts[0], const TextPart('Here you go.'));
        expect((parts[1] as A2uiPart).a2ui.single, isA<CreateSurfaceMessage>());
        expect(parts[2], const TextPart('Anything else?'));
      },
      skip: pendingProcessor,
    );

    test(
      'rejects a payload declaring another protocol version',
      () {
        expect(
          () => processor().parseResponse(
            '$a2uiJsonOpenTag'
            '[{"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}]'
            '$a2uiJsonCloseTag',
          ),
          throwsA(isA<A2uiValidationError>()),
        );
      },
      skip: pendingProcessor,
    );

    test('rejects a payload whose messages omit the version', () {
      expect(
        () => processor().parseResponse(
          '$a2uiJsonOpenTag[{"deleteSurface": {"surfaceId": "s1"}}]'
          '$a2uiJsonCloseTag',
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingProcessor);

    test('rejects a response holding no payload block', () {
      expect(
        () => processor().parseResponse('Just conversation.'),
        throwsA(isA<A2uiParseError>()),
      );
    }, skip: pendingProcessor);

    test(
      'rejects a surface created against an unnegotiated catalog',
      () {
        expect(
          () => processor().parseResponse(
            '$a2uiJsonOpenTag'
            '[{"version": "v0.9", "createSurface": {"surfaceId": "s1", '
            '"catalogId": "https://example.com/unknown.json"}}]'
            '$a2uiJsonCloseTag',
          ),
          throwsA(isA<A2uiCatalogError>()),
        );
      },
      skip: pendingProcessor,
    );

    test(
      'rejects a component the negotiated catalog does not declare',
      () {
        final SchemaCatalog pruned =
            ComponentPruningTransformer<CatalogComponent, CatalogFunction>([
              'Text',
            ]).transform(basicCatalog());

        expect(
          () => processor(catalogs: [pruned]).parseResponse(
            '$a2uiJsonOpenTag'
            '[{"version": "v0.9", "updateComponents": {"surfaceId": "s1", '
            '"components": [{"id": "v", "component": "Video", '
            '"url": "https://example.com/clip.mp4"}]}}]'
            '$a2uiJsonCloseTag',
          ),
          throwsA(isA<A2uiValidationError>()),
        );
      },
      skip: pendingProcessor,
    );
  });

  group('A2uiRequestProcessor.validateExamples', () {
    test(
      'accepts examples the negotiated catalogs can express',
      () {
        final A2uiRequestProcessor<CatalogComponent, CatalogFunction> p =
            processor(
              examples: {
                'a greeting': [
                  CreateSurfaceMessage(
                    surfaceId: 's1',
                    catalogId: basicCatalogId,
                  ),
                  UpdateComponentsMessage(
                    surfaceId: 's1',
                    components: [
                      {'id': 'root', 'component': 'Text', 'text': 'Hello'},
                    ],
                  ),
                ],
              },
            );

        expect(p.validateExamples(), completes);
      },
      skip: pendingProcessor,
    );

    test(
      'rejects examples using a component the catalog does not declare',
      () {
        final SchemaCatalog pruned =
            ComponentPruningTransformer<CatalogComponent, CatalogFunction>([
              'Text',
            ]).transform(basicCatalog());

        final A2uiRequestProcessor<CatalogComponent, CatalogFunction> p =
            processor(
              catalogs: [pruned],
              examples: {
                'uses a pruned component': [
                  UpdateComponentsMessage(
                    surfaceId: 's1',
                    components: [
                      {
                        'id': 'v',
                        'component': 'Video',
                        'url': 'https://x/y.mp4',
                      },
                    ],
                  ),
                ],
              },
            );

        expect(p.validateExamples(), throwsA(isA<A2uiValidationError>()));
      },
      skip: pendingProcessor,
    );

    test('accepts a processor with no examples', () {
      expect(processor().validateExamples(), completes);
    }, skip: pendingProcessor);
  });
}
