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

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test_infra/message_builders.dart';

void main() {
  // Test case based on jobApplication.1.sample
  testWidgets(
    'ChoicePicker mutuallyExclusive handles single String value in DataModel',
    (WidgetTester tester) async {
      final catalog = Catalog([choicePicker], catalogId: 'test');

      // Create a controller with a catalog that has ChoicePicker
      final controller = SurfaceController(catalogs: [catalog]);

      // Initial message to create surface and components
      final core.CreateSurfaceMessage createSurfaceMessage = createSurface(
        surfaceId: 'test',
        catalogId: 'test',
      );

      final core.UpdateDataModelMessage updateData = updateDataModel(
        surfaceId: 'test',
        value: {
          'experience': '2-5', // Single string value, not a list
        },
        path: DataPath.root,
      );

      final core.UpdateComponentsMessage updateComponentsMessage =
          updateComponents(
            surfaceId: 'test',
            components: [
              component(
                id: 'root',
                type: 'ChoicePicker',
                properties: {
                  'label': 'Years of Experience',
                  'variant': 'mutuallyExclusive',
                  'options': [
                    {'label': '0-1', 'value': '0-1'},
                    {'label': '2-5', 'value': '2-5'},
                    {'label': '5+', 'value': '5+'},
                  ],
                  'value': {'path': '/experience'},
                },
              ),
            ],
          );

      controller.handleMessage(createSurfaceMessage);
      controller.handleMessage(updateData);
      controller.handleMessage(updateComponentsMessage);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Surface(surfaceContext: controller.contextFor('test')),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // Verify it rendered
      expect(find.text('Years of Experience'), findsOneWidget);
      expect(find.text('0-1'), findsOneWidget);
      expect(find.text('2-5'), findsOneWidget);

      // Verify selection (RadioListTile)
      // We check if the radio button corresponding to '2-5' is selected.
      // In Flutter RadioListTile, we can find the Radio widget.

      final Iterable<Radio<String>> radios = tester.widgetList<Radio<String>>(
        find.byType(Radio<String>),
      );
      expect(radios.length, 3);

      // The second radio should be selected
      final Radio<String> selectedRadio = radios.elementAt(1);
      expect(selectedRadio.value, '2-5');
      expect(
        // ignore: deprecated_member_use
        selectedRadio.groupValue,
        '2-5',
        reason: 'Group value should match the selected choice',
      );

      // Update data model to another single string
      controller.handleMessage(
        updateDataModel(
          surfaceId: 'test',
          path: DataPath('/experience'),
          value: '5+',
        ),
      );
      await tester.pumpAndSettle();

      final Iterable<Radio<String>> radiosAfter = tester
          .widgetList<Radio<String>>(find.byType(Radio<String>));
      // ignore: deprecated_member_use
      expect(radiosAfter.elementAt(2).groupValue, '5+');
    },
  );

  testWidgets('ChoicePicker multipleSelection handles List value', (
    WidgetTester tester,
  ) async {
    final catalog = Catalog([choicePicker], catalogId: 'std');

    final controller = SurfaceController(catalogs: [catalog]);

    final core.CreateSurfaceMessage createSurfaceMessage = createSurface(
      surfaceId: 'test2',
      catalogId: 'std',
    );
    final core.UpdateDataModelMessage updateData = updateDataModel(
      surfaceId: 'test2',
      value: {
        'selections': ['A', 'B'],
      },
      path: DataPath.root,
    );
    final core.UpdateComponentsMessage updateComponentsMessage =
        updateComponents(
          surfaceId: 'test2',
          components: [
            component(
              id: 'root',
              type: 'ChoicePicker',
              properties: {
                'label': 'Multi',
                'variant': 'multipleSelection',
                'options': [
                  {'label': 'A', 'value': 'A'},
                  {'label': 'B', 'value': 'B'},
                  {'label': 'C', 'value': 'C'},
                ],
                'value': {'path': '/selections'},
              },
            ),
          ],
        );

    controller.handleMessage(createSurfaceMessage);
    controller.handleMessage(updateData);
    controller.handleMessage(updateComponentsMessage);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(surfaceContext: controller.contextFor('test2')),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Multi'), findsOneWidget);

    // Verify Checkboxes
    final Iterable<Checkbox> checkboxes = tester.widgetList<Checkbox>(
      find.byType(Checkbox),
    );
    expect(checkboxes.length, 3);

    expect(checkboxes.elementAt(0).value, true); // A
    expect(checkboxes.elementAt(1).value, true); // B
    expect(checkboxes.elementAt(2).value, false); // C
  });

  testWidgets('ChoicePicker renders chips and supports filtering', (
    WidgetTester tester,
  ) async {
    final catalog = Catalog([choicePicker], catalogId: 'std');
    final controller = SurfaceController(catalogs: [catalog]);

    final core.CreateSurfaceMessage createSurfaceMessage = createSurface(
      surfaceId: 'chipsTest',
      catalogId: 'std',
    );
    final core.UpdateDataModelMessage updateData = updateDataModel(
      surfaceId: 'chipsTest',
      value: {
        'tags': ['flutter'],
      },
      path: DataPath.root,
    );
    final core.UpdateComponentsMessage updateComponentsMessage =
        updateComponents(
          surfaceId: 'chipsTest',
          components: [
            component(
              id: 'root',
              type: 'ChoicePicker',
              properties: {
                'label': 'Tags',
                'variant': 'multipleSelection',
                'displayStyle': 'chips',
                'filterable': true,
                'options': [
                  {'label': 'Flutter', 'value': 'flutter'},
                  {'label': 'Dart', 'value': 'dart'},
                  {'label': 'GenUI', 'value': 'genui'},
                ],
                'value': {'path': '/tags'},
              },
            ),
          ],
        );

    controller.handleMessage(createSurfaceMessage);
    controller.handleMessage(updateData);
    controller.handleMessage(updateComponentsMessage);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(surfaceContext: controller.contextFor('chipsTest')),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Tags'), findsOneWidget);
    // Find FilterChips
    expect(find.byType(FilterChip), findsNWidgets(3));
    expect(find.text('Flutter'), findsOneWidget);

    // Verify 'Flutter' is selected
    final FilterChip flutterChip = tester.widget<FilterChip>(
      find.widgetWithText(FilterChip, 'Flutter'),
    );
    expect(flutterChip.selected, true);

    // Verify filterable TextField exists
    expect(find.byType(TextField), findsOneWidget);

    // Filter by "Gen"
    await tester.enterText(find.byType(TextField), 'Gen');
    await tester.pumpAndSettle();

    // Flutter and Dart should be hidden (or at least filtered out visually)
    // The implementation might return SizedBox.shrink for filtered items.
    // Let's verify visible widgets.
    expect(find.text('GenUI'), findsOneWidget);
    expect(find.text('Flutter'), findsNothing);
    expect(find.text('Dart'), findsNothing);
  });

  testWidgets(
    'ChoicePicker handles null/missing data in valid path reference',
    (WidgetTester tester) async {
      final catalog = Catalog([choicePicker], catalogId: 'std');
      final controller = SurfaceController(catalogs: [catalog]);

      final core.CreateSurfaceMessage createSurfaceMessage = createSurface(
        surfaceId: 'nullTest',
        catalogId: 'std',
      );
      // Note: We are NOT sending UpdateDataModel with the value initially.
      final core.UpdateComponentsMessage updateComponentsMessage =
          updateComponents(
            surfaceId: 'nullTest',
            components: [
              component(
                id: 'root',
                type: 'ChoicePicker',
                properties: {
                  'label': 'Null Check',
                  'variant': 'multipleSelection',
                  'options': [
                    {'label': 'A', 'value': 'A'},
                  ],
                  // Points to a path that doesn't exist yet
                  'value': {'path': '/missing_path'},
                },
              ),
            ],
          );

      controller.handleMessage(createSurfaceMessage);
      controller.handleMessage(updateComponentsMessage);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Surface(surfaceContext: controller.contextFor('nullTest')),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Should render without error (title visible)
      expect(find.text('Null Check'), findsOneWidget);
      // Should have no selections
      final Iterable<Checkbox> checkboxes = tester.widgetList<Checkbox>(
        find.byType(Checkbox),
      );
      expect(checkboxes.length, 1);
      expect(checkboxes.first.value, false);
    },
  );

  testWidgets('ChoicePicker gracefully handles non-list data model values', (
    WidgetTester tester,
  ) async {
    final catalog = Catalog([choicePicker], catalogId: 'std');
    final controller = SurfaceController(catalogs: [catalog]);
    const surfaceId = 'testSurface';

    // Store a non-list string (should be treated as selected option if
    // it matches).
    controller.handleMessage(
      updateDataModel(
        surfaceId: surfaceId,
        path: DataPath('/choice'),
        value: 'option1',
      ),
    );

    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'ChoicePicker',
        properties: {
          'label': 'Test Choice',
          'value': {'path': '/choice'},
          'options': [
            {'label': 'Option 1', 'value': 'option1'},
            {'label': 'Option 2', 'value': 'option2'},
          ],
        },
      ),
    ];

    controller.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    controller.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: 'std'),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(surfaceContext: controller.contextFor(surfaceId)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify option1 is checked even though data model had "option1" string
    // instead of ["option1"] list.
    final Checkbox checkbox1 = tester.widget<Checkbox>(
      find.descendant(
        of: find.widgetWithText(CheckboxListTile, 'Option 1'),
        matching: find.byType(Checkbox),
      ),
    );
    expect(checkbox1.value, true);

    // Also test number type
    controller.handleMessage(
      updateDataModel(
        surfaceId: surfaceId,
        path: DataPath('/choice'),
        value: 123,
      ),
    );
    await tester.pumpAndSettle();

    final Checkbox checkboxNumber = tester.widget<Checkbox>(
      find.descendant(
        of: find.widgetWithText(CheckboxListTile, 'Option 1'),
        matching: find.byType(Checkbox),
      ),
    );
    expect(checkboxNumber.value, false); // 123 does not match option1
  });
}
