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

final WidgetCatalog _catalog = basicTestCatalog([BasicComponents.slider]);

Slider _slider(WidgetTester tester) =>
    tester.widget<Slider>(find.byType(Slider));

Future<SurfaceHarness> _pumpSlider(
  WidgetTester tester,
  Map<String, Object?> props, {
  Map<String, Object?>? data,
}) => pumpComponents(
  tester,
  [
    {'id': 'root', 'component': 'Slider', ...props},
  ],
  catalog: _catalog,
  data: data,
);

void main() {
  testWidgets('shows its label and value over a range from 0', (tester) async {
    await _pumpSlider(
      tester,
      {
        'label': 'Volume',
        'max': 10,
        'value': {'path': '/volume'},
      },
      data: {'volume': 4},
    );

    expect(find.text('Volume'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    final Slider slider = _slider(tester);
    expect(slider.min, 0);
    expect(slider.max, 10);
    expect(slider.value, 4);
    expect(slider.divisions, 10);
  });

  testWidgets('writes a drag to the bound path', (tester) async {
    final SurfaceHarness harness = await _pumpSlider(
      tester,
      {
        'min': 0,
        'max': 10,
        'value': {'path': '/volume'},
      },
      data: {'volume': 0},
    );

    await tester.tap(find.byType(Slider));
    await tester.pump();

    expect(harness.data('/volume'), 5);
    expect(_slider(tester).value, 5);
    expect(find.text('5'), findsOneWidget);
  });

  testWidgets('writes values on the grid of steps from min', (tester) async {
    final SurfaceHarness harness = await _pumpSlider(
      tester,
      {
        'min': 1,
        'max': 6,
        'value': {'path': '/n'},
      },
      data: {'n': 1},
    );
    expect(_slider(tester).divisions, 5);

    _slider(tester).onChanged!(3.0000000004);
    expect(harness.data('/n'), isA<int>().having((n) => n, 'value', 3));

    _slider(tester).onChanged!(4.6);
    expect(harness.data('/n'), isA<int>().having((n) => n, 'value', 5));
  });

  testWidgets('writes a whole value from 2^53 up as a double', (tester) async {
    final SurfaceHarness harness = await _pumpSlider(
      tester,
      {
        'min': 1e20,
        'max': 2e20,
        'value': {'path': '/n'},
      },
      data: {'n': 1e20},
    );

    _slider(tester).onChanged!(1.5e20);

    expect(harness.data('/n'), isA<double>().having((n) => n, 'value', 1.5e20));
  });

  testWidgets('moves continuously over a range that is not a whole number '
      'from 2 to 1000', (tester) async {
    for (final (double min, double max) in [
      (0, 0.5),
      (0, 1),
      (0.5, 2),
      (0, 1001),
    ]) {
      final SurfaceHarness harness = await _pumpSlider(
        tester,
        {
          'min': min,
          'max': max,
          'value': {'path': '/n'},
        },
        data: {'n': min},
      );
      expect(_slider(tester).divisions, isNull, reason: '$min to $max');

      _slider(tester).onChanged!(min + 0.25);
      expect(harness.data('/n'), min + 0.25, reason: '$min to $max');
    }
  });

  testWidgets('renders a range too large for a double, disabled', (
    tester,
  ) async {
    await _pumpSlider(
      tester,
      {
        'min': -1e308,
        'max': 1e308,
        'value': {'path': '/n'},
      },
      data: {'n': 0},
    );

    expect(tester.takeException(), isNull);
    expect(_slider(tester).divisions, isNull);
    expect(_slider(tester).onChanged, isNull);
  });

  testWidgets('is disabled with a literal value and follows the payload', (
    tester,
  ) async {
    final SurfaceHarness harness = await _pumpSlider(tester, {
      'max': 10,
      'value': 2,
    });
    expect(_slider(tester).onChanged, isNull);

    await harness.send([
      updateComponents([
        {'id': 'root', 'component': 'Slider', 'max': 10, 'value': 3},
      ]),
    ]);
    expect(_slider(tester).value, 3);
  });

  testWidgets('clamps a value outside the range', (tester) async {
    final SurfaceHarness harness = await _pumpSlider(
      tester,
      {
        'min': 10,
        'max': 20,
        'value': {'path': '/n'},
      },
      data: {'n': 50},
    );
    expect(_slider(tester).value, 20);

    await harness.send([updateDataModel(-5, path: '/n')]);
    expect(_slider(tester).value, 10);
    expect(harness.data('/n'), -5);
  });

  testWidgets('starts at min when the bound value is missing', (tester) async {
    await _pumpSlider(tester, {
      'min': 3,
      'max': 9,
      'value': {'path': '/missing'},
    }, data: {});

    expect(_slider(tester).value, 3);
  });

  testWidgets('collapses a max below min onto min', (tester) async {
    await _pumpSlider(tester, {'min': 5, 'max': 1, 'value': 3});

    final Slider slider = _slider(tester);
    expect(slider.min, 5);
    expect(slider.max, 5);
    expect(slider.value, 5);
    expect(slider.divisions, isNull);
  });

  testWidgets('shows the first failing check and clears it when it passes', (
    tester,
  ) async {
    final SurfaceHarness harness = await _pumpSlider(
      tester,
      {
        'max': 10,
        'value': {'path': '/n'},
        'checks': [
          {
            'condition': {'path': '/ok'},
            'message': 'Pick a higher value',
          },
        ],
      },
      data: {'n': 1, 'ok': false},
    );
    expect(find.text('Pick a higher value'), findsOneWidget);

    await harness.send([updateDataModel(true, path: '/ok')]);
    expect(find.text('Pick a higher value'), findsNothing);
  });
}
