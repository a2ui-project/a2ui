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
  BasicComponents.dateTimeInput,
  BasicComponents.text,
]);

Future<SurfaceHarness> _pumpInput(
  WidgetTester tester,
  Map<String, Object?> props, {
  Map<String, Object?>? data,
}) => pumpComponents(
  tester,
  [
    {'id': 'root', 'component': 'DateTimeInput', ...props},
  ],
  catalog: _catalog,
  data: data,
);

InputDecoration _decoration(WidgetTester tester) =>
    tester.widget<InputDecorator>(find.byType(InputDecorator)).decoration;

Future<void> _open(WidgetTester tester) async {
  await tester.tap(find.byType(InputDecorator));
  await tester.pumpAndSettle();
}

Future<void> _pickDay(WidgetTester tester, String day) async {
  await tester.tap(
    find.descendant(
      of: find.byType(CalendarDatePicker),
      matching: find.text(day),
    ),
  );
  await tester.pump();
}

Future<void> _confirm(WidgetTester tester) async {
  await tester.tap(find.text('OK'));
  await tester.pumpAndSettle();
}

/// Replaces the input with a Text and checks that the page is still shown.
Future<void> _remove(WidgetTester tester, SurfaceHarness harness) async {
  await harness.send([
    updateComponents([
      {'id': 'root', 'component': 'Text', 'text': 'Gone'},
    ]),
  ]);
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
  expect(find.text('Gone'), findsOneWidget);
}

void main() {
  testWidgets('is a date input when neither date nor time is enabled', (
    tester,
  ) async {
    for (final Map<String, Object?> flags in [
      {},
      {'enableDate': false, 'enableTime': false},
    ]) {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          ...flags,
          'value': {'path': '/due'},
        },
        data: {'due': '2025-07-15'},
      );
      expect(find.text('Jul 15, 2025'), findsOneWidget, reason: '$flags');
      expect(find.byIcon(Icons.calendar_today), findsOneWidget);

      await _open(tester);
      await _pickDay(tester, '20');
      await _confirm(tester);

      expect(find.byType(TimePickerDialog), findsNothing, reason: '$flags');
      expect(harness.data('/due'), '2025-07-20', reason: '$flags');
    }
  });

  group('date', () {
    testWidgets('shows the label and the date of its value', (tester) async {
      await _pumpInput(tester, {
        'label': 'Due',
        'enableDate': true,
        'value': '2025-07-15',
      });

      expect(_decoration(tester).labelText, 'Due');
      expect(find.text('Jul 15, 2025'), findsOneWidget);
    });

    testWidgets('writes a picked date as YYYY-MM-DD', (tester) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'value': {'path': '/due'},
        },
        data: {'due': '2025-07-15'},
      );

      await _open(tester);
      expect(find.byType(DatePickerDialog), findsOneWidget);
      await _pickDay(tester, '20');
      await _confirm(tester);

      expect(harness.data('/due'), '2025-07-20');
      expect(find.text('Jul 20, 2025'), findsOneWidget);
    });

    testWidgets('limits the picker to the dates of min and max', (
      tester,
    ) async {
      await _pumpInput(
        tester,
        {
          'enableDate': true,
          'value': {'path': '/due'},
          'min': {'path': '/min'},
          'max': {'path': '/max'},
        },
        data: {
          'due': '2025-07-15',
          'min': '2025-07-10',
          'max': '2025-07-25T18:00:00',
        },
      );

      await _open(tester);

      final DatePickerDialog dialog = tester.widget(
        find.byType(DatePickerDialog),
      );
      expect(dialog.firstDate, DateTime(2025, 7, 10));
      expect(dialog.lastDate, DateTime(2025, 7, 25));
    });

    testWidgets('opens on the nearest allowed date', (tester) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'value': {'path': '/due'},
          'min': {'path': '/min'},
          'max': {'path': '/max'},
        },
        data: {'due': '2024-01-01', 'min': '2025-07-10', 'max': '2025-07-25'},
      );

      await _open(tester);
      expect(
        tester
            .widget<DatePickerDialog>(find.byType(DatePickerDialog))
            .initialDate,
        DateTime(2025, 7, 10),
      );
      await _confirm(tester);

      expect(harness.data('/due'), '2025-07-10');
    });

    testWidgets('clamps the picked date to bounds updated while it is open', (
      tester,
    ) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'value': {'path': '/due'},
          'min': {'path': '/min'},
          'max': {'path': '/max'},
        },
        data: {'due': '2025-07-15', 'min': '2025-07-10', 'max': '2025-07-31'},
      );

      await _open(tester);
      await _pickDay(tester, '20');
      await harness.send([updateDataModel('2025-07-25', path: '/min')]);
      await _confirm(tester);
      expect(harness.data('/due'), '2025-07-25');

      await _open(tester);
      await _pickDay(tester, '30');
      await harness.send([updateDataModel('2025-07-28', path: '/max')]);
      await _confirm(tester);
      expect(harness.data('/due'), '2025-07-28');
    });

    testWidgets('ignores a min after max', (tester) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'value': {'path': '/due'},
          'min': {'path': '/min'},
          'max': {'path': '/max'},
        },
        data: {'due': '2025-07-15', 'min': '2025-08-01', 'max': '2025-07-01'},
      );

      await _open(tester);

      final DatePickerDialog dialog = tester.widget(
        find.byType(DatePickerDialog),
      );
      expect(dialog.firstDate, DateTime(1));
      expect(dialog.lastDate, DateTime(9999, 12, 31));

      await _pickDay(tester, '20');
      await _confirm(tester);
      expect(harness.data('/due'), '2025-07-20');
    });

    testWidgets('leaves the value when the picker is cancelled', (
      tester,
    ) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'value': {'path': '/due'},
        },
        data: {'due': '2025-07-15'},
      );

      await _open(tester);
      await _pickDay(tester, '20');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(harness.data('/due'), '2025-07-15');
    });

    testWidgets('closes the picker without writing when it is removed', (
      tester,
    ) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'value': {'path': '/due'},
        },
        data: {'due': '2025-07-15'},
      );

      await _open(tester);
      await _pickDay(tester, '20');
      await _remove(tester, harness);

      expect(find.byType(DatePickerDialog), findsNothing);
      expect(harness.data('/due'), '2025-07-15');
    });

    testWidgets('is disabled with a literal value', (tester) async {
      await _pumpInput(tester, {'enableDate': true, 'value': '2025-07-15'});

      await tester.tap(find.byType(InputDecorator));
      await tester.pumpAndSettle();

      expect(find.byType(DatePickerDialog), findsNothing);
      expect(_decoration(tester).enabled, isFalse);
    });

    testWidgets('shows a value it cannot parse as written', (tester) async {
      await _pumpInput(tester, {'enableDate': true, 'value': 'soon'});

      expect(find.text('soon'), findsOneWidget);
    });

    testWidgets('opens on today when the value is empty', (tester) async {
      await _pumpInput(
        tester,
        {
          'enableDate': true,
          'value': {'path': '/due'},
        },
        data: {'due': ''},
      );

      await _open(tester);

      expect(
        tester
            .widget<DatePickerDialog>(find.byType(DatePickerDialog))
            .initialDate,
        DateUtils.dateOnly(DateTime.now()),
      );
    });
  });

  group('time', () {
    testWidgets('writes the picked time as HH:MM:SS', (tester) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableTime': true,
          'value': {'path': '/at'},
        },
        data: {'at': '08:30'},
      );
      expect(find.text('8:30 AM'), findsOneWidget);

      await _open(tester);
      expect(find.byType(DatePickerDialog), findsNothing);
      await _confirm(tester);
      expect(harness.data('/at'), '08:30:00');

      await _open(tester);
      await tester.tap(find.byIcon(Icons.keyboard_outlined));
      await tester.pumpAndSettle();
      final Finder fields = find.descendant(
        of: find.byType(Dialog),
        matching: find.byType(TextField),
      );
      await tester.enterText(fields.at(0), '9');
      await tester.enterText(fields.at(1), '45');
      await _confirm(tester);

      expect(harness.data('/at'), '09:45:00');
      expect(find.text('9:45 AM'), findsOneWidget);
    });

    testWidgets('clamps the picked time to a time min and max', (tester) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableTime': true,
          'value': {'path': '/at'},
          'min': {'path': '/min'},
          'max': {'path': '/max'},
        },
        data: {'at': '08:00', 'min': '09:00', 'max': '17:00:30'},
      );

      await _open(tester);
      await _confirm(tester);
      expect(harness.data('/at'), '09:00:00');

      await harness.send([updateDataModel('18:00', path: '/at')]);
      await _open(tester);
      await _confirm(tester);
      expect(harness.data('/at'), '17:00:30');

      await harness.send([updateDataModel('12:15', path: '/at')]);
      await _open(tester);
      await _confirm(tester);
      expect(harness.data('/at'), '12:15:00');
    });
  });

  group('date and time', () {
    testWidgets('writes the picked moment in local time', (tester) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'enableTime': true,
          'value': {'path': '/at'},
        },
        data: {'at': '2025-07-15T19:00:00'},
      );

      await _open(tester);
      expect(find.byType(DatePickerDialog), findsOneWidget);
      await _pickDay(tester, '20');
      await _confirm(tester);
      await _confirm(tester);

      expect(harness.data('/at'), '2025-07-20T19:00:00.000');
    });

    testWidgets('writes the picked moment in UTC when the value has a zone', (
      tester,
    ) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'enableTime': true,
          'value': {'path': '/at'},
        },
        data: {'at': '2025-07-15T19:00:00+02:00'},
      );
      final DateTime start = DateTime.utc(2025, 7, 15, 17).toLocal();

      await _open(tester);
      await _pickDay(tester, '20');
      await _confirm(tester);
      await _confirm(tester);

      final written = harness.data('/at')! as String;
      expect(written, endsWith('Z'));
      expect(
        DateTime.parse(written).toLocal(),
        DateTime(2025, 7, 20, start.hour, start.minute),
      );
    });

    testWidgets('clamps the picked moment to a date-time min and max', (
      tester,
    ) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'enableTime': true,
          'value': {'path': '/at'},
          'min': {'path': '/min'},
          'max': {'path': '/max'},
        },
        data: {
          'at': '2025-07-20T08:00:00',
          'min': '2025-07-15T09:30:00',
          'max': '2025-07-25T17:00:00',
        },
      );

      await _open(tester);
      await _pickDay(tester, '15');
      await _confirm(tester);
      await _confirm(tester);
      expect(harness.data('/at'), '2025-07-15T09:30:00.000');

      await harness.send([updateDataModel('2025-07-20T18:00:00', path: '/at')]);
      await _open(tester);
      await _pickDay(tester, '25');
      await _confirm(tester);
      await _confirm(tester);
      expect(harness.data('/at'), '2025-07-25T17:00:00.000');
    });

    testWidgets('ignores a time-only min and max', (tester) async {
      final SurfaceHarness harness = await _pumpInput(
        tester,
        {
          'enableDate': true,
          'enableTime': true,
          'value': {'path': '/at'},
          'min': {'path': '/min'},
          'max': {'path': '/max'},
        },
        data: {
          'at': '2025-07-15T08:00:00',
          'min': '09:00:00',
          'max': '17:00:00',
        },
      );

      await _open(tester);
      await _confirm(tester);
      await _confirm(tester);

      expect(harness.data('/at'), '2025-07-15T08:00:00.000');
    });
  });

  testWidgets('shows the first failing check as error text', (tester) async {
    final SurfaceHarness harness = await _pumpInput(
      tester,
      {
        'enableDate': true,
        'value': {'path': '/due'},
        'checks': [
          {
            'condition': {'path': '/ok'},
            'message': 'Pick a date',
          },
        ],
      },
      data: {'due': '', 'ok': false},
    );
    expect(_decoration(tester).errorText, 'Pick a date');

    await harness.send([updateDataModel(true, path: '/ok')]);
    expect(_decoration(tester).errorText, isNull);
  });
}
