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
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/surface_harness.dart';

final WidgetCatalog _catalog = basicTestCatalog([
  BasicComponents.checkBox,
  BasicComponents.text,
  BasicComponents.row,
]);

Future<SurfaceHarness> _pump(
  WidgetTester tester,
  List<Map<String, Object?>> components, {
  Map<String, Object?>? data,
}) => pumpComponents(tester, components, catalog: _catalog, data: data);

Map<String, Object?> _box(Map<String, Object?> props) => {
  'id': 'root',
  'component': 'CheckBox',
  'label': 'Agree',
  ...props,
};

bool? _checked(WidgetTester tester, [Finder? finder]) =>
    tester.widget<Checkbox>(finder ?? find.byType(Checkbox)).value;

void main() {
  group('CheckBox', () {
    testWidgets('shows its label and literal value', (tester) async {
      await _pump(tester, [
        _box({'value': true}),
      ]);

      expect(find.text('Agree'), findsOneWidget);
      expect(_checked(tester), isTrue);
    });

    group('with a bound value', () {
      testWidgets('writes every toggle to the data model', (tester) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _box({
              'value': {'path': '/agreed'},
            }),
          ],
          data: {'agreed': false},
        );

        await tester.tap(find.byType(Checkbox));
        expect(harness.data('/agreed'), isTrue);
        await tester.pump();
        expect(_checked(tester), isTrue);

        await tester.tap(find.byType(Checkbox));
        await tester.pump();
        expect(harness.data('/agreed'), isFalse);
        expect(_checked(tester), isFalse);
      });

      testWidgets('toggles from its label', (tester) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _box({
              'value': {'path': '/agreed'},
            }),
          ],
          data: {'agreed': false},
        );

        await tester.tap(find.text('Agree'));
        await tester.pump();

        expect(harness.data('/agreed'), isTrue);
        expect(_checked(tester), isTrue);
      });

      testWidgets('reads a value that is not a bool as unchecked', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _box({
              'value': {'path': '/agreed'},
            }),
          ],
          data: {'agreed': 'yes'},
        );
        expect(_checked(tester), isFalse);
        expect(tester.takeException(), isNull);

        await tester.tap(find.byType(Checkbox));
        await tester.pump();

        expect(harness.data('/agreed'), isTrue);
      });
    });

    group('with a literal value', () {
      testWidgets('is disabled', (tester) async {
        await _pump(tester, [
          _box({'value': false}),
        ]);

        expect(
          tester.widget<Checkbox>(find.byType(Checkbox)).onChanged,
          isNull,
        );
      });
    });

    group('checks', () {
      Map<String, Object?> mustAgree() => _box({
        'value': {'path': '/agreed'},
        'checks': [
          {
            'condition': {'path': '/agreed'},
            'message': 'You must agree',
          },
        ],
      });

      testWidgets('show the failing message and mark the box', (tester) async {
        await _pump(tester, [mustAgree()], data: {'agreed': false});

        expect(find.text('You must agree'), findsOneWidget);
        expect(tester.widget<Checkbox>(find.byType(Checkbox)).isError, isTrue);
        final BuildContext context = tester.element(find.byType(Checkbox));
        expect(
          tester.widget<Text>(find.text('Agree')).style?.color,
          Theme.of(context).colorScheme.error,
        );
      });
    });

    testWidgets('merges its label into the box semantics', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(
        tester,
        [
          _box({
            'value': {'path': '/agreed'},
          }),
        ],
        data: {'agreed': true},
      );

      final SemanticsData semantics = tester
          .getSemantics(find.byType(Checkbox))
          .getSemanticsData();
      expect(semantics.label, 'Agree');
      expect(semantics.hasAction(SemanticsAction.tap), isTrue);
      handle.dispose();
    });

    testWidgets('keeps a long label inside an unweighted Row', (tester) async {
      final String label = List.filled(40, 'long').join(' ');
      await _pump(tester, [
        {
          'id': 'root',
          'component': 'Row',
          'align': 'start',
          'children': ['title', 'box'],
        },
        {'id': 'title', 'component': 'Text', 'text': 'Terms'},
        {'id': 'box', 'component': 'CheckBox', 'label': label, 'value': false},
      ]);

      expect(tester.takeException(), isNull);
      expect(tester.getRect(find.text(label)).right, lessThanOrEqualTo(800));
      expect(
        tester.getSize(find.text(label)).height,
        greaterThan(tester.getSize(find.text('Terms')).height),
      );
    });
  });
}
