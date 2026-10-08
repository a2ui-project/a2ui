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

import 'package:a2ui_explorer/src/explorer_app.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_test/flutter_test.dart';

/// Pumps the app in a window wide enough for its three columns, and selects
/// the example in [fileName], which processes all of its messages.
Future<void> _open(WidgetTester tester, String fileName) async {
  tester.view.physicalSize = const Size(1600, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const ExplorerApp());

  final Finder item = find.byKey(ValueKey(fileName));
  await tester.scrollUntilVisible(
    item,
    200,
    scrollable: find.descendant(
      of: find.byKey(const Key('examples')),
      matching: find.byType(Scrollable),
    ),
  );
  await tester.tap(item);
  await tester.pump();
}

/// Taps the control labelled [control] and pumps a frame.
Future<void> _press(WidgetTester tester, String control) async {
  await tester.tap(find.text(control));
  await tester.pump();
}

/// [finder], within the surfaces.
Finder _inSurface(Finder finder) =>
    find.descendant(of: find.byType(A2uiSurface), matching: finder);

/// [finder], within the pane keyed [key].
Finder _inPane(String key, Finder finder) =>
    find.descendant(of: find.byKey(Key(key)), matching: finder);

/// Action log entries containing [text].
Finder _logged(String text) => _inPane('action-log', find.textContaining(text));

/// The action log's text while it is empty.
Finder get _noAction => _inPane('action-log', find.text('No action yet.'));

void main() {
  testWidgets('Simple Text renders its text', (tester) async {
    await _open(tester, '00_simple-text.json');

    expect(_inSurface(find.text('Hello, Minimal Catalog!')), findsOneWidget);
    expect(_noAction, findsOneWidget);
  });

  testWidgets('Row Layout lays its children out left to right', (tester) async {
    await _open(tester, '00_row-layout.json');

    final Rect left = tester.getRect(_inSurface(find.text('Left Content')));
    final Rect right = tester.getRect(_inSurface(find.text('Right Content')));
    expect(left.right, lessThanOrEqualTo(right.left));
    expect(left.center.dy, moreOrLessEquals(right.center.dy, epsilon: 1));
  });

  testWidgets('Complex Layout lays its column out top to bottom', (
    tester,
  ) async {
    await _open(tester, '00_complex-layout.json');

    final Rect header = tester.getRect(
      _inSurface(find.text('User Profile Form')),
    );
    final Rect first = tester.getRect(
      _inSurface(find.widgetWithText(TextField, 'First Name')),
    );
    final Rect last = tester.getRect(
      _inSurface(find.widgetWithText(TextField, 'Last Name')),
    );
    final Rect footer = tester.getRect(
      _inSurface(find.text('Please fill out all fields.')),
    );
    expect(header.bottom, lessThanOrEqualTo(first.top));
    expect(first.right, lessThanOrEqualTo(last.left));
    expect(first.top, last.top);
    expect(first.bottom, lessThanOrEqualTo(footer.top));
  });

  testWidgets('typing in a TextField updates it and the data model', (
    tester,
  ) async {
    await _open(tester, '00_formatted-text.json');

    await tester.enterText(_inSurface(find.byType(TextField)), 'hello');
    await tester.pump();

    expect(_inSurface(find.text('hello')), findsOneWidget);
    expect(
      _inPane('data-model', find.textContaining('"inputValue": "hello"')),
      findsOneWidget,
    );
  });

  testWidgets('toggling a CheckBox updates it and the data model', (
    tester,
  ) async {
    await _open(tester, '07_task-card.json');
    final Finder checkbox = _inSurface(find.byType(Checkbox));
    expect(
      _inPane('data-model', find.textContaining('"completed": false')),
      findsOneWidget,
    );

    await tester.tap(checkbox);
    await tester.pump();

    expect(tester.widget<Checkbox>(checkbox).value, isTrue);
    expect(
      _inPane('data-model', find.textContaining('"completed": true')),
      findsOneWidget,
    );
  });

  testWidgets('a Text bound to a TextField path follows the typing', (
    tester,
  ) async {
    await _open(tester, '00_formatted-text.json');

    await tester.enterText(_inSurface(find.byType(TextField)), 'hello');
    await tester.pump();

    expect(_inSurface(find.text('You typed: hello')), findsOneWidget);
  });

  testWidgets('an action in a template item resolves its item context', (
    tester,
  ) async {
    await _open(tester, '00_incremental.json');
    final Finder buttons = _inSurface(find.text('Book now'));
    expect(buttons, findsNWidgets(4));

    for (final (int index, String name) in [
      (1, "Ocean's Bounty"),
      (3, 'Spice Route'),
    ]) {
      await tester.ensureVisible(buttons.at(index));
      await tester.tap(buttons.at(index));
      await tester.pump();

      expect(_logged('"restaurantName": "$name"'), findsOneWidget);
    }
    expect(_inPane('action-log', find.text('book_now')), findsNWidgets(2));
    expect(_logged('"sourceComponentId": "rc_button"'), findsNWidgets(2));
  });

  testWidgets('Advance processes one message and Reset starts over', (
    tester,
  ) async {
    await _open(tester, '00_incremental.json');
    expect(find.text('6 of 6 messages processed'), findsOneWidget);

    await _press(tester, 'Reset');
    expect(find.text('0 of 6 messages processed'), findsOneWidget);
    expect(find.text('1. createSurface (pending)'), findsOneWidget);
    expect(find.byType(A2uiSurface), findsNothing);

    await _press(tester, 'Advance');
    expect(find.text('1 of 6 messages processed'), findsOneWidget);
    expect(find.text('1. createSurface (processed)'), findsOneWidget);
    expect(find.text('2. updateDataModel (pending)'), findsOneWidget);
    expect(find.byType(A2uiSurface), findsOneWidget);

    for (var i = 0; i < 3; i++) {
      await _press(tester, 'Advance');
    }
    expect(find.text('4 of 6 messages processed'), findsOneWidget);
    expect(_inSurface(find.text('The Golden Fork')), findsOneWidget);
    expect(_inSurface(find.text('Spice Route')), findsNothing);

    await _press(tester, 'Reset');
    expect(find.text('0 of 6 messages processed'), findsOneWidget);
    expect(find.byType(A2uiSurface), findsNothing);
    expect(_inPane('data-model', find.text('No surface yet.')), findsOneWidget);

    await _press(tester, 'Run all');
    expect(find.text('6 of 6 messages processed'), findsOneWidget);
    expect(_inSurface(find.text('Spice Route')), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Advance'))
          .onPressed,
      isNull,
    );
    expect(_noAction, findsOneWidget);
  });

  testWidgets('Markdown Text renders its markdown', (tester) async {
    await _open(tester, '35_markdown-text.json');

    expect(_inSurface(find.byType(MarkdownBody)), findsWidgets);
    expect(
      _inSurface(find.textContaining('**', findRichText: true)),
      findsNothing,
    );
  });

  testWidgets('Native Grid renders its custom components', (tester) async {
    await _open(tester, '37_native-grid.json');
    expect(_inSurface(find.byType(Slider)), findsNWidgets(3));
    expect(_inSurface(find.text('Master Volume (Native): 65')), findsOneWidget);

    await tester.drag(
      _inSurface(find.byType(Slider)).first,
      const Offset(-1000, 0),
    );
    await tester.pump();

    expect(_inSurface(find.text('Master Volume (Native): 0')), findsOneWidget);
    expect(
      _inPane('data-model', find.textContaining('"sliderValue1": 0')),
      findsOneWidget,
    );
    expect(_noAction, findsOneWidget);
  });
}
