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

import 'dart:async';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:logging/logging.dart';
import 'package:test/test.dart';

Catalog<ComponentApi, FunctionImplementation> _catalog({
  List<FunctionImplementation> functions = const [],
}) => Catalog(
  id: 'reentrant-node-test',
  functions: functions,
  components: [
    ComponentApi(
      name: 'Text',
      schema: Schema.object(
        properties: {
          'text': CommonSchemas.dynamicString,
          'after': CommonSchemas.dynamicString,
        },
      ),
    ),
    ComponentApi(
      name: 'Card',
      schema: Schema.object(
        properties: {
          'child': CommonSchemas.componentId,
          'label': CommonSchemas.dynamicString,
        },
      ),
    ),
    ComponentApi(
      name: 'Column',
      schema: Schema.object(properties: {'children': CommonSchemas.childList}),
    ),
  ],
);

void _add(
  SurfaceModel<ComponentApi> surface,
  String id,
  String type,
  Map<String, Object?> properties,
) {
  surface.componentsModel.addComponent(ComponentModel(id, type, properties));
}

NodeResolver<ComponentApi> _resolver(SurfaceModel<ComponentApi> surface) {
  final resolver = NodeResolver<ComponentApi>(surface);
  addTearDown(() {
    resolver.dispose();
    surface.dispose();
  });
  return resolver;
}

ComponentNode _child(ComponentNode parent, [String key = 'child']) =>
    parent.props.peek()[key]! as ComponentNode;

Object? _text(ComponentNode node) =>
    (node.props.peek()['text'] as ResolvedBinding<Object?>?)?.value;

/// Every live record must be reachable, with no disposed node in the tree.
void _expectLiveTree(NodeResolver<ComponentApi> resolver) {
  final reachable = <ComponentNode>{};
  void visit(Object? value) {
    if (value is ComponentNode) {
      expect(value.disposed, isFalse, reason: value.instanceId);
      if (reachable.add(value)) {
        visit(value.props.peek());
      }
    } else if (value is Map) {
      for (final Object? entry in value.values) {
        visit(entry);
      }
    } else if (value is List) {
      for (final Object? entry in value) {
        visit(entry);
      }
    }
  }

  visit(resolver.rootNode.peek());
  expect(resolver.activeNodeCount, reachable.length);
}

void main() {
  _commitBoundaryTests();
  _cleanupRegistrationTests();
  group('NodeResolver reentrant lifecycle', () {
    for (final existingRoot in [false, true]) {
      test('an error listener removes an unknown child '
          '(${existingRoot ? 'existing' : 'new'} root)', () {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        var errors = 0;
        surface.onError.addListener((error) {
          if (error.code == 'UNKNOWN_COMPONENT_TYPE') {
            errors++;
            surface.componentsModel.removeComponent('weird');
          }
        });
        if (existingRoot) {
          _add(surface, 'root', 'Card', {'child': 'weird'});
          _add(surface, 'weird', 'Bogus', {});
        } else {
          _add(surface, 'weird', 'Bogus', {});
          _add(surface, 'root', 'Card', {'child': 'weird'});
        }

        expect(errors, 1);
        expect(surface.componentsModel.get('weird'), isNull);
        final ComponentNode root = resolver.rootNode.peek()!;
        expect(_child(root).state, NodeState.pending);
        _expectLiveTree(resolver);

        _add(surface, 'weird', 'Text', {'text': 'ready'});
        expect(_child(root).state, NodeState.resolved);
        expect(_text(_child(root)), 'ready');
        _expectLiveTree(resolver);
      });
    }

    test('an error listener removes and replaces the unknown child', () {
      final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
      final NodeResolver<ComponentApi> resolver = _resolver(surface);
      surface.onError.addListener((error) {
        if (error.code == 'UNKNOWN_COMPONENT_TYPE') {
          surface.componentsModel.removeComponent('weird');
          _add(surface, 'weird', 'Text', {'text': 'ready'});
        }
      });
      _add(surface, 'weird', 'Bogus', {});
      _add(surface, 'root', 'Card', {'child': 'weird'});

      final ComponentNode root = resolver.rootNode.peek()!;
      expect(_child(root).state, NodeState.resolved);
      expect(_text(_child(root)), 'ready');
      _expectLiveTree(resolver);
      surface.componentsModel.get('weird')!.properties = {'text': 'updated'};
      expect(_text(_child(root)), 'updated');
    });

    for (final constructFromExistingSurface in [false, true]) {
      test('an error listener removes the root before '
          '${constructFromExistingSurface ? 'constructor' : 'creation'} '
          'returns', () {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        surface.onError.addListener((error) {
          if (error.code == 'UNKNOWN_COMPONENT_TYPE') {
            surface.componentsModel.removeComponent('root');
          }
        });
        _add(surface, 'weird', 'Bogus', {});
        if (constructFromExistingSurface) {
          _add(surface, 'root', 'Card', {'child': 'weird'});
        }
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        if (!constructFromExistingSurface) {
          _add(surface, 'root', 'Card', {'child': 'weird'});
        }

        expect(surface.componentsModel.get('root'), isNull);
        expect(resolver.rootNode.peek(), isNull);
        _expectLiveTree(resolver);

        _add(surface, 'root', 'Text', {'text': 'new root'});
        expect(_text(resolver.rootNode.peek()!), 'new root');
        _expectLiveTree(resolver);
      });
    }

    test('an error listener repairs a cyclic child on a binder update', () {
      final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
      final NodeResolver<ComponentApi> resolver = _resolver(surface);
      _add(surface, 'leaf', 'Text', {'text': 'ready'});
      _add(surface, 'card', 'Card', {'child': 'leaf'});
      _add(surface, 'root', 'Card', {'child': 'card'});
      var errors = 0;
      surface.onError.addListener((error) {
        if (error.code == 'CYCLIC_REFERENCE') {
          errors++;
          surface.componentsModel.removeComponent('card');
          _add(surface, 'card', 'Text', {'text': 'repaired'});
        }
      });

      surface.componentsModel.get('card')!.properties = {'child': 'card'};

      expect(errors, 1);
      final ComponentNode root = resolver.rootNode.peek()!;
      expect(_child(root).type, 'Text');
      expect(_text(_child(root)), 'repaired');
      _expectLiveTree(resolver);
    });

    test('a cycle error listener removes the root during creation', () {
      final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
      final NodeResolver<ComponentApi> resolver = _resolver(surface);
      surface.onError.addListener((error) {
        if (error.code == 'CYCLIC_REFERENCE') {
          surface.componentsModel.removeComponent('root');
        }
      });

      _add(surface, 'root', 'Card', {'child': 'root'});

      expect(surface.componentsModel.get('root'), isNull);
      expect(resolver.rootNode.peek(), isNull);
      _expectLiveTree(resolver);
      _add(surface, 'root', 'Text', {'text': 'new root'});
      expect(_text(resolver.rootNode.peek()!), 'new root');
      _expectLiveTree(resolver);
    });

    for (final replaceRoot in [false, true]) {
      test('an earlier delete listener replaces a same-type '
          '${replaceRoot ? 'root' : 'child'} model', () {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        final id = replaceRoot ? 'root' : 'text';
        surface.componentsModel.onDeleted.addListener((deletedId) {
          if (deletedId == id) {
            _add(surface, id, 'Text', {'text': 'replacement'});
          }
        });
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        _add(surface, id, 'Text', {'text': 'original'});
        if (!replaceRoot) {
          _add(surface, 'root', 'Card', {'child': id});
        }
        ComponentNode textNode() => replaceRoot
            ? resolver.rootNode.peek()!
            : _child(resolver.rootNode.peek()!);
        final ComponentNode previous = textNode();

        surface.componentsModel.removeComponent(id);

        expect(resolver.rootNode.peek(), isNotNull);
        expect(_text(textNode()), 'replacement');
        expect(previous.disposed, isTrue);
        _expectLiveTree(resolver);
        surface.componentsModel.get(id)!.properties = {'text': 'latest'};
        expect(_text(textNode()), 'latest');
        _expectLiveTree(resolver);
      });
    }

    test('nested diagnostics drain before the initiating update returns', () {
      final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
      final NodeResolver<ComponentApi> resolver = _resolver(surface);
      var errors = 0;
      surface.onError.addListener((error) {
        if (error.code == 'UNKNOWN_COMPONENT_TYPE') {
          errors++;
          surface.componentsModel.removeComponent('root');
          if (errors == 1) {
            _add(surface, 'root', 'AnotherUnknownType', {});
          } else {
            _add(surface, 'root', 'Text', {'text': 'repaired'});
          }
        }
      });

      _add(surface, 'root', 'Bogus', {});

      expect(errors, 2);
      expect(_text(resolver.rootNode.peek()!), 'repaired');
      _expectLiveTree(resolver);
    });

    test(
      'a throwing error listener does not strand queued diagnostics',
      () async {
        final listenerFailures = <Object>[];
        await runZonedGuarded(
          () async {
            final surface = SurfaceModel<ComponentApi>(
              'surf',
              catalog: _catalog(),
            );
            final NodeResolver<ComponentApi> resolver = _resolver(surface);
            var errors = 0;
            surface.onError.addListener((error) {
              if (error.code == 'UNKNOWN_COMPONENT_TYPE') {
                errors++;
                if (errors == 1) {
                  throw StateError('listener failed');
                }
              }
            });

            _add(surface, 'weird', 'Bogus', {});
            _add(surface, 'other', 'Bogus', {});
            _add(surface, 'root', 'Column', {
              'children': ['weird', 'other'],
            });

            expect(errors, 2);
            _expectLiveTree(resolver);
            _add(surface, 'unreferenced', 'Text', {'text': 'ready'});
            expect(errors, 2);
            // dispatchError keeps its async error propagation. Resolution and
            // the diagnostic queue have already completed above.
            await Future<void>.delayed(Duration.zero);
          },
          (Object error, StackTrace stackTrace) => listenerFailures.add(error),
        );
        expect(listenerFailures, [isA<StateError>()]);
      },
    );

    test('disposing in an error listener cancels remaining diagnostics', () {
      final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
      final NodeResolver<ComponentApi> resolver = _resolver(surface);
      var errors = 0;
      surface.onError.addListener((error) {
        errors++;
        resolver.dispose();
      });

      _add(surface, 'weird', 'Bogus', {});
      _add(surface, 'other', 'Bogus', {});
      _add(surface, 'root', 'Column', {
        'children': ['weird', 'other'],
      });

      expect(errors, 1);
      expect(resolver.disposed, isTrue);
      expect(resolver.rootNode.peek(), isNull);
      _expectLiveTree(resolver);
      surface.componentsModel.get('root')!.properties = {
        'children': ['weird'],
      };
      expect(errors, 1);
      _expectLiveTree(resolver);
    });
  });
}

class _FailingFunction extends FunctionImplementation {
  int calls = 0;

  _FailingFunction()
    : super(
        name: 'maybeFail',
        returnType: A2uiReturnType.string,
        argumentSchema: Schema.object(
          properties: {'flag': Schema.boolean(), 'tick': Schema.integer()},
        ),
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    calls++;
    if (args['flag'] == true) throw StateError('evaluation failed');
    return 'ready';
  }
}

Map<String, Object?> _expression() => {
  'call': 'maybeFail',
  'args': {
    'flag': {'path': '/flag'},
    'tick': {'path': '/tick'},
  },
  'returnType': 'string',
};

void _commitBoundaryTests() {
  group('NodeResolver commit boundary', () {
    test(
      'disposal requested during root publication finishes before return',
      () {
        final function = _FailingFunction();
        final surface = SurfaceModel<ComponentApi>(
          'surf',
          catalog: _catalog(functions: [function]),
        );
        surface.dataModel.set('/flag', false);
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        ComponentNode? published;
        final void Function() unsubscribe = resolver.rootNode.subscribe((root) {
          if (root == null) return;
          published = root;
          _expectLiveTree(resolver);
          resolver.dispose();
        });
        addTearDown(unsubscribe);

        _add(surface, 'root', 'Text', {'text': _expression()});

        expect(published, isNotNull);
        expect(published!.disposed, isTrue);
        expect(resolver.disposed, isTrue);
        expect(resolver.rootNode.peek(), isNull);
        expect(resolver.activeNodeCount, 0);
        surface.dataModel.set('/flag', true);
        expect(function.calls, 1);
      },
    );

    test('retiring parent stops evaluating before descendant callbacks', () {
      final function = _FailingFunction();
      final surface = SurfaceModel<ComponentApi>(
        'surf',
        catalog: _catalog(functions: [function]),
      );
      surface.dataModel.set('/flag', false);
      final NodeResolver<ComponentApi> resolver = _resolver(surface);
      _add(surface, 'leaf', 'Text', {'text': 'leaf'});
      _add(surface, 'root', 'Card', {'child': 'leaf', 'label': _expression()});
      final ComponentNode oldRoot = resolver.rootNode.peek()!;
      var callbacks = 0;
      _child(oldRoot).onDestroyed.addListener((_) {
        callbacks++;
        surface.dataModel.set('/flag', true);
      });

      surface.componentsModel.removeComponent('root');

      expect(callbacks, 1);
      expect(function.calls, 1);
      expect(oldRoot.disposed, isTrue);
      expect(resolver.rootNode.peek(), isNull);
      expect(resolver.activeNodeCount, 0);
    });

    for (final disposeResolver in [false, true]) {
      test('initial expression error '
          '${disposeResolver ? 'disposes resolver' : 'removes root'} '
          'after ownership is complete', () {
        final function = _FailingFunction();
        final surface = SurfaceModel<ComponentApi>(
          'surf',
          catalog: _catalog(functions: [function]),
        );
        surface.dataModel.set('/flag', true);
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        var errors = 0;
        surface.onError.addListener((error) {
          expect(error.code, 'EXPRESSION_ERROR');
          errors++;
          _expectLiveTree(resolver);
          expect(resolver.rootNode.peek(), isNotNull);
          if (disposeResolver) {
            resolver.dispose();
          } else {
            surface.componentsModel.removeComponent('root');
          }
        });

        _add(surface, 'root', 'Text', {'text': _expression()});

        expect(errors, 1);
        expect(resolver.rootNode.peek(), isNull);
        expect(resolver.activeNodeCount, 0);
        expect(resolver.disposed, disposeResolver);
        resolver.dispose();
        resolver.dispose();
        surface.dataModel.set('/flag', false);
        surface.dataModel.set('/flag', true);
        expect(function.calls, 1);
        expect(errors, 1);
      });
    }

    test('child destruction can re-add the root during root deletion', () {
      final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
      final NodeResolver<ComponentApi> resolver = _resolver(surface);
      _add(surface, 'leaf', 'Text', {'text': 'old'});
      _add(surface, 'root', 'Card', {'child': 'leaf'});
      final ComponentNode oldRoot = resolver.rootNode.peek()!;
      ComponentNode? rootDuringDestruction = oldRoot;
      _child(oldRoot).onDestroyed.addListener((_) {
        rootDuringDestruction = resolver.rootNode.peek();
        _add(surface, 'root', 'Text', {'text': 'replacement'});
      });

      surface.componentsModel.removeComponent('root');

      expect(rootDuringDestruction, isNull);
      expect(oldRoot.disposed, isTrue);
      expect(_text(resolver.rootNode.peek()!), 'replacement');
      _expectLiveTree(resolver);
    });

    test(
      'throwing destruction listeners do not interrupt any teardown',
      () async {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        _add(surface, 'a', 'Text', {'text': 'a'});
        _add(surface, 'b', 'Text', {'text': 'b'});
        _add(surface, 'root', 'Column', {
          'children': ['a', 'b'],
        });
        final ComponentNode root = resolver.rootNode.peek()!;
        final List<ComponentNode> children =
            (root.props.peek()['children'] as List).cast<ComponentNode>();
        final events = <String>[];
        final logs = <LogRecord>[];
        final StreamSubscription<LogRecord> subscription = Logger(
          'a2ui_core.resolution',
        ).onRecord.listen(logs.add);
        addTearDown(subscription.cancel);
        root.addCleanup(() => events.add('root cleanup'));
        children[1].addCleanup(() => events.add('b cleanup'));
        children[0].onDestroyed.addListener((_) {
          events.add('first listener');
          throw StateError('renderer teardown failed');
        });
        children[0].onDestroyed.addListener(
          (_) => events.add('second listener'),
        );

        expect(resolver.dispose, returnsNormally);
        await Future<void>.delayed(Duration.zero);

        expect(
          events,
          containsAll([
            'first listener',
            'second listener',
            'b cleanup',
            'root cleanup',
          ]),
        );
        expect(
          logs.where((record) => record.error is StateError),
          hasLength(1),
        );
        expect(logs.single.level, Level.SEVERE);
        expect(root.disposed, isTrue);
        expect(children.every((child) => child.disposed), isTrue);
        expect(resolver.disposed, isTrue);
        expect(resolver.rootNode.peek(), isNull);
        expect(resolver.activeNodeCount, 0);
        resolver.dispose();
        expect(events, hasLength(4));
      },
    );

    test(
      'retired child callbacks observe and can change committed parent props',
      () {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        for (final id in ['a', 'b', 'c']) {
          _add(surface, id, 'Text', {'text': id});
        }
        _add(surface, 'root', 'Column', {
          'children': ['a', 'b'],
        });
        final ComponentNode root = resolver.rootNode.peek()!;
        final old =
            (root.props.peek()['children'] as List).first as ComponentNode;
        var destroyed = 0;
        ComponentNode? observedFirst;
        bool? observedAllLive;
        old.onDestroyed.addListener((_) {
          destroyed++;
          final List<ComponentNode> children =
              (root.props.peek()['children'] as List).cast<ComponentNode>();
          observedFirst = children.first;
          observedAllLive = children.every((child) => !child.disposed);
          surface.componentsModel.get('root')!.properties = {
            'children': ['b', 'c'],
          };
        });

        surface.componentsModel.removeComponent('a');

        expect(destroyed, 1);
        expect(observedFirst, isNot(same(old)));
        expect(observedAllLive, isTrue);
        final List<ComponentNode> children =
            (root.props.peek()['children'] as List).cast<ComponentNode>();
        expect(children.map((child) => child.componentId), ['b', 'c']);
        expect(children.every((child) => !child.isPlaceholder), isTrue);
        _expectLiveTree(resolver);
      },
    );

    test(
      'same-edge placeholder destruction observes its committed replacement',
      () {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        _add(surface, 'root', 'Card', {'child': 'leaf'});
        final ComponentNode root = resolver.rootNode.peek()!;
        final ComponentNode pending = _child(root);
        var destroyed = 0;
        ComponentNode? observedChild;
        bool? observedDisposed;
        NodeState? observedState;
        Object? observedText;
        pending.onDestroyed.addListener((_) {
          destroyed++;
          final ComponentNode current = _child(root);
          observedChild = current;
          observedDisposed = current.disposed;
          observedState = current.state;
          observedText = _text(current);
        });

        _add(surface, 'leaf', 'Text', {'text': 'ready'});

        expect(destroyed, 1);
        expect(observedChild, isNot(same(pending)));
        expect(observedDisposed, isFalse);
        expect(observedState, NodeState.resolved);
        expect(observedText, 'ready');
        expect(pending.disposed, isTrue);
        _expectLiveTree(resolver);
      },
    );

    for (final componentRebuild in [false, true]) {
      for (final disposeResolver in [false, true]) {
        test('${componentRebuild ? 'component rebuild' : 'data write'} '
            'expression error '
            '${disposeResolver ? 'disposes resolver' : 'removes root'} '
            'without later evaluation', () async {
          final function = _FailingFunction();
          final surface = SurfaceModel<ComponentApi>(
            'surf',
            catalog: _catalog(functions: [function]),
          );
          surface.dataModel.set('/flag', false);
          final NodeResolver<ComponentApi> resolver = _resolver(surface);
          var errors = 0;
          surface.onError.addListener((error) {
            expect(error.code, 'EXPRESSION_ERROR');
            errors++;
            _expectLiveTree(resolver);
            expect(_text(resolver.rootNode.peek()!), isNull);
            if (componentRebuild) {
              expect(
                (resolver.rootNode.peek()!.props.peek()['after']
                        as ResolvedBinding)
                    .value,
                'complete',
              );
            }
            if (disposeResolver) {
              resolver.dispose();
            } else {
              surface.componentsModel.removeComponent('root');
            }
          });
          _add(surface, 'root', 'Text', {
            'text': componentRebuild ? 'initial' : _expression(),
          });
          final ComponentNode oldRoot = resolver.rootNode.peek()!;
          surface.dataModel.set('/flag', true);
          if (componentRebuild) {
            surface.componentsModel.get('root')!.properties = {
              'text': _expression(),
              'after': 'complete',
            };
          }

          expect(errors, 1);
          expect(oldRoot.disposed, isTrue);
          expect(resolver.rootNode.peek(), isNull);
          expect(resolver.activeNodeCount, 0);
          final int calls = function.calls;
          surface.dataModel.set('/flag', false);
          surface.dataModel.set('/flag', true);
          resolver.dispose();
          resolver.dispose();
          surface.dataModel.set('/flag', false);
          surface.dataModel.set('/flag', true);
          await Future<void>.delayed(Duration.zero);
          expect(function.calls, calls);
          expect(errors, 1);
        });
      }
    }

    for (final disposeBeforeFallback in [false, true]) {
      final outcome = disposeBeforeFallback
          ? 'is canceled on disposal'
          : 'uses one fallback microtask';
      test('unchanged-null expression error '
          '$outcome', () async {
        final function = _FailingFunction();
        final surface = SurfaceModel<ComponentApi>(
          'surf',
          catalog: _catalog(functions: [function]),
        );
        surface.dataModel.set('/flag', true);
        surface.dataModel.set('/tick', 0);
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        var errors = 0;
        surface.onError.addListener((_) {
          errors++;
          _expectLiveTree(resolver);
          expect(_text(resolver.rootNode.peek()!), isNull);
        });
        _add(surface, 'root', 'Text', {'text': _expression()});
        expect(errors, 1);

        surface.dataModel.set('/tick', 1);
        expect(function.calls, 2);
        expect(
          errors,
          1,
          reason: 'unchanged output has no resolver update to drain the error',
        );
        if (disposeBeforeFallback) resolver.dispose();
        await Future<void>.delayed(Duration.zero);

        expect(errors, disposeBeforeFallback ? 1 : 2);
        await Future<void>.delayed(Duration.zero);
        expect(errors, disposeBeforeFallback ? 1 : 2);
      });
    }
  });
}

void _cleanupRegistrationTests() {
  group('NodeResolver cleanup registration', () {
    for (final operation in [
      'resolver disposal',
      'retirement',
      'root deletion',
    ]) {
      test('drains appended cleanups in order during $operation', () {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        _add(surface, 'a', 'Text', {'text': 'a'});
        _add(surface, 'b', 'Text', {'text': 'b'});
        _add(surface, 'root', 'Column', {
          'children': ['a', 'b'],
        });
        final ComponentNode root = resolver.rootNode.peek()!;
        final List<ComponentNode> children =
            (root.props.peek()['children'] as List).cast<ComponentNode>();
        final events = <String>[];
        children[0].addCleanup(() {
          events.add('a:first start');
          children[0].addCleanup(() => events.add('a:appended'));
          events.add('a:first end');
        });
        children[0].addCleanup(() => events.add('a:second'));
        children[0].onDestroyed.addListener((_) => events.add('a:destroyed'));
        children[1].addCleanup(() => events.add('b:cleanup'));
        children[1].onDestroyed.addListener((_) => events.add('b:destroyed'));
        root.addCleanup(() => events.add('root:cleanup'));
        root.onDestroyed.addListener((_) => events.add('root:destroyed'));
        const childEvents = [
          'a:first start',
          'a:first end',
          'a:second',
          'a:appended',
          'a:destroyed',
        ];

        if (operation == 'retirement') {
          surface.componentsModel.get('root')!.properties = {
            'children': ['b'],
          };
          // Removing the first position also replaces b's positional edge.
          expect(events, [...childEvents, 'b:cleanup', 'b:destroyed']);
          expect(children[0].disposed, isTrue);
          expect(children[1].disposed, isTrue);
          expect(resolver.activeNodeCount, 2);
          expect(resolver.rootNode.peek(), same(root));
          final replacement =
              (root.props.peek()['children'] as List).single as ComponentNode;
          expect(replacement.componentId, 'b');
          expect(replacement, isNot(same(children[1])));
          _expectLiveTree(resolver);
        } else if (operation == 'root deletion') {
          surface.componentsModel.removeComponent('root');
          expect(resolver.rootNode.peek(), isNull);
          expect(resolver.activeNodeCount, 0);
          expect(resolver.disposed, isFalse);
          _add(surface, 'root', 'Text', {'text': 'replacement'});
          expect(_text(resolver.rootNode.peek()!), 'replacement');
          _expectLiveTree(resolver);
        }

        expect(resolver.dispose, returnsNormally);

        expect(events, [
          ...childEvents,
          'b:cleanup',
          'b:destroyed',
          'root:cleanup',
          'root:destroyed',
        ]);
        expect(root.disposed, isTrue);
        expect(children.every((child) => child.disposed), isTrue);
        expect(resolver.activeNodeCount, 0);
        expect(resolver.rootNode.peek(), isNull);
        expect(resolver.disposed, isTrue);
        resolver.dispose();
        expect(events, hasLength(9));
      });
    }

    test(
      'isolates failures in appended cleanups and finishes teardown',
      () async {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        _add(surface, 'a', 'Text', {'text': 'a'});
        _add(surface, 'root', 'Card', {'child': 'a'});
        final ComponentNode root = resolver.rootNode.peek()!;
        final ComponentNode child = _child(root);
        final events = <String>[];
        final logs = <LogRecord>[];
        final StreamSubscription<LogRecord> subscription = Logger(
          'a2ui_core.resolution',
        ).onRecord.listen(logs.add);
        addTearDown(subscription.cancel);
        final failure = StateError('appended cleanup failed');
        child.addCleanup(() {
          events.add('first');
          child.addCleanup(() {
            events.add('throwing');
            throw failure;
          });
          child.addCleanup(() => events.add('last'));
        });
        child.addCleanup(() => events.add('second'));
        child.onDestroyed.addListener((_) => events.add('child destroyed'));
        root.addCleanup(() => events.add('root cleanup'));
        root.onDestroyed.addListener((_) => events.add('root destroyed'));

        expect(resolver.dispose, returnsNormally);
        await Future<void>.delayed(Duration.zero);

        expect(events, [
          'first',
          'second',
          'throwing',
          'last',
          'child destroyed',
          'root cleanup',
          'root destroyed',
        ]);
        expect(logs, hasLength(1));
        expect(logs.single.level, Level.SEVERE);
        expect(logs.single.error, same(failure));
        expect(resolver.activeNodeCount, 0);
        expect(resolver.disposed, isTrue);
        expect(root.disposed, isTrue);
        expect(child.disposed, isTrue);
      },
    );

    test(
      'runs cleanup registered after disposal immediately and isolates failure',
      () async {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        _add(surface, 'root', 'Text', {'text': 'root'});
        final ComponentNode root = resolver.rootNode.peek()!;
        resolver.dispose();
        var calls = 0;
        final logs = <LogRecord>[];
        final StreamSubscription<LogRecord> subscription = Logger(
          'a2ui_core.resolution',
        ).onRecord.listen(logs.add);
        addTearDown(subscription.cancel);
        final failure = StateError('late cleanup failed');

        root.addCleanup(() => calls++);
        expect(calls, 1);
        expect(
          () => root.addCleanup(() {
            calls++;
            throw failure;
          }),
          returnsNormally,
        );
        expect(calls, 2);
        root.addCleanup(() => calls++);
        expect(calls, 3);
        resolver.dispose();
        await Future<void>.delayed(Duration.zero);

        expect(calls, 3);
        expect(logs, hasLength(1));
        expect(logs.single.level, Level.SEVERE);
        expect(logs.single.error, same(failure));
        expect(resolver.activeNodeCount, 0);
      },
    );

    test(
      'runs cleanup registered by a destruction listener before it resumes',
      () async {
        final surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
        final NodeResolver<ComponentApi> resolver = _resolver(surface);
        _add(surface, 'root', 'Text', {'text': 'root'});
        final ComponentNode root = resolver.rootNode.peek()!;
        final events = <String>[];
        final logs = <LogRecord>[];
        final StreamSubscription<LogRecord> subscription = Logger(
          'a2ui_core.resolution',
        ).onRecord.listen(logs.add);
        addTearDown(subscription.cancel);
        final failure = StateError('destruction-time cleanup failed');
        root.onDestroyed.addListener((_) {
          events.add('listener start');
          root.addCleanup(() {
            events.add('cleanup');
            throw failure;
          });
          events.add('listener end');
        });
        root.onDestroyed.addListener((_) => events.add('second listener'));

        expect(resolver.dispose, returnsNormally);
        await Future<void>.delayed(Duration.zero);

        expect(events, [
          'listener start',
          'cleanup',
          'listener end',
          'second listener',
        ]);
        expect(logs, hasLength(1));
        expect(logs.single.level, Level.SEVERE);
        expect(logs.single.error, same(failure));
        expect(resolver.disposed, isTrue);
        expect(resolver.activeNodeCount, 0);
      },
    );
  });
}
