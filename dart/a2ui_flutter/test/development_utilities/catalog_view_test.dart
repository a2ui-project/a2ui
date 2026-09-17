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

void main() {
  group('DebugCatalogView', () {
    // https://github.com/flutter/genui/issues/671
    testWidgets('Renders a custom Catalog', (WidgetTester tester) async {
      final expectedText = 'This Test Is Working!!';
      final testCatalog = Catalog([
        getCatalogItemForTesting(expectedText),
      ], catalogId: 'some-catalog-id-for-testing');

      await tester.pumpWidget(
        MaterialApp(home: DebugCatalogView(catalog: testCatalog)),
      );

      expect(find.text(expectedText), findsOneWidget);
    });
  });
}

/// Returns a simple fork of the core Text catalog item that renders the
/// incoming [successMessage].
CatalogItem getCatalogItemForTesting(String successMessage) {
  final catalogItemName = 'TextForTesting';
  return CatalogItem(
    name: catalogItemName,
    dataSchema: BasicCatalogItems.text.dataSchema,
    widgetBuilder: BasicCatalogItems.text.widgetBuilder,
    exampleData: [
      () => jsonEncode([
        {'id': 'root', 'component': catalogItemName, 'text': successMessage},
      ]),
    ],
  );
}
