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
import 'package:a2ui_flutter/v0_9/basic_catalog.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/surface_harness.dart';

final CatalogImplementation _catalog = basicTestCatalog([
  BasicComponents.dateTimeInput,
  BasicComponents.slider,
  BasicComponents.tabs,
  BasicComponents.text,
  BasicComponents.textField,
]);

Future<SurfaceHarness> _pump(
  WidgetTester tester,
  List<Map<String, Object?>> components, {
  Map<String, Object?>? data,
  ValidationConfig? validationConfig = ValidationConfig.strict,
}) => pumpComponents(
  tester,
  components,
  catalog: _catalog,
  data: data,
  validationConfig: validationConfig,
);

/// Replaces a rendered Text with [component] and expects the update to be
/// rejected and reported, leaving the Text in place.
///
/// The processor has no validation config: the schema check does not depend
/// on one.
Future<void> _expectRejected(
  WidgetTester tester,
  Map<String, Object?> component,
) async {
  final SurfaceHarness harness = await _pump(tester, [
    {'id': 'root', 'component': 'Text', 'text': 'Before'},
  ], validationConfig: null);

  expect(
    () => harness.process([
      updateComponents([
        {'id': 'root', ...component},
      ]),
    ]),
    throwsA(isA<A2uiValidationError>()),
  );
  await tester.pump();

  expect(tester.takeException(), isNull);
  expect(find.text('Before'), findsOneWidget);
  expect(harness.errorCodes, ['VALIDATION_FAILED']);
}

Slider _slider(WidgetTester tester) =>
    tester.widget<Slider>(find.byType(Slider));

// Properties an agent got wrong. A literal is checked against the component's
// schema while the message is processed, so one of the wrong type is rejected
// before it reaches a widget. What a bound path holds is not checked, so the
// values a widget must survive arrive through bindings.
void main() {
  group('Slider', () {
    testWidgets('shows a value above max at max', (tester) async {
      await _pump(tester, [
        {'id': 'root', 'component': 'Slider', 'value': 42, 'min': 0, 'max': 10},
      ]);

      expect(tester.takeException(), isNull);
      expect(_slider(tester).max, 10);
      expect(_slider(tester).value, 10);
    });

    testWidgets('shows a max below min as an empty range', (tester) async {
      await _pump(tester, [
        {'id': 'root', 'component': 'Slider', 'value': 0, 'min': 0, 'max': -1},
      ]);

      expect(tester.takeException(), isNull);
      final Slider slider = _slider(tester);
      expect(slider.min, 0);
      expect(slider.max, 0);
      expect(slider.value, 0);
    });

    for (final (String name, Object? value) in [
      ('a string', 'ten'),
      ('a list', <Object?>[]),
    ]) {
      testWidgets('starts at min when the bound value is $name', (
        tester,
      ) async {
        await _pump(
          tester,
          [
            {
              'id': 'root',
              'component': 'Slider',
              'min': 2,
              'max': 8,
              'value': {'path': '/volume'},
            },
          ],
          data: {'volume': value},
        );

        expect(tester.takeException(), isNull);
        expect(_slider(tester).value, 2);
      });
    }

    for (final (String name, Map<String, Object?> props) in [
      ('a max that is a string', {'value': 0.5, 'max': 'ten'}),
      ('a max that is a list', {'value': 0.5, 'max': <Object?>[]}),
      (
        'a max bound to a path',
        {
          'value': 0.5,
          'max': {'path': '/max'},
        },
      ),
      (
        'checks that are a string',
        {'value': 0.5, 'max': 1, 'checks': 'required'},
      ),
    ]) {
      testWidgets('rejects $name before it renders', (tester) async {
        await _expectRejected(tester, {'component': 'Slider', ...props});
      });
    }
  });

  group('TextField', () {
    Future<void> pumpBound(WidgetTester tester, Object? value) => _pump(
      tester,
      [
        {
          'id': 'root',
          'component': 'TextField',
          'label': 'Name',
          'value': {'path': '/name'},
        },
      ],
      data: {'name': value},
    );

    String text(WidgetTester tester) =>
        tester.widget<TextField>(find.byType(TextField)).controller!.text;

    testWidgets('is empty when the bound value is a list', (tester) async {
      await pumpBound(tester, <Object?>[]);

      expect(tester.takeException(), isNull);
      expect(text(tester), isEmpty);
    });

    testWidgets('shows a bound number as text', (tester) async {
      await pumpBound(tester, 42);

      expect(tester.takeException(), isNull);
      expect(text(tester), '42');
    });

    for (final (String name, Object? variant) in [
      ('a list', <Object?>[]),
      ('a number', 42),
    ]) {
      testWidgets('rejects a variant that is $name before it renders', (
        tester,
      ) async {
        await _expectRejected(tester, {
          'component': 'TextField',
          'label': 'Name',
          'variant': variant,
        });
      });
    }
  });

  group('DateTimeInput', () {
    Future<void> pumpBound(WidgetTester tester, Object? value) => _pump(
      tester,
      [
        {
          'id': 'root',
          'component': 'DateTimeInput',
          'value': {'path': '/date'},
        },
      ],
      data: {'date': value},
    );

    testWidgets('is empty when the bound value is a list', (tester) async {
      await pumpBound(tester, <Object?>[]);

      expect(tester.takeException(), isNull);
      expect(
        tester.widget<InputDecorator>(find.byType(InputDecorator)).isEmpty,
        isTrue,
      );
    });

    testWidgets('renders a bound number', (tester) async {
      await pumpBound(tester, 42);

      expect(tester.takeException(), isNull);
      expect(find.byType(InputDecorator), findsOneWidget);
    });

    for (final (String name, Map<String, Object?> props) in [
      ('a value that is a number', {'value': 42}),
      ('a value that is a list', {'value': <Object?>[]}),
      (
        'an enableDate that is a string',
        {'value': '2026-01-15', 'enableDate': 'yes'},
      ),
    ]) {
      testWidgets('rejects $name before it renders', (tester) async {
        await _expectRejected(tester, {'component': 'DateTimeInput', ...props});
      });
    }
  });

  group('Tabs', () {
    testWidgets('shows an empty title when the bound title is a list', (
      tester,
    ) async {
      await _pump(
        tester,
        [
          {
            'id': 'root',
            'component': 'Tabs',
            'tabs': [
              {
                'title': {'path': '/title'},
                'child': 'inbox',
              },
            ],
          },
          {'id': 'inbox', 'component': 'Text', 'text': 'Inbox'},
        ],
        data: {'title': <Object?>[]},
      );

      expect(tester.takeException(), isNull);
      expect(tester.widget<Tab>(find.byType(Tab)).text, isEmpty);
      expect(find.text('Inbox'), findsOneWidget);
    });

    for (final (String name, Map<String, Object?> props) in [
      ('tabs that are a string', {'tabs': 'one'}),
      ('tabs that are a number', {'tabs': 7}),
      ('a payload without tabs', {}),
      ('an empty list of tabs', {'tabs': <Object?>[]}),
      (
        'a tab that names no child',
        {
          'tabs': [
            {'title': 'One'},
          ],
        },
      ),
      (
        'a tab that is not an object',
        {
          'tabs': [
            {'title': 'First', 'child': 'first'},
            42,
            {'title': 'Third', 'child': 'third'},
          ],
        },
      ),
    ]) {
      testWidgets('rejects $name before it renders', (tester) async {
        await _expectRejected(tester, {'component': 'Tabs', ...props});
      });
    }
  });
}
