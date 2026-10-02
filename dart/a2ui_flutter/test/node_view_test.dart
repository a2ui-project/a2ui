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
  group('NodeView Fallback States', () {
    testWidgets('renders unknown component type warning', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createTestCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'unknown-surface',
        catalog: catalog,
      );

      surface.componentsModel.addComponent(
        ComponentModel('root', 'NonExistentComponentType', const {}),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.byType(A2uiUnknownTypeWarning), findsOneWidget);
      expect(
        find.textContaining('Unknown component type: NonExistentComponentType'),
        findsOneWidget,
      );
    });

    testWidgets('renders cyclic reference indicator', (
      WidgetTester tester,
    ) async {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createTestCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'cyclic-surface',
        catalog: catalog,
      );

      surface.componentsModel.addComponent(
        ComponentModel('root', 'TestContainer', const {
          'children': ['container-1'],
        }),
      );
      surface.componentsModel.addComponent(
        ComponentModel('container-1', 'TestContainer', const {'child': 'root'}),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );

      expect(find.byType(A2uiCyclicReferenceIndicator), findsOneWidget);
      expect(
        find.textContaining('Cyclic component reference detected'),
        findsOneWidget,
      );
    });
  });
}
