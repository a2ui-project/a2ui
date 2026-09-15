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

/// Node-layer conformance cases adapted from web_core's
/// `node-resolver.test.ts`, plus Dart-specific regression coverage.
///
/// The conformance fixtures write directly to `componentsModel`. A separate
/// processor integration group characterizes message-time validation and
/// the placeholder states still reachable through `MessageProcessor`.
library;

import 'dart:async';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:logging/logging.dart';
import 'package:test/test.dart';

class _TestComponentApi extends ComponentApi {
  _TestComponentApi(String name, Schema schema)
    : super(name: name, schema: schema);
}

class _ShoutFunction extends FunctionImplementation {
  _ShoutFunction()
    : super(
        name: 'shout',
        returnType: A2uiReturnType.string,
        argumentSchema: Schema.object(
          properties: {'value': Schema.string()},
          required: ['value'],
        ),
      );

  @override
  Object? execute(
    Map<String, Object?> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    return args['value'].toString().toUpperCase();
  }
}

class _PingFunction extends FunctionImplementation {
  int invocationCount = 0;

  _PingFunction()
    : super(
        name: 'ping',
        returnType: A2uiReturnType.string,
        argumentSchema: Schema.object(properties: {}),
      );

  @override
  Object? execute(
    Map<String, Object?> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    invocationCount++;
    return 'pong';
  }
}

class _Opaque {
  final int marker;
  _Opaque(this.marker);
}

Catalog<ComponentApi, FunctionImplementation> makeCatalog() {
  return Catalog<ComponentApi, FunctionImplementation>(
    id: 'node-test-catalog',
    components: [
      _TestComponentApi(
        'Text',
        Schema.object(properties: {'text': CommonSchemas.dynamicString}),
      ),
      _TestComponentApi(
        'Button',
        Schema.object(
          properties: {
            'label': CommonSchemas.dynamicString,
            'action': CommonSchemas.action,
          },
        ),
      ),
      _TestComponentApi(
        'Card',
        Schema.object(properties: {'child': CommonSchemas.componentId}),
      ),
      _TestComponentApi(
        'Column',
        Schema.object(properties: {'children': CommonSchemas.childList}),
      ),
      _TestComponentApi(
        'Tabs',
        Schema.object(
          properties: {
            'items': Schema.list(
              items: Schema.object(
                properties: {
                  'title': Schema.string(),
                  'child': CommonSchemas.componentId,
                },
              ),
            ),
          },
        ),
      ),
    ],
    functions: [_ShoutFunction()],
  );
}

typedef TestSetup = ({
  Catalog<ComponentApi, FunctionImplementation> catalog,
  SurfaceModel<ComponentApi> surface,
  NodeResolver<ComponentApi> resolver,
});

TestSetup setup() {
  final Catalog<ComponentApi, FunctionImplementation> catalog = makeCatalog();
  final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
  final resolver = NodeResolver<ComponentApi>(surface);
  return (catalog: catalog, surface: surface, resolver: resolver);
}

TestSetup setupPair() {
  final catalog = Catalog<ComponentApi, FunctionImplementation>(
    id: 'pair-catalog',
    components: [
      ComponentApi(
        name: 'Pair',
        schema: Schema.object(
          properties: {
            'a': CommonSchemas.dynamicString,
            'b': CommonSchemas.dynamicString,
          },
        ),
      ),
    ],
    functions: [],
  );
  final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
  final resolver = NodeResolver<ComponentApi>(surface);
  addTearDown(() {
    resolver.dispose();
    surface.dispose();
  });
  add(surface, 'root', 'Pair', {'a': 'old', 'b': 'old'});
  return (catalog: catalog, surface: surface, resolver: resolver);
}

void add(
  SurfaceModel<ComponentApi> surface,
  String id,
  String type,
  Map<String, Object?> properties,
) {
  surface.componentsModel.addComponent(ComponentModel(id, type, properties));
}

NodeProps props(ComponentNode node) => node.props.peek();

/// Unwraps the [ResolvedBinding] snapshot for a dynamic property.
Object? bound(ComponentNode node, String key) =>
    (props(node)[key] as ResolvedBinding<Object?>?)?.value;

ComponentNode child(ComponentNode node, String key, [int? index]) {
  final Object? value = index == null
      ? props(node)[key]
      : (props(node)[key] as List)[index];
  expect(
    value,
    isA<ComponentNode>(),
    reason: 'expected $key[${index ?? ''}] to be a ComponentNode',
  );
  return value as ComponentNode;
}

/// Counts emissions of a signal, excluding the subscription-time run.
class EmissionCounter {
  int _count = -1;
  late final void Function() dispose;

  EmissionCounter(ReadonlySignal<Object?> signal) {
    dispose = effect(() {
      signal.value;
      _count++;
    });
  }

  int get count => _count;
}

Future<void> flush() => Future<void>.delayed(Duration.zero);

typedef ProcessorSetup = ({
  MessageProcessor<ComponentApi> processor,
  SurfaceModel<ComponentApi> surface,
  NodeResolver<ComponentApi> resolver,
});

ProcessorSetup setupProcessor([
  Catalog<ComponentApi, FunctionImplementation>? catalog,
]) {
  final Catalog<ComponentApi, FunctionImplementation> effectiveCatalog =
      catalog ?? makeCatalog();
  final processor = MessageProcessor<ComponentApi>(
    catalogs: [effectiveCatalog],
  );
  processor.processMessages([
    CreateSurfaceMessage(surfaceId: 'surf-1', catalogId: effectiveCatalog.id),
  ]);
  final SurfaceModel<ComponentApi> surface = processor.groupModel.getSurface(
    'surf-1',
  )!;
  final resolver = NodeResolver<ComponentApi>(surface);
  addTearDown(() {
    resolver.dispose();
    processor.groupModel.dispose();
  });
  return (processor: processor, surface: surface, resolver: resolver);
}

void processComponents(
  ProcessorSetup fixture,
  List<Map<String, Object?>> components,
) {
  fixture.processor.processPayload([
    {
      'version': 'v0.9',
      'updateComponents': {'surfaceId': 'surf-1', 'components': components},
    },
  ]);
}

void processorContractTests() {
  group('NodeResolver processor integration', () {
    test('an empty processed surface has no pending root', () {
      final ProcessorSetup fixture = setupProcessor();
      expect(fixture.resolver.rootNode.value, isNull);
      expect(fixture.resolver.activeNodeCount, 0);
    });

    for (final (label, component, error) in [
      (
        'missing marked reference',
        {'id': 'root', 'component': 'Card', 'child': 'missing'},
        isA<A2uiIntegrityError>(),
      ),
      (
        'marked cycle',
        {'id': 'root', 'component': 'Card', 'child': 'root'},
        isA<A2uiRecursionError>(),
      ),
      (
        'unknown component type',
        {'id': 'root', 'component': 'Bogus'},
        isA<A2uiValidationError>(),
      ),
    ]) {
      test('rejects a typed $label before creating nodes', () {
        final ProcessorSetup fixture = setupProcessor();
        expect(() => processComponents(fixture, [component]), throwsA(error));
        expect(fixture.surface.componentsModel.all, isEmpty);
        expect(fixture.resolver.rootNode.value, isNull);
      });
    }

    test('a validated wire reference mounts its child without a marker', () {
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'wire-ref-test',
        components: [
          ...makeCatalog().components.values.where((api) => api.name != 'Card'),
          ComponentApi(
            name: 'Card',
            schema: Schema.object(
              properties: {
                'child': Schema.fromMap({
                  r'$ref': r'common_types.json#/$defs/ComponentId',
                }),
              },
            ),
          ),
        ],
      );
      final ProcessorSetup fixture = setupProcessor(catalog);
      processComponents(fixture, [
        {'id': 'root', 'component': 'Card', 'child': 'leaf'},
        {'id': 'leaf', 'component': 'Text', 'text': 'ready'},
      ]);
      expect(
        child(fixture.resolver.rootNode.value!, 'child').componentId,
        'leaf',
      );
      expect(fixture.surface.componentsModel.get('leaf'), isNotNull);
      expect(fixture.resolver.activeNodeCount, 2);
    });

    test('a valid parent-first batch temporarily exposes a pending child', () {
      final ProcessorSetup fixture = setupProcessor();
      final states = <NodeState>[];
      final subscriptions = <void Function()>[];
      subscriptions.add(
        fixture.resolver.rootNode.subscribe((root) {
          if (root != null) {
            subscriptions.add(
              root.props.subscribe((_) {
                states.add(child(root, 'child').state);
              }),
            );
          }
        }),
      );
      addTearDown(() {
        for (final unsubscribe in subscriptions) {
          unsubscribe();
        }
      });
      processComponents(fixture, [
        {'id': 'root', 'component': 'Card', 'child': 'leaf'},
        {'id': 'leaf', 'component': 'Text', 'text': 'ready'},
      ]);
      expect(states, [NodeState.pending, NodeState.resolved]);
      expect(
        child(fixture.resolver.rootNode.value!, 'child').state,
        NodeState.resolved,
      );
    });

    for (final (reference, state) in [
      ('missing', NodeState.pending),
      ('root', NodeState.cyclic),
    ]) {
      test(
        'a type-omitting processed update can produce ${state.jsonValue}',
        () {
          final ProcessorSetup fixture = setupProcessor();
          processComponents(fixture, [
            {'id': 'root', 'component': 'Card', 'child': 'leaf'},
            {'id': 'leaf', 'component': 'Text', 'text': 'ready'},
          ]);
          final errors = <String>[];
          fixture.surface.onError.addListener(
            (error) => errors.add(error.code),
          );
          // This characterizes an existing processor validation gap, not a
          // requirement that invalid updates should remain accepted.
          processComponents(fixture, [
            {'id': 'root', 'child': reference},
          ]);
          expect(child(fixture.resolver.rootNode.value!, 'child').state, state);
          expect(
            errors,
            state == NodeState.cyclic ? ['CYCLIC_REFERENCE'] : <String>[],
          );
        },
      );

      test('rejects an unmarked structural ${state.jsonValue} reference '
          'before model mutation', () {
        final catalog = Catalog<ComponentApi, FunctionImplementation>(
          id: 'structural-test',
          components: [
            ComponentApi(
              name: 'Column',
              schema: Schema.object(
                properties: {
                  'children': Schema.combined(
                    anyOf: [
                      Schema.list(items: Schema.string()),
                      Schema.object(
                        properties: {
                          'componentId': Schema.string(),
                          'path': Schema.string(),
                        },
                        required: ['componentId', 'path'],
                      ),
                    ],
                  ),
                },
              ),
            ),
          ],
        );
        final ProcessorSetup fixture = setupProcessor(catalog);
        expect(
          () => processComponents(fixture, [
            {
              'id': 'root',
              'component': 'Column',
              'children': [reference],
            },
          ]),
          throwsA(
            state == NodeState.pending
                ? isA<A2uiIntegrityError>()
                : isA<A2uiRecursionError>(),
          ),
        );
        expect(fixture.surface.componentsModel.all, isEmpty);
        expect(fixture.resolver.rootNode.value, isNull);
      });
    }
  });
}

void unresolvedReferenceTests() {
  group('NodeResolver unresolved scoped references', () {
    Catalog<ComponentApi, FunctionImplementation> nestedCatalog() {
      final groups = Schema.list(
        items: Schema.object(properties: {'children': CommonSchemas.childList}),
      );
      return Catalog(
        id: 'nested-reference-test',
        components: [
          ...makeCatalog().components.values,
          ComponentApi(
            name: 'Nested',
            schema: Schema.object(
              properties: {
                'nested': Schema.object(
                  properties: {'child': CommonSchemas.componentId},
                ),
                'groups': groups,
                'otherGroups': groups,
              },
            ),
          ),
        ],
      );
    }

    TestSetup nestedSetup() {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          nestedCatalog();
      final surface = SurfaceModel<ComponentApi>('nested', catalog: catalog);
      final resolver = NodeResolver<ComponentApi>(surface);
      addTearDown(() {
        resolver.dispose();
        surface.dispose();
      });
      for (final id in ['a', 'b', 'x']) {
        add(surface, id, 'Text', {'text': id});
      }
      return (catalog: catalog, surface: surface, resolver: resolver);
    }

    List<LogRecord> collectWarnings() {
      final warnings = <LogRecord>[];
      final StreamSubscription<LogRecord> subscription =
          Logger('a2ui_core.resolution').onRecord.listen((record) {
            if (record.loggerName == 'a2ui_core.resolution' &&
                record.level == Level.WARNING) {
              warnings.add(record);
            }
          });
      addTearDown(subscription.cancel);
      return warnings;
    }

    List<ChildNode> descriptors(ComponentNode node) =>
        (((props(node)['groups'] as List).single as Map)['children'] as List)
            .cast<ChildNode>();

    test('ChildNode compares and hashes its id and data scope', () {
      final reference = ChildNode('x', '/items/0');
      final same = ChildNode('x', '/items/0');
      expect(reference, same);
      expect(reference.hashCode, same.hashCode);
      expect(reference, isNot(ChildNode('y', '/items/0')));
      expect(reference, isNot(ChildNode('x', '/items/1')));
      expect({reference, same}, hasLength(1));
    });

    test(
      'nested templates retain scoped descriptors without mounting nodes',
      () {
        final TestSetup fixture = nestedSetup();
        fixture.surface.dataModel.set('/items', [
          <String, Object?>{},
          <String, Object?>{},
        ]);
        final payload = <String, Object?>{
          'groups': [
            {
              'children': {'componentId': 'x', 'path': '/items'},
            },
          ],
        };
        add(fixture.surface, 'root', 'Nested', payload);
        final ComponentNode root = fixture.resolver.rootNode.value!;
        final List<ChildNode> references = descriptors(root);
        expect(references.map((reference) => reference.id), ['x', 'x']);
        expect(references.map((reference) => reference.basePath), [
          '/items/0',
          '/items/1',
        ]);
        expect(fixture.resolver.activeNodeCount, 1);
        final emissions = EmissionCounter(root.props);
        addTearDown(emissions.dispose);
        final Object? before = props(root)['groups'];
        fixture.surface.componentsModel.get('root')!.properties = payload;
        expect(emissions.count, 0);
        expect(identical(props(root)['groups'], before), isTrue);
        expect(root.toJson(), {
          'id': 'root',
          'type': 'Nested',
          'groups': [
            {
              'children': [
                {'id': 'x', 'basePath': '/items/0'},
                {'id': 'x', 'basePath': '/items/1'},
              ],
            },
          ],
        });
      },
    );

    test('nested static ChildLists retain the owning component data scope', () {
      final TestSetup fixture = nestedSetup();
      fixture.surface.dataModel.set('/rows', [<String, Object?>{}]);
      final payload = <String, Object?>{
        'groups': [
          {
            'children': ['a', 'b'],
          },
        ],
      };
      add(fixture.surface, 'host', 'Nested', payload);
      add(fixture.surface, 'root', 'Column', {
        'children': {'componentId': 'host', 'path': '/rows'},
      });
      final ComponentNode host = child(
        fixture.resolver.rootNode.value!,
        'children',
        0,
      );
      final List<ChildNode> references = descriptors(host);
      expect(references.map((reference) => reference.id), ['a', 'b']);
      expect(references.map((reference) => reference.basePath), [
        '/rows/0',
        '/rows/0',
      ]);
      expect(fixture.resolver.activeNodeCount, 2);
      final emissions = EmissionCounter(host.props);
      addTearDown(emissions.dispose);
      final Object? before = props(host)['groups'];
      fixture.surface.componentsModel.get('host')!.properties = payload;
      expect(emissions.count, 0);
      expect(identical(props(host)['groups'], before), isTrue);
      expect(host.toJson(), {
        'id': 'host',
        'type': 'Nested',
        'groups': [
          {
            'children': [
              {'id': 'a', 'basePath': '/rows/0'},
              {'id': 'b', 'basePath': '/rows/0'},
            ],
          },
        ],
      });
    });

    test('nested single references remain raw ids without mounting nodes', () {
      final TestSetup fixture = nestedSetup();
      final payload = <String, Object?>{
        'nested': {'child': 'a'},
      };
      add(fixture.surface, 'root', 'Nested', payload);
      final ComponentNode root = fixture.resolver.rootNode.value!;
      expect((props(root)['nested'] as Map)['child'], 'a');
      expect(fixture.resolver.activeNodeCount, 1);
      final emissions = EmissionCounter(root.props);
      addTearDown(emissions.dispose);
      fixture.surface.componentsModel.get('root')!.properties = payload;
      expect(emissions.count, 0);
      expect(root.toJson(), {
        'id': 'root',
        'type': 'Nested',
        'nested': {'child': 'a'},
      });
    });

    test('warns once per resolver and property path, not per array index', () {
      final List<LogRecord> warnings = collectWarnings();
      final TestSetup first = nestedSetup();
      final group = <String, Object?>{
        'children': ['a', 'b'],
      };
      final payload = <String, Object?>{
        'groups': [group, group],
      };
      add(first.surface, 'root', 'Nested', payload);
      expect(warnings, hasLength(1));
      expect(warnings.single.message, contains('groups[].children'));
      first.surface.componentsModel.get('root')!.properties = payload;
      first.surface.componentsModel.get('root')!.properties = {
        'groups': [group, group, group],
      };
      expect(warnings, hasLength(1));
      first.surface.componentsModel.get('root')!.properties = {
        ...payload,
        'otherGroups': [group],
      };
      expect(warnings, hasLength(2));
      expect(warnings.last.message, contains('otherGroups[].children'));

      final TestSetup second = nestedSetup();
      add(second.surface, 'root', 'Nested', payload);
      expect(warnings, hasLength(3));
    });

    test('does not warn for child references materialized as nodes', () {
      final List<LogRecord> warnings = collectWarnings();
      final TestSetup fixture = nestedSetup();
      add(fixture.surface, 'root', 'Column', {
        'children': ['a', 'b'],
      });
      expect(fixture.resolver.activeNodeCount, 3);
      expect(warnings, isEmpty);
    });

    test('warning listeners see the published root and may dispose it', () {
      final TestSetup fixture = nestedSetup();
      var warnings = 0;
      final StreamSubscription<LogRecord> subscription =
          Logger('a2ui_core.resolution').onRecord.listen((record) {
            if (record.loggerName != 'a2ui_core.resolution' ||
                record.level != Level.WARNING) {
              return;
            }
            warnings++;
            expect(fixture.resolver.rootNode.value, isNotNull);
            expect(fixture.resolver.activeNodeCount, 1);
            fixture.resolver.dispose();
          });
      addTearDown(subscription.cancel);
      add(fixture.surface, 'root', 'Nested', {
        'groups': [
          {
            'children': ['a'],
          },
        ],
      });
      expect(warnings, 1);
      expect(fixture.resolver.disposed, isTrue);
      expect(fixture.resolver.activeNodeCount, 0);
      expect(fixture.resolver.rootNode.value, isNull);
    });
  });
}

void snapshotOwnershipTests() {
  group('NodeResolver immutable snapshots', () {
    test('child lists and outer props stay unmodifiable after updates', () {
      final TestSetup fixture = setup();
      addTearDown(() {
        fixture.resolver.dispose();
        fixture.surface.dispose();
      });
      add(fixture.surface, 'a', 'Text', {'text': 'a'});
      add(fixture.surface, 'b', 'Text', {'text': 'b'});
      add(fixture.surface, 'root', 'Column', {
        'children': ['a'],
      });
      final ComponentNode root = fixture.resolver.rootNode.value!;
      final before = props(root)['children'] as List;
      final first = before.single as ComponentNode;
      final emissions = EmissionCounter(root.props);
      addTearDown(emissions.dispose);

      expect(before.clear, throwsUnsupportedError);
      expect(() => props(root).clear(), throwsUnsupportedError);
      expect(first.disposed, isFalse);
      expect(fixture.resolver.activeNodeCount, 2);
      expect(emissions.count, 0);

      fixture.surface.componentsModel.get('root')!.properties = {
        'children': ['a', 'b'],
      };
      final grown = props(root)['children'] as List;
      expect(grown.removeLast, throwsUnsupportedError);
      expect(() => props(root)['children'] = [], throwsUnsupportedError);
      expect(before, [same(first)]);
      expect(fixture.resolver.activeNodeCount, 3);
      expect(emissions.count, 1);

      fixture.surface.componentsModel.get('root')!.properties = {
        'children': ['a'],
      };
      expect((props(root)['children'] as List).clear, throwsUnsupportedError);
      expect(fixture.resolver.activeNodeCount, 2);
      expect(emissions.count, 2);
    });

    test(
      'detaches static input and freezes changed and new container shapes',
      () {
        final catalog = Catalog<ComponentApi, FunctionImplementation>(
          id: 'snapshot-test',
          components: [
            ComponentApi(
              name: 'Literal',
              schema: Schema.object(properties: {'value': Schema.fromMap({})}),
            ),
          ],
        );
        final surface = SurfaceModel<ComponentApi>(
          'snapshot',
          catalog: catalog,
        );
        final resolver = NodeResolver<ComponentApi>(surface);
        addTearDown(() {
          resolver.dispose();
          surface.dispose();
        });
        final opaque = _Opaque(1);
        final input = <String, Object?>{
          'items': [
            <String, Object?>{'value': 'before'},
          ],
          'opaque': opaque,
        };
        final model = ComponentModel('root', 'Literal', {'value': input});
        surface.componentsModel.addComponent(model);
        final ComponentNode root = resolver.rootNode.value!;
        final before = props(root)['value'] as Map;
        final beforeItems = before['items'] as List;
        final beforeItem = beforeItems.single as Map;
        final emissions = EmissionCounter(root.props);
        addTearDown(emissions.dispose);
        expect(before.clear, throwsUnsupportedError);
        expect(beforeItems.clear, throwsUnsupportedError);
        expect(beforeItem.clear, throwsUnsupportedError);

        ((input['items'] as List).single as Map)['value'] = 'after';
        expect(beforeItem['value'], 'before');
        expect(emissions.count, 0);
        model.properties = {'value': input};
        final after = props(root)['value'] as Map;
        expect(((after['items'] as List).single as Map)['value'], 'after');
        expect(after['opaque'], same(opaque));
        expect(after.clear, throwsUnsupportedError);
        expect((after['items'] as List).clear, throwsUnsupportedError);
        expect(
          ((after['items'] as List).single as Map).clear,
          throwsUnsupportedError,
        );
        expect(() => props(root).clear(), throwsUnsupportedError);
        expect(emissions.count, 1);
        model.properties = {'value': input};
        expect(props(root)['value'], same(after));
        expect(emissions.count, 1);

        input['added'] = [
          <String, Object?>{'fresh': <Object?>[]},
        ];
        input['items'] = [
          0,
          <String, Object?>{
            'replacement': [1],
          },
        ];
        model.properties = {'value': input};
        final reshaped = props(root)['value'] as Map;
        final added = reshaped['added'] as List;
        final addedItem = added.single as Map;
        final replacedItems = reshaped['items'] as List;
        expect(reshaped.clear, throwsUnsupportedError);
        expect(added.clear, throwsUnsupportedError);
        expect(addedItem.clear, throwsUnsupportedError);
        expect((addedItem['fresh'] as List).clear, throwsUnsupportedError);
        expect(replacedItems.clear, throwsUnsupportedError);
        expect((replacedItems.last as Map).clear, throwsUnsupportedError);
        expect(
          ((replacedItems.last as Map)['replacement'] as List).clear,
          throwsUnsupportedError,
        );
        expect(emissions.count, 2);
        expect(beforeItem['value'], 'before');
        expect(((after['items'] as List).single as Map)['value'], 'after');
      },
    );

    test('freezes a literal container replacing a mounted child', () {
      final TestSetup fixture = setup();
      addTearDown(() {
        fixture.resolver.dispose();
        fixture.surface.dispose();
      });
      add(fixture.surface, 'leaf', 'Text', {'text': 'leaf'});
      add(fixture.surface, 'root', 'Card', {'child': 'leaf'});
      final ComponentNode root = fixture.resolver.rootNode.value!;
      final ComponentNode previous = child(root, 'child');
      // Direct-model values that are not resolvable references stay literal.
      fixture.surface.componentsModel.get('root')!.properties = {
        'child': {
          'items': [1],
        },
      };
      final literal = props(root)['child'] as Map;
      expect(literal.clear, throwsUnsupportedError);
      expect((literal['items'] as List).clear, throwsUnsupportedError);
      expect(previous.disposed, isTrue);
      expect(fixture.resolver.activeNodeCount, 1);
    });
  });
}

void main() {
  processorContractTests();
  unresolvedReferenceTests();
  snapshotOwnershipTests();
  group('NodeResolver conformance (port of node-resolver.test.ts)', () {
    test(
      'keeps child edges distinct when ids and properties share delimiters',
      () {
        final catalog = Catalog<ComponentApi, FunctionImplementation>(
          id: 'edge-test',
          components: [
            ...makeCatalog().components.values,
            ComponentApi(
              name: 'Tricky',
              schema: Schema.object(
                properties: {
                  'a': CommonSchemas.componentId,
                  'a>b': CommonSchemas.componentId,
                },
              ),
            ),
          ],
        );
        final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
        final NodeResolver<ComponentApi> resolver = NodeResolver(surface);
        addTearDown(() {
          resolver.dispose();
          surface.dispose();
        });
        add(surface, 'b>c', 'Text', {'text': 'first'});
        add(surface, 'c', 'Text', {'text': 'second'});
        add(surface, 'root', 'Tricky', {'a': 'b>c', 'a>b': 'c'});
        final ComponentNode<ComponentApi> root = resolver.rootNode.value!;
        final ComponentNode first = child(root, 'a');
        final ComponentNode second = child(root, 'a>b');
        expect(first.disposed, isFalse);
        expect(second.disposed, isFalse);
        expect(identical(first, second), isFalse);
        expect(resolver.activeNodeCount, 3);

        surface.componentsModel.get('b>c')!.properties = {'text': 'updated'};
        expect(bound(first, 'text'), 'updated');
        expect(bound(second, 'text'), 'second');
      },
    );

    test('resolves plain arrays of marked component ids', () {
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'plain-list-test',
        components: [
          ...makeCatalog().components.values,
          ComponentApi(
            name: 'PlainList',
            schema: Schema.object(
              properties: {
                'children': Schema.list(items: CommonSchemas.componentId),
              },
            ),
          ),
        ],
      );
      final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
      final NodeResolver<ComponentApi> resolver = NodeResolver(surface);
      addTearDown(() {
        resolver.dispose();
        surface.dispose();
      });
      add(surface, 'root', 'PlainList', {
        'children': ['first', 'second'],
      });
      final ComponentNode<ComponentApi> root = resolver.rootNode.value!;
      expect(child(root, 'children', 0).state, NodeState.pending);
      add(surface, 'first', 'Text', {'text': 'one'});
      add(surface, 'second', 'Text', {'text': 'two'});
      expect(bound(child(root, 'children', 0), 'text'), 'one');
      expect(bound(child(root, 'children', 1), 'text'), 'two');
      expect(resolver.activeNodeCount, 3);
    });

    test('ignores a root removed before its creation event is handled', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          makeCatalog();
      final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
      var removedOnce = false;
      surface.componentsModel.onCreated.addListener((component) {
        if (component.id == 'root' && !removedOnce) {
          removedOnce = true;
          surface.componentsModel.removeComponent(component.id);
        }
      });
      final NodeResolver<ComponentApi> resolver = NodeResolver(surface);
      addTearDown(() {
        resolver.dispose();
        surface.dispose();
      });
      add(surface, 'root', 'Text', {'text': 'removed'});
      expect(resolver.rootNode.value, isNull);
      expect(resolver.activeNodeCount, 0);

      add(surface, 'root', 'Text', {'text': 'returned'});
      expect(resolver.rootNode.value!.state, NodeState.resolved);
      expect(bound(resolver.rootNode.value!, 'text'), 'returned');
      expect(resolver.activeNodeCount, 1);
    });

    test('re-arms a pending child removed during its creation event', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          makeCatalog();
      final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
      var removedOnce = false;
      surface.componentsModel.onCreated.addListener((component) {
        if (component.id == 'child' && !removedOnce) {
          removedOnce = true;
          surface.componentsModel.removeComponent(component.id);
        }
      });
      final NodeResolver<ComponentApi> resolver = NodeResolver(surface);
      addTearDown(() {
        resolver.dispose();
        surface.dispose();
      });
      add(surface, 'root', 'Column', {
        'children': ['child'],
      });
      add(surface, 'child', 'Text', {'text': 'removed'});
      final ComponentNode<ComponentApi> root = resolver.rootNode.value!;
      expect(child(root, 'children', 0).state, NodeState.pending);

      add(surface, 'child', 'Text', {'text': 'returned'});
      expect(child(root, 'children', 0).state, NodeState.resolved);
      expect(bound(child(root, 'children', 0), 'text'), 'returned');
      expect(resolver.activeNodeCount, 2);
    });

    test('emits once when a component update changes multiple dynamic '
        'properties', () {
      final TestSetup fixture = setupPair();
      final ComponentNode<ComponentApi> root = fixture.resolver.rootNode.value!;
      final emissions = EmissionCounter(root.props);
      addTearDown(emissions.dispose);

      fixture.surface.componentsModel.get('root')!.properties = {
        'a': 'new',
        'b': 'new',
      };

      expect(emissions.count, 1);
      expect(bound(root, 'a'), 'new');
      expect(bound(root, 'b'), 'new');
    });

    test('never emits mixed old and new dynamic properties during a '
        'component update', () {
      final TestSetup fixture = setupPair();
      final ComponentNode<ComponentApi> root = fixture.resolver.rootNode.value!;
      final snapshots = <Map<String, Object?>>[];
      final void Function() unsubscribe = root.props.subscribe((properties) {
        snapshots.add({
          'a': (properties['a'] as ResolvedBinding<Object?>).value,
          'b': (properties['b'] as ResolvedBinding<Object?>).value,
        });
      });
      addTearDown(unsubscribe);
      snapshots.clear();

      for (final value in ['first', 'second']) {
        fixture.surface.componentsModel.get('root')!.properties = {
          'a': value,
          'b': value,
        };
      }

      expect(snapshots, [
        {'a': 'first', 'b': 'first'},
        {'a': 'second', 'b': 'second'},
      ]);
    });

    test('does not emit when an action-bearing component is resent '
        'unchanged', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> _,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Column', {
        'children': ['b1'],
      });
      add(surface, 'b1', 'Button', {
        'label': 'Go',
        'action': {
          'event': {'name': 'tap'},
        },
      });
      final ComponentNode root = resolver.rootNode.value!;
      final ComponentNode button = child(root, 'children', 0);
      expect(props(button)['action'], isA<Function>());

      final emissions = EmissionCounter(button.props);
      surface.componentsModel.get('b1')!.properties = {
        'label': 'Go',
        'action': {
          'event': {'name': 'tap'},
        },
      };
      expect(
        emissions.count,
        0,
        reason:
            'an unchanged resend must not emit for action-bearing components',
      );

      final Object? closureBefore = props(button)['action'];
      surface.componentsModel.get('b1')!.properties = {
        'label': 'Go',
        'action': {
          'event': {'name': 'other'},
        },
      };
      expect(emissions.count, 1);
      expect(identical(props(button)['action'], closureBefore), isFalse);

      emissions.dispose();
      resolver.dispose();
    });

    test('resolves the root and upgrades and downgrades referenced children '
        '(lifecycle)', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Column', {
        'children': ['child_1'],
      });
      final ComponentNode? root = resolver.rootNode.value;
      expect(root, isNotNull);
      expect(root!.type, 'Column');
      expect(child(root, 'children', 0).type, placeholderType);

      add(surface, 'child_1', 'Text', {'text': 'Hello Node'});
      final ComponentNode upgraded = child(root, 'children', 0);
      expect(upgraded.type, 'Text');
      expect(bound(upgraded, 'text'), 'Hello Node');

      surface.componentsModel.removeComponent('child_1');
      expect(child(root, 'children', 0).type, placeholderType);
      expect(upgraded.disposed, isTrue);
      resolver.dispose();
      surface.dispose();
    });

    test('tracks root creation and removal on rootNode', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      expect(resolver.rootNode.value, isNull);

      add(surface, 'root', 'Column', {'children': <Object?>[]});
      final ComponentNode? root = resolver.rootNode.value;
      expect(root, isA<ComponentNode>());
      expect(root!.componentId, 'root');
      expect(root.type, 'Column');

      surface.componentsModel.removeComponent('root');
      expect(resolver.rootNode.value, isNull);
      expect(root.disposed, isTrue);
      resolver.dispose();
    });

    test('resolves a root that existed before the resolver was constructed, '
        'and rebuilds it after deletion and re-send', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          makeCatalog();
      final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
      add(surface, 'root', 'Text', {'text': 'early'});
      final resolver = NodeResolver<ComponentApi>(surface);
      final ComponentNode? initial = resolver.rootNode.value;
      expect(initial, isNotNull);
      expect(bound(initial!, 'text'), 'early');

      surface.componentsModel.removeComponent('root');
      expect(resolver.rootNode.value, isNull);

      add(surface, 'root', 'Text', {'text': 'again'});
      final ComponentNode? rebuilt = resolver.rootNode.value;
      expect(rebuilt, isNotNull);
      expect(bound(rebuilt!, 'text'), 'again');
      expect(identical(rebuilt, initial), isFalse);
      resolver.dispose();
    });

    test('exposes core node properties', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Card', {'child': 'text-1'});
      add(surface, 'text-1', 'Text', {'text': 'Hi'});
      final ComponentNode root = resolver.rootNode.value!;
      expect(root.instanceId, 'root');
      expect(root.dataPath, '/');
      final ComponentNode textNode = child(root, 'child');
      expect(textNode.instanceId, 'text-1');
      expect(textNode.componentId, 'text-1');
      expect(textNode.type, 'Text');
      expect(textNode.dataPath, '/');
      resolver.dispose();
    });

    test('exposes the resolved catalog entry on impl, and none on a '
        'placeholder', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Card', {'child': 'missing'});
      final ComponentNode root = resolver.rootNode.value!;
      expect(root.impl, same(catalog.components['Card']));
      expect(child(root, 'child').impl, isNull);
      resolver.dispose();
    });

    test('resolves data-bound properties reactively', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/username', 'Alice');
      add(surface, 'root', 'Text', {
        'text': {'path': '/username'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      expect(bound(root, 'text'), 'Alice');

      surface.dataModel.set('/username', 'Bob');
      expect(bound(root, 'text'), 'Bob');
      resolver.dispose();
    });

    test('resolves a single child reference to a live node', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Card', {'child': 'text-1'});
      add(surface, 'text-1', 'Text', {'text': 'Hello'});
      final ComponentNode root = resolver.rootNode.value!;
      final ComponentNode textNode = child(root, 'child');
      expect(textNode.type, 'Text');
      expect(bound(textNode, 'text'), 'Hello');
      resolver.dispose();
    });

    test('resolves an explicit children list in order', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Column', {
        'children': ['c1', 'c2'],
      });
      add(surface, 'c1', 'Text', {'text': 'C1'});
      add(surface, 'c2', 'Text', {'text': 'C2'});
      final ComponentNode root = resolver.rootNode.value!;
      final List<ComponentNode> children = (props(root)['children'] as List)
          .cast<ComponentNode>();
      expect(children, hasLength(2));
      expect(bound(children[0], 'text'), 'C1');
      expect(bound(children[1], 'text'), 'C2');
      resolver.dispose();
    });

    for (final NodeState state in NodeState.values) {
      test('keeps sibling instance ids distinct after insertion for '
          '${state.jsonValue} nodes', () {
        final TestSetup fixture = setup();
        final SurfaceModel<ComponentApi> surface = fixture.surface;
        final NodeResolver<ComponentApi> resolver = fixture.resolver;
        addTearDown(() {
          resolver.dispose();
          surface.dispose();
        });
        final id = state == NodeState.cyclic ? 'root' : 'a';
        if (state == NodeState.resolved) {
          add(surface, id, 'Text', {'text': 'dup'});
        } else if (state == NodeState.unknownType) {
          add(surface, id, 'Unknown', {});
        }
        add(surface, 'root', 'Column', {
          'children': [id, id],
        });
        final ComponentNode root = resolver.rootNode.value!;
        final ComponentNode first = child(root, 'children', 0);
        final ComponentNode second = child(root, 'children', 1);
        expect(first, isNot(same(second)));
        expect(first.instanceId, id);
        expect(second.instanceId, '$id#2');
        expect(first.state, state);
        expect(second.state, state);

        add(surface, 'x', 'Text', {'text': 'x'});
        surface.componentsModel.get('root')!.properties = {
          'children': ['x', id, id],
        };
        final List<ComponentNode> shifted = (props(root)['children'] as List)
            .cast<ComponentNode>();
        expect(shifted.map((node) => node.instanceId), ['x', id, '$id#2']);
        expect(shifted[1].state, state);
        expect(shifted[2].state, state);
        // The same edge slot now has the first ordinal, so it cannot retain
        // the old second node's immutable instance id.
        expect(second.disposed, isTrue);
        expect(shifted[1], isNot(same(second)));

        surface.componentsModel.get('root')!.properties = {
          'children': [id, id],
        };
        expect(
          (props(root)['children'] as List).cast<ComponentNode>().map(
            (node) => node.instanceId,
          ),
          [id, '$id#2'],
        );
      });
    }

    test('keeps sibling instance ids through placeholder transitions', () {
      final TestSetup fixture = setup();
      final SurfaceModel<ComponentApi> surface = fixture.surface;
      final NodeResolver<ComponentApi> resolver = fixture.resolver;
      addTearDown(() {
        resolver.dispose();
        surface.dispose();
      });
      add(surface, 'root', 'Column', {
        'children': ['a', 'a'],
      });
      final ComponentNode root = resolver.rootNode.value!;
      void expectChildren(NodeState state) {
        final List<ComponentNode> children = (props(root)['children'] as List)
            .cast<ComponentNode>();
        expect(children.map((node) => node.instanceId), ['a', 'a#2']);
        expect(children.map((node) => node.state), [state, state]);
      }

      expectChildren(NodeState.pending);
      add(surface, 'a', 'Unknown', {});
      expectChildren(NodeState.unknownType);
      surface.componentsModel.removeComponent('a');
      expectChildren(NodeState.pending);
      add(surface, 'a', 'Text', {'text': 'ready'});
      expectChildren(NodeState.resolved);
      surface.componentsModel.removeComponent('a');
      expectChildren(NodeState.pending);
    });

    test('escapes sibling instance ids that mimic occurrence suffixes', () {
      final TestSetup fixture = setup();
      final SurfaceModel<ComponentApi> surface = fixture.surface;
      final NodeResolver<ComponentApi> resolver = fixture.resolver;
      addTearDown(() {
        resolver.dispose();
        surface.dispose();
      });
      final ids = ['a', 'a', 'a#2', 'a~1', 'a[', 'a]', 'a>', 'a@'];
      for (final String id in ids.toSet()) {
        add(surface, id, 'Text', {'text': id});
      }
      add(surface, 'root', 'Column', {'children': ids});
      final List<ComponentNode> children =
          (props(resolver.rootNode.value!)['children'] as List)
              .cast<ComponentNode>();
      expect(children.map((node) => node.instanceId), [
        'a',
        'a#2',
        'a~12',
        'a~01',
        'a~2',
        'a~3',
        'a~4',
        'a~5',
      ]);
      expect(
        children.map((node) => node.instanceId).toSet(),
        hasLength(ids.length),
      );
    });

    test('escapes sibling instance ids that mimic template scopes', () {
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'scoped-id-test',
        components: [
          ...makeCatalog().components.values,
          _TestComponentApi(
            'Pane',
            Schema.object(
              properties: {
                'main': CommonSchemas.componentId,
                'items': CommonSchemas.childList,
              },
            ),
          ),
        ],
      );
      final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
      final resolver = NodeResolver<ComponentApi>(surface);
      addTearDown(() {
        resolver.dispose();
        surface.dispose();
      });
      surface.dataModel.set('/items', [<String, Object?>{}]);
      add(surface, 't-[/items/0]', 'Text', {'text': 'literal'});
      add(surface, 't', 'Text', {'text': 'template'});
      add(surface, 'root', 'Pane', {
        'main': 't-[/items/0]',
        'items': {'componentId': 't', 'path': '/items'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      expect(child(root, 'main').instanceId, 't-~2/items/0~3');
      expect(child(root, 'items', 0).instanceId, 't-[/items/0]');

      surface.dataModel.set('/items@[#~>', [<String, Object?>{}]);
      surface.componentsModel.get('root')!.properties = {
        'items': {'componentId': 't', 'path': '/items@[#~>'},
      };
      expect(child(root, 'items', 0).instanceId, 't-[/items~5~2~1~0~4/0]');
      expect(child(root, 'items', 0).dataPath, '/items@[#~>/0');
    });

    test('spawns one node per array item for a template child list', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/items', [
        {'name': 'A'},
        {'name': 'B'},
      ]);
      add(surface, 'root', 'Column', {
        'children': {'componentId': 'item_tpl', 'path': '/items'},
      });
      add(surface, 'item_tpl', 'Text', {
        'text': {'path': 'name'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      final List<ComponentNode> children = (props(root)['children'] as List)
          .cast<ComponentNode>();
      expect(children, hasLength(2));
      expect(children[0].instanceId, 'item_tpl-[/items/0]');
      expect(children[0].dataPath, '/items/0');
      expect(bound(children[0], 'text'), 'A');
      expect(bound(children[1], 'text'), 'B');
      resolver.dispose();
    });

    test('renders placeholders progressively and emits the parent exactly once '
        'on upgrade', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Column', {
        'children': ['late'],
      });
      final ComponentNode root = resolver.rootNode.value!;
      final ComponentNode placeholder = child(root, 'children', 0);
      expect(placeholder.type, placeholderType);
      expect(placeholder.componentId, 'late');
      expect(placeholder.state, NodeState.pending);

      var destroyed = 0;
      placeholder.onDestroyed.addListener((_) {
        destroyed++;
      });
      final emissions = EmissionCounter(root.props);

      add(surface, 'late', 'Text', {'text': 'Arrived'});
      expect(emissions.count, 1);
      final ComponentNode upgraded = child(root, 'children', 0);
      expect(identical(upgraded, placeholder), isFalse);
      expect(upgraded.type, 'Text');
      expect(bound(upgraded, 'text'), 'Arrived');
      expect(placeholder.disposed, isTrue);
      expect(destroyed, 1);
      emissions.dispose();
      resolver.dispose();
    });

    test(
      'binds actions as closures that dispatch through the surface',
      () async {
        final (
          catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
          surface: SurfaceModel<ComponentApi> surface,
          resolver: NodeResolver<ComponentApi> resolver,
        ) = setup();
        final actions = <A2uiClientAction>[];
        surface.onAction.addListener(actions.add);
        surface.dataModel.set('/current_id', 42);
        add(surface, 'root', 'Button', {
          'label': 'Go',
          'action': {
            'event': {
              'name': 'submit',
              'context': {
                'itemId': {'path': '/current_id'},
              },
            },
          },
        });
        final ComponentNode root = resolver.rootNode.value!;
        final Object? fire = props(root)['action'];
        expect(fire, isA<Function>());
        (fire as Function)();
        await flush();

        expect(actions, hasLength(1));
        expect(actions[0].name, 'submit');
        expect(actions[0].surfaceId, 'surf-1');
        expect(actions[0].sourceComponentId, 'root');
        expect(actions[0].context, {'itemId': 42});
        resolver.dispose();
      },
    );

    test('resolves an unresolved binding to null without failing', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Text', {
        'text': {'path': '/missing'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      expect(bound(root, 'text'), isNull);
      resolver.dispose();
    });

    test(
      'reconciles explicit children list changes, reusing surviving nodes',
      () {
        final (
          catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
          surface: SurfaceModel<ComponentApi> surface,
          resolver: NodeResolver<ComponentApi> resolver,
        ) = setup();
        add(surface, 'root', 'Column', {
          'children': ['c1', 'c2'],
        });
        add(surface, 'c1', 'Text', {'text': 'C1'});
        add(surface, 'c2', 'Text', {'text': 'C2'});
        add(surface, 'c3', 'Text', {'text': 'C3'});
        final ComponentNode root = resolver.rootNode.value!;
        final List<ComponentNode> before = (props(root)['children'] as List)
            .cast<ComponentNode>();

        surface.componentsModel.get('root')!.properties = {
          'children': ['c1', 'c3'],
        };

        final List<ComponentNode> after = (props(root)['children'] as List)
            .cast<ComponentNode>();
        expect(after, hasLength(2));
        expect(identical(after[0], before[0]), isTrue);
        expect(bound(after[1], 'text'), 'C3');
        expect(before[1].disposed, isTrue);
        resolver.dispose();
      },
    );

    test('reconciles a swap from explicit children to a template', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/items', [
        {'name': 'T0'},
      ]);
      add(surface, 'root', 'Column', {
        'children': ['c1'],
      });
      add(surface, 'c1', 'Text', {'text': 'C1'});
      add(surface, 'item_tpl', 'Text', {
        'text': {'path': 'name'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      final ComponentNode explicitChild = child(root, 'children', 0);

      surface.componentsModel.get('root')!.properties = {
        'children': {'componentId': 'item_tpl', 'path': '/items'},
      };

      final List<ComponentNode> children = (props(root)['children'] as List)
          .cast<ComponentNode>();
      expect(children, hasLength(1));
      expect(bound(children[0], 'text'), 'T0');
      expect(explicitChild.disposed, isTrue);
      resolver.dispose();
    });

    test('resolves function-call bindings reactively', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/username', 'alice');
      add(surface, 'root', 'Text', {
        'text': {
          'call': 'shout',
          'args': {
            'value': {'path': '/username'},
          },
        },
      });
      final ComponentNode root = resolver.rootNode.value!;
      expect(bound(root, 'text'), 'ALICE');
      expect(props(root)['text'], isNot(isA<WritableBinding<Object?>>()));

      surface.dataModel.set('/username', 'bob');
      expect(bound(root, 'text'), 'BOB');
      resolver.dispose();
    });

    test('resolves nested child references inside item arrays', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Tabs', {
        'items': [
          {'title': 'One', 'child': 't1'},
          {'title': 'Two', 'child': 't2'},
        ],
      });
      add(surface, 't1', 'Text', {'text': 'First'});
      add(surface, 't2', 'Text', {'text': 'Second'});
      final ComponentNode root = resolver.rootNode.value!;
      final List<Map<Object?, Object?>> items = (props(root)['items'] as List)
          .cast<Map<Object?, Object?>>();
      expect(items, hasLength(2));
      expect(items[0]['title'], 'One');
      final Object? first = items[0]['child'];
      expect(first, isA<ComponentNode>());
      expect(bound(first as ComponentNode, 'text'), 'First');
      final Object? second = items[1]['child'];
      expect(second, isA<ComponentNode>());
      expect(bound(second as ComponentNode, 'text'), 'Second');
      resolver.dispose();
    });

    test('reconciles a deleted component back to a placeholder, leaving '
        'siblings alone', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Column', {
        'children': ['c1', 'c2'],
      });
      add(surface, 'c1', 'Text', {'text': 'C1'});
      add(surface, 'c2', 'Text', {'text': 'C2'});
      final ComponentNode root = resolver.rootNode.value!;
      final List<ComponentNode> before = (props(root)['children'] as List)
          .cast<ComponentNode>();

      surface.componentsModel.removeComponent('c2');

      final List<ComponentNode> after = (props(root)['children'] as List)
          .cast<ComponentNode>();
      expect(identical(after[0], before[0]), isTrue);
      expect(after[1].type, placeholderType);
      expect(before[1].disposed, isTrue);
      resolver.dispose();
    });

    test(
      're-spawns template children as the bound array grows and shrinks',
      () {
        final (
          catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
          surface: SurfaceModel<ComponentApi> surface,
          resolver: NodeResolver<ComponentApi> resolver,
        ) = setup();
        surface.dataModel.set('/items', [
          {'name': 'A'},
        ]);
        add(surface, 'root', 'Column', {
          'children': {'componentId': 'item_tpl', 'path': '/items'},
        });
        add(surface, 'item_tpl', 'Text', {
          'text': {'path': 'name'},
        });
        final ComponentNode root = resolver.rootNode.value!;
        expect(props(root)['children'] as List, hasLength(1));

        surface.dataModel.set('/items', [
          {'name': 'A'},
          {'name': 'B'},
          {'name': 'C'},
        ]);
        final List<ComponentNode> grown = (props(root)['children'] as List)
            .cast<ComponentNode>();
        expect(grown, hasLength(3));
        expect(bound(grown[2], 'text'), 'C');

        surface.dataModel.set('/items', [
          {'name': 'A'},
        ]);
        final List<ComponentNode> shrunk = (props(root)['children'] as List)
            .cast<ComponentNode>();
        expect(shrunk, hasLength(1));
        expect(grown[1].disposed, isTrue);
        expect(grown[2].disposed, isTrue);
        resolver.dispose();
      },
    );

    test('serializes the resolved tree, rendering actions and placeholders '
        'specially', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Column', {
        'children': ['card', 'btn', 'late'],
      });
      add(surface, 'card', 'Card', {'child': 'txt'});
      add(surface, 'txt', 'Text', {'text': 'Hello'});
      add(surface, 'btn', 'Button', {
        'label': 'Go',
        'action': {
          'event': {'name': 'go'},
        },
      });
      final ComponentNode root = resolver.rootNode.value!;
      expect(root.toJson(), {
        'id': 'root',
        'type': 'Column',
        'children': [
          {
            'id': 'card',
            'type': 'Card',
            'child': {'id': 'txt', 'type': 'Text', 'text': 'Hello'},
          },
          {'id': 'btn', 'type': 'Button', 'label': 'Go', 'action': '<Action>'},
          {'id': 'late', 'type': placeholderType, 'state': 'pending'},
        ],
      });
      resolver.dispose();
    });
  });

  group('NodeResolver actions and ownership', () {
    test('resolves action context at dispatch time, not bind time '
        '(late resolution)', () async {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      final actions = <A2uiClientAction>[];
      surface.onAction.addListener(actions.add);
      surface.dataModel.set('/current_id', 'stale');
      add(surface, 'root', 'Button', {
        'action': {
          'event': {
            'name': 'submit',
            'context': {
              'itemId': {'path': '/current_id'},
            },
          },
        },
      });
      final ComponentNode root = resolver.rootNode.value!;

      surface.dataModel.set('/current_id', 'fresh');
      (props(root)['action'] as Function)();
      await flush();

      expect(actions, hasLength(1));
      expect(actions[0].context, {'itemId': 'fresh'});
      resolver.dispose();
    });

    test('resolves dynamic values nested inside literal context structure '
        'at dispatch', () async {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      final actions = <A2uiClientAction>[];
      surface.onAction.addListener(actions.add);
      surface.dataModel.set('/field', 'name');
      add(surface, 'root', 'Button', {
        'action': {
          'event': {
            'name': 'submit',
            'context': {
              'filter': {
                'by': {'path': '/field'},
              },
            },
          },
        },
      });
      final ComponentNode root = resolver.rootNode.value!;
      (props(root)['action'] as Function)();
      await flush();

      expect(actions, hasLength(1));
      expect(actions[0].context, {
        'filter': {'by': 'name'},
      });
      resolver.dispose();
    });

    test('keeps a shared child alive for one parent when the other stops '
        'referencing it', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/label', 'shared text');
      add(surface, 'root', 'Column', {
        'children': ['card_a', 'card_b'],
      });
      add(surface, 'card_a', 'Card', {'child': 'shared'});
      add(surface, 'card_b', 'Card', {'child': 'shared'});
      add(surface, 'shared', 'Text', {
        'text': {'path': '/label'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      final ComponentNode cardA = child(root, 'children', 0);
      final ComponentNode cardB = child(root, 'children', 1);
      final ComponentNode sharedViaA = child(cardA, 'child');
      final ComponentNode sharedViaB = child(cardB, 'child');
      expect(identical(sharedViaA, sharedViaB), isFalse);

      surface.componentsModel.get('card_a')!.properties = {};

      expect(sharedViaA.disposed, isTrue);
      expect(sharedViaB.disposed, isFalse);
      surface.dataModel.set('/label', 'still updating');
      expect(bound(sharedViaB, 'text'), 'still updating');
      resolver.dispose();
    });

    test('keeps surviving template nodes across array growth and shrink '
        '(key stability)', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/items', [
        {'name': 'A'},
        {'name': 'B'},
      ]);
      add(surface, 'root', 'Column', {
        'children': {'componentId': 'item_tpl', 'path': '/items'},
      });
      add(surface, 'item_tpl', 'Text', {
        'text': {'path': 'name'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      final before = List<ComponentNode>.of(
        (props(root)['children'] as List).cast<ComponentNode>(),
      );

      surface.dataModel.set('/items', [
        {'name': 'A'},
        {'name': 'B'},
        {'name': 'C'},
      ]);
      final List<ComponentNode> grown = (props(root)['children'] as List)
          .cast<ComponentNode>();
      expect(identical(grown[0], before[0]), isTrue);
      expect(identical(grown[1], before[1]), isTrue);
      expect(before[0].disposed, isFalse);
      expect(before[1].disposed, isFalse);

      surface.dataModel.set('/items', [
        {'name': 'A'},
      ]);
      final List<ComponentNode> shrunk = (props(root)['children'] as List)
          .cast<ComponentNode>();
      expect(identical(shrunk[0], before[0]), isTrue);
      expect(before[1].disposed, isTrue);
      resolver.dispose();
    });

    test('does not emit a parent props signal when only a child property '
        'changes (no bubbling)', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/username', 'Alice');
      surface.dataModel.set('/items', [
        {'name': 'A'},
        {'name': 'B'},
      ]);
      add(surface, 'root', 'Column', {
        'children': ['bound', 'tpl_col'],
      });
      add(surface, 'bound', 'Text', {
        'text': {'path': '/username'},
      });
      add(surface, 'tpl_col', 'Column', {
        'children': {'componentId': 'item_tpl', 'path': '/items'},
      });
      add(surface, 'item_tpl', 'Text', {
        'text': {'path': 'name'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      final ComponentNode boundText = child(root, 'children', 0);
      final ComponentNode templateColumn = child(root, 'children', 1);
      final ComponentNode item0 = child(templateColumn, 'children', 0);

      final rootEmissions = EmissionCounter(root.props);
      final templateColumnEmissions = EmissionCounter(templateColumn.props);
      final boundEmissions = EmissionCounter(boundText.props);
      final item0Emissions = EmissionCounter(item0.props);

      surface.dataModel.set('/username', 'Bob');
      expect(boundEmissions.count, 1);
      expect(bound(boundText, 'text'), 'Bob');
      expect(rootEmissions.count, 0);

      // Editing one item's field re-fires the template's array
      // subscription; the item node must update while the template
      // parent's props stay identity-stable and silent.
      surface.dataModel.set('/items/0/name', 'A2');
      expect(bound(item0, 'text'), 'A2');
      expect(item0Emissions.count, greaterThanOrEqualTo(1));
      expect(templateColumnEmissions.count, 0);
      expect(rootEmissions.count, 0);

      rootEmissions.dispose();
      templateColumnEmissions.dispose();
      boundEmissions.dispose();
      item0Emissions.dispose();
      resolver.dispose();
    });
  });

  group('NodeResolver malformed and unusual payloads', () {
    test('renders cyclic references as placeholders instead of recursing', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      final errors = <A2uiClientError>[];
      surface.onError.addListener(errors.add);
      add(surface, 'root', 'Card', {'child': 'a'});
      add(surface, 'a', 'Card', {'child': 'b'});
      add(surface, 'b', 'Card', {'child': 'a'});

      final ComponentNode root = resolver.rootNode.value!;
      final ComponentNode a = child(root, 'child');
      final ComponentNode b = child(a, 'child');
      final ComponentNode backReference = child(b, 'child');
      expect(backReference.type, placeholderType);
      expect(backReference.state, NodeState.cyclic);
      expect(backReference.componentId, 'a');
      expect(errors.any((e) => e.code == 'CYCLIC_REFERENCE'), isTrue);
      expect(resolver.activeNodeCount, lessThanOrEqualTo(5));
      resolver.dispose();
    });

    test('resolves a call to an unknown function to null and dispatches an '
        'expression error instead of throwing', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      final errors = <A2uiClientError>[];
      surface.onError.addListener(errors.add);
      add(surface, 'root', 'Text', {
        'text': {'call': 'unregistered', 'args': <String, Object?>{}},
      });

      final ComponentNode root = resolver.rootNode.value!;
      expect(bound(root, 'text'), isNull);
      expect(errors, hasLength(1));
      expect(errors[0].code, 'EXPRESSION_ERROR');
      expect(errors[0].surfaceId, 'surf-1');
      expect(errors[0].message, contains('Function not found'));
      resolver.dispose();
    });

    test('renders a self-referencing component as a placeholder child', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      add(surface, 'root', 'Card', {'child': 'root'});
      final ComponentNode root = resolver.rootNode.value!;
      expect(child(root, 'child').type, placeholderType);
      resolver.dispose();
    });

    test('propagates replacement of an opaque value '
        'inside a binding map', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      final first = _Opaque(1);
      final second = _Opaque(2);
      surface.dataModel.set('/blob', {'wrapper': first});
      add(surface, 'root', 'Text', {
        'text': {'path': '/blob'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      expect(identical((bound(root, 'text') as Map)['wrapper'], first), isTrue);

      surface.dataModel.set('/blob', {'wrapper': second});
      expect(
        identical((bound(root, 'text') as Map)['wrapper'], second),
        isTrue,
      );
      resolver.dispose();
    });

    test('replaces a pending placeholder with an unknown-type placeholder '
        'when the definition arrives with an uncataloged type', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      final errors = <A2uiClientError>[];
      surface.onError.addListener(errors.add);
      add(surface, 'root', 'Card', {'child': 'late'});
      final ComponentNode root = resolver.rootNode.value!;
      final ComponentNode pendingNode = child(root, 'child');
      expect(pendingNode.state, NodeState.pending);
      expect(pendingNode.type, placeholderType);
      expect(errors.where((e) => e.code == 'UNKNOWN_COMPONENT_TYPE'), isEmpty);

      add(surface, 'late', 'Bogus', {});

      final ComponentNode unknown = child(root, 'child');
      expect(identical(unknown, pendingNode), isFalse);
      expect(pendingNode.disposed, isTrue);
      expect(unknown.type, 'Bogus');
      expect(unknown.state, NodeState.unknownType);
      expect(unknown.isPlaceholder, isTrue);
      expect(unknown.toJson(), {
        'id': 'late',
        'type': 'Bogus',
        'state': 'unknown-type',
      });
      expect(
        errors.where((e) => e.code == 'UNKNOWN_COMPONENT_TYPE'),
        hasLength(1),
      );

      surface.componentsModel.get('root')!.properties = {'child': 'late'};
      expect(identical(child(root, 'child'), unknown), isTrue);
      expect(
        errors.where((e) => e.code == 'UNKNOWN_COMPONENT_TYPE'),
        hasLength(1),
      );
      resolver.dispose();
    });

    test('keeps a stable placeholder for a component whose type is not in the '
        'catalog', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      final errors = <A2uiClientError>[];
      surface.onError.addListener(errors.add);
      add(surface, 'root', 'Card', {'child': 'weird'});
      add(surface, 'weird', 'Bogus', {});

      final ComponentNode root = resolver.rootNode.value!;
      final ComponentNode placeholder = child(root, 'child');
      expect(placeholder.type, 'Bogus');
      expect(placeholder.state, NodeState.unknownType);
      expect(placeholder.isPlaceholder, isTrue);
      expect(placeholder.toJson(), {
        'id': 'weird',
        'type': 'Bogus',
        'state': 'unknown-type',
      });
      final int reportsBefore = errors
          .where((e) => e.code == 'UNKNOWN_COMPONENT_TYPE')
          .length;

      surface.componentsModel.get('root')!.properties = {'child': 'weird'};
      surface.componentsModel.get('root')!.properties = {'child': 'weird'};

      expect(identical(child(root, 'child'), placeholder), isTrue);
      expect(
        errors.where((e) => e.code == 'UNKNOWN_COMPONENT_TYPE').length,
        reportsBefore,
      );
      resolver.dispose();
    });
  });

  group('NodeResolver resolved bindings (write path)', () {
    test('rebinding a prop to a new path replaces the binding even when '
        'values are equal', () {
      final TestSetup fixture = setup();
      addTearDown(() {
        fixture.resolver.dispose();
        fixture.surface.dispose();
      });
      fixture.surface.dataModel.set('/a', 'same');
      fixture.surface.dataModel.set('/b', 'same');
      add(fixture.surface, 'root', 'Text', {
        'text': {'path': '/a'},
      });
      final ComponentNode root = fixture.resolver.rootNode.value!;
      final before = props(root)['text'] as WritableBinding<Object?>;

      fixture.surface.componentsModel.get('root')!.properties = {
        'text': {'path': '/b'},
      };

      final after = props(root)['text'] as WritableBinding<Object?>;
      expect(identical(after, before), isFalse);
      expect(before.path, '/a');
      expect(after.path, '/b');
      after.set('written');
      expect(fixture.surface.dataModel.get('/b'), 'written');
      expect(fixture.surface.dataModel.get('/a'), 'same');
    });

    test('exposes dynamic values as bindings, writable iff path-bound', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/label', 'Go');
      add(surface, 'root', 'Column', {
        'children': ['txt', 'btn'],
      });
      add(surface, 'txt', 'Text', {'text': 'Hi'});
      add(surface, 'btn', 'Button', {
        'label': {'path': '/label'},
      });
      final ComponentNode root = resolver.rootNode.value!;

      final literal =
          props(child(root, 'children', 0))['text'] as ResolvedBinding<Object?>;
      expect(literal.value, 'Hi');
      expect(literal, isNot(isA<WritableBinding<Object?>>()));

      final pathBound =
          props(child(root, 'children', 1))['label']
              as ResolvedBinding<Object?>;
      expect(pathBound.value, 'Go');
      if (pathBound is! WritableBinding<Object?>) {
        fail('expected a WritableBinding for a path-bound property');
      }
      pathBound.set('Next');
      expect(surface.dataModel.get('/label'), 'Next');
      expect(bound(child(root, 'children', 1), 'label'), 'Next');
      resolver.dispose();
    });

    test('writes through a template item binding land at the item scope', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/items', [
        {'name': 'A'},
        {'name': 'B'},
      ]);
      add(surface, 'root', 'Column', {
        'children': {'componentId': 'item_tpl', 'path': '/items'},
      });
      add(surface, 'item_tpl', 'Text', {
        'text': {'path': 'name'},
      });
      final ComponentNode root = resolver.rootNode.value!;
      final List<ComponentNode> children = (props(root)['children'] as List)
          .cast<ComponentNode>();

      final second = props(children[1])['text'] as ResolvedBinding<Object?>;
      if (second is! WritableBinding<Object?>) {
        fail('expected a WritableBinding for a template item binding');
      }
      expect(second.path, 'name');
      second.set('B2');

      expect(surface.dataModel.get('/items/1/name'), 'B2');
      expect(surface.dataModel.get('/items/0/name'), 'A');
      expect(bound(children[0], 'text'), 'A');
      expect(bound(children[1], 'text'), 'B2');
      resolver.dispose();
    });

    test('serializes path-bound values as their snapshot, no setter '
        'entries', () {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      surface.dataModel.set('/t', 'Hello');
      add(surface, 'root', 'Text', {
        'text': {'path': '/t'},
      });
      expect(resolver.rootNode.value!.toJson(), {
        'id': 'root',
        'type': 'Text',
        'text': 'Hello',
      });
      resolver.dispose();
    });
  });

  group('NodeResolver functionCall actions', () {
    test('executes a functionCall action through the evaluator when fired, '
        'emitting no action event', () async {
      final ping = _PingFunction();
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'function-action-catalog',
        components: [
          _TestComponentApi(
            'Button',
            Schema.object(
              properties: {
                'label': CommonSchemas.dynamicString,
                'action': CommonSchemas.action,
              },
            ),
          ),
        ],
        functions: [ping],
      );
      final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
      final resolver = NodeResolver<ComponentApi>(surface);
      final actions = <A2uiClientAction>[];
      final errors = <A2uiClientError>[];
      surface.onAction.addListener(actions.add);
      surface.onError.addListener(errors.add);
      add(surface, 'root', 'Button', {
        'label': 'Go',
        'action': {
          'functionCall': {'call': 'ping', 'args': <String, Object?>{}},
        },
      });

      final ComponentNode root = resolver.rootNode.value!;
      expect(ping.invocationCount, 0);
      final Object? fire = props(root)['action'];
      expect(fire, isA<Function>());
      (fire as Function)();
      await flush();

      expect(ping.invocationCount, 1);
      expect(actions, isEmpty);
      expect(errors, isEmpty);
      resolver.dispose();
    });

    test('resolves an unknown function in a functionCall action to an '
        'expression error instead of throwing', () async {
      final (
        catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
        surface: SurfaceModel<ComponentApi> surface,
        resolver: NodeResolver<ComponentApi> resolver,
      ) = setup();
      final actions = <A2uiClientAction>[];
      final errors = <A2uiClientError>[];
      surface.onAction.addListener(actions.add);
      surface.onError.addListener(errors.add);
      add(surface, 'root', 'Button', {
        'label': 'Go',
        'action': {
          'functionCall': {'call': 'unregistered', 'args': <String, Object?>{}},
        },
      });

      final ComponentNode root = resolver.rootNode.value!;
      final Object? fire = props(root)['action'];
      expect(fire, isA<Function>());
      (fire as Function)();
      await flush();

      expect(errors, hasLength(1));
      expect(errors[0].code, 'EXPRESSION_ERROR');
      expect(errors[0].message, contains('Function not found'));
      expect(actions, isEmpty);
      resolver.dispose();
    });
  });

  group('NodeResolver construction and disposal', () {
    test('uses the implementation-bearing catalog held by the surface', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          makeCatalog();
      final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
      final resolver = NodeResolver<ComponentApi>(surface);
      addTearDown(() {
        resolver.dispose();
        surface.dispose();
      });
      add(surface, 'root', 'Text', {
        'text': {
          'call': 'shout',
          'args': {'value': 'hello'},
          'returnType': 'string',
        },
      });
      final ComponentNode<ComponentApi> root = resolver.rootNode.peek()!;
      expect(root.impl, same(catalog.components['Text']));
      expect((root.props.peek()['text'] as ResolvedBinding).value, 'HELLO');
    });

    test(
      'disposes the whole tree with the resolver, leaving no live nodes',
      () {
        final (
          catalog: Catalog<ComponentApi, FunctionImplementation> catalog,
          surface: SurfaceModel<ComponentApi> surface,
          resolver: NodeResolver<ComponentApi> resolver,
        ) = setup();
        surface.dataModel.set('/items', [
          {'name': 'A'},
          {'name': 'B'},
        ]);
        add(surface, 'root', 'Column', {
          'children': ['card', 'tpl_col'],
        });
        add(surface, 'card', 'Card', {'child': 'txt'});
        add(surface, 'txt', 'Text', {'text': 'Hello'});
        add(surface, 'tpl_col', 'Column', {
          'children': {'componentId': 'item_tpl', 'path': '/items'},
        });
        add(surface, 'item_tpl', 'Text', {
          'text': {'path': 'name'},
        });
        final ComponentNode root = resolver.rootNode.value!;
        expect(resolver.activeNodeCount, greaterThanOrEqualTo(6));

        resolver.dispose();
        expect(resolver.activeNodeCount, 0);
        expect(resolver.rootNode.value, isNull);
        expect(root.disposed, isTrue);

        // A data change after disposal must not resurrect any binding.
        surface.dataModel.set('/items', [
          {'name': 'X'},
        ]);
        expect(resolver.activeNodeCount, 0);
      },
    );
  });
}
