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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/fixture_catalog.dart';
import '../../support/surface_harness.dart';

/// The size of the default test surface.
const double _width = 800;
const double _height = 600;

WidgetCatalog _catalog([FixtureLog? log]) => basicTestCatalog([
  BasicComponents.list,
  BasicComponents.column,
  BasicComponents.row,
  BasicComponents.text,
  BasicComponents.textField,
  fixtureCatalog(log).components['Probe']!,
]);

Map<String, Object?> _list(
  Object children, {
  String id = 'root',
  String? direction,
  String? align,
}) => {
  'id': id,
  'component': 'List',
  'children': children,
  'direction': ?direction,
  'align': ?align,
};

Map<String, Object?> _text(String id, String text, {num? weight}) => {
  'id': id,
  'component': 'Text',
  'text': text,
  'weight': ?weight,
};

/// A template list over `/items`, each item a Text of its `name`.
List<Map<String, Object?>> _templateList({String? direction}) => [
  _list({'componentId': 'item', 'path': '/items'}, direction: direction),
  {
    'id': 'item',
    'component': 'Text',
    'text': {'path': 'name'},
  },
];

List<Object?> _items(int count, [String prefix = 'Item']) => <Object?>[
  for (var i = 0; i < count; i++) {'name': '$prefix $i'},
];

/// The scroll position of the only List on the surface.
ScrollPosition _listPosition(WidgetTester tester) => tester
    .state<ScrollableState>(
      find.descendant(
        of: find.byType(A2uiSurface),
        matching: find.byType(Scrollable),
      ),
    )
    .position;

void main() {
  group('on an unbounded main axis', () {
    testWidgets('lays its children out top to bottom with the gap', (
      tester,
    ) async {
      await pumpComponents(tester, [
        _list(['a', 'b']),
        _text('a', 'A'),
        _text('b', 'B'),
      ], catalog: _catalog());

      expect(_listPosition(tester).maxScrollExtent, 0);
      expect(
        tester.getTopLeft(find.text('B')).dy,
        tester.getBottomLeft(find.text('A')).dy + flexGap,
      );
    });

    testWidgets('stretches its children to its width by default', (
      tester,
    ) async {
      await pumpComponents(tester, [
        _list(['a']),
        _text('a', 'A'),
      ], catalog: _catalog());

      expect(tester.getSize(find.text('A')).width, _width);
    });
  });

  group('on a bounded main axis', () {
    testWidgets('scrolls its children', (tester) async {
      await pumpComponents(
        tester,
        _templateList(),
        catalog: _catalog(),
        data: {'items': _items(100)},
        host: boundedHost,
      );

      expect(find.text('Item 0').hitTestable(), findsOneWidget);
      expect(find.text('Item 99').hitTestable(), findsNothing);

      await tester.scrollUntilVisible(find.text('Item 99').hitTestable(), 200);

      expect(find.text('Item 99').hitTestable(), findsOneWidget);
    });

    testWidgets('aligns its children on the cross axis by align', (
      tester,
    ) async {
      for (final (String? direction, String align, Alignment expected) in [
        (null, 'start', Alignment.topLeft),
        (null, 'center', Alignment.topCenter),
        (null, 'end', Alignment.topRight),
        ('horizontal', 'end', Alignment.bottomLeft),
      ]) {
        await pumpComponents(
          tester,
          [
            _list(['a'], direction: direction, align: align),
            _text('a', 'A'),
          ],
          catalog: _catalog(),
          host: boundedHost,
        );

        final Rect rect = tester.getRect(find.text('A'));
        final reason = '$direction $align';
        expect(
          expected.withinRect(rect),
          expected.withinRect(tester.getRect(find.byType(A2uiSurface))),
          reason: reason,
        );
        expect(rect.width, lessThan(_width), reason: reason);
        expect(rect.height, lessThan(_height), reason: reason);
      }
    });

    for (final (name, host) in [
      ('scrolling', scrollingHost),
      ('bounded', boundedHost),
    ]) {
      testWidgets('scrolls a horizontal list instead of narrowing it, in a '
          '$name host', (tester) async {
        await pumpComponents(
          tester,
          _templateList(direction: 'horizontal'),
          catalog: _catalog(),
          data: {'items': _items(40, 'Wide item')},
          host: host,
        );

        expect(tester.takeException(), isNull);
        expect(
          tester.getTopLeft(find.text('Wide item 1')).dx,
          tester.getTopRight(find.text('Wide item 0')).dx + flexGap,
        );
        expect(find.text('Wide item 39').hitTestable(), findsNothing);

        await tester.drag(find.text('Wide item 0'), const Offset(-400, 0));
        await tester.pump();

        expect(tester.getTopLeft(find.text('Wide item 0')).dx, lessThan(0));
      });
    }

    testWidgets('fills a weighted Column slot and scrolls inside it', (
      tester,
    ) async {
      await pumpComponents(
        tester,
        [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['title', 'list'],
          },
          _text('title', 'Title'),
          {..._templateList().first, 'id': 'list', 'weight': 1},
          _templateList().last,
        ],
        catalog: _catalog(),
        data: {'items': _items(100)},
        host: boundedHost,
      );

      expect(tester.getBottomLeft(find.byType(Scrollable)).dy, _height);
      expect(_listPosition(tester).maxScrollExtent, greaterThan(0));
    });
  });

  group('children', () {
    for (final (name, host) in [
      ('scrolling', scrollingHost),
      ('bounded', boundedHost),
    ]) {
      testWidgets('keep their state in a Row beside a taller sibling, in a '
          '$name host', (tester) async {
        final log = FixtureLog();
        addTearDown(tester.view.reset);
        final SurfaceHarness harness = await pumpComponents(
          tester,
          [
            {
              'id': 'root',
              'component': 'Row',
              'children': ['list', 'side'],
            },
            _list(['field', 'probe'], id: 'list'),
            {'id': 'field', 'component': 'TextField', 'label': 'Name'},
            {'id': 'probe', 'component': 'Probe', 'label': 'Probe'},
            {
              'id': 'side',
              'component': 'Column',
              'children': [for (var i = 0; i < 8; i++) 'line$i'],
            },
            for (var i = 0; i < 8; i++) _text('line$i', 'Line $i'),
          ],
          catalog: _catalog(log),
          host: host,
        );

        await tester.tap(find.byType(TextField));
        await tester.pumpAndSettle();
        final EditableTextState editable = tester.state(
          find.byType(EditableText),
        );
        expect(editable.widget.focusNode.hasFocus, isTrue);
        tester.testTextInput.enterText('typed');
        await tester.pump();
        await harness.send([
          updateComponents([_text('line0', 'Line 0 changed')]),
        ]);
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();

        expect(tester.state(find.byType(EditableText)), same(editable));
        expect(editable.widget.focusNode.hasFocus, isTrue);
        expect(editable.textEditingValue.text, 'typed');
        expect(log.probeStates, ['probe']);
      });
    }

    testWidgets('switch between vertical and horizontal', (tester) async {
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          _list(['a', 'b']),
          _text('a', 'A'),
          _text('b', 'B'),
        ],
        catalog: _catalog(),
        host: boundedHost,
      );
      expect(
        tester.getTopLeft(find.text('B')).dy,
        greaterThan(tester.getTopLeft(find.text('A')).dy),
      );

      await harness.send([
        updateComponents([
          _list(['a', 'b'], direction: 'horizontal'),
        ]),
      ]);

      expect(
        tester.getTopLeft(find.text('B')).dx,
        greaterThan(tester.getTopRight(find.text('A')).dx),
      );
    });

    testWidgets('render nothing for an empty list', (tester) async {
      await pumpComponents(
        tester,
        _templateList(),
        catalog: _catalog(),
        data: {'items': <Object?>[]},
        host: boundedHost,
      );

      expect(tester.takeException(), isNull);
      expect(find.byType(Text), findsNothing);
    });
  });
}
