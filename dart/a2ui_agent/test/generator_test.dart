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

/// A format that reads every response as text, to show that the processor
/// delegates to the format it is given.
class _TextFormatFactory extends InferenceFormatFactory {
  const _TextFormatFactory();

  @override
  InferenceFormat createFormat(
    List<CatalogApi> catalogs, {
    List<List<AgentToRendererMessage>> examples = const [],
  }) => _TextFormat(catalogs, examples);
}

class _TextFormat extends InferenceFormat {
  const _TextFormat(this.catalogs, this.examples);

  final List<CatalogApi> catalogs;
  final List<List<AgentToRendererMessage>> examples;

  @override
  PromptGenerator get promptGenerator =>
      _TextPromptGenerator(catalogs, examples: examples);

  @override
  Parser createParser() => const _TextParser();
}

class _TextPromptGenerator extends PromptGenerator {
  const _TextPromptGenerator(this.catalogs, {required this.examples});

  final List<CatalogApi> catalogs;
  final List<List<AgentToRendererMessage>> examples;

  @override
  String generate() =>
      'Answer in text. Catalogs: ${catalogs.map((c) => c.id)}. '
      'Examples: ${examples.length}.';
}

class _TextParser extends Parser {
  const _TextParser();

  @override
  List<CatalogApi> get catalogs => const [];

  @override
  bool hasFormatContent(String content, {bool complete = false}) => false;

  @override
  String wrap(List<RawResponsePart> parts) => throw UnimplementedError();

  @override
  List<RawResponsePart> unwrap(String content) => [TextPart(content)];

  @override
  List<AgentToRendererMessage> compile(String formatContent) =>
      throw UnimplementedError();

  @override
  String decompile(List<AgentToRendererMessage> a2uiPayload) =>
      throw UnimplementedError();
}

/// A transformer that counts its runs and otherwise wraps
/// [ComponentPruningTransformer].
class _CountingTransformer extends CatalogTransformer {
  _CountingTransformer(this.keep);

  final List<String> keep;
  int runs = 0;

  @override
  Catalog<C, F> transform<C extends ComponentApi, F extends FunctionApi>(
    Catalog<C, F> catalog,
  ) {
    runs++;
    return ComponentPruningTransformer(keep).transform(catalog);
  }
}

/// A catalog with an id and components named [components], each taking a
/// required string `text`.
CatalogApi _catalog(String id, [List<String> components = const []]) =>
    Catalog.fromJson({
      'catalogId': id,
      'components': {
        for (final String name in components)
          name: {
            'type': 'object',
            'properties': {
              'component': {'const': name},
              'text': {'type': 'string'},
            },
            'required': ['component', 'text'],
          },
      },
    });

/// One example turn: a surface whose root is a [component].
List<AgentToRendererMessage> _example(String catalogId, String component) => [
  AgentToRendererMessage.fromJson({
    'version': 'v0.9',
    'createSurface': {'surfaceId': 'example', 'catalogId': catalogId},
  }),
  AgentToRendererMessage.fromJson({
    'version': 'v0.9',
    'updateComponents': {
      'surfaceId': 'example',
      'components': [
        {'id': 'root', 'component': component, 'text': 'Hello'},
      ],
    },
  }),
];

void main() {
  final CatalogApi a = _catalog('https://example.com/a.json', ['Text', 'Card']);
  final CatalogApi b = _catalog('https://example.com/b.json');

  A2uiGenerator generator({
    InferenceFormatFactory format = const ExpressFormatFactory(),
    List<CatalogTransformer> transformers = const [],
    List<List<AgentToRendererMessage>> examples = const [],
  }) => A2uiGenerator(
    catalogs: [
      CatalogConfig(a, transformers: transformers),
      CatalogConfig(b),
    ],
    examples: examples,
    inferenceFormatFactory: format,
  );

  group('A2uiGenerator.createProcessor', () {
    test('activates supported catalogs in the renderer preference order', () {
      final A2uiRequestProcessor processor =
          generator(format: const _TextFormatFactory()).createProcessor(
            A2uiRendererCapabilities.forCatalogIds([
              b.id,
              'https://example.com/unknown.json',
              a.id,
              b.id,
            ]),
          );
      expect(processor.activeCatalogs, [b, a]);
    });

    test('rejects a renderer supporting no registered catalog', () {
      expect(
        () => generator().createProcessor(
          A2uiRendererCapabilities.forCatalogIds([
            'https://example.com/unknown.json',
          ]),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('activates the transformed catalogs', () {
      final A2uiRequestProcessor processor = generator(
        transformers: [
          ComponentPruningTransformer(['Card']),
        ],
      ).createProcessor(A2uiRendererCapabilities.forCatalogIds([a.id]));
      expect(processor.activeCatalogs.single.id, a.id);
      expect(processor.activeCatalogs.single.components.keys, ['Card']);
      expect(a.components.keys, ['Text', 'Card']);
    });

    test('binds the active catalogs to the given format', () {
      final A2uiRequestProcessor processor = generator(
        format: const _TextFormatFactory(),
      ).createProcessor(A2uiRendererCapabilities.forCatalogIds([a.id]));
      expect(
        processor.promptSnippet,
        'Answer in text. Catalogs: (${a.id}). Examples: 0.',
      );
      expect(
        (processor.parseResponse('Which city?').single as TextPart).text,
        'Which city?',
      );
    });

    test('prefers a format given for the processor', () {
      final A2uiRequestProcessor processor = generator().createProcessor(
        A2uiRendererCapabilities.forCatalogIds([a.id]),
        inferenceFormatFactory: const _TextFormatFactory(),
      );
      expect(processor.promptSnippet, startsWith('Answer in text.'));
    });

    test('passes the examples to the format', () {
      final A2uiRequestProcessor processor = generator(
        format: const _TextFormatFactory(),
        examples: [_example(a.id, 'Text')],
      ).createProcessor(A2uiRendererCapabilities.forCatalogIds([a.id]));
      expect(processor.examples, hasLength(1));
      expect(processor.promptSnippet, endsWith('Examples: 1.'));
    });

    test('rejects an example the active catalogs cannot render', () {
      final A2uiGenerator withExample = generator(
        transformers: [
          ComponentPruningTransformer(['Card']),
        ],
        examples: [_example(a.id, 'Text')],
      );
      expect(
        () => withExample.createProcessor(
          A2uiRendererCapabilities.forCatalogIds([a.id]),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('defaults to the Express format', () {
      expect(
        A2uiGenerator(catalogs: [CatalogConfig(a)]).inferenceFormatFactory,
        isA<ExpressFormatFactory>(),
      );
      expect(
        A2uiRequestProcessor(activeCatalogs: [a]).formatFactory,
        isA<ExpressFormatFactory>(),
      );
    });
  });

  group('CatalogConfig.transformedCatalog', () {
    test('runs the transformers once and reuses the result', () {
      final first = _CountingTransformer(['Text', 'Card']);
      final second = _CountingTransformer(['Card']);
      final config = CatalogConfig(a, transformers: [first, second]);

      final CatalogApi transformed = config.transformedCatalog;
      expect(config.transformedCatalog, same(transformed));
      expect(resolveCatalogs([config], null).single, same(transformed));
      expect(resolveCatalogs([config], null).single, same(transformed));

      expect(first.runs, 1);
      expect(second.runs, 1);
      expect(transformed.components.keys, ['Card']);
    });

    test('caches per config', () {
      final counting = _CountingTransformer(['Card']);
      final one = CatalogConfig(a, transformers: [counting]);
      final other = CatalogConfig(a, transformers: [counting]);

      expect(one.transformedCatalog, isNot(same(other.transformedCatalog)));
      expect(one.transformedCatalog, same(one.transformedCatalog));
      expect(counting.runs, 2);
    });
  });

  group('resolveCatalogs', () {
    final registered = [CatalogConfig(a)];
    final CatalogApi inline = _catalog('https://example.com/inline.json');

    test('activates every registered catalog without capabilities', () {
      final List<CatalogApi> active = resolveCatalogs([
        CatalogConfig(b),
        CatalogConfig(
          a,
          transformers: [
            ComponentPruningTransformer(['Text']),
          ],
        ),
      ], null);
      expect(active.map((c) => c.id), [b.id, a.id]);
      expect(active.last.components.keys, ['Text']);
    });

    test('ignores inline catalogs unless it accepts them', () {
      expect(
        resolveCatalogs(
          registered,
          A2uiRendererCapabilities.forCatalogIds(
            [a.id],
            inlineCatalogs: [inline],
          ),
        ),
        [a],
      );
    });

    test('rejects a renderer that supports no catalog', () {
      expect(
        () => resolveCatalogs(
          registered,
          A2uiRendererCapabilities.forCatalogIds([], inlineCatalogs: [inline]),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('activates accepted inline catalogs after the registered ones', () {
      expect(
        resolveCatalogs(
          registered,
          A2uiRendererCapabilities.forCatalogIds(
            [a.id],
            inlineCatalogs: [inline],
          ),
          acceptsInlineCatalogs: true,
        ),
        [a, inline],
      );
    });

    test('prefers the registration to an inline catalog with its id', () {
      final CatalogApi redefined = _catalog(a.id, ['Other']);
      expect(
        resolveCatalogs(
          registered,
          A2uiRendererCapabilities.forCatalogIds(
            [a.id],
            inlineCatalogs: [redefined, redefined],
          ),
          acceptsInlineCatalogs: true,
        ),
        [a],
      );
    });

    test('mixes a v0.9.1 inline catalog with v0.9 registrations', () {
      final List<CatalogApi> active = resolveCatalogs(
        registered,
        A2uiRendererCapabilities.fromJson({
          'v0.9.1': {
            'supportedCatalogIds': [a.id],
            'inlineCatalogs': [inline.toJson()],
          },
        }),
        acceptsInlineCatalogs: true,
      );
      expect(active.map((c) => c.protocolVersion), [
        null,
        A2uiProtocolVersion.v0_9_1,
      ]);
      expect(
        A2uiRequestProcessor(
          activeCatalogs: active,
          formatFactory: const DirectJsonFormatFactory(),
        ).promptSnippet,
        contains(inline.id),
      );
      expect(
        () => A2uiRequestProcessor(
          activeCatalogs: active,
          formatFactory: const ExpressFormatFactory(),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('activates one of two inline catalogs sharing an id', () {
      expect(
        resolveCatalogs(
          registered,
          A2uiRendererCapabilities.forCatalogIds(
            [],
            inlineCatalogs: [
              inline,
              _catalog(inline.id, ['Other']),
            ],
          ),
          acceptsInlineCatalogs: true,
        ),
        [inline],
      );
    });

    test('rejects inline catalogs containing unresolvable local refs', () {
      final v1Registered = [
        CatalogConfig(
          Catalog.fromJson({
            'catalogId': 'https://example.com/v1.json',
            'protocolVersion': '1.0',
            'components': {
              'Text': {
                'type': 'object',
                'properties': {
                  'component': {'const': 'Text'},
                  'text': {'type': 'string'},
                },
                'required': ['component', 'text'],
              },
            },
          }),
        ),
      ];
      for (final badRef in const [
        r'#/$defs/CatalogComponentCommon',
        '#CatalogComponentCommon',
        r'#/$defs/Bad~2Escape',
      ]) {
        final Map<String, Object?> badInline = {
          'catalogId': 'renderer/bad-ref',
          'protocolVersion': '1.0',
          'components': {
            'Marquee': {
              'type': 'object',
              'properties': {
                'component': {'const': 'Marquee'},
                'tone': {r'$ref': badRef},
              },
              'required': ['component', 'tone'],
            },
          },
        };
        final capabilities = A2uiRendererCapabilities.fromJson({
          '1.0': {
            'supportedCatalogIds': ['https://example.com/v1.json'],
            'inlineCatalogs': [badInline],
          },
        });
        for (final accepts in const [true, false]) {
          expect(
            () => resolveCatalogs(
              v1Registered,
              capabilities,
              acceptsInlineCatalogs: accepts,
            ),
            throwsA(
              isA<A2uiCatalogError>()
                  .having((e) => e.message, 'message', contains('bad-ref'))
                  .having((e) => e.message, 'message', contains(badRef)),
            ),
          );
        }
        expect(
          () => readRendererCapabilities({
            a2uiRendererCapabilitiesKey: {
              '1.0': {
                'supportedCatalogIds': ['https://example.com/v1.json'],
                'inlineCatalogs': [badInline],
              },
            },
          }),
          throwsA(
            isA<A2uiCatalogError>()
                .having((e) => e.message, 'message', contains('bad-ref'))
                .having((e) => e.message, 'message', contains(badRef)),
          ),
        );
      }

      expect(
        () => readRendererCapabilities({
          a2uiRendererCapabilitiesKey: {
            '1.0': {
              'supportedCatalogIds': <String>[],
              'inlineCatalogs': [
                {
                  'catalogId': 'renderer/scalar-ref',
                  'protocolVersion': '1.0',
                  'components': {
                    'Marquee': {
                      'type': 'object',
                      'properties': {
                        'component': {'const': 'Marquee'},
                        'tone': {r'$ref': '#/catalogId'},
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
        throwsA(
          isA<A2uiCatalogError>()
              .having(
                (e) => e.message,
                'message',
                contains('renderer/scalar-ref'),
              )
              .having((e) => e.message, 'message', contains('#/catalogId')),
        ),
      );
    });

    test(
      'accepts v0.9 MessageProcessor inline catalogs and valid escaped refs',
      () {
        final CatalogApi parsedV09 = Catalog.fromJson({
          'catalogId': 'renderer/v09',
          'components': {
            'Label': {
              'type': 'object',
              'properties': {
                'component': {'const': 'Label'},
                'text': {r'$ref': r'common_types.json#/$defs/DynamicString'},
              },
              'required': ['component', 'text'],
            },
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9);
        final v09Catalog = Catalog<ComponentApi, FunctionImplementation>(
          id: parsedV09.id,
          protocolVersion: A2uiProtocolVersion.v0_9,
          components: parsedV09.components.values.toList(),
        );
        final processor = MessageProcessor<ComponentApi>(
          catalogs: [v09Catalog],
        );
        final A2uiRendererCapabilities generated = processor
            .getRendererCapabilities(
              const CapabilitiesOptions(
                versions: [A2uiProtocolVersion.v0_9],
                includeInlineCatalogs: true,
              ),
            );
        final A2uiRendererCapabilities? extracted = readRendererCapabilities({
          a2uiClientCapabilitiesKey: generated.toJson(),
        }, A2uiProtocolVersion.v0_9);
        expect(extracted, isNotNull);
        final List<CatalogApi> active = resolveCatalogs(
          registered,
          extracted,
          acceptsInlineCatalogs: true,
        );
        expect(active.map((c) => c.id), ['renderer/v09']);

        // Bare #/$defs/DynamicString resolves on v0.9, while v1.0-only Child fails.
        final List<CatalogApi> bareCommonActive = resolveCatalogs(
          registered,
          A2uiRendererCapabilities.fromJson({
            'v0.9': {
              'supportedCatalogIds': <String>[],
              'inlineCatalogs': [
                {
                  'catalogId': 'renderer/v09-bare-common',
                  'components': {
                    'Label': {
                      'type': 'object',
                      'properties': {
                        'component': {'const': 'Label'},
                        'text': {r'$ref': r'#/$defs/DynamicString'},
                      },
                      'required': ['component', 'text'],
                    },
                  },
                },
              ],
            },
          }),
          acceptsInlineCatalogs: true,
        );
        expect(bareCommonActive.map((c) => c.id), ['renderer/v09-bare-common']);

        expect(
          () => resolveCatalogs(
            registered,
            A2uiRendererCapabilities.fromJson({
              'v0.9': {
                'supportedCatalogIds': <String>[],
                'inlineCatalogs': [
                  {
                    'catalogId': 'renderer/v09-bad-common',
                    'components': {
                      'Card': {
                        'type': 'object',
                        'properties': {
                          'component': {'const': 'Card'},
                          'child': {r'$ref': r'#/$defs/Child'},
                        },
                      },
                    },
                  },
                ],
              },
            }),
            acceptsInlineCatalogs: true,
          ),
          throwsA(
            isA<A2uiCatalogError>().having(
              (e) => e.message,
              'message',
              contains(r'#/$defs/Child'),
            ),
          ),
        );

        // Flat v0.9 theme with sibling 'type' and 'default' tokens checks
        // 'default', and root theme '$ref' is checked as a schema.
        expect(
          () => readRendererCapabilities({
            a2uiClientCapabilitiesKey: {
              'v0.9': {
                'supportedCatalogIds': <String>[],
                'inlineCatalogs': [
                  {
                    'catalogId': 'renderer/theme-tokens',
                    'components': <String, Object?>{},
                    'theme': {
                      'type': {'type': 'string'},
                      'default': {r'$ref': r'#/$defs/MissingThemeToken'},
                    },
                  },
                ],
              },
            },
          }, A2uiProtocolVersion.v0_9),
          throwsA(
            isA<A2uiCatalogError>().having(
              (e) => e.message,
              'message',
              contains('MissingThemeToken'),
            ),
          ),
        );
        expect(
          () => readRendererCapabilities({
            a2uiClientCapabilitiesKey: {
              'v0.9': {
                'supportedCatalogIds': <String>[],
                'inlineCatalogs': [
                  {
                    'catalogId': 'renderer/theme-ref',
                    'components': <String, Object?>{},
                    'theme': {r'$ref': r'#/$defs/MissingThemeSchema'},
                  },
                ],
              },
            },
          }, A2uiProtocolVersion.v0_9),
          throwsA(
            isA<A2uiCatalogError>().having(
              (e) => e.message,
              'message',
              contains('MissingThemeSchema'),
            ),
          ),
        );

        // An incompatible protocolVersion on entry 0 is not masked by entry 1's
        // local $ref error.
        expect(
          () => readRendererCapabilities({
            a2uiRendererCapabilitiesKey: {
              '1.0': {
                'supportedCatalogIds': <String>[],
                'inlineCatalogs': [
                  {
                    'catalogId': 'renderer/wrong-version',
                    'protocolVersion': '0.9',
                    'components': <String, Object?>{},
                  },
                  {
                    'catalogId': 'renderer/later-ref-error',
                    'protocolVersion': '1.0',
                    'components': {
                      'Marquee': {
                        'type': 'object',
                        'properties': {
                          'component': {'const': 'Marquee'},
                          'tone': {r'$ref': r'#/$defs/MissingLater'},
                        },
                      },
                    },
                  },
                ],
              },
            },
          }),
          throwsA(
            isA<A2uiCatalogError>().having(
              (e) => e.message,
              'message',
              contains('renderer/wrong-version'),
            ),
          ),
        );

        final Map<String, Object?> escapedInline = {
          'catalogId': 'renderer/escaped',
          'protocolVersion': '1.0',
          'components': {
            'Marquee': {
              'type': 'object',
              'allOf': [
                {r'$ref': r'#/$defs/a~1b~0c/allOf/0'},
              ],
              'properties': {
                'component': {'const': 'Marquee'},
                'literalRef': {
                  'type': 'object',
                  'const': {r'$ref': r'#/$defs/not_a_schema_ref'},
                },
                'default': {'type': 'string'},
              },
              'required': ['component'],
            },
          },
          r'$defs': {
            'a/b~c': {
              'allOf': [
                {
                  'type': 'object',
                  'properties': {
                    'label': {'type': 'string'},
                  },
                },
              ],
            },
            'anyComponent': {
              'oneOf': [
                {r'$ref': '#/components/Marquee'},
              ],
              'discriminator': {'propertyName': 'component'},
            },
            'anyFunction': {'not': <String, Object?>{}},
          },
        };
        final v1Registered = [
          CatalogConfig(
            Catalog.fromJson({
              'catalogId': 'https://example.com/v1.json',
              'protocolVersion': '1.0',
              'components': <String, Object?>{},
            }),
          ),
        ];
        final List<CatalogApi> resolvedEscaped = resolveCatalogs(
          v1Registered,
          A2uiRendererCapabilities.fromJson({
            '1.0': {
              'supportedCatalogIds': <String>[],
              'inlineCatalogs': [escapedInline],
            },
          }),
          acceptsInlineCatalogs: true,
        );
        expect(resolvedEscaped.map((c) => c.id), ['renderer/escaped']);

        final Map<String, Object?> badDefaultProp = {
          ...escapedInline,
          'components': {
            'Marquee': {
              'type': 'object',
              'properties': {
                'component': {'const': 'Marquee'},
                'default': {r'$ref': r'#/$defs/MissingDefaultSchema'},
              },
              'required': ['component'],
            },
          },
        };
        expect(
          () => resolveCatalogs(
            v1Registered,
            A2uiRendererCapabilities.fromJson({
              '1.0': {
                'supportedCatalogIds': <String>[],
                'inlineCatalogs': [badDefaultProp],
              },
            }),
            acceptsInlineCatalogs: true,
          ),
          throwsA(
            isA<A2uiCatalogError>().having(
              (e) => e.message,
              'message',
              contains('MissingDefaultSchema'),
            ),
          ),
        );
      },
    );
  });

  group('A2uiRequestProcessor.parseResponse', () {
    final processor = A2uiRequestProcessor(
      activeCatalogs: [a],
      formatFactory: const ExpressFormatFactory(),
    );

    test('reads a direct JSON payload as text', () {
      const response = 'Here: <a2ui-json>[]</a2ui-json>';
      expect(processor.parseResponse(response), [
        isA<TextPart>().having((p) => p.text, 'text', response),
      ]);
    });
  });
}
