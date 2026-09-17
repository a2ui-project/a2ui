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

import 'dart:convert';

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_infra/message_builders.dart';

void main() {
  late SurfaceController controller;
  final testCatalog = Catalog([
    BasicCatalogItems.button,
    BasicCatalogItems.text,
  ], catalogId: 'test_catalog');

  setUp(() {
    controller = SurfaceController(catalogs: [testCatalog]);
  });

  tearDown(() {
    controller.dispose();
  });

  testWidgets('SurfaceWidget builds a widget from a definition', (
    WidgetTester tester,
  ) async {
    const surfaceId = 'testSurface';
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
      component(id: 'text', type: 'Text', properties: {'text': 'Hello'}),
    ];
    controller.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    controller.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Surface(surfaceContext: controller.contextFor(surfaceId)),
      ),
    );

    expect(find.text('Hello'), findsOneWidget);
    expect(find.byType(ElevatedButton), findsOneWidget);
  });

  testWidgets('SurfaceWidget handles events', (WidgetTester tester) async {
    const surfaceId = 'testSurface';
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
      component(id: 'text', type: 'Text', properties: {'text': 'Hello'}),
    ];
    controller.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    controller.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Surface(surfaceContext: controller.contextFor(surfaceId)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(ElevatedButton), findsOneWidget);
    await tester.tap(find.byType(ElevatedButton));
  });

  testWidgets(
    'SurfaceWidget stays empty when the surface names an unknown catalog',
    (WidgetTester tester) async {
      const surfaceId = 'testSurface';
      final List<JsonMap> components = [
        component(id: 'root', type: 'Text', properties: {'text': 'Hello'}),
      ];
      final Future<ChatMessage> report = controller.onSubmit.first;
      controller.handleMessage(
        updateComponents(surfaceId: surfaceId, components: components),
      );
      // Request a catalogId that doesn't exist in the controller. The
      // controller registers an empty stand-in catalog under that id, so
      // a2ui_core rejects every component the surface receives and reports
      // the failure instead of rendering a fallback.
      controller.handleMessage(
        createSurface(surfaceId: surfaceId, catalogId: 'non_existent_catalog'),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Surface(surfaceContext: controller.contextFor(surfaceId)),
        ),
      );

      expect(find.text('Hello'), findsNothing);
      expect(find.byType(FallbackWidget), findsNothing);
      expect(controller.registry.getSurface(surfaceId)!.components, isEmpty);

      final ChatMessage message = await report;
      final UiInteractionPart part = message.parts.uiInteractionParts.first;
      final json = jsonDecode(part.interaction) as Map<String, dynamic>;
      final error = json['error'] as Map<String, dynamic>;
      expect(error['code'], 'VALIDATION_FAILED');
      expect(error['message'], contains('non_existent_catalog'));
    },
  );

  testWidgets('rebuilds when components change after creation', (
    WidgetTester tester,
  ) async {
    const surfaceId = 'testSurface';
    controller.handleMessage(
      updateComponents(
        surfaceId: surfaceId,
        components: [
          component(id: 'root', type: 'Text', properties: {'text': 'first'}),
        ],
      ),
    );
    controller.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Surface(surfaceContext: controller.contextFor(surfaceId)),
      ),
    );
    expect(find.text('first'), findsOneWidget);

    // Updating the live surface should rebuild it in place.
    controller.handleMessage(
      updateComponents(
        surfaceId: surfaceId,
        components: [
          component(id: 'root', type: 'Text', properties: {'text': 'second'}),
        ],
      ),
    );
    await tester.pump();

    expect(find.text('second'), findsOneWidget);
    expect(find.text('first'), findsNothing);
  });
}
