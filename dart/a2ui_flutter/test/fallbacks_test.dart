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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import 'support/fixture_catalog.dart';

void main() {
  late FixtureLog log;
  late SurfaceModel<ComponentImplementation> surface;
  late List<A2uiRendererError> errors;
  late List<Object> infos;

  setUp(() {
    log = FixtureLog();
    errors = [];
    infos = [];
    surface = SurfaceModel<ComponentImplementation>(
      's',
      defaultCatalog: fixtureCatalog(log),
    );
    surface.onError.subscribe(errors.add);
  });

  tearDown(() => surface.dispose());

  void add(String id, String type, Map<String, Object?> properties) {
    surface.componentsModel.addComponent(ComponentModel(id, type, properties));
  }

  /// Fallbacks that log each info and show its component id as text.
  final recording = A2uiFallbacks(
    pending: (context, info) {
      infos.add(info);
      return Text('pending ${info.componentId}');
    },
    error: (context, info) {
      infos.add(info);
      return Text('error ${info.componentId} ${info.error.type}');
    },
  );

  Future<void> pumpRoot(WidgetTester tester, A2uiFallbacks? fallbacks) =>
      tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: A2uiSurface(surface: surface, fallbacks: fallbacks),
          ),
        ),
      );

  Element viewElement(WidgetTester tester, String instanceId) =>
      tester.element(find.byKey(NodeKey(instanceId)));

  group('pending', () {
    testWidgets('shows the fallback for the root until it arrives', (
      tester,
    ) async {
      await pumpRoot(tester, recording);

      expect(find.text('pending root'), findsOneWidget);
      expect(infos.toSet(), {const A2uiPendingInfo(componentId: 'root')});

      add('root', 'Text', {'text': 'Root'});
      await tester.pump();

      expect(find.text('Root'), findsOneWidget);
      expect(find.text('pending root'), findsNothing);
    });

    testWidgets('names the surface root id for the root', (tester) async {
      surface.dispose();
      surface = SurfaceModel<ComponentImplementation>(
        's',
        defaultCatalog: fixtureCatalog(log),
        rootId: 'main',
      );

      await pumpRoot(tester, recording);

      expect(find.text('pending main'), findsOneWidget);
    });

    testWidgets('shows the fallback for a child, then replaces it in place', (
      tester,
    ) async {
      add('root', 'Column', {
        'children': ['late'],
      });
      await pumpRoot(tester, recording);

      expect(find.text('pending late'), findsOneWidget);
      expect(infos.toSet(), {
        const A2uiPendingInfo(
          componentId: 'late',
          parentComponentType: 'Column',
        ),
      });
      final Element before = viewElement(tester, 'late');

      add('late', 'Probe', {'label': 'Arrived'});
      await tester.pump();

      expect(find.text('Arrived'), findsOneWidget);
      expect(find.text('pending late'), findsNothing);
      expect(viewElement(tester, 'late'), same(before));
    });

    testWidgets('reaches nested nodes through single-child parents', (
      tester,
    ) async {
      add('root', 'Column', {
        'children': ['box'],
      });
      add('box', 'Box', {'child': 'button'});
      add('button', 'Button', {'child': 'late'});

      await pumpRoot(tester, recording);

      expect(find.text('pending late'), findsOneWidget);
      expect(infos.toSet(), {
        const A2uiPendingInfo(
          componentId: 'late',
          parentComponentType: 'Button',
        ),
      });
    });
  });

  group('error', () {
    testWidgets('shows the fallback for an unknown type, reported once', (
      tester,
    ) async {
      add('root', 'Column', {
        'children': ['weird'],
      });
      add('weird', 'Bogus', {});

      await pumpRoot(tester, recording);

      expect(find.text('error weird unknown-type'), findsOneWidget);
      expect(infos.toSet(), {
        const A2uiErrorInfo(
          componentId: 'weird',
          parentComponentType: 'Column',
          error: A2uiFallbackError(
            type: A2uiFallbackError.unknownType,
            componentType: 'Bogus',
          ),
        ),
      });
      expect(errors.map((e) => e.code), ['UNKNOWN_COMPONENT_TYPE']);
    });

    testWidgets('shows the fallback for an unknown root type', (tester) async {
      add('root', 'Bogus', {});

      await pumpRoot(tester, recording);

      expect(find.text('error root unknown-type'), findsOneWidget);
      expect(infos.toSet(), {
        const A2uiErrorInfo(
          componentId: 'root',
          error: A2uiFallbackError(
            type: 'unknown-type',
            componentType: 'Bogus',
          ),
        ),
      });
    });

    testWidgets('shows the fallback for a cycle, reported once', (
      tester,
    ) async {
      add('root', 'Column', {
        'children': ['a'],
      });
      add('a', 'Box', {'child': 'root'});

      await pumpRoot(tester, recording);

      expect(find.text('error root cyclic'), findsOneWidget);
      expect(infos.toSet(), {
        const A2uiErrorInfo(
          componentId: 'root',
          parentComponentType: 'Box',
          error: A2uiFallbackError(type: A2uiFallbackError.cyclic),
        ),
      });
      expect(errors.map((e) => e.code), ['CYCLIC_REFERENCE']);
    });
  });

  group('nothing', () {
    testWidgets('without fallbacks, or with a missing category', (
      tester,
    ) async {
      add('root', 'Column', {
        'children': ['late', 'weird'],
      });
      add('weird', 'Bogus', {});

      for (final A2uiFallbacks? fallbacks in [
        null,
        const A2uiFallbacks(),
        A2uiFallbacks(error: (context, info) => null),
      ]) {
        await pumpRoot(tester, fallbacks);

        expect(find.byType(Text), findsNothing);
        expect(tester.getSize(find.byKey(const NodeKey('late'))), Size.zero);
        expect(tester.getSize(find.byKey(const NodeKey('weird'))), Size.zero);
      }
    });

    testWidgets('for the root when the builder returns null', (tester) async {
      await pumpRoot(tester, A2uiFallbacks(pending: (context, info) => null));

      expect(tester.getSize(find.byType(A2uiSurface)), Size.zero);
    });

    testWidgets('when the builder throws, which is logged', (tester) async {
      add('root', 'Column', {
        'children': ['late', 'on-time'],
      });
      add('on-time', 'Text', {'text': 'On time'});

      await pumpRoot(
        tester,
        A2uiFallbacks(pending: (context, info) => throw StateError('broken')),
      );

      expect(tester.takeException(), isStateError);
      expect(find.text('On time'), findsOneWidget);
      expect(tester.getSize(find.byKey(const NodeKey('late'))), Size.zero);
      expect(errors, isEmpty);
    });
  });

  testWidgets('follows fallbacks given to the surface later', (tester) async {
    add('root', 'Column', {
      'children': ['late'],
    });
    await pumpRoot(tester, null);
    expect(find.byType(Text), findsNothing);

    await pumpRoot(tester, recording);

    expect(find.text('pending late'), findsOneWidget);
  });

  testWidgets('a nested surface does not inherit the outer fallbacks', (
    tester,
  ) async {
    final inner = SurfaceModel<ComponentImplementation>(
      'inner',
      defaultCatalog: fixtureCatalog(),
    );
    addTearDown(inner.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              A2uiSurface(surface: surface, fallbacks: recording),
              A2uiSurface(surface: inner),
            ],
          ),
        ),
      ),
    );

    expect(find.text('pending root'), findsOneWidget);
  });

  group('buildChildOrNull', () {
    late List<Widget?> built;

    setUp(() {
      built = [];
      surface = SurfaceModel<ComponentImplementation>(
        's',
        defaultCatalog: CatalogImplementation(
          id: fixtureCatalogId,
          components: [
            ...fixtureCatalog().components.values,
            ComponentImplementation(
              name: 'Spy',
              schema: Schema.object(
                properties: {'children': CommonSchemas.childList},
              ),
              builder: (context, node, props, buildChild) {
                built = [
                  for (final child in props.children('children'))
                    buildChildOrNull(context, child, buildChild),
                ];
                return Column(children: built.nonNulls.toList());
              },
            ),
            // Wraps each child in a KeyedSubtree, as the README asks of a
            // builder that wraps its children.
            ComponentImplementation(
              name: 'KeyedSpy',
              schema: Schema.object(
                properties: {'children': CommonSchemas.childList},
              ),
              builder: (context, node, props, buildChild) {
                Widget keyed(ComponentNode<ComponentImplementation> child) =>
                    KeyedSubtree(
                      key: NodeKey(child.instanceId),
                      child: buildChild(child),
                    );
                built = [
                  for (final child in props.children('children'))
                    buildChildOrNull(context, child, keyed),
                ];
                return Column(children: built.nonNulls.toList());
              },
            ),
          ],
        ),
      );
    });

    testWidgets('looks through a KeyedSubtree the builder wraps a child in', (
      tester,
    ) async {
      add('root', 'KeyedSpy', {
        'children': ['text', 'late'],
      });
      add('text', 'Text', {'text': 'Text'});

      await pumpRoot(tester, A2uiFallbacks(pending: (context, info) => null));
      expect(built, [isA<KeyedSubtree>(), isNull]);

      await pumpRoot(tester, recording);
      expect(built, [isA<KeyedSubtree>(), isA<KeyedSubtree>()]);
    });

    testWidgets('returns null for a child that shows nothing', (tester) async {
      add('root', 'Spy', {
        'children': ['text', 'late'],
      });
      add('text', 'Text', {'text': 'Text'});

      await pumpRoot(tester, A2uiFallbacks(pending: (context, info) => null));

      expect(built, [isA<Widget>(), isNull]);
    });

    testWidgets('returns a widget for a child with a fallback', (tester) async {
      add('root', 'Spy', {
        'children': ['late'],
      });

      await pumpRoot(tester, recording);

      expect(built, [isA<Widget>()]);
      expect(find.text('pending late'), findsOneWidget);
      expect(infos.toSet(), {
        const A2uiPendingInfo(componentId: 'late', parentComponentType: 'Spy'),
      });
    });
  });
}
