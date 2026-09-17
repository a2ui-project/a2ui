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
  testWidgets('Card widget renders child', (WidgetTester tester) async {
    final surfaceController = SurfaceController(
      catalogs: [
        Catalog([
          BasicCatalogItems.card,
          BasicCatalogItems.text,
        ], catalogId: 'test_catalog'),
      ],
    );
    const surfaceId = 'testSurface';
    final List<JsonMap> components = [
      component(id: 'root', type: 'Card', properties: {'child': 'text'}),
      component(
        id: 'text',
        type: 'Text',
        properties: {'text': 'This is a card.'},
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

    expect(find.text('This is a card.'), findsOneWidget);
    expect(find.byType(Card), findsOneWidget);
  });
}
