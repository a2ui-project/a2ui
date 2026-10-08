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
import 'package:a2ui_core/src/core/contexts.dart' show ComponentContext;
import 'package:a2ui_core/src/rendering/binder.dart' show GenericBinder;
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

void main() {
  group('GenericBinder lifecycle', () {
    late MinimalCatalog catalog;
    late SurfaceModel<ComponentApi> surface;

    setUp(() {
      catalog = MinimalCatalog();
      surface = SurfaceModel('s1', defaultCatalog: catalog);
    });

    test('rebuilds multiple dynamic properties in one coherent emission', () {
      final comp = ComponentModel('pair', 'Pair', {'a': 'old', 'b': 'old'});
      surface.componentsModel.addComponent(comp);
      final schema = Schema.object(
        properties: {
          'a': CommonSchemas.dynamicString,
          'b': CommonSchemas.dynamicString,
        },
      );
      final binder = GenericBinder(ComponentContext(surface, comp), schema);
      final snapshots = <Map<String, Object?>>[];
      final void Function() unsubscribe = binder.resolvedProps.subscribe((
        properties,
      ) {
        snapshots.add({
          'a': (properties['a'] as ResolvedBinding<Object?>).value,
          'b': (properties['b'] as ResolvedBinding<Object?>).value,
        });
      });
      addTearDown(() {
        unsubscribe();
        binder.dispose();
        surface.dispose();
      });
      snapshots.clear();

      comp.properties = {'a': 'new', 'b': 'new'};

      expect(snapshots, [
        {'a': 'new', 'b': 'new'},
      ]);
    });

    for (final wrapInList in [false, true]) {
      test(
          'preserves emitted ${wrapInList ? 'list' : 'map'} binding snapshots '
          'across descendant writes', () {
        Object? expected(String value) {
          final item = {
            'items': [
              {'value': value},
            ],
          };
          return wrapInList ? [item] : item;
        }

        final comp = ComponentModel('c1', 'Container', {
          'value': {'path': '/value'},
        });
        surface.componentsModel.addComponent(comp);
        surface.dataModel.set('/value', expected('initial'));
        final schema = Schema.object(
          properties: {
            'value': Schema.combined(
              anyOf: [
                Schema.object(additionalProperties: true),
                Schema.list(items: Schema.object(additionalProperties: true)),
                CommonSchemas.dataBinding,
              ],
            ),
          },
        );
        final binder = GenericBinder(ComponentContext(surface, comp), schema);
        final snapshots = <ResolvedBinding<Object?>>[];
        final void Function() unsubscribe = binder.resolvedProps.subscribe((
          props,
        ) {
          snapshots.add(props['value'] as ResolvedBinding<Object?>);
        });
        addTearDown(() {
          unsubscribe();
          binder.dispose();
          surface.dispose();
        });

        final writePath = '/value/${wrapInList ? '0/' : ''}items/0/value';
        surface.dataModel.set(writePath, 'first');
        expect(snapshots, hasLength(2));
        expect(snapshots[0].value, expected('initial'));
        expect(snapshots[1].value, expected('first'));

        surface.dataModel.set(writePath, 'second');
        expect(snapshots, hasLength(3));
        expect(snapshots[0].value, expected('initial'));
        expect(snapshots[1].value, expected('first'));
        expect(snapshots[2].value, expected('second'));

        for (final snapshot in snapshots) {
          final Object? value = snapshot.value;
          if (value is List) expect(value.clear, throwsUnsupportedError);
          final item = (value is List ? value.single : value) as Map;
          final items = item['items'] as List;
          expect(item.clear, throwsUnsupportedError);
          expect(items.clear, throwsUnsupportedError);
          expect((items.single as Map).clear, throwsUnsupportedError);
        }
        (snapshots.last as WritableBinding<Object?>).set(expected('written'));
        expect(snapshots.last.value, expected('written'));
      });
    }

    test('dispose stops reacting to data model changes', () {
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

      binder.dispose();

      surface.dataModel.set('/val', 'updated');
      expect(
        (binder.resolvedProps.value['text'] as ResolvedBinding<Object?>).value,
        'initial',
        reason: 'binder should not react after dispose',
      );
    });

    test(
      'disposal inside a rebuild releases acquired subscriptions and is final',
      () {
        var calls = 0;
        late GenericBinder binder;
        final trackingCatalog = _TrackingCatalog(
          onExecute: () {
            calls++;
            if (calls == 2) binder.dispose();
          },
        );
        final trackingSurface = SurfaceModel<ComponentApi>(
          's',
          defaultCatalog: trackingCatalog,
        );
        final comp = ComponentModel('pair', 'Pair', {
          'a': 'old',
          'b': 'old',
          'c': 'old',
        });
        trackingSurface.componentsModel.addComponent(comp);
        binder = GenericBinder(
          ComponentContext(trackingSurface, comp),
          Schema.object(
            properties: {
              'a': CommonSchemas.dynamicString,
              'b': CommonSchemas.dynamicString,
              'c': CommonSchemas.dynamicString,
            },
          ),
        );
        addTearDown(() {
          binder.dispose();
          trackingSurface.dispose();
        });
        Map<String, Object?> expression(String path) => {
              'call': 'trackingFn',
              'args': {
                'value': {'path': path},
              },
              'returnType': 'string',
            };

        comp.properties = {
          'a': expression('/a'),
          'b': expression('/b'),
          'c': expression('/c'),
        };

        expect(
          calls,
          2,
          reason: 'binding must stop when disposal interrupts acquisition',
        );
        for (final path in ['/a', '/b', '/c']) {
          trackingSurface.dataModel.set(path, 'changed');
        }
        expect(
          calls,
          2,
          reason:
              'neither earlier nor interrupted subscriptions may remain live',
        );
        binder.connect();
        comp.properties = {'a': expression('/a')};
        binder.dispose();
        trackingSurface.dataModel.set('/a', 'again');
        expect(
          calls,
          2,
          reason: 'connect and dispose cannot reactivate a disposed binder',
        );
      },
    );

    test(
        'rebuilding bindings disposes old ComputedNotifiers '
        'from function calls', () {
      var callCount = 0;
      final trackingCatalog = _TrackingCatalog(onExecute: () => callCount++);
      final trackingSurface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: trackingCatalog,
      );

      final comp = ComponentModel('c1', 'Text', {
        'text': {
          'call': 'trackingFn',
          'args': {
            'value': {'path': '/val'},
          },
          'returnType': 'any',
        },
      });
      trackingSurface.componentsModel.addComponent(comp);
      trackingSurface.dataModel.set('/val', 'a');

      final context = ComponentContext(trackingSurface, comp);
      final binder = GenericBinder(context, MinimalTextApi().schema);

      // Trigger a rebuild by updating component properties.
      comp.properties = {
        'text': {
          'call': 'trackingFn',
          'args': {
            'value': {'path': '/val'},
          },
          'returnType': 'any',
        },
      };

      // Now update the data model. If old ComputedNotifiers leaked,
      // the function will be called more than once.
      callCount = 0;
      trackingSurface.dataModel.set('/val', 'b');

      expect(
        callCount,
        1,
        reason: 'Old ComputedNotifiers should be disposed '
            'after rebuild, but function was called '
            '$callCount times',
      );

      binder.dispose();
    });
    test('construction resolves function-call properties exactly once', () {
      var callCount = 0;
      final trackingCatalog = _TrackingCatalog(onExecute: () => callCount++);
      final trackingSurface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: trackingCatalog,
      );

      final comp = ComponentModel('c1', 'Text', {
        'text': {
          'call': 'trackingFn',
          'args': {
            'value': {'path': '/val'},
          },
          'returnType': 'any',
        },
      });
      trackingSurface.componentsModel.addComponent(comp);
      trackingSurface.dataModel.set('/val', 'hello');

      callCount = 0;
      final context = ComponentContext(trackingSurface, comp);
      GenericBinder(context, MinimalTextApi().schema);

      expect(
        callCount,
        1,
        reason: 'Function should be evaluated once during '
            'construction, not $callCount times',
      );
    });

    test(
      'checks conditions evaluate once on initial bind and once per dependency '
      'change without writing to stale resolvedProps during rebuild',
      () {
        var checkCallCount = 0;
        final trackingCatalog = _TrackingCatalog(
          onExecute: () => checkCallCount++,
        );
        final trackingSurface = SurfaceModel<ComponentApi>(
          's1',
          defaultCatalog: trackingCatalog,
        );

        final comp = ComponentModel('c1', 'TextField', {
          'label': {'path': '/label'},
          'checks': [
            {
              'condition': {
                'call': 'trackingCheckFn',
                'args': {
                  'value': {'path': '/val'},
                },
                'returnType': 'boolean',
              },
              'message': 'Value must be valid',
            },
          ],
        });
        trackingSurface.componentsModel.addComponent(comp);
        trackingSurface.dataModel.set('/label', 'Initial label');
        trackingSurface.dataModel.set('/val', 'bad');

        checkCallCount = 0;
        final context = ComponentContext(trackingSurface, comp);
        final binder = GenericBinder(context, MinimalTextFieldApi().schema);
        addTearDown(binder.dispose);

        expect(
          checkCallCount,
          1,
          reason: 'Checks condition should be evaluated exactly once on '
              'initial bind, not $checkCallCount times',
        );
        expect(binder.resolvedProps.value['isValid'], isFalse);
        expect(binder.resolvedProps.value['validationErrors'], [
          'Value must be valid',
        ]);

        // Listen for resolvedProps emissions during a component model rebuild:
        // _rebuildAllBindings must emit only the final rebuilt map, never
        // intermediate partial mutations on the stale _resolvedProps map.
        final emissions = <Map<String, dynamic>>[];
        final void Function() unsub = binder.resolvedProps.subscribe(
          emissions.add,
        );
        addTearDown(unsub);
        emissions.clear();

        // Trigger adependency change: should evaluate once more.
        trackingSurface.dataModel.set('/val', 'good');
        expect(
          checkCallCount,
          2,
          reason: 'Checks condition should evaluate once per dependency change',
        );
        expect(binder.resolvedProps.value['isValid'], isTrue);
        expect(binder.resolvedProps.value['validationErrors'], isEmpty);
        expect(emissions, hasLength(1));

        // Trigger a full component model rebuild (_rebuildAllBindings).
        emissions.clear();
        comp.properties = {
          'label': {'path': '/label'},
          'checks': [
            {
              'condition': {
                'call': 'trackingCheckFn',
                'args': {
                  'value': {'path': '/val'},
                },
                'returnType': 'boolean',
              },
              'message': 'Value must be valid',
            },
          ],
        };
        expect(
          checkCallCount,
          3,
          reason: 'Rebuild should evaluate checks condition once',
        );
        expect(
          emissions,
          hasLength(1),
          reason: 'Rebuild must emit once when replacing _resolvedProps.value, '
              'not mutate stale _resolvedProps during subscription setup',
        );
      },
    );
  });
}

class _TrackingCatalog extends MinimalCatalog {
  _TrackingCatalog({required this.onExecute}) {
    functions['trackingFn'] = _TrackingFunction(onExecute);
    functions['trackingCheckFn'] = _TrackingCheckFunction(onExecute);
  }

  final void Function() onExecute;
}

class _TrackingCheckFunction extends FunctionImplementation {
  final void Function() _onExecute;

  _TrackingCheckFunction(this._onExecute)
      : super(
          name: 'trackingCheckFn',
          returnType: A2uiReturnType.boolean,
          argumentSchema: Schema.object(
            properties: {'value': CommonSchemas.dynamicString},
            required: ['value'],
          ),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    _onExecute();
    return args['value'] == 'good';
  }
}

class _TrackingFunction extends FunctionImplementation {
  final void Function() _onExecute;

  _TrackingFunction(this._onExecute)
      : super(
          name: 'trackingFn',
          argumentSchema: Schema.object(
            properties: {'value': CommonSchemas.dynamicString},
            required: ['value'],
          ),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    _onExecute();
    return args['value']?.toString() ?? '';
  }
}
