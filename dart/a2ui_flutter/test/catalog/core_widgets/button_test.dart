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

import 'dart:async';

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:logging/logging.dart';

import '../../test_infra/message_builders.dart';

void main() {
  setUpAll(() {
    Logger.root.level = Level.ALL;
    Logger.root.onRecord.listen((record) {
      debugPrint(
        '[${record.level.name}] ${record.loggerName}: ${record.message}',
      );
      if (record.error != null) {
        debugPrint('Error: ${record.error}');
      }
      if (record.stackTrace != null) {
        debugPrint('StackTrace:\n${record.stackTrace}');
      }
    });
  });

  testWidgets('Button widget renders and handles taps', (
    WidgetTester tester,
  ) async {
    ChatMessage? message;
    final surfaceController = SurfaceController(
      catalogs: [
        Catalog([
          BasicCatalogItems.button,
          BasicCatalogItems.text,
        ], catalogId: 'test_catalog'),
      ],
    );
    surfaceController.onSubmit.listen((event) => message = event);
    const surfaceId = 'testSurface';
    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'Button',
        properties: {
          'child': 'button_text',
          'action': {
            'event': {'name': 'testAction'},
          },
        },
      ),
      component(
        id: 'button_text',
        type: 'Text',
        properties: {'text': 'Click Me'},
      ),
    ];
    surfaceController.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    surfaceController.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(
            surfaceContext: surfaceController.contextFor(surfaceId),
          ),
        ),
      ),
    );

    final Finder buttonFinder = find.byType(ElevatedButton);
    expect(buttonFinder, findsOneWidget);
    expect(
      find.descendant(of: buttonFinder, matching: find.text('Click Me')),
      findsOneWidget,
    );

    expect(message, null);
    await tester.tap(find.byType(ElevatedButton));
    expect(message, isNotNull);
  });

  testWidgets('Button widget handles stream errors gracefully', (
    WidgetTester tester,
  ) async {
    final mockFunction = MockFunction(
      name: 'throwError',
      onExecute: (args, context) =>
          Stream<Object?>.error(Exception('Stream error')),
    );

    final surfaceController = SurfaceController(
      catalogs: [
        Catalog(
          [BasicCatalogItems.button, BasicCatalogItems.text],
          catalogId: 'test_catalog',
          functions: [mockFunction],
        ),
      ],
    );
    ChatMessage? message;
    surfaceController.onSubmit.listen((event) => message = event);

    const surfaceId = 'testSurface';
    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'Button',
        properties: {
          'child': 'button_text',
          'action': {
            'functionCall': {'call': 'throwError'},
          },
        },
      ),
      component(
        id: 'button_text',
        type: 'Text',
        properties: {'text': 'Click Me'},
      ),
    ];
    surfaceController.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    surfaceController.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
    );

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

    // Tap the button to trigger the function call
    await tester.runAsync(() async {
      final Future<ChatMessage> onSubmitFuture =
          surfaceController.onSubmit.first;
      await tester.tap(find.byType(ElevatedButton));
      await onSubmitFuture;
    });
    await tester.pump();

    // Verify the error was caught and reported
    expect(message, isNotNull);
    expect(
      message!.parts.first.asUiInteractionPart!.interaction,
      contains('throwError'),
    );
    surfaceController.dispose();
  });

  testWidgets(
    'Button widget is disabled when checks fail and enabled when they pass',
    (WidgetTester tester) async {
      ChatMessage? message;
      final surfaceController = SurfaceController(
        catalogs: [
          BasicCatalogItems.asCatalog().copyWith(catalogId: 'test_catalog'),
        ],
      );
      addTearDown(surfaceController.dispose);
      surfaceController.onSubmit.listen((event) => message = event);

      const surfaceId = 'validationTest';
      // Initialize with a value that fails the check
      surfaceController.handleMessage(
        updateDataModel(
          surfaceId: surfaceId,
          path: DataPath('/count'),
          value: 0,
        ),
      );

      final List<JsonMap> components = [
        component(
          id: 'root',
          type: 'Button',
          properties: {
            'child': 'button_text',
            'action': {
              'event': {'name': 'testAction'},
            },
            'checks': [
              {
                'message': 'Cannot click when count is 0',
                'condition': {
                  'call': 'numeric',
                  'args': {
                    'value': {'path': '/count'},
                    'min': 1,
                  },
                },
              },
            ],
          },
        ),
        component(
          id: 'button_text',
          type: 'Text',
          properties: {'text': 'Click Me'},
        ),
      ];

      surfaceController.handleMessage(
        updateComponents(surfaceId: surfaceId, components: components),
      );
      surfaceController.handleMessage(
        createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
      );

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

      final Finder buttonFinder = find.byType(ElevatedButton);
      expect(buttonFinder, findsOneWidget);

      // Button should be disabled -> onPressed is null
      ElevatedButton buttonElem = tester.widget<ElevatedButton>(buttonFinder);
      expect(buttonElem.onPressed, isNull);

      // Try tapping, nothing should happen
      expect(message, isNull);
      await tester.tap(buttonFinder);
      await tester.pumpAndSettle();
      expect(message, isNull);

      // Update data model to pass the check
      surfaceController.handleMessage(
        updateDataModel(
          surfaceId: surfaceId,
          path: DataPath('/count'),
          value: 1,
        ),
      );
      await tester.pumpAndSettle();

      // Button should now be enabled
      ElevatedButton buttonElemAfter = tester.widget<ElevatedButton>(
        buttonFinder,
      );
      expect(buttonElemAfter.onPressed, isNotNull);

      // Try tapping, action should fire
      await tester.tap(buttonFinder);
      await tester.pumpAndSettle();
      expect(message, isNotNull);
    },
  );
}

class MockFunction implements ClientFunction {
  MockFunction({required this.name, required this.onExecute});

  @override
  final String name;

  @override
  String get description => 'A mock function for testing.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.any;

  final Stream<Object?> Function(JsonMap args, ExecutionContext context)
  onExecute;

  @override
  Schema get argumentSchema => Schema.object();

  @override
  Stream<Object?> execute(JsonMap args, ExecutionContext context) {
    return onExecute(args, context);
  }
}
