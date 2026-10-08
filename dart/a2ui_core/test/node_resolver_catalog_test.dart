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
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

import 'conformance/conformance_harness.dart';

class _RecordingFunction extends FunctionImplementation {
  final List<Map<String, Object?>> calls = [];

  _RecordingFunction(FunctionApi api)
      : super(
          name: api.name,
          argumentSchema: api.argumentSchema,
          returnType: api.returnType,
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    calls.add(args);
    return null;
  }
}

void main() {
  group('NodeResolver with the published basic catalog', () {
    late MessageProcessor<ComponentApi> processor;
    late SurfaceModel<ComponentApi> surface;
    late NodeResolver<ComponentApi> resolver;
    late _RecordingFunction openUrl;

    setUp(() {
      final CatalogApi parsed = Catalog.fromJson(
        jsonDecode(
          File(
            resolveConformancePath(
              '../specification/v0_9_1/catalogs/basic/catalog.json',
            ),
          ).readAsStringSync(),
        ) as Map<String, Object?>,
      );
      openUrl = _RecordingFunction(parsed.functions['openUrl']!);
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: parsed.id,
        protocolVersion: 'v0.9',
        components: parsed.components.values.toList(),
        functions: [openUrl],
      );
      processor = MessageProcessor<ComponentApi>(
        catalogs: [catalog],
        defaultVersion: A2uiProtocolVersion.v0_9,
      );
      processor.processMessages(
        AgentToRendererMessagePayload.of(
          CreateSurfaceMessage(
              version: 'v0.9', surfaceId: 's', catalogId: catalog.id),
        ),
      );
      surface = processor.groupModel.getSurface('s')!;
      resolver = NodeResolver(surface);
      addTearDown(() {
        resolver.dispose();
        processor.groupModel.dispose();
      });
    });

    void process(List<Map<String, Object?>> components) {
      processor.processMessages(
        AgentToRendererMessage.parseAll([
          {
            'version': 'v0.9',
            'updateComponents': {'surfaceId': 's', 'components': components},
          },
        ], protocolVersion: A2uiProtocolVersion.v0_9),
      );
    }

    test('resolves scoped bindings and publishes only the changed node', () {
      surface.dataModel.set('/people', [
        {'name': 'Ada'},
        {'name': 'Lin'},
      ]);
      process([
        {
          'id': 'root',
          'component': 'Column',
          'children': {'componentId': 'nameField', 'path': '/people'},
        },
        {
          'id': 'nameField',
          'component': 'TextField',
          'label': 'Name',
          'value': {'path': 'name'},
        },
      ]);
      final ComponentNode<ComponentApi> root = resolver.rootNode.peek()!;
      final List<ComponentNode<ComponentApi>> children =
          (root.props.peek()['children']! as List)
              .cast<ComponentNode<ComponentApi>>();
      expect(children.map((node) => node.dataPath), ['/people/0', '/people/1']);
      final Object? label = children.first.props.peek()['label'];
      expect(label, isA<ResolvedBinding<Object?>>());
      expect(label, isNot(isA<WritableBinding<Object?>>()));
      expect((label! as ResolvedBinding<Object?>).value, 'Name');
      final Object? value = children.first.props.peek()['value'];
      expect(value, isA<WritableBinding<Object?>>());
      final binding = value! as WritableBinding<Object?>;
      expect(binding.value, 'Ada');

      final emissions = [0, 0, 0];
      final nodes = [root, ...children];
      for (var i = 0; i < nodes.length; i++) {
        final index = i;
        addTearDown(nodes[i].props.subscribe((_) => emissions[index]++));
        emissions[i] = 0;
      }
      binding.set('Grace');

      expect(surface.dataModel.get('/people/0/name'), 'Grace');
      expect(binding.value, 'Ada');
      expect(
        (children.first.props.peek()['value']! as ResolvedBinding<Object?>)
            .value,
        'Grace',
      );
      expect(
        (children.last.props.peek()['value']! as ResolvedBinding<Object?>)
            .value,
        'Lin',
      );
      expect(emissions, [0, 1, 0]);
    });

    test('resolves event context when the action is invoked', () async {
      surface.dataModel.set('/name', 'Ada');
      final actions = <A2uiClientAction>[];
      surface.onAction.addListener(actions.add);
      process([
        {
          'id': 'root',
          'component': 'Button',
          'child': 'label',
          'action': {
            'event': {
              'name': 'save',
              'context': {
                'name': {'path': '/name'},
              },
            },
          },
        },
        {'id': 'label', 'component': 'Text', 'text': 'Save'},
      ]);
      final Object? action = resolver.rootNode.peek()!.props.peek()['action'];
      expect(action, isA<Future<void> Function()>());
      expect(actions, isEmpty);
      surface.dataModel.set('/name', 'Grace');
      await (action! as Future<void> Function())();

      expect(actions, hasLength(1));
      expect(actions.single.name, 'save');
      expect(actions.single.sourceComponentId, 'root');
      expect(actions.single.context, {'name': 'Grace'});
    });

    test('executes a function action without emitting an event', () async {
      final actions = <A2uiClientAction>[];
      surface.onAction.addListener(actions.add);
      process([
        {
          'id': 'root',
          'component': 'Button',
          'child': 'label',
          'action': {
            'functionCall': {
              'call': 'openUrl',
              'args': {'url': 'https://example.test'},
            },
          },
        },
        {'id': 'label', 'component': 'Text', 'text': 'Open'},
      ]);
      final Object? action = resolver.rootNode.peek()!.props.peek()['action'];
      expect(action, isA<Future<void> Function()>());
      expect(openUrl.calls, isEmpty);
      await (action! as Future<void> Function())();

      expect(openUrl.calls, [
        {'url': 'https://example.test'},
      ]);
      expect(actions, isEmpty);
    });
  });

  test('recognizes each shared dynamic type as a binding', () {
    final values = <String, Object?>{
      'DynamicString': 'hello',
      'DynamicNumber': 42,
      'DynamicBoolean': true,
      'DynamicStringList': ['a', 'b'],
      'DynamicValue': {'count': 1},
    };
    final CatalogApi parsed = Catalog.fromJson({
      'catalogId': 'dynamic-types',
      'components': {
        'Values': {
          'type': 'object',
          'properties': {
            for (final type in values.keys)
              for (final suffix in ['Literal', 'Bound'])
                '$type$suffix': {r'$ref': 'common_types.json#/\$defs/$type'},
          },
        },
      },
    });
    final catalog = Catalog<ComponentApi, FunctionImplementation>(
      id: parsed.id,
      protocolVersion: 'v0.9',
      components: parsed.components.values.toList(),
    );
    final surface = SurfaceModel<ComponentApi>('s', defaultCatalog: catalog);
    final resolver = NodeResolver<ComponentApi>(surface);
    addTearDown(() {
      resolver.dispose();
      surface.dispose();
    });
    surface.dataModel.set('/', values);
    surface.componentsModel.addComponent(
      ComponentModel('root', 'Values', {
        for (final MapEntry<String, Object?> entry in values.entries) ...{
          '${entry.key}Literal': entry.value,
          '${entry.key}Bound': {'path': '/${entry.key}'},
        },
      }),
    );
    final NodeProps props = resolver.rootNode.peek()!.props.peek();
    for (final MapEntry<String, Object?> entry in values.entries) {
      final Object? literal = props['${entry.key}Literal'];
      final Object? bound = props['${entry.key}Bound'];
      expect(literal, isA<ResolvedBinding<Object?>>(), reason: entry.key);
      expect(literal, isNot(isA<WritableBinding<Object?>>()));
      expect(bound, isA<WritableBinding<Object?>>(), reason: entry.key);
      expect((literal! as ResolvedBinding<Object?>).value, entry.value);
      expect((bound! as WritableBinding<Object?>).value, entry.value);
    }
  });
  group('NodeResolver with several catalogs on one surface', () {
    late MessageProcessor<ComponentApi> processor;
    late SurfaceModel<ComponentApi> surface;
    late NodeResolver<ComponentApi> resolver;
    final chartApi = ComponentApi(
      name: 'Chart',
      schema: Schema.object(properties: {'title': Schema.string()}),
    );

    setUp(() {
      final second = Catalog<ComponentApi, FunctionImplementation>(
        id: 'second',
        components: [chartApi],
        functions: [_ConstantFunction('capitalize', 'from second')],
      );
      processor = MessageProcessor<ComponentApi>(
        catalogs: [MinimalCatalog(), second],
        defaultVersion: A2uiProtocolVersion.v0_9,
      );
      processor.processMessages(
        AgentToRendererMessagePayload.of(
          CreateSurfaceMessage(
            version: 'v0.9',
            surfaceId: 's',
            catalogId: MinimalCatalog().id,
          ),
        ),
      );
      surface = processor.groupModel.getSurface('s')!;
      resolver = NodeResolver(surface);
      addTearDown(() {
        resolver.dispose();
        processor.groupModel.dispose();
      });
    });

    void process(List<Map<String, Object?>> components) {
      processor.processMessages(
        AgentToRendererMessage.parseAll([
          {
            'version': 'v0.9',
            'updateComponents': {'surfaceId': 's', 'components': components},
          },
        ], protocolVersion: A2uiProtocolVersion.v0_9),
      );
    }

    test('renders a component with the catalog it names for itself', () {
      process([
        {
          'id': 'root',
          'component': 'Chart',
          'catalogId': 'second',
          'title': 'Sales',
        },
      ]);

      final ComponentNode<ComponentApi> root = resolver.rootNode.peek()!;
      expect(root.state, NodeState.resolved);
      expect(root.impl, same(chartApi));
    });

    test('does not find a component in the default catalog by another', () {
      process([
        {'id': 'root', 'component': 'Chart', 'title': 'Sales'},
      ]);

      expect(resolver.rootNode.peek()!.state, NodeState.unknownType);
    });

    test('runs a function call in the catalog it names', () {
      process([
        {
          'id': 'root',
          'component': 'Text',
          'text': {
            'call': 'capitalize',
            'catalogId': 'second',
            'args': {'value': 'hello'},
          },
        },
      ]);

      final Object? text = resolver.rootNode.peek()!.props.peek()['text'];
      expect((text! as ResolvedBinding<Object?>).value, 'from second');
    });

    test('runs a function call without a catalogId in the default', () {
      process([
        {
          'id': 'root',
          'component': 'Text',
          'text': {
            'call': 'capitalize',
            'args': {'value': 'hello'},
          },
        },
      ]);

      final Object? text = resolver.rootNode.peek()!.props.peek()['text'];
      expect((text! as ResolvedBinding<Object?>).value, 'Hello');
    });
  });
}

/// A function that ignores its arguments and returns [result].
class _ConstantFunction extends FunctionImplementation {
  final Object? result;

  _ConstantFunction(String name, this.result)
      : super(name: name, argumentSchema: Schema.object());

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      result;
}
