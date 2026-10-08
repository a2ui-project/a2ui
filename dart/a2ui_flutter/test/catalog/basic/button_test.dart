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

final WidgetCatalog _catalog = basicTestCatalog([
  BasicComponents.button,
  BasicComponents.column,
  BasicComponents.icon,
  BasicComponents.text,
]);

Map<String, Object?> _button({
  Object? action = const {
    'event': {'name': 'pressed'},
  },
  String? variant,
  List<Map<String, Object?>>? checks,
  String child = 'label',
}) => {
  'id': 'root',
  'component': 'Button',
  'child': child,
  'action': action,
  'variant': ?variant,
  'checks': ?checks,
};

const Map<String, Object?> _label = {
  'id': 'label',
  'component': 'Text',
  'text': 'Go',
};

ButtonStyleButton _buttonWidget(WidgetTester tester) =>
    tester.widget<ButtonStyleButton>(
      find.byWidgetPredicate((w) => w is ButtonStyleButton),
    );

void main() {
  testWidgets('renders its child inside the button', (tester) async {
    await pumpComponents(tester, [_button(), _label], catalog: _catalog);

    expect(
      find.descendant(
        of: find.byType(OutlinedButton),
        matching: find.text('Go'),
      ),
      findsOneWidget,
    );
  });

  group('variant', () {
    for (final (String? variant, Type type) in [
      (null, OutlinedButton),
      ('default', OutlinedButton),
      ('primary', FilledButton),
      ('borderless', TextButton),
    ]) {
      testWidgets('${variant ?? 'omitted'} renders a $type', (tester) async {
        await pumpComponents(tester, [
          _button(variant: variant),
          _label,
        ], catalog: _catalog);

        expect(find.byType(type), findsOneWidget);
        expect(_buttonWidget(tester).enabled, isTrue);
      });
    }
  });

  group('action', () {
    testWidgets('dispatches the event with its source', (tester) async {
      final SurfaceHarness harness = await pumpComponents(tester, [
        _button(),
        _label,
      ], catalog: _catalog);

      await tester.tap(find.byType(OutlinedButton));
      await tester.pump();

      expect(harness.actions, hasLength(1));
      expect(harness.actions.single.name, 'pressed');
      expect(harness.actions.single.surfaceId, testSurfaceId);
      expect(harness.actions.single.sourceComponentId, 'root');
      expect(harness.actions.single.context, isEmpty);
      expect(harness.errors, isEmpty);
    });
  });

  group('checks', () {
    testWidgets('disable the button with the failing message as a tooltip '
        'until they pass', (tester) async {
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          _button(
            checks: [
              {
                'condition': {'path': '/agreed'},
                'message': 'Accept the terms',
              },
            ],
          ),
          _label,
        ],
        catalog: _catalog,
        data: {'agreed': false},
      );
      expect(_buttonWidget(tester).enabled, isFalse);
      expect(find.byTooltip('Accept the terms'), findsOneWidget);
      await tester.tap(find.text('Go'));
      await tester.pump();
      expect(harness.actions, isEmpty);

      await harness.send([updateDataModel(true, path: '/agreed')]);
      expect(_buttonWidget(tester).enabled, isTrue);
      expect(find.byType(Tooltip), findsNothing);
      await tester.tap(find.text('Go'));
      await tester.pump();
      expect(harness.actions.single.name, 'pressed');

      await harness.send([updateDataModel(false, path: '/agreed')]);
      expect(_buttonWidget(tester).enabled, isFalse);
    });
  });
}
