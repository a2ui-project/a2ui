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

/// Marks a test describing behaviour capability negotiation does not implement
/// yet. Remove the skip alongside the implementation.
const String pendingNegotiation =
    'Capability negotiation is not implemented yet.';

A2uiGenerator<CatalogComponent, CatalogFunction> generator({
  List<SchemaCatalogConfig>? catalogs,
  Map<String, List<A2uiMessage>>? examples,
  bool acceptsInlineCatalogs = false,
  InferenceFormatFactory<CatalogComponent, CatalogFunction>? factory,
}) => A2uiGenerator<CatalogComponent, CatalogFunction>(
  catalogs: catalogs ?? [CatalogConfig(basicCatalog())],
  examples: examples,
  acceptsInlineCatalogs: acceptsInlineCatalogs,
  inferenceFormatFactory: factory,
);

void main() {
  group('A2uiGenerator configuration', () {
    test('holds the catalog configurations it was registered with', () {
      final A2uiGenerator<CatalogComponent, CatalogFunction> g = generator();

      expect(g.catalogs, hasLength(1));
      expect(g.catalogs.single.catalog.id, basicCatalogId);
    });

    test('defaults to the DIRECT_JSON inference format', () {
      expect(
        generator().inferenceFormatFactory,
        isA<DirectJsonFormatFactory<CatalogComponent, CatalogFunction>>(),
      );
    });

    test('accepts an inference format override', () {
      expect(
        generator(factory: const ExpressFormatFactory()).inferenceFormatFactory,
        isA<ExpressFormatFactory<CatalogComponent, CatalogFunction>>(),
      );
    });

    test('does not accept inline catalogs by default', () {
      expect(generator().acceptsInlineCatalogs, isFalse);
    });

    test('holds the shared example turns', () {
      final examples = <String, List<A2uiMessage>>{
        'a greeting': [
          CreateSurfaceMessage(surfaceId: 's1', catalogId: basicCatalogId),
        ],
      };

      expect(generator(examples: examples).examples, same(examples));
    });
  });

  group('A2uiGenerator.agentCapabilities', () {
    test('advertises only the protocol version this SDK implements', () {
      expect(generator().agentCapabilities['a2uiVersions'], ['v0.9']);
    });

    test('advertises every registered catalog id', () {
      final A2uiGenerator<CatalogComponent, CatalogFunction> g = generator(
        catalogs: [
          CatalogConfig(basicCatalog()),
          CatalogConfig(smallCatalog()),
        ],
      );

      expect(g.agentCapabilities['supportedCatalogIds'], [
        basicCatalogId,
        'https://example.com/small.json',
      ]);
    });

    test('advertises whether inline catalogs are accepted', () {
      expect(generator().agentCapabilities['acceptsInlineCatalogs'], isFalse);
      expect(
        generator(
          acceptsInlineCatalogs: true,
        ).agentCapabilities['acceptsInlineCatalogs'],
        isTrue,
      );
    });

    test('advertises the pristine catalog id, not a transformed copy', () {
      final A2uiGenerator<CatalogComponent, CatalogFunction> g = generator(
        catalogs: [
          CatalogConfig(
            basicCatalog(),
            transformers: [
              ComponentPruningTransformer(['Text']),
            ],
          ),
        ],
      );

      expect(g.agentCapabilities['supportedCatalogIds'], [basicCatalogId]);
    });
  });

  group('A2uiGenerator.createProcessor', () {
    test('negotiates the catalog the renderer declares', () {
      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
          generator().createProcessor(basicCatalogCapabilities());

      expect(processor.activeCatalogs, hasLength(1));
      expect(processor.activeCatalogs.single.id, basicCatalogId);
    }, skip: pendingNegotiation);

    test('binds the processor to the transformed catalog', () {
      final A2uiGenerator<CatalogComponent, CatalogFunction> g = generator(
        catalogs: [
          CatalogConfig(
            basicCatalog(),
            transformers: [
              ComponentPruningTransformer(['Text', 'Card']),
            ],
          ),
        ],
      );

      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
          g.createProcessor(basicCatalogCapabilities());

      expect(processor.activeCatalogs.single.components.keys.toSet(), {
        'Text',
        'Card',
      });
    }, skip: pendingNegotiation);

    test('passes the shared examples to the processor', () {
      final examples = <String, List<A2uiMessage>>{
        'a greeting': [
          CreateSurfaceMessage(surfaceId: 's1', catalogId: basicCatalogId),
        ],
      };

      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
          generator(
            examples: examples,
          ).createProcessor(basicCatalogCapabilities());

      expect(processor.examples, same(examples));
    }, skip: pendingNegotiation);

    test('uses the generator format factory by default', () {
      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
          generator(
            factory: const ExpressFormatFactory(),
          ).createProcessor(basicCatalogCapabilities());

      expect(
        processor.format,
        isA<ExpressFormat<CatalogComponent, CatalogFunction>>(),
      );
    }, skip: pendingNegotiation);

    test('accepts a per-request format override', () {
      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
          generator().createProcessor(
            basicCatalogCapabilities(),
            inferenceFormatFactory: const ExpressFormatFactory(),
          );

      expect(
        processor.format,
        isA<ExpressFormat<CatalogComponent, CatalogFunction>>(),
      );
    }, skip: pendingNegotiation);

    test(
      'rejects a renderer that supports no registered catalog',
      () {
        expect(
          () => generator().createProcessor(
            A2uiRendererCapabilities.forCatalogIds([
              'https://example.com/unknown.json',
            ]),
          ),
          throwsA(isA<A2uiCatalogError>()),
        );
      },
      skip: pendingNegotiation,
    );

    test('rejects capabilities carrying no v0.9 entry', () {
      expect(
        () => A2uiRendererCapabilities.fromJson({
          'v1.0': {
            'supportedCatalogIds': [basicCatalogId],
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test(
      'rejects examples that the negotiated catalog cannot express',
      () {
        final A2uiGenerator<CatalogComponent, CatalogFunction> g = generator(
          catalogs: [
            CatalogConfig(
              basicCatalog(),
              transformers: [
                ComponentPruningTransformer(['Text']),
              ],
            ),
          ],
          examples: {
            'uses a pruned component': [
              UpdateComponentsMessage(
                surfaceId: 's1',
                components: [
                  {'id': 'v', 'component': 'Video', 'url': 'https://x/y.mp4'},
                ],
              ),
            ],
          },
        );

        expect(
          () => g.createProcessor(basicCatalogCapabilities()),
          throwsA(isA<A2uiValidationError>()),
        );
      },
      skip: pendingNegotiation,
    );

    test('creates an independent processor per request', () {
      final A2uiGenerator<CatalogComponent, CatalogFunction> g = generator();

      expect(
        identical(
          g.createProcessor(basicCatalogCapabilities()),
          g.createProcessor(basicCatalogCapabilities()),
        ),
        isFalse,
      );
    }, skip: pendingNegotiation);
  });
}
