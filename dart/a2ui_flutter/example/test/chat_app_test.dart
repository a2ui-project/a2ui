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
import 'package:a2ui_flutter_example/chat_app.dart';
import 'package:a2ui_flutter_example/chat_session.dart';
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
}
