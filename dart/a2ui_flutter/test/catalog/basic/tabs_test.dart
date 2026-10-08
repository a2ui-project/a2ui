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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/fixture_catalog.dart';
import '../../support/surface_harness.dart';

WidgetCatalog _catalog([FixtureLog? log]) => basicTestCatalog([
  BasicComponents.tabs,
  BasicComponents.list,
  BasicComponents.column,
  BasicComponents.row,
  BasicComponents.text,
  BasicComponents.button,
  BasicComponents.textField,
  fixtureCatalog(log).components['Probe']!,
]);

Map<String, Object?> _tabs(List<(Object, String)> tabs, {String id = 'root'}) =>
    {
      'id': id,
      'component': 'Tabs',
      'tabs': [
        for (final (title, child) in tabs) {'title': title, 'child': child},
      ],
    };

Map<String, Object?> _text(String id, String text) => {
  'id': id,
  'component': 'Text',
  'text': text,
};

/// Three tabs titled One, Two and Three over texts First, Second and Third.
final List<Map<String, Object?>> _threeTabs = [
  _tabs([('One', 'first'), ('Two', 'second'), ('Three', 'third')]),
  _text('first', 'First'),
  _text('second', 'Second'),
  _text('third', 'Third'),
];

Future<void> _select(WidgetTester tester, String title) async {
  await tester.tap(find.widgetWithText(Tab, title));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows every title and the child of the tab the user selects', (
    tester,
  ) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      _threeTabs,
      catalog: _catalog(),
    );
    for (final title in ['One', 'Two', 'Three']) {
      expect(find.widgetWithText(Tab, title), findsOneWidget);
    }
    expect(find.text('First'), findsOneWidget);
    expect(find.text('Second'), findsNothing);
    expect(find.text('Third'), findsNothing);

    await _select(tester, 'Three');

    expect(find.text('Third'), findsOneWidget);
    expect(find.text('First'), findsNothing);
    expect(harness.actions, isEmpty);

    await _select(tester, 'One');

    expect(find.text('First'), findsOneWidget);
    expect(find.text('Third'), findsNothing);
  });

  testWidgets('follows bound titles', (tester) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      [
        _tabs([
          (const {'path': '/title'}, 'first'),
          (const {'path': '/count'}, 'second'),
        ]),
        _text('first', 'First'),
        _text('second', 'Second'),
      ],
      catalog: _catalog(),
      data: {'title': 'Inbox', 'count': 3.0},
    );

    expect(find.widgetWithText(Tab, 'Inbox'), findsOneWidget);
    expect(find.widgetWithText(Tab, '3'), findsOneWidget);

    await harness.send([updateDataModel('Archive', path: '/title')]);

    expect(find.widgetWithText(Tab, 'Archive'), findsOneWidget);
  });

  testWidgets('keeps the selection when the component is updated', (
    tester,
  ) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      _threeTabs,
      catalog: _catalog(),
    );
    await _select(tester, 'Two');

    await harness.send([
      updateComponents([
        _tabs([('Uno', 'first'), ('Dos', 'second'), ('Tres', 'third')]),
      ]),
    ]);

    expect(find.widgetWithText(Tab, 'Dos'), findsOneWidget);
    expect(find.text('Second'), findsOneWidget);
  });

  testWidgets('selects the last tab when the selected one is removed', (
    tester,
  ) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      _threeTabs,
      catalog: _catalog(),
      validationConfig: const ValidationConfig(allowOrphanComponents: true),
    );
    await _select(tester, 'Three');

    await harness.send([
      updateComponents([
        _tabs([('One', 'first'), ('Two', 'second')]),
      ]),
    ]);
    await tester.pumpAndSettle();

    expect(find.widgetWithText(Tab, 'Three'), findsNothing);
    expect(find.text('Second'), findsOneWidget);

    await _select(tester, 'One');

    expect(find.text('First'), findsOneWidget);
  });

  testWidgets('shows a new child when the selected tab is repointed', (
    tester,
  ) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      _threeTabs,
      catalog: _catalog(),
    );

    await harness.send([
      updateComponents([
        _tabs([('One', 'third'), ('Two', 'second'), ('Three', 'first')]),
      ]),
    ]);

    expect(find.text('Third'), findsOneWidget);
    expect(find.text('First'), findsNothing);
  });

  testWidgets('builds a tab child afresh each time it is selected', (
    tester,
  ) async {
    final log = FixtureLog();
    await pumpComponents(tester, [
      _tabs([('One', 'a'), ('Two', 'b')]),
      {'id': 'a', 'component': 'Probe', 'label': 'A'},
      {'id': 'b', 'component': 'Probe', 'label': 'B'},
    ], catalog: _catalog(log));

    await _select(tester, 'Two');
    await _select(tester, 'One');

    expect(log.probeStates, ['a', 'b', 'a']);
  });

  testWidgets('is as tall as its header and the selected child', (
    tester,
  ) async {
    await pumpComponents(tester, _threeTabs, catalog: _catalog());

    final Rect tabs = tester.getRect(find.byType(TabBar).first);
    final Rect child = tester.getRect(find.text('First'));
    final double height = tester
        .getSize(find.byType(DefaultTabController))
        .height;

    expect(height, child.bottom - tabs.top);
    expect(height, lessThan(100));
  });

  for (final (name, weighted) in [
    ('a weighted Column slot', true),
    ('a bounded root', false),
  ]) {
    testWidgets('scrolls a List in the selected child in $name', (
      tester,
    ) async {
      final List<Map<String, Object?>> tabs = [
        _tabs([('Feed', 'feed')], id: weighted ? 'tabs' : 'root'),
        {
          'id': 'feed',
          'component': 'List',
          'children': [for (var i = 0; i < 60; i++) 'line$i'],
        },
        for (var i = 0; i < 60; i++) _text('line$i', 'Line $i'),
      ];
      await pumpComponents(
        tester,
        [
          if (weighted) ...[
            {
              'id': 'root',
              'component': 'Column',
              'children': ['title', 'tabs'],
            },
            _text('title', 'Title'),
            {...tabs.first, 'weight': 1},
            ...tabs.skip(1),
          ] else
            ...tabs,
        ],
        catalog: _catalog(),
        host: boundedHost,
      );

      expect(tester.takeException(), isNull);
      final ScrollableState feed = tester.state(
        find
            .descendant(
              of: find.byType(A2uiSurface),
              matching: find.byType(Scrollable),
            )
            .last,
      );
      expect(feed.position.maxScrollExtent, greaterThan(0));
      expect(tester.getBottomLeft(find.byWidget(feed.widget)).dy, 600);
    });
  }

  testWidgets('keeps the selected child when it gains a weight', (
    tester,
  ) async {
    final List<Map<String, Object?>> components = [
      {
        'id': 'root',
        'component': 'Column',
        'children': ['tabs'],
      },
      _tabs([('Form', 'field')], id: 'tabs'),
      {'id': 'field', 'component': 'TextField', 'label': 'Name'},
    ];
    final SurfaceHarness harness = await pumpComponents(
      tester,
      components,
      catalog: _catalog(),
      host: boundedHost,
    );
    await tester.enterText(find.byType(TextField), 'Ada');
    await tester.pump();
    final State field = tester.state(find.byType(EditableText));

    await harness.send([
      updateComponents([
        {...components[1], 'weight': 1},
      ]),
    ]);

    expect(tester.state(find.byType(EditableText)), same(field));
    expect(find.text('Ada'), findsOneWidget);
  });

  testWidgets('fills a bounded width', (tester) async {
    await pumpComponents(tester, _threeTabs, catalog: _catalog());

    expect(tester.getSize(find.byType(TabBar)).width, 800);
    expect(tester.getSize(find.text('First')).width, 800 - 2 * 8);
  });

  testWidgets('lays out on an unbounded width', (tester) async {
    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'List',
        'direction': 'horizontal',
        'children': ['tabs', 'after'],
      },
      ..._threeTabs.map((c) => c['id'] == 'root' ? {...c, 'id': 'tabs'} : c),
      _text('after', 'After'),
    ], catalog: _catalog());

    expect(tester.takeException(), isNull);
    expect(find.text('First'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('After')).dx,
      greaterThan(tester.getTopRight(find.widgetWithText(Tab, 'Three')).dx),
    );
  });
}
