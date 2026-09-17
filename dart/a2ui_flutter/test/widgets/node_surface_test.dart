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
// coreCatalogFor is internal; this test exercises the same wiring
// SurfaceController performs.
import 'package:a2ui_flutter/src/model/catalog.dart' show coreCatalogFor;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final testCatalog = Catalog([
    BasicCatalogItems.text,
    BasicCatalogItems.column,
    BasicCatalogItems.button,
  ], catalogId: 'test_catalog');

  (core.SurfaceModel<core.ComponentApi>, List<UiEvent>) createSurface() {
    final core.Catalog<core.ComponentApi, core.FunctionImplementation>
    coreCatalog = coreCatalogFor(testCatalog);
    final surface = core.SurfaceModel<core.ComponentApi>(
      'node-surface-test',
      catalog: coreCatalog,
    );
    return (surface, <UiEvent>[]);
  }

  Widget host(
    core.SurfaceModel<core.ComponentApi> surface,
    List<UiEvent> events,
  ) {
    return MaterialApp(
      home: NodeSurface(
        surface: surface,
        catalog: testCatalog,
        onEvent: events.add,
      ),
    );
  }

  void add(
    core.SurfaceModel<core.ComponentApi> surface,
    String id,
    String type,
    Map<String, Object?> properties,
  ) {
    surface.componentsModel.addComponent(
      core.ComponentModel(id, type, properties),
    );
  }

  testWidgets('renders a column of texts through the node path', (
    WidgetTester tester,
  ) async {
    final (core.SurfaceModel<core.ComponentApi> surface, List<UiEvent> events) =
        createSurface();
    add(surface, 'root', 'Column', {
      'children': ['t1', 't2'],
    });
    add(surface, 't1', 'Text', {'text': 'First'});
    add(surface, 't2', 'Text', {'text': 'Second'});

    await tester.pumpWidget(host(surface, events));
    await tester.pumpAndSettle();

    expect(find.text('First'), findsOneWidget);
    expect(find.text('Second'), findsOneWidget);
    expect(find.byType(Column), findsWidgets);
  });

  testWidgets('renders a children list referencing the same component twice', (
    WidgetTester tester,
  ) async {
    final (core.SurfaceModel<core.ComponentApi> surface, List<UiEvent> events) =
        createSurface();
    add(surface, 'root', 'Column', {
      'children': ['dup', 'dup'],
    });
    add(surface, 'dup', 'Text', {'text': 'Twice'});

    await tester.pumpWidget(host(surface, events));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Twice'), findsNWidgets(2));
  });

  testWidgets('upgrades a placeholder in place when its component arrives', (
    WidgetTester tester,
  ) async {
    final (core.SurfaceModel<core.ComponentApi> surface, List<UiEvent> events) =
        createSurface();
    add(surface, 'root', 'Column', {
      'children': ['late'],
    });

    await tester.pumpWidget(host(surface, events));
    await tester.pumpAndSettle();
    expect(find.text('Arrived'), findsNothing);

    add(surface, 'late', 'Text', {'text': 'Arrived'});
    await tester.pumpAndSettle();
    expect(find.text('Arrived'), findsOneWidget);
  });

  testWidgets('updates a data-bound text when the data model changes', (
    WidgetTester tester,
  ) async {
    final (core.SurfaceModel<core.ComponentApi> surface, List<UiEvent> events) =
        createSurface();
    surface.dataModel.set('/message', 'Hello');
    add(surface, 'root', 'Text', {
      'text': {'path': '/message'},
    });

    await tester.pumpWidget(host(surface, events));
    await tester.pumpAndSettle();
    expect(find.text('Hello'), findsOneWidget);

    surface.dataModel.set('/message', 'Goodbye');
    await tester.pumpAndSettle();
    expect(find.text('Goodbye'), findsOneWidget);
    expect(find.text('Hello'), findsNothing);
  });

  testWidgets('expands a template child list, one node per data item', (
    WidgetTester tester,
  ) async {
    final (core.SurfaceModel<core.ComponentApi> surface, List<UiEvent> events) =
        createSurface();
    surface.dataModel.set('/items', [
      {'name': 'Alpha'},
      {'name': 'Beta'},
    ]);
    add(surface, 'root', 'Column', {
      'children': {'componentId': 'item_tpl', 'path': '/items'},
    });
    add(surface, 'item_tpl', 'Text', {
      'text': {'path': 'name'},
    });

    await tester.pumpWidget(host(surface, events));
    await tester.pumpAndSettle();
    expect(find.text('Alpha'), findsOneWidget);
    expect(find.text('Beta'), findsOneWidget);

    surface.dataModel.set('/items', [
      {'name': 'Alpha'},
      {'name': 'Beta'},
      {'name': 'Gamma'},
    ]);
    await tester.pumpAndSettle();
    expect(find.text('Gamma'), findsOneWidget);
  });

  testWidgets('renders unmarked single-child references from raw definitions '
      'and dispatches actions', (WidgetTester tester) async {
    final (core.SurfaceModel<core.ComponentApi> surface, List<UiEvent> events) =
        createSurface();
    add(surface, 'root', 'Button', {
      'child': 'label',
      'action': {
        'event': {'name': 'pressed'},
      },
    });
    add(surface, 'label', 'Text', {'text': 'Press me'});

    await tester.pumpWidget(host(surface, events));
    await tester.pumpAndSettle();
    expect(find.text('Press me'), findsOneWidget);

    await tester.tap(find.byType(ElevatedButton));
    await tester.pumpAndSettle();

    expect(events, hasLength(1));
    expect(events.single.isUserAction, isTrue);
    expect(events.single.surfaceId, 'node-surface-test');
  });

  testWidgets('reconciles an explicit children list change', (
    WidgetTester tester,
  ) async {
    final (core.SurfaceModel<core.ComponentApi> surface, List<UiEvent> events) =
        createSurface();
    add(surface, 'root', 'Column', {
      'children': ['t1', 't2'],
    });
    add(surface, 't1', 'Text', {'text': 'Keep'});
    add(surface, 't2', 'Text', {'text': 'Drop'});
    add(surface, 't3', 'Text', {'text': 'New'});

    await tester.pumpWidget(host(surface, events));
    await tester.pumpAndSettle();
    expect(find.text('Keep'), findsOneWidget);
    expect(find.text('Drop'), findsOneWidget);

    surface.componentsModel.get('root')!.properties = {
      'children': ['t1', 't3'],
    };
    await tester.pumpAndSettle();
    expect(find.text('Keep'), findsOneWidget);
    expect(find.text('Drop'), findsNothing);
    expect(find.text('New'), findsOneWidget);
  });
}
