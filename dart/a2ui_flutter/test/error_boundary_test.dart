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
import 'dart:convert';

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:logging/logging.dart';

import 'test_infra/message_builders.dart';

void main() {
  group('Secure Error Boundary Tests', () {
    setUp(() {
      hierarchicalLoggingEnabled = true;
      Logger.root.level = Level.ALL;
      Logger.root.onRecord.listen((record) {
        // ignore: avoid_print
        print('[${record.level.name}] ${record.message}');
        if (record.error != null) {
          // ignore: avoid_print
          print('  Error: ${record.error}');
        }
      });
    });
    test(
      'A2uiValidationException is reported cleanly as VALIDATION_FAILED',
      () async {
        final surfaceController = SurfaceController(catalogs: []);
        final Completer<JsonMap> errorCompleter = Completer();

        surfaceController.onSubmit.listen((event) {
          final String interaction =
              event.parts.first.asUiInteractionPart!.interaction;
          final data = jsonDecode(interaction) as JsonMap;
          errorCompleter.complete(data);
        });

        surfaceController.reportError(
          A2uiValidationException(
            'Invalid component properties',
            surfaceId: 'test-surface',
            path: '/components/0',
          ),
          StackTrace.current,
        );

        final JsonMap result = await errorCompleter.future;
        expect(result['version'], equals('v0.9'));
        final error = result['error'] as JsonMap;
        expect(error['code'], equals('VALIDATION_FAILED'));
        expect(error['message'], equals('Invalid component properties'));
        expect(error['surfaceId'], equals('test-surface'));
        expect(error['path'], equals('/components/0'));
        expect(error.containsKey('stackTrace'), isFalse);
      },
    );

    test(
      'A2uiFunctionException is reported as FUNCTION_EXECUTION_FAILED',
      () async {
        final surfaceController = SurfaceController(catalogs: []);
        final Completer<JsonMap> errorCompleter = Completer();

        surfaceController.onSubmit.listen((event) {
          final String interaction =
              event.parts.first.asUiInteractionPart!.interaction;
          final data = jsonDecode(interaction) as JsonMap;
          errorCompleter.complete(data);
        });

        surfaceController.reportError(
          A2uiFunctionException(
            'Custom rule validation failed',
            functionName: 'validateEmail',
            argumentKey: 'email',
          ),
          StackTrace.current,
        );

        final JsonMap result = await errorCompleter.future;
        expect(result['version'], equals('v0.9'));
        final error = result['error'] as JsonMap;
        expect(error['code'], equals('FUNCTION_EXECUTION_FAILED'));
        expect(error['message'], equals('Custom rule validation failed'));
        expect(error['functionName'], equals('validateEmail'));
        expect(error.containsKey('stackTrace'), isFalse);
      },
    );

    test('Raw VM exceptions are completely masked as INTERNAL_ERROR', () async {
      final surfaceController = SurfaceController(catalogs: []);
      final Completer<JsonMap> errorCompleter = Completer();

      surfaceController.onSubmit.listen((event) {
        final String interaction =
            event.parts.first.asUiInteractionPart!.interaction;
        final data = jsonDecode(interaction) as JsonMap;
        errorCompleter.complete(data);
      });

      // Simulate a VM/internal crash
      surfaceController.reportError(TypeError(), StackTrace.current);

      final JsonMap result = await errorCompleter.future;
      expect(result['version'], equals('v0.9'));
      final error = result['error'] as JsonMap;
      expect(error['code'], equals('INTERNAL_ERROR'));
      expect(error['message'], equals('An unexpected system error occurred.'));
      expect(error.containsKey('surfaceId'), isFalse);
      expect(error.containsKey('path'), isFalse);
      expect(error.containsKey('stackTrace'), isFalse);
    });

    testWidgets('Button widget handles action VM throws by wrapping in '
        'A2uiFunctionException', (WidgetTester tester) async {
      final mockFunction = MockFunction(
        name: 'crashFunc',
        onExecute: (args, context) => throw TypeError(),
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

      final List<ChatMessage> messages = [];
      surfaceController.onSubmit.listen(messages.add);

      const surfaceId = 'testSurface';
      final components = [
        const Component(
          id: 'root',
          type: 'Button',
          properties: {
            'child': 'button_text',
            'action': {
              'functionCall': {
                'call': 'crashFunc',
                'args': <String, Object?>{},
              },
            },
          },
        ),
        const Component(
          id: 'button_text',
          type: 'Text',
          properties: {'text': 'Click Me'},
        ),
      ];

      surfaceController.handleMessage(
        updateComponents(
          surfaceId: surfaceId,
          components: components.map((c) => c.toJson()).toList(),
        ),
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

      expect(find.byType(ElevatedButton), findsOneWidget);
      final ElevatedButton button = tester.widget<ElevatedButton>(
        find.byType(ElevatedButton),
      );
      expect(button.onPressed, isNotNull);
      await tester.runAsync(() async {
        await tester.tap(find.byType(ElevatedButton));
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });

      expect(messages, isNotEmpty);
      final String interaction =
          messages.first.parts.first.asUiInteractionPart!.interaction;
      final result = jsonDecode(interaction) as JsonMap;
      expect(result['version'], equals('v0.9'));
      final error = result['error'] as JsonMap;
      expect(error['code'], equals('FUNCTION_EXECUTION_FAILED'));
      expect(error['message'], contains('Function execution failed'));
      expect(error['functionName'], equals('crashFunc'));
      expect(error.containsKey('stackTrace'), isFalse);

      surfaceController.dispose();
    });
  });
}

class MockFunction extends SynchronousClientFunction {
  MockFunction({required this.name, required this.onExecute});

  @override
  final String name;

  final Object? Function(JsonMap, ExecutionContext) onExecute;

  @override
  String get description => 'Mock function for testing.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.empty;

  @override
  Schema get argumentSchema => S.object();

  @override
  Object? executeSync(JsonMap args, ExecutionContext context) {
    return onExecute(args, context);
  }
}
