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

import 'dart:async';
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter_example/chat_app.dart';
import 'package:a2ui_flutter_example/chat_session.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_client.dart';
import 'replies.dart';

void main() {
  testWidgets('applies a createSurface that grows across chunks once', (
    tester,
  ) async {
    final client = FakeClient([
      [
        '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s", '
            '"catalogId": "${BasicCatalog.v0_9Id}"',
        ', "sendDataModel": true}}',
        ', {"version": "v0.9", "updateComponents": {"surfaceId": "s", '
            '"components": [{"id": "root", "component": "Text", '
            '"text": "Hello"}]}}]</a2ui-json>',
      ],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Say hello.'));
    await tester.pump();

    expect(errorsOf(session), isEmpty);
    expect(session.processor.model.getSurface('s')!.sendDataModel, isTrue);
    expect(find.text('Hello'), findsOneWidget);
  });

  testWidgets('sends the data model as it is when a queued turn starts', (
    tester,
  ) async {
    final client = FakeClient([
      [
        block([
          createSurface('s', sendDataModel: true),
          rootComponent('s', 'Form'),
        ]),
      ],
      ['Done.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Make a form.'));
    unawaited(session.send('Thanks.'));
    await tester.pump();

    expect(client.requests, hasLength(2));
    expect(client.requests[1].last.text, contains('a2uiClientDataModel'));
  });

  testWidgets('sends an update to a missing surface back to the model as an '
      'error message', (tester) async {
    final client = FakeClient([
      [
        '<a2ui-json>[{"version": "v0.9", "updateComponents": '
            '{"surfaceId": "missing", "components": [{"id": "root", '
            '"component": "Text", "text": "Hi"}]}}]</a2ui-json>',
      ],
      ['Sorry, that surface does not exist.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Update the missing surface.'));
    await tester.pump();

    expect(errorsOf(session), hasLength(1));
    expect(client.requests, hasLength(2));
    expect(jsonDecode(client.requests[1].last.text), {
      'a2ui': {
        'messages': [
          {
            'version': 'v0.9',
            'error': {
              'code': 'INTEGRITY_ERROR',
              'surfaceId': '',
              'message': contains('missing'),
            },
          },
        ],
      },
    });
    expect(find.text('Sorry, that surface does not exist.'), findsOneWidget);
  });

  testWidgets('reports an error again when the reply to it repeats it', (
    tester,
  ) async {
    final String update = block([rootComponent('missing', 'Hi')]);
    final client = FakeClient([
      [update],
      [update],
      ['Sorry, that surface does not exist.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Update the missing surface.'));
    await tester.pump();

    expect(errorsOf(session), hasLength(2));
    expect(client.requests, hasLength(3));
    expect(client.requests[2].last.text, contains('INTEGRITY_ERROR'));
  });

  testWidgets('reports a block it rejects and reads no more of the reply', (
    tester,
  ) async {
    final client = FakeClient([
      [
        'Two cards.',
        block([
          createSurface('a'),
          rootComponent('a', 'Card A', component: 'Bogus'),
        ]),
        ' Anything else?',
      ],
      ['Fixed.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Show two cards.'));
    await tester.pump();

    expect(find.text('Two cards.'), findsOneWidget);
    expect(find.text('Anything else?'), findsNothing);
    expect(errorsOf(session), [contains("'Bogus'")]);
    expect(client.requests, hasLength(2));
    expect(client.requests[1].last.text, contains('Bogus'));
  });

  testWidgets('sends an error a surface reports as it first builds', (
    tester,
  ) async {
    final client = FakeClient([
      [
        block([
          createSurface('s'),
          updateDataModel('s', {'amount': 'abc'}),
          {
            'version': 'v0.9',
            'updateComponents': {
              'surfaceId': 's',
              'components': [
                {
                  'id': 'root',
                  'component': 'Text',
                  'text': {
                    'call': 'formatCurrency',
                    'args': {
                      'value': {'path': '/amount'},
                      'currency': 'USD',
                    },
                    'returnType': 'string',
                  },
                },
              ],
            },
          },
        ]),
      ],
      ['Fixed the amount.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Show the price.'));
    await tester.pump();
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(errorsOf(session), [startsWith('EXPRESSION_ERROR on "s"')]);
    expect(client.requests, hasLength(2));
    expect(jsonDecode(client.requests[1].last.text), {
      'a2ui': {
        'messages': [
          {
            'version': 'v0.9',
            'error': allOf(
              containsPair('code', 'EXPRESSION_ERROR'),
              containsPair('surfaceId', 's'),
            ),
          },
        ],
      },
    });
    expect(find.text('Fixed the amount.'), findsOneWidget);
  });

  testWidgets('sends an error whose details are not JSON', (tester) async {
    final client = FakeClient([
      [
        block([
          createSurface('s'),
          updateDataModel('s', {'name': 'abc', 'pattern': '('}),
          {
            'version': 'v0.9',
            'updateComponents': {
              'surfaceId': 's',
              'components': [
                {
                  'id': 'root',
                  'component': 'Text',
                  'text': {
                    'call': 'formatString',
                    'args': {
                      'value':
                          r'${regex(value: ${/name}, pattern: ${/pattern})}',
                    },
                    'returnType': 'string',
                  },
                },
              ],
            },
          },
        ]),
      ],
      ['Fixed the pattern.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Check my name.'));
    await tester.pump();
    await tester.pump();

    expect(errorsOf(session), [startsWith('EXPRESSION_ERROR on "s"')]);
    expect(client.requests, hasLength(2));
    expect(jsonDecode(client.requests[1].last.text), {
      'a2ui': {
        'messages': [
          {
            'version': 'v0.9',
            'error': allOf(
              containsPair('code', 'EXPRESSION_ERROR'),
              containsPair('surfaceId', 's'),
            ),
          },
        ],
      },
    });
    expect(find.text('Fixed the pattern.'), findsOneWidget);
  });

  testWidgets('shows an error for a reply with no output', (tester) async {
    final client = FakeClient([
      [],
      ['Hello.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('One.'));
    await tester.pump();

    expect(session.busy, isFalse);
    expect(errorsOf(session), ['The model gave no reply.']);
    expect(find.text('The model gave no reply.'), findsOneWidget);

    unawaited(session.send('Two.'));
    await tester.pump();

    expect(client.requests[1].map((turn) => turn.text), ['Two.']);
  });

  testWidgets('stops reading and requests nothing once disposed', (
    tester,
  ) async {
    final client = ControlledClient();
    final session = ChatSession(client: client);

    unawaited(session.send('One.'));
    await tester.pump();
    client.reply.add(block([rootComponent('missing', 'Hi')]));
    await tester.pump();
    unawaited(session.send('Two.'));
    await tester.pump();
    session.dispose();
    unawaited(client.reply.close());
    await tester.pump();

    expect(client.cancelled, isTrue);
    expect(client.requests, hasLength(1));
  });

  testWidgets('sends later turns after a request throws an Error', (
    tester,
  ) async {
    final client = FakeClient(
      [
        [],
        ['Hello again.'],
      ],
      failures: {0: StateError('boom')},
    );
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('One.'));
    await tester.pump();
    unawaited(session.send('Two.'));
    await tester.pump();

    expect(errorsOf(session), ['The request failed: Bad state: boom']);
    expect(client.requests, hasLength(2));
    expect(client.requests[1].map((turn) => turn.text), ['Two.']);
    expect(find.text('Hello again.'), findsOneWidget);
  });

  testWidgets('sends a message that fails to process back to the model', (
    tester,
  ) async {
    final client = FakeClient([
      [
        block([
          createSurface('s'),
          {
            'version': 'v0.9',
            'updateComponents': {
              'surfaceId': 's',
              'components': [
                {
                  'id': 'root',
                  'component': 'TextField',
                  'label': 'Name',
                  'value': {'path': '/name'},
                },
              ],
            },
          },
        ]),
      ],
      [
        block([updateDataModel('s', 'Ada', path: '/name/first')]),
      ],
      ['Sorry.'],
      ['Done.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Ask my name.'));
    await tester.pump();
    // The agent SDK does not see the text the user types, so it accepts an
    // update of /name/first that the renderer cannot apply to a string.
    await tester.enterText(
      find.descendant(
        of: find.byType(A2uiSurface),
        matching: find.byType(TextField),
      ),
      'Ada',
    );
    unawaited(session.send('Store my first name.'));
    await tester.pump();
    unawaited(session.send('Thanks.'));
    await tester.pump();

    expect(errorsOf(session), [contains('/name/first')]);
    expect(client.requests, hasLength(4));
    expect(jsonDecode(client.requests[2].last.text), {
      'a2ui': {
        'messages': [
          {
            'version': 'v0.9',
            'error': allOf(
              containsPair('surfaceId', 's'),
              containsPair('message', contains('/name/first')),
            ),
          },
        ],
      },
    });
    expect(client.requests[3].last.text, startsWith('Thanks.'));
    expect(find.text('Done.'), findsOneWidget);
  });

  testWidgets('sends the renderer data model after a typed turn', (
    tester,
  ) async {
    final client = FakeClient([
      [
        '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s", '
            '"catalogId": "${BasicCatalog.v0_9Id}", "sendDataModel": true}}, '
            '{"version": "v0.9", "updateDataModel": {"surfaceId": "s", '
            '"value": {"name": "Ada"}}}]</a2ui-json>',
      ],
      ['Hello, Ada.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Remember my name.'));
    await tester.pump();
    unawaited(session.send('Greet me.'));
    await tester.pump();

    expect(errorsOf(session), isEmpty);
    expect(client.requests[0].last.text, 'Remember my name.');
    final String turn = client.requests[1].last.text;
    expect(turn, startsWith('Greet me.\n\n'));
    expect(jsonDecode(turn.substring('Greet me.\n\n'.length)), {
      'metadata': {
        'a2uiClientDataModel': {
          'version': 'v0.9',
          'surfaces': {
            's': {'name': 'Ada'},
          },
        },
      },
    });
  });
}
