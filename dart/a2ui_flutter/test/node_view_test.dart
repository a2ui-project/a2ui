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
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_catalog.dart';

void main() {
  late FixtureLog log;
  late SurfaceModel<ComponentImplementation> surface;
  late List<A2uiClientError> errors;

  setUp(() {
    log = FixtureLog();
    errors = [];
    surface = SurfaceModel<ComponentImplementation>(
      's',
      defaultCatalog: fixtureCatalog(log),
    );
    surface.onError.addListener(errors.add);
  });

  tearDown(() => surface.dispose());

  void add(String id, String type, Map<String, Object?> properties) {
    surface.componentsModel.addComponent(ComponentModel(id, type, properties));
  }

  void update(String id, Map<String, Object?> properties) {
    surface.componentsModel.get(id)!.properties = properties;
  }

  void retype(String id, String type, Map<String, Object?> properties) {
    surface.componentsModel.removeComponent(id);
    add(id, type, properties);
  }

  /// Renders the surface.
  Future<void> pumpRoot(WidgetTester tester) => tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: A2uiSurface(surface: surface)),
    ),
  );

  /// The node the builder last ran for under [instanceId].
  ComponentNode<ComponentImplementation> viewNode(String instanceId) =>
      log.nodes[instanceId]!;

  Element viewElement(WidgetTester tester, String instanceId) =>
      tester.element(find.byKey(NodeKey(instanceId)));

  testWidgets('renders a resolved tree', (tester) async {
    add('root', 'Column', {
      'children': ['t1', 't2'],
    });
    add('t1', 'Text', {'text': 'First'});
    add('t2', 'Text', {'text': 'Second'});

    await pumpRoot(tester);

    expect(find.text('First'), findsOneWidget);
    expect(find.text('Second'), findsOneWidget);
    expect(log.builds, ['root', 't1', 't2']);
  });

  testWidgets('shows a progress indicator for a pending child, then upgrades '
      'it in place', (tester) async {
    add('root', 'Column', {
      'children': ['late'],
    });
    await pumpRoot(tester);
    final Element before = viewElement(tester, 'late');
    expect(log.nodes['late'], isNull);
    expect(find.byType(Text), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    add('late', 'Probe', {'label': 'Arrived'});
    await tester.pump();

    expect(find.text('Arrived'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(viewElement(tester, 'late'), same(before));
    expect(log.probeStates, ['late']);
  });

  testWidgets('follows the replacement node after an upgrade', (tester) async {
    add('root', 'Column', {
      'children': ['late'],
    });
    await pumpRoot(tester);
    surface.dataModel.set('/label', 'One');
    add('late', 'Probe', {
      'label': {'path': '/label'},
    });
    await tester.pump();
    expect(find.text('One'), findsOneWidget);

    surface.dataModel.set('/label', 'Two');
    await tester.pump();

    expect(find.text('Two'), findsOneWidget);
  });

  testWidgets('renders a diagnostic for an unknown type, reported once', (
    tester,
  ) async {
    add('root', 'Column', {
      'children': ['weird', 'weird'],
    });
    add('weird', 'Bogus', {});

    await pumpRoot(tester);

    expect(find.text('Unknown component type "Bogus"'), findsNWidgets(2));
    expect(errors.map((e) => e.code), ['UNKNOWN_COMPONENT_TYPE']);
  });

  testWidgets('renders a diagnostic for a cycle through children, reported '
      'once', (tester) async {
    add('root', 'Column', {
      'children': ['a'],
    });
    add('a', 'Column', {
      'children': ['b'],
    });
    add('b', 'Column', {
      'children': ['a'],
    });

    await pumpRoot(tester);

    expect(find.text('Cyclic reference to "a"'), findsOneWidget);
    expect(errors.map((e) => e.code), ['CYCLIC_REFERENCE']);

    update('root', {
      'children': ['a'],
    });
    await tester.pump();
    expect(errors, hasLength(1));
  });

  testWidgets('rebuilds only the node whose bound data changed', (
    tester,
  ) async {
    surface.dataModel.set('/message', 'Hello');
    add('root', 'Column', {
      'children': ['t1', 't2'],
    });
    add('t1', 'Text', {
      'text': {'path': '/message'},
    });
    add('t2', 'Text', {'text': 'Static'});
    await pumpRoot(tester);
    log.builds.clear();

    surface.dataModel.set('/message', 'Goodbye');
    await tester.pump();

    expect(find.text('Goodbye'), findsOneWidget);
    expect(log.builds, ['t1']);
  });

  testWidgets('keeps unchanged child nodes when the parent changes in place', (
    tester,
  ) async {
    add('root', 'Column', {
      'children': ['t1', 't2'],
    });
    add('t1', 'Text', {'text': 'One'});
    add('t2', 'Text', {'text': 'Two'});
    add('t3', 'Text', {'text': 'Three'});
    await pumpRoot(tester);
    final ComponentNode<ComponentImplementation> t1 = viewNode('t1');
    log.builds.clear();

    update('root', {
      'children': ['t1', 't2', 't3'],
    });
    await tester.pump();

    expect(find.text('Three'), findsOneWidget);
    expect(viewNode('t1'), same(t1));
  });

  testWidgets('keeps state across an explicit-list reorder, rebuilding the '
      'moved nodes', (tester) async {
    add('root', 'Column', {
      'children': ['p1', 'p2'],
    });
    add('p1', 'Probe', {'label': 'One'});
    add('p2', 'Probe', {'label': 'Two'});
    await pumpRoot(tester);
    final Element p1Before = viewElement(tester, 'p1');
    final ComponentNode<ComponentImplementation> p1Node = viewNode('p1');
    log.builds.clear();

    update('root', {
      'children': ['p2', 'p1'],
    });
    await tester.pump();

    expect(viewElement(tester, 'p1'), same(p1Before));
    expect(log.probeStates, ['p1', 'p2']);
    // The resolver keys child nodes by slot, so moved children are new nodes.
    expect(viewNode('p1'), isNot(same(p1Node)));
    expect(log.builds, unorderedEquals(['root', 'p1', 'p2']));
    expect(
      tester.getTopLeft(find.text('Two')).dy,
      lessThan(tester.getTopLeft(find.text('One')).dy),
    );
  });

  testWidgets('keeps state across a mid-list insert', (tester) async {
    add('root', 'Column', {
      'children': ['p1', 'p2'],
    });
    add('p1', 'Probe', {'label': 'One'});
    add('p2', 'Probe', {'label': 'Two'});
    add('x', 'Probe', {'label': 'New'});
    await pumpRoot(tester);
    final ComponentNode<ComponentImplementation> p1Node = viewNode('p1');
    log.builds.clear();

    update('root', {
      'children': ['p1', 'x', 'p2'],
    });
    await tester.pump();

    expect(find.text('New'), findsOneWidget);
    expect(log.probeStates, ['p1', 'p2', 'x']);
    expect(viewNode('p1'), same(p1Node));
  });

  testWidgets('resets the implementation state on a type change', (
    tester,
  ) async {
    add('root', 'Column', {
      'children': ['p'],
    });
    add('p', 'Probe', {'label': 'Probe'});
    await pumpRoot(tester);
    final Element before = viewElement(tester, 'p');

    retype('p', 'OtherProbe', {'label': 'Other'});
    await tester.pump();

    expect(find.text('Other'), findsOneWidget);
    expect(viewElement(tester, 'p'), same(before));
    expect(log.probeStates, ['p', 'p']);
  });

  group('template children', () {
    Future<void> pumpItems(WidgetTester tester, List<String> names) async {
      surface.dataModel.set('/items', [
        for (final name in names) {'name': name},
      ]);
      add('root', 'Column', {
        'children': {'componentId': 'item', 'path': '/items'},
      });
      add('item', 'Probe', {
        'label': {'path': 'name'},
      });
      await pumpRoot(tester);
    }

    List<String> labels(WidgetTester tester) => [
      for (final Element e in find.byType(Text).evaluate())
        (e.widget as Text).data!,
    ];

    void setItems(List<String> names) => surface.dataModel.set('/items', [
      for (final name in names) {'name': name},
    ]);

    testWidgets('keep state by index on an insert at the front', (
      tester,
    ) async {
      await pumpItems(tester, ['A', 'B']);
      final ComponentNode<ComponentImplementation> first = viewNode(
        'item-[/items/0]',
      );

      setItems(['Z', 'A', 'B']);
      await tester.pump();

      expect(labels(tester), ['Z', 'A', 'B']);
      expect(viewNode('item-[/items/0]'), same(first));
      expect(log.probeStates, [
        'item-[/items/0]',
        'item-[/items/1]',
        'item-[/items/2]',
      ]);
    });

    testWidgets('keep state by index on a delete', (tester) async {
      await pumpItems(tester, ['A', 'B']);
      final ComponentNode<ComponentImplementation> second = viewNode(
        'item-[/items/1]',
      );

      setItems(['B']);
      await tester.pump();

      expect(labels(tester), ['B']);
      expect(second.disposed, isTrue);
      expect(log.probeStates, ['item-[/items/0]', 'item-[/items/1]']);
    });

    testWidgets('keep state by index on a reorder', (tester) async {
      await pumpItems(tester, ['A', 'B']);

      setItems(['B', 'A']);
      await tester.pump();

      expect(labels(tester), ['B', 'A']);
      expect(log.probeStates, ['item-[/items/0]', 'item-[/items/1]']);
    });
  });

  testWidgets('leaves no live nodes after unmount', (tester) async {
    add('root', 'Column', {
      'children': ['t1', 'p'],
    });
    add('t1', 'Text', {'text': 'One'});
    add('p', 'Probe', {'label': 'Two'});
    await pumpRoot(tester);
    expect(log.nodes.keys, unorderedEquals(['root', 't1', 'p']));
    expect(log.nodes.values.where((node) => node.disposed), isEmpty);

    await tester.pumpWidget(const SizedBox());

    expect(log.nodes.values.where((node) => !node.disposed), isEmpty);
  });

  testWidgets('drops a removed child view without error', (tester) async {
    add('root', 'Column', {
      'children': ['t1', 't2'],
    });
    add('t1', 'Text', {'text': 'Keep'});
    add('t2', 'Text', {'text': 'Drop'});
    await pumpRoot(tester);
    final ComponentNode<ComponentImplementation> dropped = viewNode('t2');

    update('root', {
      'children': ['t1'],
    });
    await tester.pump();

    expect(find.text('Drop'), findsNothing);
    expect(dropped.disposed, isTrue);
    expect(tester.takeException(), isNull);
  });
}
