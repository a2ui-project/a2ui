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

/// Parsing chat and canvas turns against a [RendererState].
void main() {
  final CatalogApi basic = BasicCatalog.v0_9();
  final Map<String, Object?> create = {
    'version': 'v0.9',
    'createSurface': {'surfaceId': 's', 'catalogId': basic.id},
  };

  Map<String, Object?> update(List<Map<String, Object?>> components) => {
    'version': 'v0.9',
    'updateComponents': {'surfaceId': 's', 'components': components},
  };

  Map<String, Object?> column(List<String> children) => {
    'id': 'root',
    'component': 'Column',
    'children': children,
  };

  Map<String, Object?> text(String id) => {
    'id': id,
    'component': 'Text',
    'text': id,
  };

  String block(List<Map<String, Object?>> messages) =>
      '<a2ui-json>${jsonEncode(messages)}</a2ui-json>';

  /// [message] as the parser returns it.
  Map<String, Object?> parsed(Map<String, Object?> message) =>
      AgentToRendererMessage.fromJson(message).toJson();

  List<AgentToRendererMessage> emittedMessages(List<ResponsePart> parts) => [
    for (final A2uiPart part in parts.whereType<A2uiPart>()) ...part.a2ui,
  ];

  List<Map<String, Object?>> emitted(List<ResponsePart> parts) => [
    for (final AgentToRendererMessage m in emittedMessages(parts)) m.toJson(),
  ];

  String textOf(List<ResponsePart> parts) => [
    for (final TextPart part in parts.whereType<TextPart>()) part.text,
  ].join();

  Set<String> componentIds(RendererState state) =>
      state.getSurface('s')!.componentsModel.keys.toSet();

  Map<String, Object?> components(RendererState state) => {
    for (final ComponentModel c
        in state.getSurface('s')!.componentsModel.values)
      c.id: c.properties,
  };

  DirectJsonParser parser({Set<String> progressiveKeys = const {}}) =>
      DirectJsonParser([basic], progressiveKeys: progressiveKeys);

  /// A state holding a surface whose root column shows one text.
  RendererState canvas() {
    final state = RendererState([basic]);
    parser().parseResponse(
      block([
        create,
        update([
          column(['a']),
          text('a'),
        ]),
      ]),
      state: state,
    );
    return state;
  }

  Matcher throwsIntegrity(String fragment) => throwsA(
    isA<A2uiIntegrityError>().having(
      (e) => e.message,
      'message',
      contains(fragment),
    ),
  );

  final Map<String, Object?> changeA = update([
    {'id': 'a', 'component': 'Text', 'text': 'Changed'},
  ]);

  group('parseResponse', () {
    test('a chat turn shows new UI', () {
      // Without a state, an update to a surface the turn never created is
      // rejected. validatePayload, which checks one payload with no record
      // of earlier ones, assumes such a surface exists.
      final Map<String, Object?> earlier = update([
        column(['earlier']),
      ]);

      expect(
        () => parser().parseResponse(block([earlier])),
        throwsIntegrity('Surface not found'),
      );
      validatePayload([basic], parser().compile(jsonEncode([earlier])));
    });

    test('a canvas turn is checked against earlier turns', () {
      final RendererState state = canvas();

      parser().parseResponse(
        block([
          update([
            column(['a', 'b']),
            text('b'),
          ]),
        ]),
        state: state,
      );

      expect(componentIds(state), {'root', 'a', 'b'});
      expect(
        () => parser().parseResponse(
          block([
            update([
              column(['a', 'missing']),
            ]),
          ]),
          state: state,
        ),
        throwsIntegrity("non-existent component 'missing'"),
      );
    });

    test('a failed canvas turn leaves the state unchanged', () {
      final RendererState state = canvas();
      final Map<String, Object?> before = components(state);

      expect(
        () => parser().parseResponse(
          'Adding b.\n'
          '${block([
            update([
              column(['a', 'b']),
              text('b'),
            ]),
          ])}'
          '${block([
            update([
              {'id': 'c', 'component': 'Unknown'},
            ]),
          ])}',
          state: state,
        ),
        throwsA(isA<A2uiValidationError>()),
      );

      expect(components(state), before);
    });

    test('a response may reference a component a later block adds', () {
      final String first = block([
        create,
        update([
          column(['a']),
        ]),
      ]);
      final String second = block([
        update([text('a')]),
      ]);

      final List<ResponsePart> parts = parser().parseResponse(
        '$first and $second',
      );

      expect(emitted(parts), hasLength(3));
      // A block parsed on its own is checked as a whole response.
      expect(
        () => parser().parseResponse(first),
        throwsIntegrity("non-existent component 'a'"),
      );
    });

    test('a block cut off by the end of the response skips the tree '
        'checks only for the surface it touches', () {
      final open =
          '<a2ui-json>${jsonEncode([
            create,
            update([
              column(['a']),
            ]),
          ])}';
      final otherOpen =
          '<a2ui-json>${jsonEncode([
            {
              'version': 'v0.9',
              'createSurface': {'surfaceId': 's2', 'catalogId': basic.id},
            },
            {
              'version': 'v0.9',
              'updateComponents': {
                'surfaceId': 's2',
                'components': [
                  column(['b']),
                ],
              },
            },
          ])}';

      expect(emitted(parser().parseResponse(open)), hasLength(2));
      expect(
        () => parser().parseResponse(
          '${block([
            create,
            update([
              column(['missing']),
            ]),
          ])} $otherOpen',
        ),
        throwsIntegrity("non-existent component 'missing'"),
      );
    });

    test('a truncated block does not hold its components against later '
        'turns', () {
      // Direct JSON compiles a cut-off block that holds whole JSON, as
      // Express compiles one as far as it goes.
      final RendererState state = canvas();

      parser().parseResponse(
        '<a2ui-json>${jsonEncode([
          update([text('orphan')]),
        ])}',
        state: state,
      );

      expect(componentIds(state), contains('orphan'));
      parser().parseResponse(block([changeA]), state: state);
      expect(components(state)['a'], containsPair('text', 'Changed'));
    });
  });

  group('openStream', () {
    test('a stream reuses one state while data arrives', () {
      final state = RendererState([basic]);
      final DirectJsonResponseStream stream = parser().openStream(state: state);
      final response =
          'Here. ${block([
            create,
            update([
              column(['a']),
              text('a'),
            ]),
          ])} Done.';

      final parts = <ResponsePart>[];
      for (var start = 0; start < response.length; start += 7) {
        final int end = start + 7 < response.length
            ? start + 7
            : response.length;
        parts.addAll(stream.feed(response.substring(start, end)));
      }
      parts.addAll(stream.close());

      expect(stream.state, same(state));
      expect(textOf(parts), 'Here.Done.');
      // Replaying what was emitted rebuilds the state.
      final replayed = RendererState([basic])..apply(emittedMessages(parts));
      expect(componentIds(replayed), {'root', 'a'});
      expect(componentIds(state), {'root', 'a'});
    });

    test('a canvas stream updates the state of an earlier turn', () {
      final RendererState state = canvas();
      final Map<String, Object?> second = update([
        column(['a', 'b']),
        text('b'),
      ]);

      final DirectJsonResponseStream stream = parser().openStream(state: state);
      final List<ResponsePart> parts = [
        ...stream.feed(block([second])),
        ...stream.close(),
      ];

      expect(emitted(parts), [parsed(second)]);
      expect(componentIds(state), {'root', 'a', 'b'});
    });

    test('a failed stream keeps what it emitted', () {
      // The renderer received the emitted messages, so the state keeps them.
      final state = RendererState([basic]);
      final DirectJsonResponseStream stream = parser().openStream(state: state);
      final Map<String, Object?> dangling = update([
        column(['a']),
      ]);

      final List<ResponsePart> parts = stream.feed(
        '<a2ui-json>${jsonEncode([create, dangling])}',
      );
      expect(
        () => stream.feed('</a2ui-json>'),
        throwsIntegrity("non-existent component 'a'"),
      );

      expect(emitted(parts), [parsed(create), parsed(dangling)]);
      expect(componentIds(state), {'root'});
    });

    test('a chunk that fails after applying a block leaves the state '
        'unchanged', () {
      // A chunk that throws returns no parts, so the state keeps none of it.
      final state = RendererState([basic]);
      final DirectJsonResponseStream stream = parser().openStream(state: state);
      final Map<String, Object?> otherCreate = {
        'version': 'v0.9',
        'createSurface': {'surfaceId': 'other', 'catalogId': basic.id},
      };
      final Map<String, Object?> invalid = {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'other',
          'components': [
            {'id': 'root', 'component': 'Text'},
          ],
        },
      };

      expect(
        () => stream.feed(
          block([
                create,
                update([text('root')]),
              ]) +
              block([otherCreate, invalid]),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(state.surfaceIds, isEmpty);
    });

    test('close flushes text held as a possible tag', () {
      final DirectJsonResponseStream stream = parser().openStream();

      final List<ResponsePart> parts = [
        ...stream.feed('Compare a <a2ui'),
        ...stream.close(),
      ];

      expect(textOf(parts), 'Compare a <a2ui');
    });

    test('close rejects an unclosed block', () {
      final DirectJsonResponseStream stream = parser().openStream();
      stream.feed('<a2ui-json>${jsonEncode([create])}');

      expect(
        stream.close,
        throwsA(
          isA<A2uiParseError>().having(
            (e) => e.message,
            'message',
            contains('ended inside'),
          ),
        ),
      );
    });

    test('close checks the tree of an unwrapped stream', () {
      final DirectJsonResponseStream stream = parser().openStream(
        wrapped: false,
      );
      stream.feed(
        jsonEncode([
          create,
          update([
            column(['a']),
          ]),
        ]),
      );

      expect(stream.close, throwsIntegrity("non-existent component 'a'"));
    });

    test('feed after close is an error', () {
      final DirectJsonResponseStream stream = parser().openStream()..close();

      expect(() => stream.feed('more'), throwsStateError);
    });

    test('every version a stream emitted rebuilds its state', () {
      final state = RendererState([basic]);
      final DirectJsonResponseStream stream = parser(
        progressiveKeys: {'text'},
      ).openStream(state: state);
      final Map<String, Object?> longText = {
        'id': 'a',
        'component': 'Text',
        'text': 'a' * 40,
      };
      final String body = jsonEncode([
        create,
        update([
          column(['a']),
          longText,
        ]),
      ]);

      final List<ResponsePart> parts = stream.feed('<a2ui-json>');
      for (var start = 0; start < body.length; start += 3) {
        final int end = start + 3 < body.length ? start + 3 : body.length;
        parts.addAll(stream.feed(body.substring(start, end)));
      }
      parts
        ..addAll(stream.feed('</a2ui-json>'))
        ..addAll(stream.close());

      final List<AgentToRendererMessage> messages = emittedMessages(parts);
      // The update was emitted again as its text grew.
      expect(messages.length, greaterThan(2));
      final rebuilt = RendererState([basic])..apply(messages);
      expect(components(rebuilt), components(state));
      expect((components(state)['a']! as Map)['text'], 'a' * 40);
    });

    test('a stream holds a create until it closes', () {
      final DirectJsonResponseStream stream = parser().openStream();

      expect(
        emitted(
          stream.feed(
            '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": '
            '"s", "catalogId": "${basic.id}"',
          ),
        ),
        isEmpty,
      );
      expect(stream.state.surfaceIds, isEmpty);
      expect(emitted(stream.feed('}}')), [parsed(create)]);
      expect(stream.state.surfaceIds, ['s']);
    });

    test('a stream holds a delete until it closes', () {
      final state = RendererState([basic]);
      parser().parseResponse(
        block([
          create,
          update([text('root')]),
        ]),
        state: state,
      );
      final DirectJsonResponseStream stream = parser().openStream(state: state);

      final List<ResponsePart> held = stream.feed(
        '<a2ui-json>[{"version": "v0.9", "deleteSurface": {"surfaceId": "s"}',
      );
      expect(emitted(held), isEmpty);
      expect(state.surfaceIds, ['s']);

      final List<ResponsePart> closed = stream.feed('}]</a2ui-json>');
      expect(emitted(closed), [
        {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's'},
        },
      ]);
      expect(state.surfaceIds, isEmpty);
    });

    test('a stream that throws has ended', () {
      final DirectJsonResponseStream stream = parser().openStream();
      stream.feed(
        '<a2ui-json>${jsonEncode([
          create,
          update([
            column(['a']),
          ]),
        ])}',
      );

      expect(
        () => stream.feed('</a2ui-json> More text.'),
        throwsIntegrity("non-existent component 'a'"),
      );
      expect(() => stream.feed('More text.'), throwsStateError);
      expect(stream.close(), isEmpty);
    });

    test('closing twice returns nothing the second time', () {
      final DirectJsonResponseStream stream = parser().openStream();
      stream.feed('Held <a2ui');

      expect(textOf(stream.close()), ' <a2ui');
      expect(stream.close(), isEmpty);
    });

    final Map<String, (Map<String, Object?>, String)> wholeBlocks = {
      'an unknown component': (
        update([
          {'id': 'root', 'component': 'Unknown'},
        ]),
        "no component named 'Unknown'",
      ),
      'a duplicate id': (update([text('root'), text('root')]), 'uplicate'),
    };
    for (final MapEntry(
          key: String name,
          value: (Map<String, Object?> message, String fragment),
        )
        in wholeBlocks.entries) {
      test('a block that arrives whole is checked when it closes: $name', () {
        // Messages that never streamed in parts are checked as the block
        // closes.
        final DirectJsonResponseStream stream = parser().openStream();

        expect(
          () => stream.feed(block([create, message])),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              contains(fragment),
            ),
          ),
        );
      });
    }

    test('the last message of a block is checked when it closes', () {
      // A message whose object closes with the block is checked then.
      final DirectJsonResponseStream stream = parser().openStream();
      final String body = jsonEncode([
        create,
        update([
          {'id': 'root', 'component': 'Unknown'},
        ]),
      ]);

      stream.feed('<a2ui-json>${body.substring(0, body.length - 2)}');
      expect(
        () => stream.feed('${body.substring(body.length - 2)}</a2ui-json>'),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test(
      'a failed stream does not hold what it emitted against later turns',
      () {
        final RendererState state = canvas();
        final DirectJsonResponseStream stream = parser().openStream(
          state: state,
        );

        final List<ResponsePart> parts = stream.feed(
          '<a2ui-json>[${jsonEncode(update([text('orphan')]))}',
        );
        expect(emitted(parts), isNotEmpty);
        expect(
          () => stream.feed(']</a2ui-json>'),
          throwsIntegrity("'orphan' is not reachable"),
        );

        // The renderer holds the orphan, and no message can remove it.
        expect(componentIds(state), contains('orphan'));
        parser().parseResponse(block([changeA]), state: state);
        expect(components(state)['a'], containsPair('text', 'Changed'));
      },
    );

    test('a stream cut off inside a block does not hold what it emitted', () {
      final RendererState state = canvas();
      final DirectJsonResponseStream stream = parser().openStream(state: state);

      expect(
        emitted(
          stream.feed('<a2ui-json>[${jsonEncode(update([text('orphan')]))},'),
        ),
        isNotEmpty,
      );
      expect(
        stream.close,
        throwsA(
          isA<A2uiParseError>().having(
            (e) => e.message,
            'message',
            contains('ended inside'),
          ),
        ),
      );

      parser().parseResponse(block([changeA]), state: state);
      expect(components(state)['a'], containsPair('text', 'Changed'));
    });
  });

  group('A2uiRequestProcessor', () {
    test('parses canvas turns against a state it creates', () {
      final processor = A2uiRequestProcessor(activeCatalogs: [basic]);
      final RendererState state = processor.createState();
      processor.parseResponse(
        block([
          create,
          update([
            column(['a']),
            text('a'),
          ]),
        ]),
        state: state,
      );

      processor.openStream(state: state)
        ..feed(
          block([
            update([
              column(['a', 'b']),
              text('b'),
            ]),
          ]),
        )
        ..close();

      expect(componentIds(state), {'root', 'a', 'b'});
      expect(
        () => processor.parseResponse(
          block([
            update([
              column(['missing']),
            ]),
          ]),
          state: state,
        ),
        throwsIntegrity("non-existent component 'missing'"),
      );
    });

    test('reuses one parser', () {
      final processor = A2uiRequestProcessor(activeCatalogs: [basic]);

      expect(processor.parser, same(processor.parser));
    });

    test('rejects a state for other catalogs', () {
      final processor = A2uiRequestProcessor(activeCatalogs: [basic]);
      final other = RendererState([
        Catalog.fromJson({
          'catalogId': 'other',
          'protocolVersion': '0.9',
          'components': <String, Object?>{},
        }),
      ]);

      expect(
        () => processor.parseResponse(block([create]), state: other),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('active catalogs'),
          ),
        ),
      );
      expect(
        () => A2uiRequestProcessor(activeCatalogs: [basic], state: other),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('accepts a state that holds the active catalogs in order', () {
      final Catalog other = Catalog.fromJson({
        'catalogId': 'other',
        'protocolVersion': '0.9',
        'components': <String, Object?>{},
      });
      final processor = A2uiRequestProcessor(activeCatalogs: [basic, other]);

      expect(processor.acceptsState(processor.createState()), isTrue);
      expect(processor.acceptsState(RendererState([basic, other])), isTrue);
      // The order decides which catalog a surface resolves to.
      expect(processor.acceptsState(RendererState([other, basic])), isFalse);
      expect(processor.acceptsState(RendererState([basic])), isFalse);
    });

    test('uses a bound state when a call passes none', () {
      final state = RendererState([basic]);
      final processor = A2uiRequestProcessor(
        activeCatalogs: [basic],
        state: state,
      );

      processor.parseResponse(
        block([
          create,
          update([
            column(['a']),
            text('a'),
          ]),
        ]),
      );
      processor.openStream()
        ..feed(
          block([
            update([
              column(['a', 'b']),
              text('b'),
            ]),
          ]),
        )
        ..close();

      expect(processor.state, same(state));
      expect(componentIds(state), {'root', 'a', 'b'});
    });

    test('A2uiGenerator binds a state to the processor it creates', () {
      final generator = A2uiGenerator(catalogs: [CatalogConfig(basic)]);
      final capabilities = A2uiRendererCapabilities.forCatalogIds([basic.id]);
      final RendererState state = generator
          .createProcessor(capabilities)
          .createState();

      expect(
        generator.createProcessor(capabilities, state: state).state,
        same(state),
      );
    });

    test('A2uiGenerator rejects a state for other catalogs', () {
      final generator = A2uiGenerator(catalogs: [CatalogConfig(basic)]);
      final capabilities = A2uiRendererCapabilities.forCatalogIds([basic.id]);
      final other = RendererState([
        Catalog.fromJson({
          'catalogId': 'other',
          'protocolVersion': '0.9',
          'components': <String, Object?>{},
        }),
      ]);

      expect(
        () => generator.createProcessor(capabilities, state: other),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('active catalogs'),
          ),
        ),
      );
    });
  });
}
