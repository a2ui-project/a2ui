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

// The omitted-property fixture is adapted from web_core's node-resolver suite.
// The remaining cases cover nulls, arrays, updates, and binder output in Dart.

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

Schema _groupSchema() => Schema.object(
  properties: {
    'title': CommonSchemas.dynamicString,
    'group': Schema.object(
      properties: {
        'value': CommonSchemas.dynamicString,
        'label': Schema.string(),
      },
    ),
    'items': Schema.list(
      items: Schema.object(
        properties: {
          'value': CommonSchemas.dynamicString,
          'details': Schema.object(
            properties: {'value': CommonSchemas.dynamicString},
          ),
        },
      ),
    ),
    'values': Schema.list(items: CommonSchemas.dynamicString),
    'label': Schema.string(),
    'action': CommonSchemas.action,
  },
);

typedef _Fixture = ({
  SurfaceModel<ComponentApi> surface,
  NodeResolver<ComponentApi> resolver,
  ComponentModel model,
  ComponentNode root,
});

_Fixture _setup(Map<String, dynamic> properties) {
  final catalog = Catalog<ComponentApi, FunctionImplementation>(
    id: 'absent-dynamic-catalog',
    components: [ComponentApi(name: 'Group', schema: _groupSchema())],
    functions: [],
  );
  final surface = SurfaceModel<ComponentApi>('surf-1', catalog: catalog);
  final resolver = NodeResolver<ComponentApi>(surface);
  final model = ComponentModel('root', 'Group', properties);
  surface.componentsModel.addComponent(model);
  addTearDown(() {
    resolver.dispose();
    surface.dispose();
  });
  return (
    surface: surface,
    resolver: resolver,
    model: model,
    root: resolver.rootNode.value!,
  );
}

void _expectReadOnlyNull(Object? value) {
  expect(value, isA<ResolvedBinding<Object?>>());
  expect(value, isNot(isA<WritableBinding<Object?>>()));
  expect((value as ResolvedBinding<Object?>).value, isNull);
}

void main() {
  group('NodeResolver absent dynamic properties', () {
    test('represents omitted dynamic properties as read-only bindings at '
        'every level', () {
      final _Fixture fixture = _setup({
        'group': {'label': 'x'},
      });
      final NodeProps properties = fixture.root.props.value;
      _expectReadOnlyNull(properties['title']);
      final group = properties['group'] as Map;
      _expectReadOnlyNull(group['value']);
      expect(group['label'], 'x');
      expect(fixture.root.toJson(), {
        'id': 'root',
        'type': 'Group',
        'group': {'label': 'x', 'value': null},
        'title': null,
      });
    });

    test('wraps explicit null dynamic values in nested objects and arrays', () {
      final _Fixture fixture = _setup({
        'title': null,
        'group': {'value': null},
        'items': [
          {'value': null, 'details': <String, Object?>{}},
          {
            'details': {'value': null},
          },
        ],
        'values': [null, 'literal'],
      });
      final NodeProps properties = fixture.root.props.value;
      _expectReadOnlyNull(properties['title']);
      _expectReadOnlyNull((properties['group'] as Map)['value']);
      for (final item in properties['items'] as List) {
        final map = item as Map;
        _expectReadOnlyNull(map['value']);
        _expectReadOnlyNull((map['details'] as Map)['value']);
      }
      final values = properties['values'] as List;
      _expectReadOnlyNull(values[0]);
      expect((values[1] as ResolvedBinding<Object?>).value, 'literal');
    });

    test('does not invent omitted or null non-dynamic containers', () {
      final _Fixture fixture = _setup({});
      expect(fixture.root.props.value.keys, ['title']);
      _expectReadOnlyNull(fixture.root.props.value['title']);

      fixture.model.properties = {
        'group': null,
        'items': null,
        'values': null,
        'label': null,
        'action': null,
      };
      final NodeProps properties = fixture.root.props.value;
      for (final key in ['group', 'items', 'values', 'label', 'action']) {
        expect(properties.containsKey(key), isTrue, reason: key);
        expect(properties[key], isNull, reason: key);
      }
      _expectReadOnlyNull(properties['title']);

      fixture.model.properties = {
        'items': [null],
      };
      expect(fixture.root.props.value['items'], [null]);
      expect(fixture.root.props.value.containsKey('group'), isFalse);
    });

    test(
      'keeps missing path values writable at every existing nesting level',
      () {
        final _Fixture fixture = _setup({
          'title': {'path': '/missing'},
          'group': {
            'value': {'path': '/missing'},
          },
          'items': [
            {
              'value': {'path': '/missing'},
            },
          ],
        });
        final NodeProps properties = fixture.root.props.value;
        final bindings = <Object?>[
          properties['title'],
          (properties['group'] as Map)['value'],
          ((properties['items'] as List).single as Map)['value'],
        ];
        for (final binding in bindings) {
          expect(binding, isA<WritableBinding<Object?>>());
          final writable = binding as WritableBinding<Object?>;
          expect(writable.value, isNull);
          expect(writable.path, '/missing');
        }
        (bindings.last as WritableBinding<Object?>).set('written');
        expect(fixture.surface.dataModel.get('/missing'), 'written');
        expect(
          (fixture.root.props.value['title'] as WritableBinding<Object?>).value,
          'written',
        );
        expect((bindings.first as WritableBinding<Object?>).value, isNull);
      },
    );

    test(
      'updates null bindings coherently and releases replaced data bindings',
      () {
        final _Fixture fixture = _setup({
          'title': {'path': '/old'},
          'group': {
            'value': {'path': '/old'},
          },
        });
        final seen = <NodeProps>[];
        final void Function() unsubscribe = fixture.root.props.subscribe(
          seen.add,
        );
        addTearDown(unsubscribe);
        seen.clear();

        fixture.model.properties = {
          'title': null,
          'group': <String, Object?>{},
        };
        expect(seen, hasLength(1));
        _expectReadOnlyNull(seen.single['title']);
        _expectReadOnlyNull((seen.single['group'] as Map)['value']);
        fixture.surface.dataModel.set('/old', 'no longer bound');
        expect(seen, hasLength(1));

        fixture.model.properties = {
          'title': 'literal',
          'group': {'value': 'literal'},
        };
        expect(seen, hasLength(2));
        expect(
          (seen.last['title'] as ResolvedBinding<Object?>).value,
          'literal',
        );
        fixture.model.properties = {
          'title': {'path': '/new'},
          'group': {
            'value': {'path': '/new'},
          },
        };
        expect(seen, hasLength(3));
        final writable = seen.last['title'] as WritableBinding<Object?>;
        expect(writable.value, isNull);
        writable.set('next');
        expect(
          (fixture.root.props.value['title'] as WritableBinding<Object?>).value,
          'next',
        );
        expect(
          ((fixture.root.props.value['group'] as Map)['value']
                  as WritableBinding<Object?>)
              .value,
          'next',
        );
        _expectReadOnlyNull(seen.first['title']);
        expect(
          () => (seen.first['group'] as Map)['value'] = null,
          throwsUnsupportedError,
        );
      },
    );

    test(
      'suppresses unchanged emissions when omission and literal null alternate',
      () {
        final _Fixture fixture = _setup({
          'group': <String, Object?>{},
          'items': [<String, Object?>{}],
        });
        final NodeProps before = fixture.root.props.value;
        var emissions = 0;
        final void Function() unsubscribe = fixture.root.props.subscribe(
          (_) => emissions++,
        );
        addTearDown(unsubscribe);
        emissions = 0;

        fixture.model.properties = {
          'title': null,
          'group': {'value': null},
          'items': [
            {'value': null},
          ],
        };
        expect(emissions, 0);
        expect(identical(fixture.root.props.value, before), isTrue);
        fixture.model.properties = {
          'group': <String, Object?>{},
          'items': [<String, Object?>{}],
        };
        expect(emissions, 0);
        expect(identical(fixture.root.props.value, before), isTrue);

        fixture.model.properties = {
          'group': {'label': 'changed'},
          'items': [<String, Object?>{}],
        };
        expect(emissions, 1);
        expect(
          identical(fixture.root.props.value['title'], before['title']),
          isTrue,
        );
        expect(
          identical(fixture.root.props.value['items'], before['items']),
          isTrue,
        );
      },
    );

    test(
      'publishes the same missing and null wrapper contract from the binder',
      () {
        final _Fixture fixture = _setup({
          'title': null,
          'group': <String, Object?>{},
          'items': [<String, Object?>{}],
          'values': [null],
        });
        final binder = GenericBinder(
          ComponentContext(fixture.surface, fixture.model),
          _groupSchema(),
        );
        addTearDown(binder.dispose);
        final Map<String, dynamic> properties = binder.resolvedProps.value;
        _expectReadOnlyNull(properties['title']);
        _expectReadOnlyNull((properties['group'] as Map)['value']);
        _expectReadOnlyNull(
          ((properties['items'] as List).single as Map)['value'],
        );
        _expectReadOnlyNull((properties['values'] as List).single);
        fixture.model.properties = {};
        expect(binder.resolvedProps.value.keys, ['title']);
        _expectReadOnlyNull(binder.resolvedProps.value['title']);
      },
    );
  });
}
