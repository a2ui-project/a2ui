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
        components: parsed.components.values.toList(),
        functions: [openUrl],
      );
      processor = MessageProcessor<ComponentApi>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
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
      components: parsed.components.values.toList(),
    );
    final surface = SurfaceModel<ComponentApi>('s', catalog: catalog);
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
}
