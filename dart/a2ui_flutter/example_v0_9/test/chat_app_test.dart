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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter_example_v0_9/chat_app.dart';
import 'package:a2ui_flutter_example_v0_9/chat_session.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_client.dart';
import 'replies.dart';

void main() {
  testWidgets('renders Markdown in the model text and in a Text', (
    tester,
  ) async {
    final client = FakeClient([
      [
        'Some **bold** words.',
        block([createSurface('s'), rootComponent('s', 'A **bold** label')]),
      ],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Say something bold.'));
    await tester.pump();

    expect(errorsOf(session), isEmpty);
    expect(find.text('Some bold words.'), findsOne);
    expect(
      find.descendant(
        of: find.byType(A2uiSurface),
        matching: find.text('A bold label'),
      ),
      findsOne,
    );
    expect(find.textContaining('**'), findsNothing);
  });

  testWidgets('opens a link tapped in the model text or in a Text', (
    tester,
  ) async {
    const channel = MethodChannel('plugins.flutter.io/url_launcher');
    final opened = <Object?>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
      call,
    ) async {
      opened.add((call.arguments as Map<Object?, Object?>)['url']);
      return true;
    });
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        null,
      ),
    );
    final client = FakeClient([
      [
        '[Docs](https://example.com/docs)',
        block([
          createSurface('s'),
          rootComponent('s', '[Guide](https://example.com/guide)'),
        ]),
      ],
    ]);
    final session = ChatSession(client: client);
    addTearDown(session.dispose);
    await tester.pumpWidget(ChatApp(session: session));

    unawaited(session.send('Link the docs.'));
    await tester.pump();
    await tester.tap(find.text('Docs'));
    await tester.tap(find.text('Guide'));
    await tester.pump();

    expect(opened, ['https://example.com/docs', 'https://example.com/guide']);
  });

  testWidgets(
    'keeps the text field focused after sending with Enter or the button',
    (tester) async {
      final client = FakeClient([
        ['First reply.'],
        ['Second reply.'],
      ]);
      final session = ChatSession(client: client);
      addTearDown(session.dispose);
      await tester.pumpWidget(ChatApp(session: session));
      bool focused() => tester
          .widget<EditableText>(find.byType(EditableText))
          .focusNode
          .hasFocus;

      await tester.enterText(find.byType(TextField), 'First turn.');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(focused(), isTrue);

      await tester.enterText(find.byType(TextField), 'Second turn.');
      await tester.tap(find.byTooltip('Send'));
      await tester.pump();
      expect(focused(), isTrue);
      expect(client.requests, hasLength(2));
    },
    // On desktop a tap outside a focused text field unfocuses it.
    variant: TargetPlatformVariant.only(TargetPlatform.macOS),
  );
}
