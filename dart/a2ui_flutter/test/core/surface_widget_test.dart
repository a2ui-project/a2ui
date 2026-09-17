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
import 'package:json_schema_builder/json_schema_builder.dart';

class FakeSurfaceContext implements SurfaceContext {
  FakeSurfaceContext({
    required this.surfaceId,
    required this.dataModel,
    required this.catalog,
    required this.definition,
    required this.handleUiEventCallback,
    this.reportErrorCallback,
  });

  @override
  final String surfaceId;

  @override
  final DataModel dataModel;

  @override
  final Catalog? catalog;

  @override
  final ValueNotifier<SurfaceDefinition?> definition;

  final void Function(UiEvent) handleUiEventCallback;

  @override
  void handleUiEvent(UiEvent event) {
    handleUiEventCallback(event);
  }

  final void Function(Object error, StackTrace? stack)? reportErrorCallback;

  @override
  void reportError(Object error, StackTrace? stack) {
    if (reportErrorCallback != null) {
      reportErrorCallback!(error, stack);
    }
  }
}

void main() {
  group('SurfaceWidget', () {
    late DataModel dataModel;
    late FakeSurfaceContext surfaceContext;
    late Catalog catalog;

    setUp(() {
      dataModel = InMemoryDataModel();
      catalog = Catalog([text], catalogId: 'test_catalog');
      surfaceContext = FakeSurfaceContext(
        surfaceId: 'test_surface',
        dataModel: dataModel,
        catalog: catalog,
        definition: ValueNotifier<SurfaceDefinition?>(null),
        handleUiEventCallback: (event) {},
      );
    });

    testWidgets('renders empty when no definition', (tester) async {
      await tester.pumpWidget(
        MaterialApp(home: Surface(surfaceContext: surfaceContext)),
      );

      expect(find.byType(SizedBox), findsOneWidget);
    });

    testWidgets('renders default builder when no definition', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Surface(
            surfaceContext: surfaceContext,
            defaultBuilder: (context) => const Text('Loading...'),
          ),
        ),
      );

      expect(find.text('Loading...'), findsOneWidget);
    });

    testWidgets('renders root component', (tester) async {
      surfaceContext.definition.value = SurfaceDefinition(
        surfaceId: 'test_surface',
        catalogId: 'test_catalog',
        components: {
          'root': const Component(
            id: 'root',
            type: 'Text',
            properties: {'text': 'Hello World'},
          ),
        },
      );

      await tester.pumpWidget(
        MaterialApp(home: Surface(surfaceContext: surfaceContext)),
      );

      expect(find.text('Hello World'), findsOneWidget);
    });

    testWidgets('handles missing root component', (tester) async {
      surfaceContext.definition.value = SurfaceDefinition(
        surfaceId: 'test_surface',
        catalogId: 'test_catalog',
        components: {
          'other': const Component(
            id: 'other',
            type: 'Text',
            properties: {'text': 'Hidden'},
          ),
        },
      );

      await tester.pumpWidget(
        MaterialApp(home: Surface(surfaceContext: surfaceContext)),
      );

      expect(find.text('Hidden'), findsNothing);
      expect(find.byType(SizedBox), findsOneWidget);
    });

    testWidgets('propogates data context', (tester) async {
      dataModel.update(DataPath('/message'), 'Dynamic Content');
      surfaceContext.definition.value = SurfaceDefinition(
        surfaceId: 'test_surface',
        catalogId: 'test_catalog',
        components: {
          'root': const Component(
            id: 'root',
            type: 'Text',
            properties: {
              'text': {'path': '/message'},
            },
          ),
        },
      );

      await tester.pumpWidget(
        MaterialApp(home: Surface(surfaceContext: surfaceContext)),
      );

      expect(find.text('Dynamic Content'), findsOneWidget);

      // Update data
      dataModel.update(DataPath('/message'), 'Updated Content');
      await tester.pump();

      expect(find.text('Updated Content'), findsOneWidget);
    });

    testWidgets('reports error and shows fallback when builder throws', (
      tester,
    ) async {
      Object? reportedError;
      dataModel = InMemoryDataModel();
      surfaceContext = FakeSurfaceContext(
        surfaceId: 'test_surface',
        dataModel: dataModel,
        catalog: Catalog([
          CatalogItem(
            name: 'BrokenWidget',
            dataSchema: Schema.object(properties: {}),
            widgetBuilder: (context) => throw Exception('Build failed'),
          ),
        ], catalogId: 'test_catalog'),
        definition: ValueNotifier<SurfaceDefinition?>(
          SurfaceDefinition(
            surfaceId: 'test_surface',
            catalogId: 'test_catalog',
            components: {
              'root': const Component(
                id: 'root',
                type: 'BrokenWidget',
                properties: {},
              ),
            },
          ),
        ),
        handleUiEventCallback: (event) {},
        reportErrorCallback: (error, stack) {
          reportedError = error;
        },
      );

      await tester.pumpWidget(
        MaterialApp(home: Surface(surfaceContext: surfaceContext)),
      );

      expect(reportedError, isNotNull);
      expect(find.byType(FallbackWidget), findsOneWidget);
    });
  });
}
