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

import 'test_catalog.dart';

void main() {
  group('A2uiSurface', () {
    testWidgets('renders loading placeholder before root arrives', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createTestCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'test-surface',
        catalog: catalog,
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.byType(A2uiLoadingPlaceholder), findsOneWidget);
      expect(find.text('Loading root...'), findsOneWidget);
    });

    testWidgets('renders resolved components when root arrives', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createTestCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'test-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.text('Loading root...'), findsOneWidget);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'test-surface',
            'components': [
              {
                'id': 'root',
                'component': 'TestText',
                'text': 'Surface Rendered Successfully',
                'variant': 'h2',
              },
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      await tester.pump();

      expect(find.byType(A2uiLoadingPlaceholder), findsNothing);
      expect(find.text('Surface Rendered Successfully'), findsOneWidget);
    });

    testWidgets('provides ambient context via A2uiSurfaceScope', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createTestCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'test-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'test-surface',
            'components': [
              {'id': 'root', 'component': 'TestText', 'text': 'Scoped Text'},
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) {
                return A2uiSurface(surface: surface);
              },
            ),
          ),
        ),
      );

      final BuildContext textContext = tester.element(find.text('Scoped Text'));
      final A2uiSurfaceScope capturedScope = A2uiSurfaceScope.of(textContext);

      expect(capturedScope.surface.id, 'test-surface');
      expect(capturedScope.resolver.rootNode.value?.componentId, 'root');
    });
  });
}
