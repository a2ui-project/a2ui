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

import 'package:a2ui_core/src/core/catalog.dart';
import 'package:a2ui_core/src/core/common_schemas.dart';
import 'package:a2ui_core/src/core/component_model.dart';
import 'package:a2ui_core/src/core/contexts.dart';
import 'package:a2ui_core/src/core/messages.dart';
import 'package:a2ui_core/src/core/minimal_catalog.dart';
import 'package:a2ui_core/src/core/surface_model.dart';
import 'package:a2ui_core/src/primitives/cancellation.dart';
import 'package:a2ui_core/src/rendering/binder.dart';
import 'package:a2ui_core/src/resolution/resolved_binding.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

/// A catalog function that hands its resolved arguments to [onExecute].
class _SpyFunction extends FunctionImplementation {
  _SpyFunction(String name, this.onExecute)
      : super(name: name, argumentSchema: Schema.object());

  final Object? Function(Map<String, dynamic> args) onExecute;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      onExecute(args);
}

void main() {
  group('GenericBinder', () {
    late MinimalCatalog catalog;
    late SurfaceModel surface;

    setUp(() {
      catalog = MinimalCatalog();
      surface = SurfaceModel('s1', defaultCatalog: catalog);
    });

    test('resolves dynamic properties', () {
      final comp = ComponentModel('c1', 'Text', {
        'text': {'path': '/val'},
      });
      surface.componentsModel.addComponent(comp);
      surface.dataModel.set('/val', 'initial');

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalTextApi().schema);

      expect(
        (binder.resolvedProps.value['text'] as ResolvedBinding<Object?>).value,
        'initial',
      );

      surface.dataModel.set('/val', 'updated');
      expect(
        (binder.resolvedProps.value['text'] as ResolvedBinding<Object?>).value,
        'updated',
      );
    });

    test('resolves actions into callbacks', () async {
      String? actionName;
      surface.onAction.addListener((action) {
        actionName = action.name;
      });

      final comp = ComponentModel('c1', 'Button', {
        'child': 'c2',
        'action': {
          'event': {'name': 'test_action'},
        },
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalButtonApi().schema);

      final Object? action = binder.resolvedProps.value['action'];
      expect(action, isA<Function>());
      await (action as Function)();

      expect(actionName, 'test_action');
    });

    group('local function actions', () {
      final calls = <Map<String, dynamic>>[];
      late SurfaceModel spySurface;
      final actions = <A2uiClientAction>[];
      final errors = <A2uiClientError>[];

      setUp(() {
        calls.clear();
        actions.clear();
        errors.clear();
        spySurface = SurfaceModel(
          's2',
          defaultCatalog: Catalog<ComponentApi, FunctionImplementation>(
            id: 'test',
            components: [MinimalButtonApi()],
            functions: [
              _SpyFunction('spy', (args) {
                calls.add(args);
                return null;
              }),
              _SpyFunction('failAsync', (_) async {
                await Future<void>.delayed(Duration.zero);
                throw StateError('async failure');
              }),
              _SpyFunction('slow', (args) async {
                await Future<void>.delayed(Duration.zero);
                calls.add({'slow': true, ...args});
                return null;
              }),
            ],
          ),
        );
        spySurface.onAction.addListener(actions.add);
        spySurface.onError.addListener(errors.add);
        spySurface.dataModel.set('/items', [
          {'label': 'first'},
          {'label': 'second'},
        ]);
      });

      Future<void> invokeAction(
        Map<String, dynamic> action, {
        String? basePath,
      }) async {
        final comp = ComponentModel('c1', 'Button', {
          'child': 'c2',
          'action': action,
        });
        spySurface.componentsModel.addComponent(comp);
        final context = ComponentContext(spySurface, comp, basePath: basePath);
        final binder = GenericBinder(context, MinimalButtonApi().schema);
        final Object? callback = binder.resolvedProps.value['action'];
        expect(callback, isA<Future<void> Function()>());
        await (callback as Future<void> Function())();
      }

      test('runs functionCall against the component data context', () async {
        await invokeAction({
          'functionCall': {
            'call': 'spy',
            'args': {
              'label': {'path': 'label'},
              'literal': 7,
            },
          },
        }, basePath: '/items/1');

        expect(calls, [
          {'label': 'second', 'literal': 7},
        ]);
        expect(actions, isEmpty);
        expect(errors, isEmpty);
      });

      test('runs unwrapped call against the component data context', () async {
        await invokeAction({
          'call': 'spy',
          'args': {
            'label': {'path': 'label'},
          },
        }, basePath: '/items/0');

        expect(calls, [
          {'label': 'first'},
        ]);
        expect(actions, isEmpty);
        expect(errors, isEmpty);
      });

      test('awaits a function that returns a Future', () async {
        await invokeAction({
          'functionCall': {
            'call': 'slow',
            'args': {'n': 1},
          },
        });

        expect(calls, [
          {'slow': true, 'n': 1},
        ]);
      });

      test('reports a missing function through onError', () async {
        await invokeAction({
          'functionCall': {'call': 'doesNotExist', 'args': <String, Object?>{}},
        });

        expect(actions, isEmpty);
        expect(errors, hasLength(1));
        expect(errors.single.code, 'EXPRESSION_ERROR');
        expect(errors.single.surfaceId, 's2');
        expect(errors.single.message, contains('doesNotExist'));
      });

      test('reports an async function failure through onError', () async {
        await invokeAction({
          'functionCall': {'call': 'failAsync', 'args': <String, Object?>{}},
        });

        expect(actions, isEmpty);
        expect(errors, hasLength(1));
        expect(errors.single.message, contains('async failure'));
      });
    });

    test('resolves each context entry as a separate dynamic value', () async {
      A2uiClientAction? dispatchedAction;
      surface.onAction.addListener((action) {
        dispatchedAction = action;
      });
      surface.dataModel.set('/tab', 'general');

      final comp = ComponentModel('c1', 'Button', {
        'child': 'c2',
        'action': {
          'event': {
            'name': 'navigate',
            'context': {
              'path': '/settings',
              'call': 'literal',
              'tab': {'path': '/tab'},
            },
          },
        },
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalButtonApi().schema);
      await (binder.resolvedProps.value['action'] as Future<void> Function())();

      expect(dispatchedAction, isNotNull);
      expect(dispatchedAction!.context, {
        'path': '/settings',
        'call': 'literal',
        'tab': 'general',
      });
    });

    test('resolves direct name action with userMessage and context', () async {
      A2uiClientAction? dispatchedAction;
      surface.onAction.addListener((action) {
        dispatchedAction = action;
      });

      surface.dataModel.set('/userId', 'u123');
      surface.dataModel.set('/msg', 'Sending message');

      final comp = ComponentModel('c1', 'Button', {
        'child': 'c2',
        'action': {
          'name': 'submit_direct',
          'userMessage': {'path': '/msg'},
          'context': {
            'user': {'path': '/userId'},
          },
        },
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalButtonApi().schema);

      final Object? action = binder.resolvedProps.value['action'];
      expect(action, isA<Function>());
      await (action as Function)();

      expect(dispatchedAction, isNotNull);
      expect(dispatchedAction!.name, 'submit_direct');
      expect(dispatchedAction!.userMessage, 'Sending message');
      expect(dispatchedAction!.context, {'user': 'u123'});
    });

    test('writes back a nested map with non-string keys', () {
      final comp = ComponentModel('c1', 'Text', {
        'text': {'path': '/val'},
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalTextApi().schema);
      final binding =
          binder.resolvedProps.value['text'] as WritableBinding<Object?>;

      binding.set({
        'byName': {'a': 1},
        'byIndex': {1: 'one'},
      });

      final written = surface.dataModel.get('/val') as Map;
      expect(written['byName'], isA<Map<String, Object?>>());
      expect(written['byIndex'], {1: 'one'});
    });

    test('writes back a snapshot holding a map with non-string keys', () {
      surface.dataModel.set('/val', {
        'byIndex': {1: 'one'},
      });
      final comp = ComponentModel('c1', 'Text', {
        'text': {'path': '/val'},
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalTextApi().schema);
      final binding =
          binder.resolvedProps.value['text'] as WritableBinding<Object?>;

      binding.set(binding.value);

      expect(surface.dataModel.get('/val'), {
        'byIndex': {1: 'one'},
      });
    });

    test('resolves structural children', () {
      final comp = ComponentModel('c1', 'Row', {
        'children': ['child1', 'child2'],
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalRowApi().schema);

      final children =
          binder.resolvedProps.value['children'] as List<ChildNode>;
      expect(children.length, 2);
      expect(children[0].id, 'child1');
      expect(children[1].id, 'child2');
    });

    test('caps a static child id list at maxDynamicChildListSize', () {
      final comp = ComponentModel('c1', 'Row', {
        'children': [
          for (int i = 0; i < maxDynamicChildListSize + 5; i++) 'child$i',
        ],
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalRowApi().schema);

      final children =
          binder.resolvedProps.value['children'] as List<ChildNode>;
      expect(children, hasLength(maxDynamicChildListSize));
      expect(children.last.id, 'child${maxDynamicChildListSize - 1}');
    });

    test('caps a static child id list nested in array items', () {
      final comp = ComponentModel('c1', 'Groups', {
        'groups': [
          {
            'children': [
              for (int i = 0; i < maxDynamicChildListSize + 3; i++) 'child$i',
            ],
          },
        ],
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(
        context,
        Schema.object(
          properties: {
            'groups': Schema.list(
              items: Schema.object(
                properties: {'children': CommonSchemas.childList},
              ),
            ),
          },
        ),
      );

      final groups = binder.resolvedProps.value['groups'] as List;
      final children = (groups.single as Map)['children'] as List<ChildNode>;
      expect(children, hasLength(maxDynamicChildListSize));
    });

    test('resolves checkable validation', () async {
      final comp = ComponentModel('c1', 'TextField', {
        'label': 'Name',
        'checks': [
          {
            'condition': {'path': '/valid'},
            'message': 'Must be valid',
          },
        ],
      });
      surface.componentsModel.addComponent(comp);
      surface.dataModel.set('/valid', false);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalTextFieldApi().schema);

      // Wait for Timer.run in GenericBinder
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(binder.resolvedProps.value['isValid'], false);
      expect(binder.resolvedProps.value['validationErrors'], ['Must be valid']);

      surface.dataModel.set('/valid', true);
      expect(binder.resolvedProps.value['isValid'], true);
    });

    test(
      'v1.0 @path produces WritableBinding while plain path is read-only',
      () {
        final v1Surface = SurfaceModel<ComponentApi>(
          's-v1',
          defaultCatalog: catalog,
          protocolVersion: 'v1.0',
        );
        addTearDown(v1Surface.dispose);
        v1Surface.dataModel.set('/val', 'initial');

        final comp = ComponentModel('c1', 'Text', {
          'text': {'@path': '/val'},
        });
        v1Surface.componentsModel.addComponent(comp);

        final context = ComponentContext(v1Surface, comp);
        final binder = GenericBinder(context, MinimalTextApi().schema);

        final Object? binding = binder.resolvedProps.value['text'];
        expect(binding, isA<WritableBinding<Object?>>());
        final writable = binding as WritableBinding<Object?>;
        expect(writable.value, 'initial');
        expect(writable.path, '/val');

        writable.set('updated-v1');
        expect(v1Surface.dataModel.get('/val'), 'updated-v1');

        // Plain {'path': '/val'} in v1.0 is a literal map, not a WritableBinding.
        final comp2 = ComponentModel('c2', 'Text', {
          'text': {'path': '/val'},
        });
        v1Surface.componentsModel.addComponent(comp2);
        final binder2 = GenericBinder(
          ComponentContext(v1Surface, comp2),
          MinimalTextApi().schema,
        );
        final Object? plainBinding = binder2.resolvedProps.value['text'];
        expect(plainBinding, isNot(isA<WritableBinding<Object?>>()));
        expect((plainBinding as ResolvedBinding<Object?>).value, {
          'path': '/val',
        });
      },
    );

    test(
      'v1.0 local function actions execute @call and reject plain call',
      () async {
        final calls = <Map<String, dynamic>>[];
        final actions = <A2uiClientAction>[];
        final errors = <A2uiClientError>[];
        final v1Surface = SurfaceModel<ComponentApi>(
          's-v1-fn',
          protocolVersion: 'v1.0',
          defaultCatalog: Catalog<ComponentApi, FunctionImplementation>(
            id: 'test-v1',
            components: [MinimalButtonApi()],
            functions: [
              _SpyFunction('spy', (args) {
                calls.add(args);
                return null;
              }),
              _SpyFunction('failAsync', (_) async {
                await Future<void>.delayed(Duration.zero);
                throw StateError('v1 async boom');
              }),
            ],
          ),
        );
        addTearDown(v1Surface.dispose);
        v1Surface.onAction.addListener(actions.add);
        v1Surface.onError.addListener(errors.add);
        v1Surface.dataModel.set('/items/0/label', 'v1-item');

        Future<void> invokeV1Action(
          Map<String, dynamic> action, {
          String? basePath,
        }) async {
          final comp = ComponentModel('c1', 'Button', {
            'child': 'c2',
            'action': action,
          });
          v1Surface.componentsModel.removeComponent('c1');
          v1Surface.componentsModel.addComponent(comp);
          final ctx = ComponentContext(v1Surface, comp, basePath: basePath);
          final binder = GenericBinder(ctx, MinimalButtonApi().schema);
          final callback =
              binder.resolvedProps.value['action'] as Future<void> Function();
          await callback();
          binder.dispose();
        }

        await invokeV1Action({
          'functionCall': {
            '@call': 'spy',
            'args': {
              'label': {'@path': 'label'},
            },
          },
        }, basePath: '/items/0');
        expect(calls, [
          {'label': 'v1-item'},
        ]);
        expect(actions, isEmpty);
        expect(errors, isEmpty);

        calls.clear();
        await invokeV1Action({
          '@call': 'spy',
          'args': {
            'label': {'@path': 'label'},
          },
        }, basePath: '/items/0');
        expect(calls, [
          {'label': 'v1-item'},
        ]);

        // Async failure in v1.0 @call reports function name in error message.
        await invokeV1Action({
          'functionCall': {'@call': 'failAsync', 'args': <String, Object?>{}},
        });
        expect(errors, hasLength(1));
        expect(errors.single.message, contains('failAsync'));

        // Plain 'call' in v1.0 is not a function call; fails action dispatch.
        errors.clear();
        calls.clear();
        await invokeV1Action({
          'functionCall': {'call': 'spy', 'args': <String, Object?>{}},
        });
        expect(calls, isEmpty);
        expect(actions, isEmpty);
        expect(errors, hasLength(1));
        expect(errors.single.code, 'INVALID_ACTION');
      },
    );

    test('v1.0 ChildListTemplate expands items using bindingFor', () {
      final v1Surface = SurfaceModel<ComponentApi>(
        's-v1-tpl',
        defaultCatalog: catalog,
        protocolVersion: 'v1.0',
      );
      addTearDown(v1Surface.dispose);
      v1Surface.dataModel.set('/todos', [
        {'title': 'One'},
        {'title': 'Two'},
      ]);

      final comp = ComponentModel('c1', 'Row', {
        'children': {'path': '/todos', 'componentId': 'todo-item'},
      });
      v1Surface.componentsModel.addComponent(comp);

      final context = ComponentContext(v1Surface, comp);
      final binder = GenericBinder(context, MinimalRowApi().schema);

      final children =
          binder.resolvedProps.value['children'] as List<ChildNode>;
      expect(children, [
        ChildNode('todo-item', '/todos/0', index: 0),
        ChildNode('todo-item', '/todos/1', index: 1),
      ]);

      v1Surface.dataModel.set('/todos', [
        {'title': 'One'},
        {'title': 'Two'},
        {'title': 'Three'},
      ]);
      final updated = binder.resolvedProps.value['children'] as List<ChildNode>;
      expect(updated, hasLength(3));
      expect(updated[2], ChildNode('todo-item', '/todos/2', index: 2));
    });

    test(
      'reports unrecognized action payloads via onError',
      () async {
        final actions = <A2uiClientAction>[];
        final errors = <A2uiClientError>[];
        surface.onAction.addListener(actions.add);
        surface.onError.addListener(errors.add);

        final comp = ComponentModel('c1', 'Button', {
          'child': 'c2',
          'action': {'unexpected': 'payload'},
        });
        surface.componentsModel.addComponent(comp);

        final context = ComponentContext(surface, comp);
        final binder = GenericBinder(context, MinimalButtonApi().schema);
        final callback =
            binder.resolvedProps.value['action'] as Future<void> Function();
        await callback();

        expect(actions, isEmpty);
        expect(errors, hasLength(1));
        expect(errors.single.code, 'INVALID_ACTION');
        expect(errors.single.surfaceId, 's1');
      },
    );

    test('resolves dynamic binding to an action payload before dispatching',
        () async {
      final actions = <A2uiClientAction>[];
      final errors = <A2uiClientError>[];
      surface.onAction.addListener(actions.add);
      surface.onError.addListener(errors.add);
      surface.dataModel.set('/boundAction', {
        'event': {
          'name': 'bound_submit',
          'context': {'from': 'binding'},
        },
      });

      final comp = ComponentModel('c1', 'Button', {
        'child': 'c2',
        'action': {'path': '/boundAction'},
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalButtonApi().schema);
      final callback =
          binder.resolvedProps.value['action'] as Future<void> Function();
      await callback();

      expect(errors, isEmpty);
      expect(actions, hasLength(1));
      expect(actions.single.name, 'bound_submit');
      expect(actions.single.context, {'from': 'binding'});
    });
  });
}
