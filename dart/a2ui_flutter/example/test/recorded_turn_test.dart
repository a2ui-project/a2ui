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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter_example/chat_app.dart';
import 'package:a2ui_flutter_example/chat_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_client.dart';

/// A model's streamed replies to a request for a newsletter form, and to
/// the action the form's button sends once `ada@example.com` is typed.
final Map<String, Object?> _recording =
    jsonDecode(File('test/fixtures/newsletter_replies.json').readAsStringSync())
        as Map<String, Object?>;

void main() {
  testWidgets('replays a recorded form, its action and the reply to it', (
    tester,
  ) async {
    final client = FakeClient([
      for (final Object? reply in _recording['replies']! as List<Object?>)
        (reply! as List<Object?>).cast<String>(),
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    await tester.enterText(
      find.widgetWithText(TextField, 'Ask for some UI'),
      _recording['request']! as String,
    );
    await tester.tap(find.byTooltip('Send'));
    await tester.pump();

    expect(client.systemPrompts.single, startsWith(appInstructions));
    expect(client.systemPrompts.single, contains(BasicCatalog.v0_9Id));
    expect(find.text('Here is a sign-up form for your newsletter.'), findsOne);
    final Finder surface = find.byType(A2uiSurface);
    expect(
      find.descendant(
        of: surface,
        matching: find.text('Subscribe to our Newsletter'),
      ),
      findsOne,
    );

    await tester.enterText(
      find.descendant(of: surface, matching: find.byType(TextField)),
      'ada@example.com',
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Subscribe'));
    await tester.pump();

    expect(client.requests, hasLength(2));
    expect(client.requests[1].map((turn) => turn.fromUser), [
      true,
      false,
      true,
    ]);
    expect(jsonDecode(client.requests[1].last.text), {
      'a2ui': {
        'messages': [
          {
            'version': 'v0.9',
            'action': {
              'name': 'subscribe',
              'surfaceId': 'newsletter-signup',
              'sourceComponentId': 'subscribeBtn',
              'timestamp': isA<String>(),
              'context': {'email': 'ada@example.com'},
            },
          },
        ],
      },
      'metadata': {
        'a2uiClientDataModel': {
          'version': 'v0.9',
          'surfaces': {
            'newsletter-signup': {'email': 'ada@example.com'},
          },
        },
      },
    });

    expect(
      find.descendant(of: surface, matching: find.text("You're subscribed!")),
      findsOne,
    );
    expect(find.text('Subscribe to our Newsletter'), findsNothing);
    expect(errorsOf(session), isEmpty);
  });
}
