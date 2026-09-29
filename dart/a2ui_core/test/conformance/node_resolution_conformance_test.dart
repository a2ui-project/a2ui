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
import 'package:yaml/yaml.dart';

import 'conformance_harness.dart';

typedef _Node = ComponentNode<ComponentApi>;
typedef _Json = Map<String, Object?>;

void main() {
  final List<_Json> cases = loadConformanceSuite('core/node_resolution.yaml');
  group('conformance core/node_resolution.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      test(testCase['name']! as String, () async {
        final fixture = normalizeYaml(
          loadYaml(
            File(
              resolveConformancePath(testCase['fixture']! as String),
            ).readAsStringSync(),
          ),
        )! as _Json;
        final runner = _Runner(fixture);
        addTearDown(runner.close);
        runner.check(testCase['expect']! as _Json, {}, 'initial');
        final steps = testCase['steps']! as List<Object?>;
        for (var i = 0; i < steps.length; i++) {
          final step = steps[i]! as _Json;
          final Map<String, _Node> before = runner.nodes();
          final bindings = Map<ResolvedBinding<Object?>, Object?>.identity();
          for (final _Node node in before.values) {
            _collectBindings(node.props.peek(), bindings);
          }
          runner.beginStep(before);
          await runner.apply(step, before);
          runner.check(
            step['expect']! as _Json,
            before,
            'step $i (${step['op']})',
          );
          for (final MapEntry<ResolvedBinding<Object?>, Object?> entry
              in bindings.entries) {
            expect(
              entry.key.value,
              entry.value,
              reason: 'step $i: old binding snapshot',
            );
          }
        }
      });
    }
  });
}

Object? _copy(Object? value) => jsonDecode(jsonEncode(value));

void _collectBindings(
  Object? value,
  Map<ResolvedBinding<Object?>, Object?> result,
) {
  if (value is ResolvedBinding<Object?>) {
    result[value] = _copy(value.value);
  } else if (value is Map) {
    for (final Object? child in value.values) {
      _collectBindings(child, result);
    }
  } else if (value is List) {
    for (final Object? child in value) {
      _collectBindings(child, result);
    }
  }
}

Object? _normalize(Object? value, String path) {
  if (value is _Node) return {'node': path};
  if (value is ResolvedBinding<Object?>) {
    return {
      'value': _copy(value.value),
      'writable': value is WritableBinding<Object?>,
    };
  }
  if (value is Function) return {'action': true};
  if (value is Map) {
    return {
      for (final MapEntry<String, Object?> entry
          in value.cast<String, Object?>().entries)
        entry.key: _normalize(entry.value, '$path/${entry.key}'),
    };
  }
  if (value is List) {
    return [
      for (var i = 0; i < value.length; i++) _normalize(value[i], '$path/$i'),
    ];
  }
  return value;
}

class _RecordingFunction extends FunctionImplementation {
  final List<_Json> calls;

  _RecordingFunction(FunctionApi api, this.calls)
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
    calls.add({'name': name, 'args': _copy(args)});
    return null;
  }
}

class _Runner {
  late final SurfaceModel<ComponentApi> surface;
  late final NodeResolver<ComponentApi> resolver;
  final List<_Json> events = [];
  final List<_Json> functions = [];
  final Map<_Node, int> emissions = Map.identity();
  final List<_Node> destroyedNodes = [];
  final Map<String, int> destroyed = {};
  final Map<_Node, Object?> lastEmission = Map.identity();
  final Map<_Node, String> watched = Map.identity();
  final List<void Function()> subscriptions = [];

  _Runner(_Json fixture) {
    final SchemaCatalog parsed = Catalog.fromJson(
      jsonDecode(
        File(
          resolveConformancePath(fixture['catalog']! as String),
        ).readAsStringSync(),
      ) as _Json,
    );
    final catalog = Catalog<ComponentApi, FunctionImplementation>(
      id: parsed.id,
      components: parsed.components.values.toList(),
      functions: [
        for (final FunctionApi api in parsed.functions.values)
          _RecordingFunction(api, functions),
      ],
    );
    surface = SurfaceModel('s', catalog: catalog);
    surface.dataModel.set('/', _copy(fixture['data']));
    updateComponents(fixture['components']! as List<Object?>);
    surface.onAction.addListener((event) {
      events.add({
        'name': event.name,
        'source_component_id': event.sourceComponentId,
        'context': _copy(event.context),
      });
    });
    resolver = NodeResolver(surface);
  }

  Map<String, _Node> nodes() {
    final result = <String, _Node>{};
    final seen = Set<_Node>.identity();
    void visit(Object? value, String path, Set<String> siblingIds) {
      if (value is _Node) {
        expect(
          seen.add(value),
          isTrue,
          reason: '$path must be an independent instance',
        );
        expect(
          siblingIds.add(value.instanceId),
          isTrue,
          reason: '$path needs a distinct sibling instanceId',
        );
        expect(value.disposed, isFalse, reason: '$path is mounted');
        result[path] = value;
        visit(value.props.peek(), path, <String>{});
      } else if (value is Map) {
        for (final MapEntry<String, Object?> entry
            in value.cast<String, Object?>().entries) {
          visit(entry.value, '$path/${entry.key}', siblingIds);
        }
      } else if (value is List) {
        for (var i = 0; i < value.length; i++) {
          visit(value[i], '$path/$i', siblingIds);
        }
      }
    }

    visit(resolver.rootNode.peek(), 'root', <String>{});
    return result;
  }

  void beginStep(Map<String, _Node> before) {
    for (final MapEntry<String, _Node> entry in before.entries) {
      final _Node node = entry.value;
      final bool alreadyWatched = watched.containsKey(node);
      watched[node] = entry.key;
      if (alreadyWatched) continue;
      var subscribing = true;
      subscriptions.add(
        node.props.subscribe((props) {
          if (subscribing) return;
          final String path = watched[node]!;
          emissions.update(node, (count) => count + 1, ifAbsent: () => 1);
          lastEmission[node] = _normalize(props, path);
        }),
      );
      subscribing = false;
      node.onDestroyed.addListener((_) {
        final String path = watched[node]!;
        destroyed.update(path, (count) => count + 1, ifAbsent: () => 1);
        destroyedNodes.add(node);
      });
    }
    emissions.clear();
    destroyedNodes.clear();
    destroyed.clear();
    lastEmission.clear();
    events.clear();
    functions.clear();
  }

  void updateComponents(List<Object?> components) {
    for (final value in components) {
      final component = value! as _Json;
      final id = component['id']! as String;
      final type = component['component']! as String;
      final properties = Map<String, Object?>.from(component)
        ..remove('id')
        ..remove('component');
      final ComponentModel? existing = surface.componentsModel.get(id);
      if (existing == null) {
        surface.componentsModel.addComponent(
          ComponentModel(id, type, properties),
        );
      } else {
        expect(
          existing.type,
          type,
          reason: 'update_components preserves component type',
        );
        existing.properties = properties;
      }
    }
  }

  Future<void> apply(_Json step, Map<String, _Node> before) async {
    switch (step['op']) {
      case 'set_data':
        surface.dataModel.set(step['path']! as String, _copy(step['value']));
      case 'update_components':
        updateComponents(step['components']! as List<Object?>);
      case 'remove_component':
        surface.componentsModel.removeComponent(
          step['component_id']! as String,
        );
      case 'write':
        final Object? binding =
            before[step['node']]!.props.peek()[step['property']];
        expect(binding, isA<WritableBinding<Object?>>());
        (binding! as WritableBinding<Object?>).set(_copy(step['value']));
      case 'invoke':
        final Object? action =
            before[step['node']]!.props.peek()[step['property']];
        expect(action, isA<Future<void> Function()>());
        await (action! as Future<void> Function())();
      case 'dispose':
        resolver.dispose();
      default:
        fail('Unknown resolve_nodes operation: ${step['op']}');
    }
  }

  void check(_Json expected, Map<String, _Node> before, String reason) {
    final Map<String, _Node> current = nodes();
    final assertions = expected['nodes']! as _Json;
    expect(
      current.keys,
      unorderedEquals(assertions.keys),
      reason: '$reason: mounted paths',
    );
    for (final MapEntry<String, Object?> entry in assertions.entries) {
      final _Node node = current[entry.key]!;
      final actual = <String, Object?>{
        'component_id': node.componentId,
        'type': node.type,
        'state': node.state.jsonValue,
        'data_path': node.dataPath,
        'props': _normalize(node.props.peek(), entry.key),
      };
      for (final MapEntry<String, Object?> assertion
          in (entry.value! as _Json).entries) {
        if (assertion.key == 'props') {
          final props = actual['props']! as _Json;
          for (final MapEntry<String, Object?> prop
              in (assertion.value! as _Json).entries) {
            expect(
              props.containsKey(prop.key),
              isTrue,
              reason: '$reason: ${entry.key}.${prop.key} exists',
            );
            expect(
              props[prop.key],
              prop.value,
              reason: '$reason: ${entry.key}.${prop.key}',
            );
          }
        } else {
          expect(
            actual[assertion.key],
            assertion.value,
            reason: '$reason: ${entry.key}.${assertion.key}',
          );
        }
      }
    }
    // Creation and retirement scheduling is not part of the props contract.
    final retainedEmissions = <String, int>{};
    for (final MapEntry<_Node, int> entry in emissions.entries) {
      final String path = watched[entry.key]!;
      if (identical(current[path], entry.key)) {
        retainedEmissions[path] = entry.value;
      }
    }
    for (final _Node node in destroyedNodes) {
      expect(
        node.disposed,
        isTrue,
        reason: '$reason: destroyed node is disposed',
      );
    }
    expect(
      retainedEmissions,
      expected['emissions'] ?? {},
      reason: '$reason: emissions',
    );
    expect(
      destroyed,
      expected['destroyed'] ?? {},
      reason: '$reason: destroyed',
    );
    expect(events, expected['events'] ?? [], reason: '$reason: events');
    expect(
      functions,
      expected['functions'] ?? [],
      reason: '$reason: functions',
    );
    for (final MapEntry<_Node, Object?> entry in lastEmission.entries) {
      if (current.values.any((node) => identical(node, entry.key))) {
        expect(
          entry.value,
          _normalize(entry.key.props.peek(), watched[entry.key]!),
          reason: '$reason: complete emitted snapshot',
        );
      }
    }
    for (final field in ['same_nodes', 'replaced_nodes']) {
      for (final Object? path in (expected[field] as List<Object?>?) ?? []) {
        expect(
          before.containsKey(path) && current.containsKey(path),
          isTrue,
          reason: '$reason: $field $path exists before and after',
        );
        expect(
          identical(before[path], current[path]),
          field == 'same_nodes',
          reason: '$reason: $field $path',
        );
      }
    }
    for (final MapEntry<String, Object?> entry
        in ((expected['data'] as _Json?) ?? {}).entries) {
      expect(
        surface.dataModel.get(entry.key),
        entry.value,
        reason: '$reason: data ${entry.key}',
      );
    }
  }

  void close() {
    for (final void Function() unsubscribe in subscriptions) {
      unsubscribe();
    }
    resolver.dispose();
    surface.dispose();
  }
}
