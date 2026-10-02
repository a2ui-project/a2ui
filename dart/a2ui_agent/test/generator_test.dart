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
    List<SchemaCatalog> catalogs, {
    List<List<AgentToRendererMessage>> examples = const [],
  }) => _TextFormat(catalogs, examples);
}

class _TextFormat extends InferenceFormat {
  const _TextFormat(this.catalogs, this.examples);

  final List<SchemaCatalog> catalogs;
  final List<List<AgentToRendererMessage>> examples;

  @override
  PromptGenerator get promptGenerator =>
      _TextPromptGenerator(catalogs, examples: examples);

  @override
  Parser createParser() => const _TextParser();
}

class _TextPromptGenerator extends PromptGenerator {
  const _TextPromptGenerator(this.catalogs, {required this.examples});

  final List<SchemaCatalog> catalogs;
  final List<List<AgentToRendererMessage>> examples;

  @override
  String generate() =>
      'Answer in text. Catalogs: ${catalogs.map((c) => c.id)}. '
      'Examples: ${examples.length}.';
}

class _TextParser extends Parser {
  const _TextParser();

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

/// A catalog with an id and components named [components], each taking a
/// required string `text`.
SchemaCatalog _catalog(String id, [List<String> components = const []]) =>
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
  final SchemaCatalog a = _catalog('https://example.com/a.json', [
    'Text',
    'Card',
  ]);
  final SchemaCatalog b = _catalog('https://example.com/b.json');

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
      final A2uiRequestProcessor processor = generator().createProcessor(
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

    test('defaults to the direct JSON format', () {
      expect(
        A2uiGenerator(catalogs: [CatalogConfig(a)]).inferenceFormatFactory,
        isA<DirectJsonFormatFactory>(),
      );
    });
  });

  group('resolveCatalogs', () {
    final registered = [CatalogConfig(a)];
    final SchemaCatalog inline = _catalog('https://example.com/inline.json');

    test('activates every registered catalog without capabilities', () {
      final List<SchemaCatalog> active = resolveCatalogs([
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
      final SchemaCatalog redefined = _catalog(a.id, ['Other']);
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
