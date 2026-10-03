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

import '../test_infra/message_builders.dart';

void main() {
  group('Basic Widgets', () {
    final Catalog testCatalog = BasicCatalogItems.asCatalog();

    ChatMessage? message;
    SurfaceController? controller;

    Future<void> pumpWidgetWithDefinition(
      WidgetTester tester,
      String rootId,
      List<JsonMap> components,
    ) async {
      message = null;
      controller?.dispose();
      controller = SurfaceController(catalogs: [testCatalog]);
      controller!.onSubmit.listen((event) => message = event);
      const surfaceId = 'testSurface';
      controller!.handleMessage(
        updateComponents(surfaceId: surfaceId, components: components),
      );
      controller!.handleMessage(
        createSurface(surfaceId: surfaceId, catalogId: testCatalog.catalogId!),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Surface(surfaceContext: controller!.contextFor(surfaceId)),
          ),
        ),
      );
    }

    testWidgets('Button renders and handles taps', (WidgetTester tester) async {
      final List<JsonMap> components = [
        component(
          id: 'root',
          type: 'Button',
          properties: {
            'child': 'text',
            'action': {
              'event': {'name': 'testAction'},
            },
          },
        ),
        component(id: 'text', type: 'Text', properties: {'text': 'Click Me'}),
      ];

      await pumpWidgetWithDefinition(tester, 'root', components);

      expect(find.text('Click Me'), findsOneWidget);

      expect(message, null);
      await tester.tap(find.byType(ElevatedButton));
      expect(message, isNotNull);
    });

    testWidgets('Text renders from data model', (WidgetTester tester) async {
      final List<JsonMap> components = [
        component(
          id: 'root',
          type: 'Text',
          properties: {
            'text': {'path': '/myText'},
          },
        ),
      ];

      await pumpWidgetWithDefinition(tester, 'root', components);
      controller!
          .contextFor('testSurface')
          .dataModel
          .update(DataPath('/myText'), 'Hello from data model');
      await tester.pumpAndSettle();

      expect(find.text('Hello from data model'), findsOneWidget);
    });

    testWidgets('Column renders children', (WidgetTester tester) async {
      final List<JsonMap> components = [
        component(
          id: 'root',
          type: 'Column',
          properties: {
            'children': ['text1', 'text2'],
          },
        ),
        component(id: 'text1', type: 'Text', properties: {'text': 'First'}),
        component(id: 'text2', type: 'Text', properties: {'text': 'Second'}),
      ];

      await pumpWidgetWithDefinition(tester, 'root', components);

      expect(find.text('First'), findsOneWidget);
      expect(find.text('Second'), findsOneWidget);
    });

    testWidgets('TextField renders and handles changes/submissions', (
      WidgetTester tester,
    ) async {
      final List<JsonMap> components = [
        component(
          id: 'root',
          type: 'TextField',
          properties: {
            'value': {'path': '/myValue'},
            'label': 'My Label',
            'onSubmittedAction': {
              'event': {'name': 'submit'},
            },
          },
        ),
      ];

      await pumpWidgetWithDefinition(tester, 'field', components);
      controller!
          .contextFor('testSurface')
          .dataModel
          .update(DataPath('/myValue'), 'initial');
      await tester.pumpAndSettle();

      final Finder textFieldFinder = find.byType(TextField);
      expect(find.widgetWithText(TextField, 'initial'), findsOneWidget);
      final TextField textField = tester.widget<TextField>(textFieldFinder);
      expect(textField.decoration?.labelText, 'My Label');

      // Test onChanged
      await tester.enterText(textFieldFinder, 'new value');
      expect(
        controller!
            .contextFor('testSurface')
            .dataModel
            .getValue<String>(DataPath('/myValue')),
        'new value',
      );

      // Test onSubmitted
      expect(message, null);
      await tester.testTextInput.receiveAction(TextInputAction.done);
      expect(message, isNotNull);
    });
  });
}
