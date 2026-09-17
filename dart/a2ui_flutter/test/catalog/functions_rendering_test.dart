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
  late SurfaceController controller;
  final testCatalog = Catalog(
    [BasicCatalogItems.text, BasicCatalogItems.column],
    functions: BasicFunctions.all,
    catalogId: 'test_catalog',
  );

  setUp(() {
    controller = SurfaceController(catalogs: [testCatalog]);
  });

  tearDown(() {
    controller.dispose();
  });

  testWidgets('Surface renders function output correctly', (
    WidgetTester tester,
  ) async {
    const surfaceId = 'testSurface';

    // 1. Create surface
    controller.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
    );

    // 2. Update data model
    controller.handleMessage(
      updateDataModel(
        surfaceId: surfaceId,
        path: DataPath.root,
        value: {'count': 2},
      ),
    );

    // 3. Update components with a function call
    final components = [
      const Component(
        id: 'root',
        type: 'Column',
        properties: {
          'children': ['cartSummaryText'],
        },
      ),
      const Component(
        id: 'cartSummaryText',
        type: 'Text',
        properties: {
          'text': {
            'call': 'pluralize',
            'args': {
              'count': {'path': '/count'},
              'zero': 'No items',
              'one': 'One item',
              'other': 'Multiple items',
            },
            'returnType': 'string',
          },
        },
      ),
    ];

    controller.handleMessage(
      updateComponents(
        surfaceId: surfaceId,
        components: components.map((c) => c.toJson()).toList(),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Surface(surfaceContext: controller.contextFor(surfaceId)),
      ),
    );
    await tester.pumpAndSettle();

    // We expect "Multiple items" because count is 2.
    expect(find.text('Multiple items'), findsOneWidget);
  });
}
