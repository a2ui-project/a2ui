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

/// Direct JSON prompting and parsing against the published v0.9 basic
/// catalog.
///
/// The rules shared by every SDK are covered by the conformance suites, run
/// by `conformance/direct_json_conformance_test.dart`. The cases here cover
/// what those suites do not: the v0.9 message shapes and catalog, decisions
/// of this SDK, and errors.
void main() {
  final SchemaCatalog basic = Catalog.fromJson(
    jsonDecode(
          File(
            '../../specification/v0_9/catalogs/basic/catalog.json',
          ).readAsStringSync(),
        )
        as Map<String, Object?>,
  );
  final SchemaCatalog custom = Catalog.fromJson({
    'catalogId': 'https://example.com/custom.json',
    'components': {
      'Gauge': {
        'type': 'object',
        'properties': {
          'component': {'const': 'Gauge'},
          'value': {'type': 'number'},
        },
        'required': ['component', 'value'],
      },
    },
  });

  DirectJsonParser parser({Set<String> progressiveKeys = const {}}) =>
      DirectJsonParser([basic, custom], progressiveKeys: progressiveKeys);

  /// The messages one payload compiles to, as JSON.
  List<Map<String, Object?>> compile(String payload) => [
    for (final AgentToRendererMessage m in parser().compile(payload))
      m.toJson(),
  ];

  String create(String surfaceId, [String? catalogId]) => jsonEncode({
    'version': 'v0.9',
    'createSurface': {
      'surfaceId': surfaceId,
      'catalogId': catalogId ?? basic.id,
    },
  });

  String update(String surfaceId, List<Map<String, Object?>> components) =>
      jsonEncode({
        'version': 'v0.9',
        'updateComponents': {'surfaceId': surfaceId, 'components': components},
      });

  /// The JSON of the message [create] writes, as the parser returns it.
  Map<String, Object?> created(String surfaceId) => {
    'version': 'v0.9',
    'createSurface': {
      'surfaceId': surfaceId,
      'catalogId': basic.id,
      'sendDataModel': false,
    },
  };

  Matcher throwsError<T extends A2uiError>() => throwsA(isA<T>());

  group('compile', () {
    test('keeps a curly quote inside a string of valid JSON', () {
      final List<Map<String, Object?>> messages = compile(
        '[${update('s', [
          {'id': 'root', 'component': 'Text', 'text': 'She said “hi”'},
        ])}]',
      );
      final components =
          (messages.single['updateComponents']! as Map)['components']! as List;
      expect((components.single as Map)['text'], 'She said “hi”');
    });

    test('reads a raw line break inside a string', () {
      final List<Map<String, Object?>> messages = compile(
        '[{"version": "v0.9", "updateComponents": {"surfaceId": "s", '
        '"components": [{"id": "root", "component": "Text", '
        '"text": "Line 1\nLine 2"}]}}]',
      );
      expect(jsonEncode(messages), contains(r'Line 1\nLine 2'));
    });

    test('removes a markdown fence around an unwrapped payload', () {
      expect(
        compile('```json\n[${create('s')}]\n```').single['createSurface'],
        {'surfaceId': 's', 'catalogId': basic.id, 'sendDataModel': false},
      );
    });

    test('checks a component against the catalog its surface names', () {
      expect(
        () => compile(
          '[${create('g', custom.id)}, ${update('g', [
            {'id': 'root', 'component': 'Text', 'text': 'x'},
          ])}]',
        ),
        throwsError<A2uiValidationError>(),
      );
      expect(
        compile(
          '[${create('g', custom.id)}, ${update('g', [
            {'id': 'root', 'component': 'Gauge', 'value': 0.5},
          ])}]',
        ),
        hasLength(2),
      );
    });

    test('checks an update of an earlier surface against the catalog '
        'declaring its components', () {
      expect(
        compile(
          '[${update('g', [
            {'id': 'root', 'component': 'Gauge', 'value': 0.5},
          ])}]',
        ),
        hasLength(1),
      );
    });

    final Map<String, String> rejected = {
      'a property the component does not declare': update('s', [
        {'id': 'root', 'component': 'Text', 'text': 'x', 'color': 'red'},
      ]),
      'a function the catalog does not declare': update('s', [
        {
          'id': 'root',
          'component': 'Text',
          'text': {
            'call': 'shout',
            'args': {'value': 'x'},
          },
        },
      ]),
      'arguments a function does not take': update('s', [
        {
          'id': 'root',
          'component': 'Text',
          'text': {
            'call': 'formatString',
            'args': {'value': 'x', 'loud': true},
          },
        },
      ]),
      'function arguments that are not an object': update('s', [
        {
          'id': 'root',
          'component': 'Text',
          'text': {'call': 'formatString', 'args': 'x'},
        },
      ]),
      'a check calling an unknown function': update('s', [
        {
          'id': 'root',
          'component': 'TextField',
          'label': 'Email',
          'checks': [
            {
              'condition': {
                'call': 'isEmail',
                'args': {'value': 'x'},
              },
              'message': 'Bad email',
            },
          ],
        },
      ]),
      'a surface naming an inactive catalog': create(
        's',
        'https://example.com/other.json',
      ),
      'a theme the catalog does not allow': jsonEncode({
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 's',
          'catalogId': basic.id,
          'theme': {'primaryColor': 'red'},
        },
      }),
      'a field the envelope does not declare': jsonEncode({
        'version': 'v0.9',
        'deleteSurface': {'surfaceId': 's'},
        'note': 'x',
      }),
      'a field the message does not declare': jsonEncode({
        'version': 'v0.9',
        'deleteSurface': {'surfaceId': 's', 'force': true},
      }),
      'an update without components': update('s', []),
      'a message that is not an object': '"deleteSurface"',
      'two message types in one message': jsonEncode({
        'version': 'v0.9',
        'deleteSurface': {'surfaceId': 's'},
        'createSurface': {'surfaceId': 's', 'catalogId': basic.id},
      }),
    };
    for (final MapEntry<String, String> entry in rejected.entries) {
      test('rejects ${entry.key}', () {
        expect(
          () => compile('[${entry.value}]'),
          throwsError<A2uiValidationError>(),
        );
      });
    }

    test('rejects a payload that is not JSON with a parse error', () {
      for (final payload in ['[{"version": "v0.9",', '{} {}', '[1, 2,, 3]']) {
        expect(() => compile(payload), throwsError<A2uiParseError>());
      }
    });

    test('rejects a payload without catalogs', () {
      expect(
        () => DirectJsonParser([]).compile('[${create('s')}]'),
        throwsError<A2uiCatalogError>(),
      );
    });
  });

  group('decompile', () {
    test('writes one message per line, and an empty payload as []', () {
      final List<AgentToRendererMessage> messages = parser().compile(
        '[${create('s')}, {"version": "v0.9", "deleteSurface": '
        '{"surfaceId": "s"}}]',
      );
      final String written = parser().decompile(messages);
      expect(written.split('\n'), hasLength(4));
      expect(
        parser().compile(written).map((m) => m.toJson()),
        messages.map((m) => m.toJson()),
      );
      expect(parser().decompile(const []), '[]');
    });
  });

  group('unwrap', () {
    test('rejects an Express payload', () {
      expect(
        () => parser().unwrap('<a2ui>root = Text("x")</a2ui>'),
        throwsError<A2uiParseError>(),
      );
      expect(
        () => parser().parseResponse('Here: <a2ui>\nroot = Text("x")'),
        throwsError<A2uiParseError>(),
      );
    });

    test('finds an open block, and a closed one when asked', () {
      const open = 'Here: <a2ui-json>[{"version": "v0.9"';
      expect(parser().hasFormatContent(open), isTrue);
      expect(parser().hasFormatContent(open, complete: true), isFalse);
      expect(
        parser().hasFormatContent('$open}]</a2ui-json>', complete: true),
        isTrue,
      );
      expect(parser().hasFormatContent('No tags'), isFalse);
    });

    test('does not take a close tag in a string as the end of a block', () {
      expect(
        parser().hasFormatContent(
          '<a2ui-json>[{"text": "</a2ui-json>"',
          complete: true,
        ),
        isFalse,
      );
    });
  });

  group('parseChunk', () {
    List<List<Object?>> stream(
      List<String> chunks, {
      Set<String> progressiveKeys = const {},
      bool wrapped = true,
    }) {
      final DirectJsonParser reader = parser(progressiveKeys: progressiveKeys);
      return [
        for (final String chunk in chunks)
          [
            for (final ResponsePart part in reader.parseChunk(
              chunk,
              wrapped: wrapped,
            ))
              switch (part) {
                TextPart(:final String text) => text,
                A2uiPart(:final List<AgentToRendererMessage> a2ui) => [
                  for (final AgentToRendererMessage m in a2ui) m.toJson(),
                ],
              },
          ],
      ];
    }

    test('holds an open tag with attributes until it closes', () {
      expect(
        stream([
          'Here <a2ui-json version=',
          '"v0.9">[${create('s')}]</a2ui-json>',
        ]),
        [
          ['Here'],
          [
            [created('s')],
          ],
        ],
      );
    });

    test('emits the whitespace inside a run, and drops it before a tag', () {
      expect(stream(['One  ', ' two ', '<a2ui-json>']), [
        ['One'],
        ['   two'],
        <Object?>[],
      ]);
    });

    test('drops an escape that is cut short in a healed string', () {
      final List<List<Object?>> steps = stream(
        [
          '<a2ui-json>[{"version": "v0.9", "updateComponents": {"surfaceId": '
              r'"s", "components": [{"id": "root", "component": "Text", '
              r'"text": "Tab\',
          r't\u00',
          r'e9"}]}}]</a2ui-json>',
        ],
        progressiveKeys: {'text'},
      );
      String textOf(List<Object?> step) =>
          (((((step.single! as List).single! as Map)['updateComponents']!
                              as Map)['components']!
                          as List)
                      .single
                  as Map)['text']!
              as String;
      expect(textOf(steps[0]), 'Tab');
      expect(textOf(steps[1]), 'Tab\t');
      expect(textOf(steps[2]), 'Tab\té');
    });

    test('reads a block wrapped in a markdown fence', () {
      expect(
        stream(['<a2ui-json>\n``', '`json\n[${create('s')}]\n```</a2ui-json>']),
        [
          <Object?>[],
          [
            [created('s')],
          ],
        ],
      );
    });

    test('checks a streamed component against the catalog its surface '
        'names', () {
      final List<List<Object?>> steps = stream([
        '<a2ui-json>[${create('g', custom.id)}, ',
        update('g', [
          {'id': 'root', 'component': 'Gauge', 'value': 0.5},
        ]),
      ]);
      expect(steps[0], hasLength(1));
      expect(steps[1], hasLength(1));
    });

    test('rejects an Express payload in the stream', () {
      final DirectJsonParser reader = parser();
      expect(reader.parseChunk('Here <a2ui'), [
        isA<TextPart>().having((p) => p.text, 'text', 'Here'),
      ]);
      expect(
        () => reader.parseChunk('>root = Text("x")'),
        throwsError<A2uiParseError>(),
      );
    });

    test('rejects a change of wrapped between chunks', () {
      final DirectJsonParser reader = parser()..parseChunk('Hello');
      expect(
        () => reader.parseChunk('[', wrapped: false),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('gives each parser from a format its own stream', () {
      final InferenceFormat format = const DirectJsonFormatFactory()
          .createFormat([basic]);
      final Parser first = format.createParser();
      expect(first.supportsStreaming, isTrue);
      first.parseChunk('<a2ui-json>[');
      expect(format.createParser().parseChunk('Hello'), [isA<TextPart>()]);
    });
  });

  group('promptSnippet', () {
    String snippet({
      List<SchemaCatalog>? catalogs,
      List<String>? allowedMessages,
      List<List<AgentToRendererMessage>> examples = const [],
    }) => DirectJsonFormatFactory(allowedMessages: allowedMessages)
        .createFormat(catalogs ?? [basic], examples: examples)
        .promptGenerator
        .generate();

    test('embeds the published v0.9 message schema', () {
      final Object? published = jsonDecode(
        File(
          '../../specification/v0_9/json/server_to_client.json',
        ).readAsStringSync(),
      );
      expect(
        snippet(),
        contains(jsonEncode(published)),
        reason:
            'lib/src/inference_formats/direct_json/server_to_client.g.dart '
            'has drifted from the specification. Run '
            '`dart run tool/generate_server_to_client.dart`.',
      );
    });

    test('embeds the common types and the catalog', () {
      final String text = snippet();
      expect(
        text,
        contains(
          jsonEncode(PayloadValidator.commonTypesFor(A2uiProtocolVersion.v0_9)),
        ),
      );
      expect(text, contains(jsonEncode(basic.catalogSchema)));
      expect(text, contains('"version": "v0.9"'));
    });

    test('prunes the message schema to the allowed messages', () {
      final String text = snippet(allowedMessages: ['updateDataModel']);
      expect(
        text,
        contains('"oneOf":[{"\$ref":"#/\$defs/UpdateDataModelMessage"}]'),
      );
      for (final pruned in [
        'CreateSurfaceMessage',
        'UpdateComponentsMessage',
        'DeleteSurfaceMessage',
        '`createSurface`',
      ]) {
        expect(text, isNot(contains(pruned)));
      }
    });

    test('rejects an allowlist naming no v0.9 message', () {
      expect(
        () => snippet(allowedMessages: ['callFunction']),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('shows each example as a payload the parser reads back', () {
      final List<AgentToRendererMessage> example = parser().compile(
        '[${create('greeting')}, ${update('greeting', [
          {'id': 'root', 'component': 'Text', 'text': 'Hi'},
        ])}]',
      );
      final String text = snippet(examples: [example]);
      final List<ResponsePart> parts = parser().parseResponse(
        text.substring(text.indexOf('## Examples')),
      );
      expect(
        parts.whereType<A2uiPart>().single.a2ui.map((m) => m.toJson()),
        example.map((m) => m.toJson()),
      );
    });
  });

  group('A2uiRequestProcessor', () {
    test('uses direct JSON by default', () {
      final processor = A2uiRequestProcessor(activeCatalogs: [basic]);
      expect(processor.promptSnippet, contains('<a2ui-json>'));
      final List<ResponsePart> parts = processor.parseResponse(
        'Here:<a2ui-json>[${create('s')}, ${update('s', [
          {'id': 'root', 'component': 'Text', 'text': 'Hi'},
        ])}]</a2ui-json>',
      );
      expect(parts.first, isA<TextPart>());
      expect((parts.last as A2uiPart).a2ui, hasLength(2));
    });

    test('rejects a response the renderer would reject', () {
      final processor = A2uiRequestProcessor(activeCatalogs: [basic]);
      expect(
        () => processor.parseResponse(
          '<a2ui-json>[${create('s')}, ${update('s', [
            {'id': 'root', 'component': 'Text', 'text': 'Hi'},
            {'id': 'orphan', 'component': 'Text', 'text': 'Hi'},
          ])}]</a2ui-json>',
        ),
        throwsError<A2uiIntegrityError>(),
      );
    });
  });
}
