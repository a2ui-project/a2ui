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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter_example/chat_app.dart';
import 'package:a2ui_flutter_example/chat_session.dart';
import 'package:a2ui_flutter_example/llm_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_infra/api_key.dart';
import 'test_infra/pump.dart';
import 'test_infra/recording_client.dart';

const String loginFormRequest =
    'Show a login form with email and password fields and a "Sign in" '
    'button.';

const String productCardRequest =
    'Show a product card for a coffee grinder that costs 129.99 USD and was '
    'released on 2026-03-14. Format the price with formatCurrency and the '
    'date with formatDate. Use no images.';

void main() {
  const timeout = Timeout(Duration(minutes: 5));

  // flutter_test answers every HTTP request with status 400 unless its
  // overrides are removed.
  setUpAll(() => HttpOverrides.global = null);

  late RecordingClient client;
  late ChatSession session;

  /// Shows the chat app and sends [request] from its text field.
  Future<void> ask(WidgetTester tester, String request) async {
    client = RecordingClient(GeminiClient(apiKey: apiKeyForEval()));
    session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));
    await tester.enterText(
      find.widgetWithText(TextField, 'Ask for some UI'),
      request,
    );
    await tester.tap(find.byTooltip('Send'));
    await pumpUntilIdle(tester, session);
  }

  /// Checks that no surface reported an error and that every message
  /// processed.
  void expectNoErrors() {
    final List<String> errors = [
      for (final ChatEntry entry in session.entries)
        if (entry.kind == ChatEntryKind.error) entry.text,
    ];
    expect(errors, isEmpty, reason: 'Model output:\n${client.replies}');
  }

  final Finder surface = find.byType(A2uiSurface);
  final Finder textFields = find.descendant(
    of: surface,
    matching: find.byType(TextField),
  );

  testWidgets('a login form renders, and its button sends an action the '
      'model answers', (tester) async {
    await ask(tester, loginFormRequest);
    expectNoErrors();
    expect(surface, findsOne);
    expect(textFields, findsAtLeast(2));

    for (final Element field in textFields.evaluate().toList()) {
      final String label =
          (field.widget as TextField).decoration?.labelText ?? '';
      await tester.enterText(
        find.byWidget(field.widget),
        label.toLowerCase().contains('mail')
            ? 'ada@example.com'
            : 'correct-horse-battery',
      );
    }
    await tester.pump();
    final Finder signIn = find.ancestor(
      of: find.textContaining(RegExp('sign in', caseSensitive: false)),
      matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
    );
    expect(signIn, findsAtLeast(1), reason: 'Model output:\n${client.replies}');
    final String surfaceId = session.processor.groupModel.allSurfaces.single.id;
    await tester.tap(signIn.first);
    await pumpUntilIdle(tester, session);

    expectNoErrors();
    expect(client.requests, hasLength(2));
    final turn = jsonDecode(client.requests[1]) as Map<String, Object?>;
    expect((turn['a2ui']! as Map<String, Object?>)['messages'], [
      {'version': 'v0.9', 'action': containsPair('surfaceId', surfaceId)},
    ]);
    expect(client.requests[1], contains('ada@example.com'));
  }, timeout: timeout);

  testWidgets('a price and a date format with basic functions', (tester) async {
    await ask(tester, productCardRequest);

    expectNoErrors();
    final String reply = client.replies.single.join();
    expect(reply, contains('formatCurrency'));
    expect(reply, contains('formatDate'));
    expect(
      find.descendant(of: surface, matching: find.textContaining('129.99')),
      findsAtLeast(1),
    );
  }, timeout: timeout);
}
