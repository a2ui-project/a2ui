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
import '../../support/surface_harness.dart';

final WidgetCatalog _catalog = basicTestCatalog([BasicComponents.choicePicker]);

const List<Map<String, Object?>> _fruit = [
  {'label': 'Apple', 'value': 'apple'},
  {'label': 'Banana', 'value': 'banana'},
  {'label': 'Cherry', 'value': 'cherry'},
];

Future<SurfaceHarness> _pumpPicker(
  WidgetTester tester,
  Map<String, Object?> props, {
  Map<String, Object?>? data,
}) => pumpComponents(
  tester,
  [
    {'id': 'root', 'component': 'ChoicePicker', 'options': _fruit, ...props},
  ],
  catalog: _catalog,
  data: data,
);

bool _radioSelected(WidgetTester tester, String label) {
  final RadioGroup<String> group = tester.widget<RadioGroup<String>>(
    find.byType(RadioGroup<String>),
  );
  final RadioListTile<String> tile = tester.widget<RadioListTile<String>>(
    find.widgetWithText(RadioListTile<String>, label),
  );
  return group.groupValue == tile.value;
}

bool? _checked(WidgetTester tester, String label) => tester
    .widget<CheckboxListTile>(find.widgetWithText(CheckboxListTile, label))
    .value;

void main() {
  group('mutuallyExclusive', () {
    testWidgets('is the default and shows radio buttons under the label', (
      tester,
    ) async {
      await _pumpPicker(
        tester,
        {
          'label': 'Fruit',
          'value': {'path': '/fruit'},
        },
        data: {
          'fruit': ['banana'],
        },
      );

      expect(find.text('Fruit'), findsOneWidget);
      expect(find.byType(RadioListTile<String>), findsNWidgets(3));
      expect(find.byType(CheckboxListTile), findsNothing);
      expect(find.byType(TextField), findsNothing);
      expect(_radioSelected(tester, 'Banana'), isTrue);
      expect(_radioSelected(tester, 'Apple'), isFalse);
    });

    testWidgets('writes the picked option as a one-item list', (tester) async {
      final SurfaceHarness harness = await _pumpPicker(
        tester,
        {
          'value': {'path': '/fruit'},
        },
        data: {
          'fruit': ['banana'],
        },
      );

      await tester.tap(find.text('Cherry'));
      await tester.pump();

      expect(harness.data('/fruit'), ['cherry']);
      expect(_radioSelected(tester, 'Cherry'), isTrue);
      expect(_radioSelected(tester, 'Banana'), isFalse);
    });
  });

  group('multipleSelection', () {
    testWidgets('shows checkboxes and toggles values in pick order', (
      tester,
    ) async {
      final SurfaceHarness harness = await _pumpPicker(
        tester,
        {
          'variant': 'multipleSelection',
          'value': {'path': '/fruit'},
        },
        data: {
          'fruit': ['banana'],
        },
      );
      expect(find.byType(CheckboxListTile), findsNWidgets(3));
      expect(find.byType(RadioListTile<String>), findsNothing);
      expect(_checked(tester, 'Banana'), isTrue);

      await tester.tap(find.text('Cherry'));
      await tester.pump();
      expect(harness.data('/fruit'), ['banana', 'cherry']);

      await tester.tap(find.text('Apple'));
      await tester.pump();
      expect(harness.data('/fruit'), ['banana', 'cherry', 'apple']);

      await tester.tap(find.text('Banana'));
      await tester.pump();
      expect(harness.data('/fruit'), ['cherry', 'apple']);
      expect(_checked(tester, 'Banana'), isFalse);
      expect(_checked(tester, 'Cherry'), isTrue);
    });
  });

  group('chips', () {
    testWidgets('use choice chips for one value', (tester) async {
      final SurfaceHarness harness = await _pumpPicker(
        tester,
        {
          'displayStyle': 'chips',
          'value': {'path': '/fruit'},
        },
        data: {
          'fruit': ['apple'],
        },
      );
      expect(find.byType(ChoiceChip), findsNWidgets(3));
      expect(find.byType(RadioListTile<String>), findsNothing);

      await tester.tap(find.text('Banana'));
      await tester.pump();

      expect(harness.data('/fruit'), ['banana']);
      expect(
        tester
            .widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Banana'))
            .selected,
        isTrue,
      );
      expect(
        tester
            .widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Apple'))
            .selected,
        isFalse,
      );
    });

    testWidgets('use filter chips for several values', (tester) async {
      final SurfaceHarness harness = await _pumpPicker(
        tester,
        {
          'variant': 'multipleSelection',
          'displayStyle': 'chips',
          'value': {'path': '/fruit'},
        },
        data: {
          'fruit': ['apple'],
        },
      );
      expect(find.byType(FilterChip), findsNWidgets(3));

      await tester.tap(find.text('Cherry'));
      await tester.pump();
      expect(harness.data('/fruit'), ['apple', 'cherry']);

      await tester.tap(find.text('Apple'));
      await tester.pump();
      expect(harness.data('/fruit'), ['cherry']);
      expect(
        tester
            .widget<FilterChip>(find.widgetWithText(FilterChip, 'Apple'))
            .selected,
        isFalse,
      );
    });
  });

  group('filterable', () {
    testWidgets('filters options by label, ignoring case', (tester) async {
      final SurfaceHarness harness = await _pumpPicker(
        tester,
        {
          'variant': 'multipleSelection',
          'filterable': true,
          'value': {'path': '/fruit'},
        },
        data: {
          'fruit': ['apple'],
        },
      );
      expect(find.byType(TextField), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'AN');
      await tester.pump();

      expect(find.text('Banana'), findsOneWidget);
      expect(find.text('Apple'), findsNothing);
      expect(find.text('Cherry'), findsNothing);

      await tester.tap(find.text('Banana'));
      await tester.pump();
      expect(harness.data('/fruit'), ['apple', 'banana']);

      await tester.enterText(find.byType(TextField), '');
      await tester.pump();
      expect(find.byType(CheckboxListTile), findsNWidgets(3));
      expect(_checked(tester, 'Apple'), isTrue);
    });
  });

  testWidgets('reads bound option labels', (tester) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      [
        {
          'id': 'root',
          'component': 'ChoicePicker',
          'options': [
            {
              'label': {'path': '/labels/small'},
              'value': 's',
            },
            {'label': 'Large', 'value': 'l'},
          ],
          'value': {'path': '/size'},
        },
      ],
      catalog: _catalog,
      data: {
        'labels': {'small': 'Small'},
        'size': ['s'],
      },
    );
    expect(find.text('Small'), findsOneWidget);
    expect(_radioSelected(tester, 'Small'), isTrue);

    await harness.send([updateDataModel('Petite', path: '/labels/small')]);

    expect(find.text('Petite'), findsOneWidget);
    expect(find.text('Small'), findsNothing);
  });

  testWidgets('is disabled with a literal value and follows the payload', (
    tester,
  ) async {
    final SurfaceHarness harness = await _pumpPicker(tester, {
      'variant': 'multipleSelection',
      'value': ['apple'],
    });

    await tester.tap(find.text('Banana'));
    await tester.pump();
    expect(_checked(tester, 'Apple'), isTrue);
    expect(_checked(tester, 'Banana'), isFalse);

    await harness.send([
      updateComponents([
        {
          'id': 'root',
          'component': 'ChoicePicker',
          'variant': 'multipleSelection',
          'options': _fruit,
          'value': ['cherry'],
        },
      ]),
    ]);
    expect(_checked(tester, 'Apple'), isFalse);
    expect(_checked(tester, 'Banana'), isFalse);
    expect(_checked(tester, 'Cherry'), isTrue);
  });

  testWidgets('shows the first failing check and clears it when it passes', (
    tester,
  ) async {
    final SurfaceHarness harness = await _pumpPicker(
      tester,
      {
        'value': {'path': '/fruit'},
        'checks': [
          {
            'condition': {'path': '/ok'},
            'message': 'Pick a fruit',
          },
          {'condition': false, 'message': 'Second'},
        ],
      },
      data: {'fruit': <String>[], 'ok': false},
    );
    expect(find.text('Pick a fruit'), findsOneWidget);
    expect(find.text('Second'), findsNothing);

    await harness.send([updateDataModel(true, path: '/ok')]);
    expect(find.text('Pick a fruit'), findsNothing);
    expect(find.text('Second'), findsOneWidget);
  });
}
