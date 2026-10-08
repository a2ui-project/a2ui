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
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/surface_harness.dart';

final WidgetCatalog _catalog = basicTestCatalog([
  BasicComponents.modal,
  BasicComponents.list,
  BasicComponents.column,
  BasicComponents.text,
  BasicComponents.button,
  BasicComponents.textField,
]);

/// The spec's Modal example: a Button that opens a Column with one Text.
List<Map<String, Object?>> _example() {
  final example =
      jsonDecode(
            File(
              '../../specification/v0_9/catalogs/basic/examples/'
              '36_modal.json',
            ).readAsStringSync(),
          )
          as Map<String, Object?>;
  return (example['messages']! as List<Object?>).cast<Map<String, Object?>>();
}

const String _exampleSurfaceId = 'modal-sample-surface';
const String _trigger = 'Open Modal';
const String _content = 'This is the content inside the modal.';
const ValidationConfig _allowOrphans = ValidationConfig(
  allowOrphanComponents: true,
);

Map<String, Object?> _modal({
  String id = 'root',
  String trigger = 'trigger',
  String content = 'content',
}) => {'id': id, 'component': 'Modal', 'trigger': trigger, 'content': content};

Map<String, Object?> _text(String id, Object text) => {
  'id': id,
  'component': 'Text',
  'text': text,
};

Future<SurfaceHarness> _pumpExample(WidgetTester tester) =>
    pumpSurface(tester, _example(), catalog: _catalog);

Future<void> _open(WidgetTester tester) async {
  await tester.tap(find.text(_trigger));
  await tester.pump();
}

FocusNode _focusOf(WidgetTester tester, Finder finder) =>
    Focus.of(tester.element(finder));

/// Performs a tap on the semantics node that [finder]'s widget is part of,
/// as a screen reader does.
void _semanticsTap(WidgetTester tester, Finder finder) {
  final SemanticsNode node = tester.getSemantics(finder);
  node.owner!.performAction(node.id, SemanticsAction.tap);
}

TestFlutterView get _view =>
    TestWidgetsFlutterBinding.instance.platformDispatcher.implicitView!;

void main() {
  // A screen 400 wide, which shows the content in a sheet.
  setUp(() => _view.physicalSize = const Size(1200, 1800));
  tearDown(() => _view.reset());

  testWidgets('opens and runs the trigger action on one tap', (tester) async {
    final SurfaceHarness harness = await _pumpExample(tester);

    await _open(tester);

    expect(find.text(_content), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(BottomSheet),
        matching: find.text(_content),
      ),
      findsOneWidget,
    );
    expect(harness.actions, hasLength(1));
    expect(harness.actions.single.name, 'openModalEvent');
    expect(harness.actions.single.surfaceId, _exampleSurfaceId);
    expect(harness.actions.single.sourceComponentId, 'open-btn');
  });

  testWidgets('opens from a trigger that does not handle taps', (tester) async {
    await pumpComponents(tester, [
      _modal(),
      _text('trigger', _trigger),
      _text('content', _content),
    ], catalog: _catalog);

    await _open(tester);

    expect(find.text(_content), findsOneWidget);
  });

  testWidgets('opens and runs the trigger action on a semantics tap', (
    tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    final SurfaceHarness harness = await _pumpExample(tester);

    _semanticsTap(tester, find.text(_trigger));
    await tester.pump();
    await tester.pump();

    expect(find.text(_content), findsOneWidget);
    expect(harness.actions.single.name, 'openModalEvent');
    semantics.dispose();
  });

  testWidgets('opens from a trigger that does not handle a semantics tap', (
    tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await pumpComponents(tester, [
      _modal(),
      _text('trigger', _trigger),
      _text('content', _content),
    ], catalog: _catalog);

    _semanticsTap(tester, find.text(_trigger));
    await tester.pump();

    expect(find.text(_content), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('stays closed after a drag or a secondary click', (tester) async {
    await pumpComponents(tester, [
      _modal(),
      _text('trigger', _trigger),
      _text('content', _content),
    ], catalog: _catalog);

    await tester.drag(find.text(_trigger), const Offset(0, 100));
    await tester.pump();
    await tester.tap(find.text(_trigger), buttons: kSecondaryButton);
    await tester.pump();

    expect(find.text(_content), findsNothing);
  });

  testWidgets('opens on a tap after a drag on a button trigger', (
    tester,
  ) async {
    await _pumpExample(tester);

    await tester.drag(find.text(_trigger), const Offset(0, 100));
    await tester.pump();
    expect(find.text(_content), findsNothing);

    await _open(tester);

    expect(tester.takeException(), isNull);
    expect(find.text(_content), findsOneWidget);
  });

  testWidgets('stays closed while a check on its trigger fails', (
    tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    final SurfaceHarness harness = await pumpComponents(
      tester,
      [
        _modal(),
        {
          'id': 'trigger',
          'component': 'Button',
          'child': 'trigger-label',
          'action': {
            'event': {'name': 'open'},
          },
          'checks': [
            {
              'condition': {'path': '/agreed'},
              'message': 'Accept the terms',
            },
          ],
        },
        _text('trigger-label', _trigger),
        _text('content', _content),
      ],
      catalog: _catalog,
      data: {'agreed': false},
    );

    _semanticsTap(tester, find.text(_trigger));
    await tester.pump();
    expect(find.text(_content), findsNothing);
    await _open(tester);
    expect(find.text(_content), findsNothing);
    expect(harness.actions, isEmpty);

    await harness.send([updateDataModel(true, path: '/agreed')]);
    await _open(tester);
    expect(find.text(_content), findsOneWidget);
    expect(harness.actions.single.name, 'open');
    semantics.dispose();
  });

  testWidgets('shows its content in a centered dialog on a wide screen', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(3000, 1800);
    await _pumpExample(tester);

    await _open(tester);

    expect(find.byType(BottomSheet), findsNothing);
    expect(
      find.descendant(of: find.byType(Dialog), matching: find.text(_content)),
      findsOneWidget,
    );
    final Rect dialog = tester.getRect(
      find
          .descendant(of: find.byType(Dialog), matching: find.byType(Material))
          .first,
    );
    expect(dialog.width, 560);
    expect(dialog.center, const Offset(500, 300));

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(find.text(_content), findsNothing);
  });

  group('closes', () {
    testWidgets('on a tap on the barrier', (tester) async {
      await _pumpExample(tester);
      await _open(tester);

      await tester.tapAt(const Offset(10, 10));
      await tester.pump();

      expect(find.text(_content), findsNothing);
      expect(find.text(_trigger), findsOneWidget);
    });

    testWidgets('on the close button', (tester) async {
      await _pumpExample(tester);
      await _open(tester);

      await tester.tap(find.byType(CloseButton));
      await tester.pump();

      expect(find.text(_content), findsNothing);
    });

    testWidgets('on Escape', (tester) async {
      await _pumpExample(tester);
      await _open(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();

      expect(find.text(_content), findsNothing);
    });

    testWidgets('on a back navigation, without leaving the page', (
      tester,
    ) async {
      await _pumpExample(tester);
      await _open(tester);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.text(_content), findsNothing);
      expect(find.text(_trigger), findsOneWidget);
    });

    testWidgets('only the innermost one on a back navigation', (tester) async {
      await pumpComponents(tester, [
        _modal(trigger: 'openA', content: 'a'),
        _text('openA', 'Open A'),
        {
          'id': 'a',
          'component': 'Column',
          'children': ['inA', 'b'],
        },
        _text('inA', 'In A'),
        _modal(id: 'b', trigger: 'openB', content: 'inB'),
        _text('openB', 'Open B'),
        _text('inB', 'In B'),
      ], catalog: _catalog);
      await tester.tap(find.text('Open A'));
      await tester.pump();
      await tester.tap(find.text('Open B'));
      await tester.pump();

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.text('In B'), findsNothing);
      expect(find.text('In A'), findsOneWidget);
    });

    testWidgets('when the Modal is removed', (tester) async {
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['modal'],
          },
          _modal(id: 'modal'),
          _text('trigger', _trigger),
          _text('content', _content),
        ],
        catalog: _catalog,
        validationConfig: _allowOrphans,
      );
      await _open(tester);

      await harness.send([
        updateComponents([
          {'id': 'root', 'component': 'Column', 'children': <Object?>[]},
        ]),
      ]);

      expect(tester.takeException(), isNull);
      expect(find.text(_content), findsNothing);
      expect(find.byType(BottomSheet), findsNothing);
    });
  });

  group('keyboard', () {
    testWidgets('opens when a focused trigger is activated and gives the '
        'focus back to it on close', (tester) async {
      final SurfaceHarness harness = await _pumpExample(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(_focusOf(tester, find.text(_trigger)).hasPrimaryFocus, isTrue);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      await tester.pump();

      expect(find.text(_content), findsOneWidget);
      expect(harness.actions.single.name, 'openModalEvent');
      expect(_focusOf(tester, find.text(_trigger)).hasFocus, isFalse);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();

      expect(find.text(_content), findsNothing);
      expect(_focusOf(tester, find.text(_trigger)).hasPrimaryFocus, isTrue);
    });

    testWidgets('keeps the focus inside the sheet', (tester) async {
      await pumpComponents(tester, [
        _modal(),
        {
          'id': 'trigger',
          'component': 'Button',
          'child': 'trigger-label',
          'action': {
            'event': {'name': 'open'},
          },
        },
        _text('trigger-label', _trigger),
        {
          'id': 'content',
          'component': 'Column',
          'children': ['field', 'submit'],
        },
        {
          'id': 'field',
          'component': 'TextField',
          'label': 'Name',
          'value': {'path': '/name'},
        },
        {
          'id': 'submit',
          'component': 'Button',
          'child': 'submit-label',
          'action': {
            'event': {'name': 'submit'},
          },
        },
        _text('submit-label', 'Submit'),
      ], catalog: _catalog);
      await _open(tester);
      await tester.pump();

      final FocusNode trigger = _focusOf(tester, find.text(_trigger));
      final Finder sheet = find.byType(BottomSheet);
      for (var i = 0; i < 6; i++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pump();
        expect(trigger.hasFocus, isFalse);
        final BuildContext focused =
            FocusManager.instance.primaryFocus!.context!;
        expect(
          find.ancestor(
            of: find.byElementPredicate((e) => e == focused),
            matching: sheet,
          ),
          findsOneWidget,
        );
      }
    });
  });

  group('content', () {
    testWidgets('follows its component and data while open', (tester) async {
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          _modal(),
          _text('trigger', _trigger),
          _text('content', {'path': '/message'}),
        ],
        catalog: _catalog,
        data: {'message': 'Hello'},
        validationConfig: _allowOrphans,
      );
      await _open(tester);
      expect(find.text('Hello'), findsOneWidget);

      await harness.send([updateDataModel('Goodbye', path: '/message')]);

      expect(find.text('Goodbye'), findsOneWidget);

      await harness.send([
        updateComponents([
          _modal(content: 'other'),
          _text('other', 'Other content'),
        ]),
      ]);

      expect(find.text('Other content'), findsOneWidget);
      expect(find.text('Goodbye'), findsNothing);
    });

    testWidgets('writes edits back and sends actions with their context', (
      tester,
    ) async {
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          _modal(),
          _text('trigger', _trigger),
          {
            'id': 'content',
            'component': 'Column',
            'children': ['field', 'submit'],
          },
          {
            'id': 'field',
            'component': 'TextField',
            'label': 'Name',
            'value': {'path': '/name'},
          },
          {
            'id': 'submit',
            'component': 'Button',
            'child': 'submit-label',
            'action': {
              'event': {
                'name': 'submit',
                'context': {
                  'name': {'path': '/name'},
                },
              },
            },
          },
          _text('submit-label', 'Submit'),
        ],
        catalog: _catalog,
        data: {'name': ''},
      );
      await _open(tester);

      await tester.enterText(find.byType(TextField), 'Ada');
      await tester.pump();
      await tester.tap(find.text('Submit'));
      await tester.pump();

      expect(harness.data('/name'), 'Ada');
      expect(harness.actions.single.name, 'submit');
      expect(harness.actions.single.sourceComponentId, 'submit');
      expect(harness.actions.single.context, {'name': 'Ada'});
      expect(find.text('Submit'), findsOneWidget);
    });

    testWidgets('stays open in a List that scrolls its trigger out of view', (
      tester,
    ) async {
      addTearDown(tester.view.reset);
      await pumpComponents(
        tester,
        [
          {
            'id': 'root',
            'component': 'List',
            'children': [for (var i = 0; i < 40; i++) 'item$i', 'modal'],
          },
          for (var i = 0; i < 40; i++) _text('item$i', 'Item $i'),
          _modal(id: 'modal'),
          _text('trigger', _trigger),
          _text('content', _content),
        ],
        catalog: _catalog,
        host: boundedHost,
      );
      await tester.scrollUntilVisible(find.text(_trigger).hitTestable(), 200);
      await _open(tester);

      tester.view.physicalSize = const Size(2400, 600);
      await tester.pumpAndSettle();

      expect(
        find.text(_content, skipOffstage: false).hitTestable(),
        findsOneWidget,
      );
    });

    testWidgets('sits above the keyboard', (tester) async {
      tester.view
        ..physicalSize = const Size(400, 800)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await pumpComponents(tester, [
        _modal(),
        _text('trigger', _trigger),
        {
          'id': 'content',
          'component': 'Column',
          'children': ['a', 'b', 'c', 'field'],
        },
        _text('a', 'A'),
        _text('b', 'B'),
        _text('c', 'C'),
        {'id': 'field', 'component': 'TextField', 'label': 'Name'},
      ], catalog: _catalog);
      await _open(tester);
      await tester.showKeyboard(find.byType(TextField));

      tester.view.viewInsets = const FakeViewPadding(bottom: 350);
      await tester.pumpAndSettle();

      final Rect sheet = tester.getRect(find.byType(BottomSheet));
      expect(sheet.bottom, 450);
      expect(
        tester.getRect(find.byType(TextField)).bottom,
        lessThanOrEqualTo(450),
      );
      expect(sheet.height, lessThanOrEqualTo(450 * 0.9));
    });

    testWidgets('keeps its edits when the screen turns wide', (tester) async {
      await pumpComponents(tester, [
        _modal(),
        _text('trigger', _trigger),
        {'id': 'content', 'component': 'TextField', 'label': 'Name'},
      ], catalog: _catalog);
      await _open(tester);
      await tester.enterText(find.byType(TextField), 'Ada');
      await tester.pump();
      final State field = tester.state(find.byType(EditableText));

      tester.view.physicalSize = const Size(3000, 1800);
      await tester.pump();

      expect(find.byType(Dialog), findsOneWidget);
      expect(tester.state(find.byType(EditableText)), same(field));
      expect(find.text('Ada'), findsOneWidget);
    });

    testWidgets('opens empty while its content is missing', (tester) async {
      await pumpComponents(
        tester,
        [_modal(content: 'missing'), _text('trigger', _trigger)],
        catalog: _catalog,
        validationConfig: ValidationConfig.relaxed,
      );

      await _open(tester);

      expect(tester.takeException(), isNull);
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(find.byType(CloseButton), findsOneWidget);
    });
  });
}
