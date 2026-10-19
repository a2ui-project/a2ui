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
import 'package:a2ui_flutter_example/chat_app.dart';
import 'package:a2ui_flutter_example/chat_session.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_client.dart';
import 'replies.dart';

void main() {
  testWidgets('applies a createSurface that grows across chunks once', (
    tester,
  ) async {
    final client = FakeClient([
      [
        '<a2ui-json>[{"version": "v1.0", "createSurface": {"surfaceId": "s", '
            '"catalogId": "${BasicCatalog.v1_0Id}"',
        ', "sendDataModel": true}}',
        ', {"version": "v1.0", "updateComponents": {"surfaceId": "s", '
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

  testWidgets('sends a processing error to the model as an error message', (
    tester,
  ) async {
    final client = FakeClient([
      [
        '<a2ui-json>[{"version": "v1.0", "updateComponents": '
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
            'version': 'v1.0',
            'error': {
              'code': 'INTEGRITY_ERROR',
              'surfaceId': 'missing',
              'message': isA<String>(),
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

  testWidgets('sends later turns after a message fails to process', (
    tester,
  ) async {
    String picker(List<String> options) => block([
      {
        'version': 'v1.0',
        'updateComponents': {
          'surfaceId': 's',
          'components': [
            {
              'id': 'root',
              'component': 'ChoicePicker',
              'options': [
                for (final String option in options)
                  {'label': option, 'value': option},
              ],
              'value': {'@path': '/choice'},
            },
          ],
        },
      },
    ]);
    final client = FakeClient([
      [
        block([createSurface('s')]),
        picker(['a', 'b', 'c']),
      ],
      [
        picker(['a', 'b', 'c', 'd']),
      ],
      ['Done.'],
      ['Done.'],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    for (final request in ['One.', 'Two.', 'Three.']) {
      unawaited(session.send(request));
      await tester.pump();
    }

    expect(client.requests.last.last.text, 'Three.');
    expect(find.text('Done.'), findsWidgets);
  });

  testWidgets('sends the client data model after a typed turn', (tester) async {
    final client = FakeClient([
      [
        '<a2ui-json>[{"version": "v1.0", "createSurface": {"surfaceId": "s", '
            '"catalogId": "${BasicCatalog.v1_0Id}", "sendDataModel": true}}, '
            '{"version": "v1.0", "updateDataModel": {"surfaceId": "s", '
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
          'version': 'v1.0',
          'surfaces': {
            's': {'name': 'Ada'},
          },
        },
      },
    });
  });
}
