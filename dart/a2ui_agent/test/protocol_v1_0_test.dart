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

import 'dart:convert';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// An agent turn against the published v1.0 basic catalog, beyond what the
/// shared suites in `test/conformance` run as written in v1.0.
///
/// The cases skipped as not implemented state what the v1.0 API does once the
/// part they reach is implemented.
void main() {
  const notImplemented = 'Not implemented yet for v1.0.';
  const A2uiProtocolVersion v1_0 = A2uiProtocolVersion.v1_0;

  final CatalogApi basic = const FileSystemCatalogProvider(
    '../../catalogs/basic/v1/catalog.json',
  ).load();
  final CatalogApi v0_9Basic = const FileSystemCatalogProvider(
    '../../specification/v0_9/catalogs/basic/catalog.json',
    protocolVersion: A2uiProtocolVersion.v0_9,
  ).load();

  A2uiRendererCapabilities supporting(
    List<String> catalogIds, {
    A2uiProtocolVersion version = v1_0,
  }) => A2uiRendererCapabilities.forCatalogIds(catalogIds, version: version);

  A2uiRequestProcessor processor({
    InferenceFormatFactory format = const DirectJsonFormatFactory(),
    List<List<AgentToRendererMessage>> examples = const [],
  }) => A2uiGenerator(
    catalogs: [CatalogConfig(basic)],
    examples: examples,
    inferenceFormatFactory: format,
  ).createProcessor(supporting([basic.id]));

  /// One v1.0 message, parsed from [json].
  AgentToRendererMessage message(Map<String, Object?> json) =>
      AgentToRendererMessage.fromJson({'version': 'v1.0', ...json});

  /// A direct JSON response holding one block of v1.0 messages with
  /// [bodies].
  String jsonBlock(List<Map<String, Object?>> bodies) =>
      '<a2ui-json>${jsonEncode([
        for (final body in bodies) {'version': 'v1.0', ...body},
      ])}</a2ui-json>';

  /// A v1.0 `createSurface` carrying [components].
  Map<String, Object?> createSurface(List<Map<String, Object?>> components) => {
    'createSurface': {
      'surfaceId': 's',
      'catalogId': basic.id,
      'components': components,
    },
  };

  /// A v1.0 `callRendererFunction` of the basic catalog's [function].
  Map<String, Object?> callRendererFunction(
    String function,
    Map<String, Object?> args,
  ) => {
    'callRendererFunction': {
      'functionCallId': 'call_1',
      'callFunction': {'catalogId': basic.id, '@call': function, 'args': args},
    },
  };

  final Map<String, Object?> helloSurface = createSurface([
    {'id': 'root', 'component': 'Text', 'text': 'Hello'},
  ]);

  group('negotiation', () {
    test('activates the catalogs the renderer supports for v1.0', () {
      expect(processor().activeCatalogs, [basic]);
    });

    test('rejects capabilities that declare only another version', () {
      expect(
        () => resolveCatalogs([
          CatalogConfig(basic),
        ], supporting([basic.id], version: A2uiProtocolVersion.v0_9)),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects registered catalogs of different versions', () {
      expect(
        () => resolveCatalogs(
          [CatalogConfig(basic), CatalogConfig(v0_9Basic)],
          A2uiRendererCapabilities(
            versions: {
              v1_0: A2uiVersionCapabilities(supportedCatalogIds: [basic.id]),
              A2uiProtocolVersion.v0_9: A2uiVersionCapabilities(
                supportedCatalogIds: [v0_9Basic.id],
              ),
            },
          ),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('reads an inline catalog stating no version as v1.0', () {
      final List<CatalogApi> active = resolveCatalogs(
        [CatalogConfig(basic)],
        A2uiRendererCapabilities.fromJson({
          'v1.0': {
            'supportedCatalogIds': [basic.id],
            'inlineCatalogs': [
              {
                'catalogId': 'renderer/inline',
                'components': {
                  'Marquee': {'type': 'object'},
                },
              },
            ],
          },
        }),
        acceptsInlineCatalogs: true,
      );
      expect(active.last.protocolVersion, v1_0);
    });
  });

  group('formats', () {
    for (final InferenceFormatFactory format in const [
      DirectJsonFormatFactory(),
      ExpressFormatFactory(),
    ]) {
      test('${format.runtimeType} rejects two catalogs with one id', () {
        expect(
          () => format.createFormat([basic, basic]),
          throwsA(isA<A2uiCatalogError>()),
        );
      });
    }
  });

  group('direct JSON', () {
    test('teaches the v1.0 messages and the catalog', () {
      final String snippet = processor().promptSnippet;
      expect(snippet, contains('"version":{"const":"v1.0"}'));
      expect(snippet, contains(basic.id));
    });

    test('reads a response without a payload', () {
      final List<ResponsePart> parts = processor().parseResponse('Hello.');
      expect((parts.single as TextPart).text, 'Hello.');
    });

    test(
      'reads a createSurface carrying its components',
      skip: notImplemented,
      () {
        final List<ResponsePart> parts = processor().parseResponse(
          jsonBlock([helloSurface]),
        );
        final create =
            (parts.single as A2uiPart).a2ui.single as CreateSurfaceMessage;
        expect(create.version, 'v1.0');
        expect(create.components!.single['component'], 'Text');
      },
    );

    test('reads a component naming its catalog', skip: notImplemented, () {
      final List<ResponsePart> parts = processor().parseResponse(
        jsonBlock([
          createSurface([
            {
              'id': 'root',
              'component': 'Text',
              'catalogId': basic.id,
              'text': 'Hello',
            },
          ]),
        ]),
      );
      expect(parts.single, isA<A2uiPart>());
    });

    test('reads a callRendererFunction', skip: notImplemented, () {
      final List<ResponsePart> parts = processor().parseResponse(
        jsonBlock([
          callRendererFunction('formatString', {'value': 'Hello'}),
        ]),
      );
      expect(
        (parts.single as A2uiPart).a2ui.single,
        isA<CallRendererFunctionMessage>(),
      );
    });

    test(
      'rejects a call to a function the catalog does not declare',
      skip: notImplemented,
      () {
        expect(
          () => processor().parseResponse(
            jsonBlock([callRendererFunction('vibrate', {})]),
          ),
          throwsA(isA<A2uiValidationError>()),
        );
      },
    );

    test(
      'rejects a component the catalog does not declare',
      skip: notImplemented,
      () {
        expect(
          () => processor().parseResponse(
            jsonBlock([
              createSurface([
                {'id': 'root', 'component': 'Marquee', 'text': 'Hello'},
              ]),
            ]),
          ),
          throwsA(isA<A2uiValidationError>()),
        );
      },
    );

    test(
      'streams a component once its object closes',
      skip: notImplemented,
      () {
        final Parser parser = const DirectJsonFormatFactory(
          bufferIncompleteComponents: true,
        ).createFormat([basic]).createParser();
        final String response = jsonBlock([helloSurface]);
        final int cut = response.indexOf('Hello');
        expect(parser.parseChunk(response.substring(0, cut)), isEmpty);
        final List<ResponsePart> parts = parser.parseChunk(
          response.substring(cut),
        );
        expect(parts.whereType<A2uiPart>(), isNotEmpty);
      },
    );
  });

  group('Express', () {
    A2uiRequestProcessor express({
      List<List<AgentToRendererMessage>> examples = const [],
    }) => processor(format: const ExpressFormatFactory(), examples: examples);

    test('teaches the catalog', skip: notImplemented, () {
      expect(express().promptSnippet, contains('Text('));
    });

    test(
      'compiles a surface into one createSurface carrying its components',
      skip: notImplemented,
      () {
        final List<ResponsePart> parts = express().parseResponse(
          '<a2ui>\nsurface("s")\nroot = Text("Hello")\n</a2ui>',
        );
        final List<AgentToRendererMessage> messages =
            (parts.single as A2uiPart).a2ui;
        expect(messages.single.toJson(), {
          'version': 'v1.0',
          'createSurface': {
            'surfaceId': 's',
            'catalogId': basic.id,
            'sendDataModel': false,
            'components': [
              {'id': 'root', 'component': 'Text', 'text': 'Hello'},
            ],
          },
        });
      },
    );

    test(
      'compiles a standalone function call into a callRendererFunction',
      skip: notImplemented,
      () {
        final List<ResponsePart> parts = express().parseResponse(
          '<a2ui>\nformatString("Hello")\n</a2ui>',
        );
        expect(
          (parts.single as A2uiPart).a2ui.single,
          isA<CallRendererFunctionMessage>(),
        );
      },
    );

    test('writes an example in Express', skip: notImplemented, () {
      expect(
        express(
          examples: [
            [message(helloSurface)],
          ],
        ).promptSnippet,
        contains('root = Text("Hello")'),
      );
    });
  });

  group('A2uiRequestProcessor', () {
    test('checks each example when it is created', skip: notImplemented, () {
      expect(
        () => processor(
          examples: [
            [
              message(
                createSurface([
                  {'id': 'root', 'component': 'Marquee', 'text': 'Hello'},
                ]),
              ),
            ],
          ],
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test(
      'rejects a surface with a component nothing reaches from its root',
      skip: notImplemented,
      () {
        expect(
          () => processor().parseResponse(
            jsonBlock([
              createSurface([
                {'id': 'root', 'component': 'Text', 'text': 'Hello'},
                {'id': 'orphan', 'component': 'Text', 'text': 'Alone'},
              ]),
            ]),
          ),
          throwsA(isA<A2uiError>()),
        );
      },
    );
  });
}
