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
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test_infra/message_builders.dart';

void main() {
  testWidgets('renders and handles explicit updates', (tester) async {
    final robot = DateTimeInputRobot(tester);
    final (SurfaceHost surfaceController, String surfaceId) = setup(
      'datetime',
      {
        'value': {'path': '/myDateTime'},
        'enableTime': false,
      },
    );

    surfaceController
        .contextFor(surfaceId)
        .dataModel
        .update(DataPath('/myDateTime'), '2025-10-15');

    await robot.pumpSurface(surfaceController, surfaceId);

    robot.expectInputText('datetime', 'Wednesday, October 15, 2025');
  });

  testWidgets('displays correct placeholder/initial text based on mode', (
    tester,
  ) async {
    final robot = DateTimeInputRobot(tester);

    var (SurfaceHost surfaceController, String surfaceId) = setup(
      'datetime_default',
      {
        'value': {'path': '/myDateTimeDefault'},
      },
    );
    await robot.pumpSurface(surfaceController, surfaceId);
    robot.expectInputText('datetime_default', 'Select a date and time');

    (surfaceController, surfaceId) = setup('datetime_date_only', {
      'value': {'path': '/myDateOnly'},
      'enableTime': false,
    });
    await robot.pumpSurface(surfaceController, surfaceId);
    robot.expectInputText('datetime_date_only', 'Select a date');

    (surfaceController, surfaceId) = setup('datetime_time_only', {
      'value': {'path': '/myTimeOnly'},
      'enableDate': false,
    });
    await robot.pumpSurface(surfaceController, surfaceId);
    robot.expectInputText('datetime_time_only', 'Select a time');
  });

  group('combined mode', () {
    testWidgets('aborts update when time picker is cancelled', (tester) async {
      final robot = DateTimeInputRobot(tester);
      final (SurfaceHost surfaceController, String surfaceId) = setup(
        'combined_mode',
        {
          'value': {'path': '/myDateTime'},
        },
      );

      surfaceController
          .contextFor(surfaceId)
          .dataModel
          .update(DataPath('/myDateTime'), '2022-01-01T14:30:00');

      await robot.pumpSurface(surfaceController, surfaceId);

      await robot.openPicker('combined_mode');
      await robot.selectDate('15');

      robot.expectTimePickerVisible();
      await robot.cancelPicker();

      final String? value = surfaceController
          .contextFor(surfaceId)
          .dataModel
          .getValue<String>(DataPath('/myDateTime'));
      expect(value, equals('2022-01-01T14:30:00'));
    });
  });

  group('time only mode', () {
    testWidgets('aborts when time picker is cancelled', (tester) async {
      final robot = DateTimeInputRobot(tester);
      final (SurfaceHost surfaceController, String surfaceId) = setup(
        'time_only_mode',
        {
          'value': {'path': '/myTime'},
          'enableDate': false,
        },
      );

      await robot.pumpSurface(surfaceController, surfaceId);

      await robot.openPicker('time_only_mode');
      robot.expectTimePickerVisible();
      await robot.cancelPicker();

      final String? value = surfaceController
          .contextFor(surfaceId)
          .dataModel
          .getValue<String>(DataPath('/myTime'));
      expect(value, isNull);
    });

    testWidgets('parses initial value correctly', (tester) async {
      final robot = DateTimeInputRobot(tester);
      final (SurfaceHost surfaceController, String surfaceId) = setup(
        'time_only_parsing',
        {
          'value': {'path': '/myTimeProp'},
          'enableDate': false,
        },
      );

      surfaceController
          .contextFor(surfaceId)
          .dataModel
          .update(DataPath('/myTimeProp'), '14:32:00');

      await robot.pumpSurface(surfaceController, surfaceId);

      await robot.openPicker('time_only_parsing');

      robot.expectPickerText('32');

      await robot.cancelPicker();
    });
  });

  group('date only mode', () {
    testWidgets('updates immediately with date-only string after '
        'date selection', (tester) async {
      final robot = DateTimeInputRobot(tester);
      final (SurfaceHost surfaceController, String surfaceId) = setup(
        'date_only_mode',
        {
          'value': {'path': '/myDate'},
          'enableTime': false,
        },
      );

      surfaceController
          .contextFor(surfaceId)
          .dataModel
          .update(DataPath('/myDate'), '2022-01-01');

      await robot.pumpSurface(surfaceController, surfaceId);

      await robot.openPicker('date_only_mode');
      await robot.selectDate('20');

      final String? value = surfaceController
          .contextFor(surfaceId)
          .dataModel
          .getValue<String>(DataPath('/myDate'));
      expect(value, isNotNull);
      // Verify that no time is included in the value.
      expect(value, equals('2022-01-20'));
      robot.expectInputText('date_only_mode', 'Thursday, January 20, 2022');

      robot.expectTimePickerHidden();
    });
  });

  group('date range configuration', () {
    testWidgets('respects custom firstDate and lastDate', (tester) async {
      final robot = DateTimeInputRobot(tester);
      final (SurfaceHost surfaceController, String surfaceId) = setup(
        'custom_range',
        {
          'value': {'path': '/myDate'},
          'min': '2020-01-01',
          'max': '2030-12-31',
        },
      );

      await robot.pumpSurface(surfaceController, surfaceId);

      await robot.openPicker('custom_range');

      final DatePickerDialog dialog = tester.widget(
        find.byType(DatePickerDialog),
      );
      expect(dialog.firstDate, DateTime(2020));
      expect(dialog.lastDate, DateTime(2030, 12, 31));

      await robot.cancelPicker();
    });

    testWidgets('defaults to -9999 to 9999 when not specified', (tester) async {
      final robot = DateTimeInputRobot(tester);
      final (SurfaceHost surfaceController, String surfaceId) = setup(
        'default_range',
        {
          'value': {'path': '/myDate'},
        },
      );

      await robot.pumpSurface(surfaceController, surfaceId);
      await robot.openPicker('default_range');

      final DatePickerDialog dialog = tester.widget(
        find.byType(DatePickerDialog),
      );
      expect(dialog.firstDate, DateTime(-9999));
      expect(dialog.lastDate, DateTime(9999, 12, 31));

      await robot.cancelPicker();
    });
  });

  group('validation', () {
    testWidgets('shows error when check fails', (tester) async {
      final robot = DateTimeInputRobot(tester);
      final (SurfaceHost surfaceController, String surfaceId) = setup(
        'validation_test',
        {
          'value': {'path': '/myDate'},
          'checks': [
            {
              'condition': {
                'call': 'required',
                'args': {
                  'value': {'path': '/myDate'},
                },
              },
              'message': 'Date is required',
            },
          ],
        },
      );

      await robot.pumpSurface(surfaceController, surfaceId);
      robot.expectError('Date is required');

      surfaceController
          .contextFor(surfaceId)
          .dataModel
          .update(DataPath('/myDate'), '2022-01-01');
      await robot.pumpSurface(surfaceController, surfaceId);
      robot.expectNoError();
    });
  });
}

(SurfaceHost, String) setup(String componentId, Map<String, dynamic> props) {
  final catalog = Catalog(
    [BasicCatalogItems.dateTimeInput],
    catalogId: 'test_catalog',
    functions: BasicFunctions.all,
  );

  final surfaceController = SurfaceController(catalogs: [catalog]);
  const surfaceId = 'testSurface';

  final List<JsonMap> components = [
    component(id: 'root', type: 'DateTimeInput', properties: props),
  ];

  surfaceController.handleMessage(
    updateComponents(surfaceId: surfaceId, components: components),
  );
  surfaceController.handleMessage(
    createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
  );

  return (surfaceController, surfaceId);
}

class DateTimeInputRobot {
  final WidgetTester tester;

  DateTimeInputRobot(this.tester);

  Future<void> pumpSurface(
    SurfaceHost surfaceController,
    String surfaceId,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(
            surfaceContext: surfaceController.contextFor(surfaceId),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> openPicker(String componentId) async {
    await tester.tap(find.byKey(const Key('root')));
    await tester.pumpAndSettle();
  }

  Future<void> selectDate(String day) async {
    await tester.tap(find.text(day));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
  }

  Future<void> cancelPicker() async {
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
  }

  void expectInputText(String componentId, String text) {
    final Finder finder = find.byKey(const Key('root_text'));
    expect(finder, findsOneWidget);
    final String actualText = tester.widget<Text>(finder).data!;
    if (actualText != text) {
      // Expectation will fail below and show the diff.
    }
    expect(actualText, text);
  }

  void expectPickerText(String text) {
    expect(find.text(text), findsOneWidget);
  }

  void expectTimePickerVisible() {
    expect(find.text('Select time'), findsOneWidget);
  }

  void expectTimePickerHidden() {
    expect(find.text('Select time'), findsNothing);
  }

  void expectError(String errorText) {
    final Finder finder = find.byType(InputDecorator);
    expect(finder, findsOneWidget);
    final InputDecorator decorator = tester.widget(finder);
    expect(decorator.decoration.errorText, errorText);
  }

  void expectNoError() {
    final Finder finder = find.byType(InputDecorator);
    expect(finder, findsOneWidget);
    final InputDecorator decorator = tester.widget(finder);
    expect(decorator.decoration.errorText, isNull);
  }
}
