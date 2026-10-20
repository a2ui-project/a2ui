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
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// An agent turn against the published v1.0 basic catalog, and against it
/// beside a second v1.0 catalog, beyond what the shared suites in
/// `test/conformance` run as written in v1.0.
void main() {
  const A2uiProtocolVersion v1_0 = A2uiProtocolVersion.v1_0;

  final basicDocument =
      jsonDecode(
            File('../../catalogs/basic/v1/catalog.json').readAsStringSync(),
          )
          as Map<String, Object?>;
  final CatalogApi basic = InMemoryCatalogProvider(basicDocument).load();
  final CatalogApi v0_9Basic = const FileSystemCatalogProvider(
    '../../specification/v0_9/catalogs/basic/catalog.json',
    protocolVersion: A2uiProtocolVersion.v0_9,
  ).load();

  /// [basic] letting the agent call `formatString`, which the published
  /// catalog leaves to the renderer alone, as it does every function.
  final CatalogApi callable = InMemoryCatalogProvider({
    ...basicDocument,
    'functions': {
      ...basicDocument['functions']! as Map<String, Object?>,
      'formatString': {
        ...(basicDocument['functions']!
                as Map<String, Object?>)['formatString']!
            as Map<String, Object?>,
        'allowedCallers': 'rendererOrAgent',
      },
    },
  }).load();

  /// A second v1.0 catalog, declaring a component and a function of its own,
  /// and a `Text` and a `required` the basic catalog declares too.
  final CatalogApi custom = Catalog.fromJson({
    'catalogId': 'https://example.com/custom.json',
    'protocolVersion': '1.0',
    'components': {
      'Gauge': {
        'type': 'object',
        'properties': {
          'component': {'const': 'Gauge'},
          'value': {'type': 'number'},
        },
        'required': ['component', 'value'],
      },
      'Text': {
        'type': 'object',
        'properties': {
          'component': {'const': 'Text'},
          'label': {'type': 'string'},
        },
        'required': ['component', 'label'],
      },
    },
    'functions': {
      'percent': {
        'type': 'object',
        'returnType': 'string',
        'allowedCallers': 'rendererOrAgent',
        'properties': {
          '@call': {'const': 'percent'},
          'args': {
            'type': 'object',
            'properties': {
              'value': {'type': 'number'},
            },
            'required': ['value'],
            'unevaluatedProperties': false,
          },
        },
        'required': ['@call', 'args'],
      },
      'required': {
        'type': 'object',
        'returnType': 'validationResult',
        'properties': {
          '@call': {'const': 'required'},
          'args': {
            'type': 'object',
            'properties': {'value': <String, Object?>{}},
            'required': ['value'],
            'unevaluatedProperties': false,
          },
        },
        'required': ['@call', 'args'],
      },
    },
  });

  A2uiRendererCapabilities supporting(
    List<String> catalogIds, {
    A2uiProtocolVersion version = v1_0,
  }) => A2uiRendererCapabilities.forCatalogIds(catalogIds, version: version);

  A2uiRequestProcessor processor({
    InferenceFormatFactory format = const DirectJsonFormatFactory(),
    List<List<AgentToRendererMessage>> examples = const [],
    List<CatalogApi>? catalogs,
  }) {
    final List<CatalogApi> registered = catalogs ?? [basic];
    return A2uiGenerator(
      catalogs: [for (final CatalogApi c in registered) CatalogConfig(c)],
      examples: examples,
      inferenceFormatFactory: format,
    ).createProcessor(supporting([for (final c in registered) c.id]));
  }

  /// One v1.0 message, parsed from [json].
  AgentToRendererMessage message(Map<String, Object?> json) =>
      AgentToRendererMessage.fromJson({'version': 'v1.0', ...json});

  /// The JSON of [messages].
  List<Map<String, Object?>> json(List<AgentToRendererMessage> messages) => [
    for (final AgentToRendererMessage m in messages) m.toJson(),
  ];

  /// A direct JSON response holding one block of v1.0 messages with
  /// [bodies].
  String jsonBlock(List<Map<String, Object?>> bodies) =>
      '<a2ui-json>${jsonEncode([
        for (final body in bodies) {'version': 'v1.0', ...body},
      ])}</a2ui-json>';

  /// A v1.0 `createSurface` carrying [components], on [catalogId] or by
  /// default the basic catalog.
  Map<String, Object?> createSurface(
    List<Map<String, Object?>> components, {
    String? catalogId,
    bool namesCatalog = true,
  }) => {
    'createSurface': {
      'surfaceId': 's',
      if (namesCatalog) 'catalogId': catalogId ?? basic.id,
      'components': components,
    },
  };

  /// A v1.0 `callRendererFunction` of [function], of the basic catalog
  /// unless [catalogId] names another.
  Map<String, Object?> callRendererFunction(
    String function,
    Map<String, Object?> args, {
    String? catalogId,
    String? surfaceId,
  }) => {
    'callRendererFunction': {
      'surfaceId': ?surfaceId,
      'functionCallId': 'call_1',
      'callFunction': {
        'catalogId': catalogId ?? basic.id,
        '@call': function,
        'args': args,
      },
    },
  };

  final Map<String, Object?> helloSurface = createSurface([
    {'id': 'root', 'component': 'Text', 'text': 'Hello'},
  ]);

  Matcher throwsError<T extends A2uiError>() => throwsA(isA<T>());

  group('negotiation', () {
    test('activates the catalogs the renderer supports for v1.0', () {
      expect(processor().activeCatalogs, [basic]);
    });

    test('rejects capabilities that declare only another version', () {
      expect(
        () => resolveCatalogs([
          CatalogConfig(basic),
        ], supporting([basic.id], version: A2uiProtocolVersion.v0_9)),
        throwsError<A2uiValidationError>(),
      );
    });

    test('rejects catalogs of different versions without capabilities', () {
      expect(
        () => resolveCatalogs([
          CatalogConfig(basic),
          CatalogConfig(v0_9Basic),
        ], null),
        throwsError<A2uiCatalogError>(),
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

  group('negotiation across versions', () {
    final both = [CatalogConfig(v0_9Basic), CatalogConfig(basic)];

    /// Capabilities declaring [v1Ids] for v1.0 and [v0_9Ids] for v0.9.
    A2uiRendererCapabilities declaring(
      List<String> v1Ids,
      List<String> v0_9Ids,
    ) => A2uiRendererCapabilities(
      versions: {
        v1_0: A2uiVersionCapabilities(supportedCatalogIds: v1Ids),
        A2uiProtocolVersion.v0_9: A2uiVersionCapabilities(
          supportedCatalogIds: v0_9Ids,
        ),
      },
    );

    final v0_9Example = [
      AgentToRendererMessage.fromJson({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 's', 'catalogId': v0_9Basic.id},
      }),
      AgentToRendererMessage.fromJson({
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 's',
          'components': [
            {'id': 'root', 'component': 'Text', 'text': 'Hello'},
          ],
        },
      }),
    ];
    final List<AgentToRendererMessage> v1_0Example = [message(helloSurface)];

    test('uses the latest version both declare', () {
      expect(resolveCatalogs(both, declaring([basic.id], [v0_9Basic.id])), [
        basic,
      ]);
      expect(resolveCatalogs(both, supporting([basic.id])), [basic]);
      expect(
        resolveCatalogs(
          both,
          supporting([v0_9Basic.id], version: A2uiProtocolVersion.v0_9),
        ),
        [v0_9Basic],
      );
    });

    test('falls back to an earlier version with a catalog in common', () {
      expect(
        resolveCatalogs(both, declaring(['renderer/only'], [v0_9Basic.id])),
        [v0_9Basic],
      );
    });

    test('rejects a renderer with no catalog in common in any version', () {
      expect(
        () => resolveCatalogs(both, declaring([v0_9Basic.id], [basic.id])),
        throwsError<A2uiCatalogError>(),
      );
    });

    test('takes a catalog id registered for each version from the one '
        'negotiated', () {
      Map<String, Object?> document(String? version) => {
        'catalogId': 'example/catalog',
        'protocolVersion': ?version,
        'components': <String, Object?>{},
      };
      final CatalogApi v0_9Catalog = Catalog.fromJson(document(null));
      final CatalogApi v1_0Catalog = Catalog.fromJson(document('1.0'));
      final registered = [
        CatalogConfig(v0_9Catalog),
        CatalogConfig(v1_0Catalog),
      ];
      expect(
        resolveCatalogs(
          registered,
          declaring(['example/catalog'], ['example/catalog']),
        ),
        [v1_0Catalog],
      );
      expect(
        resolveCatalogs(
          registered,
          supporting(['example/catalog'], version: A2uiProtocolVersion.v0_9),
        ),
        [v0_9Catalog],
      );
    });

    test('gives a processor the examples of the version it negotiated', () {
      final A2uiRequestProcessor processor =
          A2uiGenerator(
            catalogs: both,
            examples: [v1_0Example, v0_9Example],
          ).createProcessor(
            supporting([v0_9Basic.id], version: A2uiProtocolVersion.v0_9),
          );
      expect(processor.activeCatalogs, [v0_9Basic]);
      expect(processor.examples, [v0_9Example]);
    });

    test('gives a v1.0 processor the v1.0 examples', () {
      final A2uiRequestProcessor processor = A2uiGenerator(
        catalogs: both,
        examples: [v1_0Example, v0_9Example],
      ).createProcessor(declaring([basic.id], [v0_9Basic.id]));
      expect(processor.activeCatalogs, [basic]);
      expect(processor.examples, [v1_0Example]);
    });

    test('rejects an example of a version no catalog targets', () {
      expect(
        () =>
            A2uiGenerator(
              catalogs: [CatalogConfig(v0_9Basic)],
              examples: [v1_0Example],
            ).createProcessor(
              supporting([v0_9Basic.id], version: A2uiProtocolVersion.v0_9),
            ),
        throwsError<A2uiValidationError>(),
      );
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
          throwsError<A2uiCatalogError>(),
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

    test('reads a createSurface carrying its components', () {
      final List<ResponsePart> parts = processor().parseResponse(
        jsonBlock([helloSurface]),
      );
      final create =
          (parts.single as A2uiPart).a2ui.single as CreateSurfaceMessage;
      expect(create.version, 'v1.0');
      expect(create.components!.single['component'], 'Text');
    });

    test('reads a component naming its catalog', () {
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

    test('reads a callRendererFunction', () {
      final List<ResponsePart> parts = processor(catalogs: [callable])
          .parseResponse(
            jsonBlock([
              callRendererFunction('formatString', {'value': 'Hello'}),
            ]),
          );
      expect(
        (parts.single as A2uiPart).a2ui.single,
        isA<CallRendererFunctionMessage>(),
      );
    });

    test('rejects a call to a function the catalog does not declare', () {
      expect(
        () => processor().parseResponse(
          jsonBlock([callRendererFunction('vibrate', {})]),
        ),
        throwsError<A2uiValidationError>(),
      );
    });

    test('rejects a call whose arguments do not match the function', () {
      expect(
        () => processor(catalogs: [callable]).parseResponse(
          jsonBlock([
            callRendererFunction('formatString', {'text': 'Hello'}),
          ]),
        ),
        throwsError<A2uiValidationError>(),
      );
    });

    test('rejects a call only the renderer may make, in parseResponse and as '
        'it streams', () {
      final String block = jsonBlock([
        callRendererFunction('formatString', {'value': 'Hello'}),
      ]);
      Parser parser() =>
          const DirectJsonFormatFactory().createFormat([basic]).createParser();
      final Matcher rendererOnly = throwsA(
        isA<A2uiValidationError>().having(
          (e) => e.message,
          'message',
          contains('rendererOnly'),
        ),
      );
      expect(() => parser().parseResponse(block), rendererOnly);
      expect(() => processor().parseResponse(block), rendererOnly);
      // The call has closed, but it is never emitted, and the block fails
      // when it closes.
      final ResponseStream stream = parser().openStream();
      expect(
        stream
            .feed(block.substring(0, block.lastIndexOf(']')))
            .whereType<A2uiPart>(),
        isEmpty,
      );
      expect(
        () => stream.feed(block.substring(block.lastIndexOf(']'))),
        rendererOnly,
      );
    });

    test('rejects a component the catalog does not declare', () {
      expect(
        () => processor().parseResponse(
          jsonBlock([
            createSurface([
              {'id': 'root', 'component': 'Marquee', 'text': 'Hello'},
            ]),
          ]),
        ),
        throwsError<A2uiValidationError>(),
      );
    });

    test('streams a component once its object closes', () {
      // v1.0 holds components back whatever the format is given.
      final ResponseStream stream = const DirectJsonFormatFactory()
          .createFormat([basic])
          .createParser()
          .openStream();
      final String response = jsonBlock([helloSurface]);
      final int cut = response.indexOf('Hello');
      expect(stream.feed(response.substring(0, cut)), isEmpty);
      final List<ResponsePart> parts = stream.feed(response.substring(cut));
      expect(parts.whereType<A2uiPart>(), isNotEmpty);
    });

    test('streams a createSurface once, after its object closes', () {
      final ResponseStream stream = const DirectJsonFormatFactory(
        progressiveKeys: {'text'},
      ).createFormat([basic]).createParser().openStream();
      final String response = jsonBlock([
        helloSurface,
        {
          'deleteSurface': {'surfaceId': 's'},
        },
      ]);
      final int closed = response.indexOf('}]}}') + 4;
      expect(stream.feed(response.substring(0, closed - 1)), isEmpty);
      final List<ResponsePart> parts = stream.feed(
        response.substring(closed - 1),
      );
      expect(
        [for (final A2uiPart p in parts.whereType<A2uiPart>()) ...p.a2ui],
        [isA<CreateSurfaceMessage>(), isA<DeleteSurfaceMessage>()],
      );
    });

    test('streams a callRendererFunction once, after its object closes', () {
      final ResponseStream stream = const DirectJsonFormatFactory()
          .createFormat([callable])
          .createParser()
          .openStream();
      // The surface id comes last, so the call reads before it arrives.
      final String response = jsonBlock([
        helloSurface,
        {
          'callRendererFunction': {
            'functionCallId': 'call_1',
            'callFunction': {
              'catalogId': basic.id,
              '@call': 'formatString',
              'args': {'value': 'Hello'},
            },
            'surfaceId': 's',
          },
        },
      ]);
      final int cut = response.lastIndexOf(',"surfaceId"');
      final List<AgentToRendererMessage> messages = [
        for (final String chunk in [
          response.substring(0, cut),
          response.substring(cut),
        ])
          for (final A2uiPart part in stream.feed(chunk).whereType<A2uiPart>())
            ...part.a2ui,
      ];
      expect(
        messages.whereType<CallRendererFunctionMessage>().map(
          (CallRendererFunctionMessage m) => m.surfaceId,
        ),
        ['s'],
      );
    });

    test('raises on the chunk that closes an invalid component', () {
      final ResponseStream stream = const DirectJsonFormatFactory()
          .createFormat([basic])
          .createParser()
          .openStream();
      stream.feed(
        '<a2ui-json>[{"version": "v1.0", "createSurface": {"surfaceId": "s", '
        '"catalogId": "${basic.id}"}}, {"version": "v1.0", '
        '"updateComponents": {"surfaceId": "s", "components": [',
      );
      expect(
        () => stream.feed(
          '{"id": "root", "component": "Marquee", "text": "Hello"}',
        ),
        throwsError<A2uiValidationError>(),
      );
    });

    group('raises on the chunk whose component', () {
      ResponseStream streaming() {
        final ResponseStream stream = const DirectJsonFormatFactory()
            .createFormat([basic])
            .createParser()
            .openStream();
        stream.feed(
          '<a2ui-json>[{"version": "v1.0", "createSurface": {"surfaceId": '
          '"s", "catalogId": "${basic.id}"}}, {"version": "v1.0", '
          '"updateComponents": {"surfaceId": "s", "components": [',
        );
        return stream;
      }

      test('repeats an id an earlier chunk gave', () {
        final ResponseStream stream = streaming();
        expect(
          stream.feed('{"id": "root", "component": "Text", "text": "A"}, '),
          [isA<A2uiPart>()],
        );
        expect(
          () => stream.feed('{"id": "root", "component": "Text", "text": "B"}'),
          throwsA(
            isA<A2uiIntegrityError>().having(
              (e) => e.message,
              'message',
              contains('Duplicate component ID: root'),
            ),
          ),
        );
      });

      test('closes a cycle with a component an earlier chunk gave', () {
        final ResponseStream stream = streaming();
        expect(
          stream.feed(
            '{"id": "root", "component": "Column", "children": ["a"]}, ',
          ),
          [isA<A2uiPart>()],
        );
        expect(
          () => stream.feed(
            '{"id": "a", "component": "Column", "children": ["root"]}',
          ),
          throwsA(
            isA<A2uiIntegrityError>().having(
              (e) => e.message,
              'message',
              contains('Circular reference'),
            ),
          ),
        );
      });
    });
  });

  group('direct JSON across catalogs', () {
    Parser parser() => const DirectJsonFormatFactory().createFormat([
      callable,
      custom,
    ]).createParser();

    List<AgentToRendererMessage> compile(List<Map<String, Object?>> bodies) {
      final List<AgentToRendererMessage> messages = parser().compile(
        jsonEncode([
          for (final body in bodies) {'version': 'v1.0', ...body},
        ]),
      );
      validatePayload([callable, custom], messages);
      return messages;
    }

    test('checks a component against the catalog it names', () {
      compile([
        createSurface([
          {
            'id': 'root',
            'component': 'Gauge',
            'catalogId': custom.id,
            'value': 1,
          },
        ]),
      ]);
      expect(
        () => compile([
          createSurface([
            {'id': 'root', 'component': 'Gauge', 'value': 1},
          ]),
        ]),
        throwsError<A2uiValidationError>(),
      );
    });

    test('checks a function call against the catalog it names', () {
      Map<String, Object?> surface(Object? value) => createSurface([
        {
          'id': 'root',
          'component': 'Text',
          'text': {
            '@call': 'percent',
            'catalogId': custom.id,
            'args': {'value': value},
          },
        },
      ]);
      compile([surface(75)]);
      expect(
        () => compile([surface('most')]),
        throwsError<A2uiValidationError>(),
      );
    });

    test('rejects a component naming no catalog on a surface that names '
        'none', () {
      expect(
        () => compile([
          createSurface([
            {'id': 'root', 'component': 'Gauge', 'value': 1},
          ], namesCatalog: false),
        ]),
        throwsError<A2uiValidationError>(),
      );
    });

    test('rejects a component naming a catalog that is not active', () {
      expect(
        () => compile([
          createSurface([
            {
              'id': 'root',
              'component': 'Gauge',
              'catalogId': 'https://example.com/elsewhere.json',
              'value': 1,
            },
          ]),
        ]),
        throwsError<A2uiValidationError>(),
      );
    });

    test('checks a component of a surface an earlier response created '
        'against the first catalog declaring it', () {
      Map<String, Object?> update(String type) => {
        'updateComponents': {
          'surfaceId': 'earlier',
          'components': [
            {'id': 'gauge', 'component': type, 'value': 1},
          ],
        },
      };
      compile([update('Gauge')]);
      expect(
        () => compile([update('Marquee')]),
        throwsError<A2uiValidationError>(),
      );
    });

    test('rejects a renderer call naming a catalog that is not active', () {
      expect(
        () => compile([
          callRendererFunction('percent', {
            'value': 1,
          }, catalogId: 'https://example.com/elsewhere.json'),
        ]),
        throwsError<A2uiValidationError>(),
      );
    });

    test('checks a call nested in a renderer call against the catalog it '
        'names', () {
      Map<String, Object?> nesting(Map<String, Object?> args) =>
          callRendererFunction('formatString', {
            'value': {'@call': 'percent', 'catalogId': custom.id, 'args': args},
          });
      compile([
        nesting({'value': 1}),
      ]);
      expect(
        () => compile([
          nesting({'text': 'x'}),
        ]),
        throwsError<A2uiValidationError>(),
      );
    });

    test('rejects a renderer call with a field a function call does not '
        'have', () {
      expect(
        () => compile([
          {
            'callRendererFunction': {
              'functionCallId': 'call_1',
              'callFunction': {
                'catalogId': custom.id,
                '@call': 'percent',
                'args': {'value': 1},
                'unknown': 1,
              },
            },
          },
        ]),
        throwsError<A2uiValidationError>(),
      );
    });
  });

  group('Express', () {
    A2uiRequestProcessor express({
      List<List<AgentToRendererMessage>> examples = const [],
      List<CatalogApi>? catalogs,
      List<String>? allowedMessages,
    }) => processor(
      format: ExpressFormatFactory(allowedMessages: allowedMessages),
      examples: examples,
      catalogs: catalogs,
    );

    /// The messages [block] compiles to against [catalogs], as JSON.
    List<Map<String, Object?>> compile(
      String block, [
      List<CatalogApi>? catalogs,
    ]) => json(ExpressCompiler(catalogs ?? [callable]).compile(block));

    test('teaches the catalog', () {
      expect(express().promptSnippet, contains('Text('));
    });

    test('compiles a surface into one createSurface carrying its '
        'components', () {
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
    });

    test('compiles initial data into the createSurface', () {
      expect(
        compile(
          r'$/title = "Hi"'
          '\nroot = Text(\$/title)',
        ),
        [
          {
            'version': 'v1.0',
            'createSurface': {
              'surfaceId': 'default_surface',
              'catalogId': basic.id,
              'sendDataModel': false,
              'components': [
                {
                  'id': 'root',
                  'component': 'Text',
                  'text': {'@path': '/title'},
                },
              ],
              'dataModel': {'title': 'Hi'},
            },
          },
        ],
      );
    });

    test('compiles components without a root into an update', () {
      expect(
        compile(
          r'title = Text("Hi")'
          '\n\$/count = 2',
        ),
        [
          {
            'version': 'v1.0',
            'updateComponents': {
              'surfaceId': 'default_surface',
              'components': [
                {'id': 'title', 'component': 'Text', 'text': 'Hi'},
              ],
            },
          },
          {
            'version': 'v1.0',
            'updateDataModel': {
              'surfaceId': 'default_surface',
              'path': '/',
              'value': {'count': 2},
            },
          },
        ],
      );
    });

    test('writes function calls and checks with @call', () {
      final List<Map<String, Object?>> messages = compile(
        r'root = TextField(formatString("Name"), $/name, _, _, _, '
        '[?required("Needed")])',
      );
      final component =
          ((messages.single['createSurface']! as Map)['components']! as List)
                  .single
              as Map<String, Object?>;
      expect(component['label'], {
        '@call': 'formatString',
        'args': {'value': 'Name'},
      });
      expect(component['checks'], [
        {
          'condition': {
            '@call': 'required',
            'args': {
              'value': {'@path': '/name'},
            },
          },
          'message': 'Needed',
        },
      ]);
    });

    test('compiles a standalone function call into a callRendererFunction', () {
      final List<ResponsePart> parts = express(
        catalogs: [callable],
      ).parseResponse('<a2ui>\nformatString("Hello")\n</a2ui>');
      expect(
        (parts.single as A2uiPart).a2ui.single,
        isA<CallRendererFunctionMessage>(),
      );
    });

    test('rejects a standalone call only the renderer may make', () {
      expect(
        () => const ExpressFormatFactory()
            .createFormat([basic])
            .createParser()
            .compile('formatString("Hello")'),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('rendererOnly'),
          ),
        ),
      );
    });

    test('numbers standalone calls, unless one names its id', () {
      expect(
        compile(
          'formatString("One")\n'
          'formatString("Two", functionCallId="second")\n'
          'formatString("Three")',
        ).map((m) => (m['callRendererFunction']! as Map)['functionCallId']),
        ['call_1', 'second', 'call_3'],
      );
    });

    test('lets a call before any surface line name a variable of the '
        'default surface', () {
      final List<Map<String, Object?>> messages = compile(
        'formatString(greeting)\n'
        'greeting = "Hello"\n'
        'root = Text(greeting)',
      );
      expect(messages, hasLength(2));
      expect(
        ((messages.first['callRendererFunction']! as Map)['callFunction']!
            as Map)['args'],
        {'value': 'Hello'},
      );
      expect(
        (messages.last['createSurface']! as Map)['surfaceId'],
        'default_surface',
      );
    });

    test('rejects a component or an Event written on its own', () {
      expect(
        () => compile('Text("Hello")'),
        throwsError<A2uiValidationError>(),
      );
      expect(
        () => compile('Event("submit")'),
        throwsError<A2uiValidationError>(),
      );
    });

    test('writes an example in Express', () {
      expect(
        express(
          examples: [
            [message(helloSurface)],
          ],
        ).promptSnippet,
        contains('root = Text("Hello")'),
      );
    });

    test('decompiles an empty createSurface with the update that fills it', () {
      final parser = ExpressParser([basic]);
      final String block = parser.decompile([
        message({
          'createSurface': {'surfaceId': 's', 'catalogId': basic.id},
        }),
        message({
          'updateComponents': {
            'surfaceId': 's',
            'components': [
              {'id': 'root', 'component': 'Text', 'text': 'Hello'},
            ],
          },
        }),
      ]);
      expect(block, 'surface("s")\nroot = Text("Hello")');
      expect(json(parser.compile(block)), json([message(helloSurface)]));
    });

    test('decompiles a renderer call into a standalone call and back', () {
      final parser = ExpressParser([callable]);
      final List<AgentToRendererMessage> messages = [
        message({
          'callRendererFunction': {
            'functionCallId': 'refresh',
            'callFunction': {
              'catalogId': basic.id,
              '@call': 'formatString',
              'args': {'value': 'Hello'},
            },
          },
        }),
      ];
      final String block = parser.decompile(messages);
      expect(block, 'formatString("Hello", functionCallId="refresh")');
      expect(json(parser.compile(block)), json(messages));
    });

    test('rejects two renderer calls with the same id', () {
      expect(
        () => ExpressParser([callable]).compile(
          'formatString("One")\n'
          'formatString("Two", functionCallId="call_1")',
        ),
        throwsError<A2uiValidationError>(),
      );
    });

    test('decompiles a renderer call without arguments', () {
      final CatalogApi refreshing = Catalog.fromJson({
        'catalogId': 'https://example.com/refresh.json',
        'protocolVersion': '1.0',
        'components': {'Text': (basicDocument['components']! as Map)['Text']},
        'functions': {
          'refresh': {
            'type': 'object',
            'returnType': 'void',
            'allowedCallers': 'agentOnly',
            'properties': {
              '@call': {'const': 'refresh'},
              'args': {'type': 'object', 'unevaluatedProperties': false},
            },
            'required': ['@call'],
          },
        },
      });
      final parser = ExpressParser([refreshing]);
      final String block = parser.decompile([
        message({
          'callRendererFunction': {
            'functionCallId': 'call_1',
            'callFunction': {'catalogId': refreshing.id, '@call': 'refresh'},
          },
        }),
      ]);
      expect(block, 'refresh()');
      expect(parser.compile(block), [isA<CallRendererFunctionMessage>()]);
    });

    test('has no notation for a renderer call on a surface, a response to '
        "the renderer's call, or surface metadata", () {
      final decompiler = ExpressDecompiler([basic]);
      for (final Map<String, Object?> body in [
        callRendererFunction('formatString', {'value': 'Hi'}, surfaceId: 's'),
        {
          'agentFunctionResponse': {'functionCallId': 'call_1', 'value': 1},
        },
        {
          'createSurface': {
            ...helloSurface['createSurface']! as Map<String, Object?>,
            'metadata': {
              'extensions': {'theme': 'dark'},
            },
          },
        },
      ]) {
        expect(
          () => decompiler.decompile([message(body)]),
          throwsError<A2uiValidationError>(),
          reason: '$body',
        );
      }
    });

    test('teaches the functions the agent may call on their own', () {
      final String snippet = express(catalogs: [callable]).promptSnippet;
      expect(snippet, contains('To have the renderer run a function'));
      expect(
        snippet,
        contains(
          'Only these functions can be called this way: '
          '`formatString`.',
        ),
      );
      // The published catalog lets the agent call none of its functions.
      expect(
        express().promptSnippet,
        isNot(contains('To have the renderer run a function')),
      );
      expect(
        express(
          catalogs: [callable],
          allowedMessages: ['createSurface', 'updateComponents'],
        ).promptSnippet,
        isNot(contains('To have the renderer run a function')),
      );
    });

    test('carries the catalog instructions, with their examples in '
        'Express', () {
      final String snippet = express().promptSnippet;
      expect(snippet, contains('## Catalog Instructions'));
      expect(snippet, contains('## Catalog Guidelines'));
      expect(snippet, contains('root = Column([repField, valueField])'));
      expect(snippet, isNot(contains('"createSurface"')));
    });
  });

  group('Express across catalogs', () {
    final both = [basic, custom];

    List<Map<String, Object?>> compile(String block) =>
        json(ExpressCompiler(both).compile(block));

    /// The components of the one surface [block] creates.
    List<Object?> components(String block) =>
        (compile(block).single['createSurface']! as Map)['components']! as List;

    test('names no catalog on the surface and each on its items', () {
      final create =
          compile('root = Column([Gauge(50)])').single['createSurface']!
              as Map<String, Object?>;
      expect(create.containsKey('catalogId'), isFalse);
      expect(create['components'], [
        {
          'id': 'root',
          'component': 'Column',
          'catalogId': basic.id,
          'children': ['root_children_0'],
        },
        {
          'id': 'root_children_0',
          'component': 'Gauge',
          'catalogId': custom.id,
          'value': 50,
        },
      ]);
      expect(
        (components(
              'root = Text(formatString("Hi"), catalogId="${basic.id}")',
            ).single
            as Map)['text'],
        {
          '@call': 'formatString',
          'catalogId': basic.id,
          'args': {'value': 'Hi'},
        },
      );
    });

    test('needs a catalogId for a name several catalogs declare', () {
      expect(
        () => compile('root = Text("Hi")'),
        throwsError<A2uiValidationError>(),
      );
      expect(
        (components('root = Text("Hi", catalogId="${custom.id}")').single
            as Map)['catalogId'],
        custom.id,
      );
    });

    test('names the catalog of a check whose function several catalogs '
        'declare', () {
      const field = r'root = TextField("Name", $/name, catalogId="';
      expect(
        () => compile('$field${basic.id}", [?required])'),
        throwsError<A2uiValidationError>(),
      );
      final component =
          components(
                '$field${basic.id}", [?required({catalogId: "${basic.id}"})])',
              ).single
              as Map;
      expect(((component['checks']! as List).single as Map)['condition'], {
        '@call': 'required',
        'catalogId': basic.id,
        'args': {
          'value': {'@path': '/name'},
        },
      });
    });

    test('rejects a check whose catalogId is not a string literal', () {
      const field = r'root = TextField("Name", $/name, catalogId="';
      expect(
        () => compile('$field${basic.id}", [?required({catalogId: 3})])'),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("Argument 'catalogId' of ?required(...)"),
          ),
        ),
      );
    });

    test('rejects a surface line naming a catalog, and an Event naming '
        'one', () {
      expect(
        () => compile('surface("s", "${basic.id}")\nroot = Gauge(1)'),
        throwsError<A2uiValidationError>(),
      );
      expect(
        () => compile(
          'root = Button(label, Event("go", catalogId="${basic.id}"))\n'
          'label = Gauge(1)',
        ),
        throwsError<A2uiValidationError>(),
      );
    });

    test('decompiles a name several catalogs declare with its catalog', () {
      final List<AgentToRendererMessage> messages = [
        message({
          'createSurface': {
            'surfaceId': 's',
            'components': [
              {
                'id': 'root',
                'component': 'Column',
                'catalogId': basic.id,
                'children': ['name', 'gauge'],
              },
              {
                'id': 'name',
                'component': 'TextField',
                'catalogId': basic.id,
                'label': 'Name',
                'value': {'@path': '/name'},
                'checks': [
                  {
                    'condition': {
                      '@call': 'required',
                      'catalogId': basic.id,
                      'args': {
                        'value': {'@path': '/name'},
                      },
                    },
                    'message': 'Needed',
                  },
                ],
              },
              {
                'id': 'gauge',
                'component': 'Gauge',
                'catalogId': custom.id,
                'value': 1,
              },
            ],
          },
        }),
      ];
      final parser = ExpressParser(both);
      final String block = parser.decompile(messages);
      expect(block, contains('gauge = Gauge(1)'));
      expect(
        block,
        contains('?required("Needed", {catalogId: "${basic.id}"})'),
      );
      expect(json(parser.compile(block)), json(messages));
    });

    test('decompiles a call to a function another catalog names a component '
        'with its catalog', () {
      final CatalogApi labels = Catalog.fromJson({
        'catalogId': 'https://example.com/labels.json',
        'protocolVersion': '1.0',
        'components': {
          'percent': {
            'type': 'object',
            'properties': {
              'component': {'const': 'percent'},
              'text': {'type': 'string'},
            },
            'required': ['component', 'text'],
          },
        },
      });
      final List<AgentToRendererMessage> messages = [
        message({
          'createSurface': {
            'surfaceId': 's',
            'components': [
              {
                'id': 'root',
                'component': 'Text',
                'catalogId': basic.id,
                'text': {
                  '@call': 'percent',
                  'catalogId': custom.id,
                  'args': {'value': 1},
                },
              },
            ],
          },
        }),
      ];
      final parser = ExpressParser([basic, custom, labels]);
      final String block = parser.decompile(messages);
      expect(block, contains('percent(1, catalogId="${custom.id}")'));
      expect(json(parser.compile(block)), json(messages));
    });

    test('rejects a call that names no catalog on a surface that names '
        'none', () {
      expect(
        () => ExpressDecompiler(both).decompile([
          message({
            'createSurface': {
              'surfaceId': 's',
              'components': [
                {
                  'id': 'root',
                  'component': 'Text',
                  'catalogId': basic.id,
                  'text': {
                    '@call': 'formatString',
                    'args': {'value': 'Hi'},
                  },
                },
              ],
            },
          }),
        ]),
        throwsError<A2uiValidationError>(),
      );
    });

    test('teaches how an item names its catalog, and which names need it', () {
      final String snippet = ExpressFormat(both).promptGenerator.generate();
      expect(snippet, contains('A surface names no catalog'));
      expect(snippet, contains('catalogId="${custom.id}"'));
      expect(
        snippet,
        contains('- Component `Text`: `${basic.id}`, `${custom.id}`'),
      );
      expect(
        snippet,
        contains('- Function `required`: `${basic.id}`, `${custom.id}`'),
      );
      expect(
        snippet,
        contains(
          'Only these functions can be called this way: '
          '`percent`.',
        ),
      );
    });
  });

  group('A2uiRequestProcessor', () {
    test('checks each example when it is created', () {
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
        throwsError<A2uiValidationError>(),
      );
    });

    test('rejects an example naming a catalog that is not active', () {
      for (final Map<String, Object?> body in [
        createSurface([
          {
            'id': 'root',
            'component': 'Text',
            'catalogId': 'https://example.com/elsewhere.json',
            'text': 'Hello',
          },
        ]),
        createSurface([
          {
            'id': 'root',
            'component': 'Text',
            'text': {
              '@call': 'formatString',
              'catalogId': 'https://example.com/elsewhere.json',
              'args': {'value': 'Hello'},
            },
          },
        ]),
        callRendererFunction('formatString', {
          'value': 'Hello',
        }, catalogId: 'https://example.com/elsewhere.json'),
      ]) {
        expect(
          () => processor(
            examples: [
              [message(body)],
            ],
          ),
          throwsError<A2uiValidationError>(),
          reason: '$body',
        );
      }
    });

    test(
      'rejects a surface with a component nothing reaches from its root',
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
          throwsError<A2uiError>(),
        );
      },
    );

    test('reads no calls in component metadata', () {
      processor().parseResponse(
        jsonBlock([
          createSurface([
            {
              'id': 'root',
              'component': 'Text',
              'text': 'Hello',
              'metadata': {
                'extensions': {
                  'tracking': {'@call': 'track', 'catalogId': 'vendor'},
                },
              },
            },
          ]),
        ]),
      );
    });

    test('rejects a renderer call on a surface the response does not '
        'create', () {
      expect(
        () => processor(catalogs: [callable]).parseResponse(
          jsonBlock([
            callRendererFunction('formatString', {
              'value': 'Hello',
            }, surfaceId: 'missing'),
          ]),
        ),
        throwsError<A2uiValidationError>(),
      );
      processor(catalogs: [callable]).parseResponse(
        jsonBlock([
          helloSurface,
          callRendererFunction('formatString', {
            'value': {'@path': '/name'},
          }, surfaceId: 's'),
        ]),
      );
    });
  });
}
