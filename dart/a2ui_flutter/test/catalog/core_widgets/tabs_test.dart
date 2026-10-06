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
  testWidgets('Tabs widget renders and handles taps', (
    WidgetTester tester,
  ) async {
    final surfaceController = SurfaceController(
      catalogs: [
        Catalog([
          BasicCatalogItems.tabs,
          BasicCatalogItems.text,
        ], catalogId: 'test_catalog'),
      ],
    );
    const surfaceId = 'testSurface';
    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'Tabs',
        properties: {
          'component': 'Tabs',
          'tabs': [
            {'label': 'Tab 1', 'content': 'text1'},
            {'label': 'Tab 2', 'content': 'text2'},
          ],
        },
      ),
      component(
        id: 'text1',
        type: 'Text',
        properties: {'component': 'Text', 'text': 'This is the first tab.'},
      ),
      component(
        id: 'text2',
        type: 'Text',
        properties: {'component': 'Text', 'text': 'This is the second tab.'},
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

    expect(find.text('Tab 1'), findsOneWidget);
    expect(find.text('Tab 2'), findsOneWidget);
    expect(find.text('This is the first tab.'), findsOneWidget);
    expect(find.text('This is the second tab.'), findsNothing);

    await tester.tap(find.text('Tab 2'));
    await tester.pumpAndSettle();

    expect(find.text('This is the first tab.'), findsNothing);
    expect(find.text('This is the second tab.'), findsOneWidget);
  });

  testWidgets('Tabs activeTab binding works', (WidgetTester tester) async {
    final surfaceController = SurfaceController(
      catalogs: [
        Catalog([
          BasicCatalogItems.tabs,
          BasicCatalogItems.text,
        ], catalogId: 'test_catalog'),
      ],
    );
    const surfaceId = 'testSurface';

    // Initialize data model with tab 1 (index 1) active
    surfaceController.handleMessage(
      updateDataModel(
        surfaceId: surfaceId,
        path: DataPath('/'),
        value: {'currentTab': 1},
      ),
    );

    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'Tabs',
        properties: {
          'component': 'Tabs',
          'activeTab': {'path': 'currentTab'},
          'tabs': [
            {'label': 'Tab 1', 'content': 'text1'},
            {'label': 'Tab 2', 'content': 'text2'},
          ],
        },
      ),
      component(
        id: 'text1',
        type: 'Text',
        properties: {'component': 'Text', 'text': 'Content 1'},
      ),
      component(
        id: 'text2',
        type: 'Text',
        properties: {'component': 'Text', 'text': 'Content 2'},
      ),
    ];

    surfaceController.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    surfaceController.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
    );

    // Initial build
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

    // Verify Tab 2 is active (index 1)
    expect(find.text('Content 2'), findsOneWidget);
    expect(find.text('Content 1'), findsNothing);

    // Update data model to switch to Tab 1 (index 0)
    surfaceController.handleMessage(
      updateDataModel(
        surfaceId: 'testSurface',
        path: DataPath('/currentTab'),
        value: 0,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Content 1'), findsOneWidget);
    expect(find.text('Content 2'), findsNothing);

    // Tap Tab 2
    await tester.tap(find.text('Tab 2'));
    await tester.pumpAndSettle();
    expect(find.text('Content 2'), findsOneWidget);

    // Verify data model updated
    final DataModel dataModel = surfaceController
        .contextFor(surfaceId)
        .dataModel;
    expect(dataModel.getValue<num>(DataPath('currentTab')), 1);
  });
}
