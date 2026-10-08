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
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

const _commonTypes = 'https://a2ui.org/specification/v0_9/common_types.json';

final _dynamicNumber = Schema.fromMap({
  r'$ref': '$_commonTypes#/\$defs/DynamicNumber',
});

final _probe = ComponentImplementation(
  name: 'Probe',
  schema: Schema.object(
    properties: {
      'text': CommonSchemas.dynamicString,
      'flag': CommonSchemas.dynamicBoolean,
      'count': _dynamicNumber,
      'variant': Schema.string(),
      'tags': Schema.list(items: Schema.string()),
      'tabs': Schema.list(
        items: Schema.object(
          properties: {
            'title': CommonSchemas.dynamicString,
            'child': CommonSchemas.componentId,
          },
        ),
      ),
      'action': CommonSchemas.action,
      'child': CommonSchemas.componentId,
      'children': CommonSchemas.childList,
      'checks': Schema.list(
        items: Schema.object(
          properties: {
            'condition': CommonSchemas.dynamicBoolean,
            'message': Schema.string(),
          },
        ),
      ),
    },
  ),
  builder: (context, node, props, buildChild) => const SizedBox(),
);

final _leaf = ComponentImplementation(
  name: 'Leaf',
  schema: Schema.object(properties: {}),
  builder: (context, node, props, buildChild) => const SizedBox(),
);

/// Resolves [properties] as the root `Probe` of a fresh surface and returns
/// its props.
ComponentProps _resolve(
  Map<String, Object?> properties, {
  Map<String, Object?> data = const {},
}) {
  final surface = SurfaceModel<ComponentImplementation>(
    's',
    defaultCatalog: WidgetCatalog(id: 'test', components: [_probe, _leaf]),
  );
  addTearDown(surface.dispose);
  surface.dataModel.set('/', Map<String, Object?>.of(data));
  surface.componentsModel.addComponent(
    ComponentModel('root', 'Probe', properties),
  );
  for (final id in ['a', 'b']) {
    surface.componentsModel.addComponent(ComponentModel(id, 'Leaf', {}));
  }
  final resolver = NodeResolver<ComponentImplementation>(surface);
  addTearDown(resolver.dispose);
  return ComponentProps(resolver.rootNode.peek()!.props.peek());
}

void main() {
  group('ComponentProps on resolved props', () {
    test('reads a literal dynamic string through its binding', () {
      final ComponentProps props = _resolve({'text': 'Hello'});

      expect(props['text'], isA<ResolvedBinding<Object?>>());
      expect(props.string('text'), 'Hello');
      expect(props.value('text'), 'Hello');
      expect(props.writable('text'), isNull);
    });

    test('reads a path binding and exposes it as writable', () {
      final ComponentProps props = _resolve(
        {
          'text': {'path': '/name'},
        },
        data: {'name': 'Ada'},
      );

      expect(props.string('text'), 'Ada');
      expect(props.writable('text'), isA<WritableBinding<Object?>>());
      expect(props.writable('text')!.path, '/name');
    });

    test('gives null for an omitted dynamic property', () {
      final ComponentProps props = _resolve({});

      expect(props['text'], const ResolvedBinding<Object?>(null));
      expect(props.string('text'), isNull);
      expect(props.boolean('flag'), isNull);
      expect(props.number('count'), isNull);
    });

    test('reads numbers and booleans', () {
      final ComponentProps props = _resolve(
        {
          'count': {'path': '/count'},
          'flag': true,
        },
        data: {'count': 3},
      );

      expect(props.number('count'), 3.0);
      expect(props.boolean('flag'), isTrue);
      expect(props.writable('count'), isNotNull);
    });

    test('reads a static property as its literal', () {
      final ComponentProps props = _resolve({
        'variant': 'h1',
        'tags': ['x', 'y'],
      });

      expect(props.string('variant'), 'h1');
      expect(props.list('tags'), ['x', 'y']);
    });

    test('reads a bound list', () {
      final ComponentProps props = _resolve(
        {
          'text': {'path': '/tags'},
        },
        data: {
          'tags': ['x', 'y'],
        },
      );

      expect(props.list('text'), ['x', 'y']);
      expect(props.string('text'), isNull);
    });

    test('returns the action closure', () {
      final ComponentProps props = _resolve({
        'action': {
          'event': {'name': 'go'},
        },
      });

      expect(props.action('action'), isNotNull);
      expect(props.action('text'), isNull);
    });

    test('returns child nodes and skips other items', () {
      final ComponentProps props = _resolve({
        'child': 'a',
        'children': ['a', 'b'],
      });

      expect(props.child('child')?.componentId, 'a');
      expect(props.children('children').map((n) => n.componentId), ['a', 'b']);
      expect(props.child('children'), isNull);
      expect(props.children('child'), isEmpty);
    });

    test('unwraps bindings nested in a list of objects', () {
      final ComponentProps props = _resolve(
        {
          'tabs': [
            {
              'title': {'path': '/title'},
              'child': 'a',
            },
          ],
        },
        data: {'title': 'First'},
      );

      final tab = props.list('tabs').single! as Map<Object?, Object?>;
      expect(ComponentProps.asString(tab['title']), 'First');
      expect(tab['child'], isA<ComponentNode<ComponentImplementation>>());
    });

    test('reports checks', () {
      final ComponentProps props = _resolve(
        {
          'checks': [
            {
              'condition': {'path': '/ok'},
              'message': 'Must be ok',
            },
          ],
        },
        data: {'ok': false},
      );

      expect(props.isValid, isFalse);
      expect(props.validationErrors, ['Must be ok']);
    });

    test('is valid without checks', () {
      final ComponentProps props = _resolve({});

      expect(props.containsKey('isValid'), isFalse);
      expect(props.isValid, isTrue);
      expect(props.validationErrors, isEmpty);
    });
  });

  group('ComponentProps on other shapes', () {
    const props = ComponentProps({
      'map': {'a': 1},
      'list': [1, 'x'],
      'string': 'text',
      'callback': _voidCallback,
      'node': 'a',
      'children': ['a', 'b'],
      'isValid': 'no',
      'validationErrors': ['First', 2, null],
    });

    test('never throws on a mismatched shape', () {
      expect(props.string('map'), isNull);
      expect(props.string('list'), isNull);
      expect(props.number('string'), isNull);
      expect(props.boolean('string'), isNull);
      expect(props.list('string'), isEmpty);
      expect(props.writable('string'), isNull);
      expect(props.action('callback'), isNull);
      expect(props.child('node'), isNull);
      expect(props.children('children'), isEmpty);
      expect(props.string('missing'), isNull);
      expect(props.list('missing'), isEmpty);
    });

    test('treats anything but false as valid', () {
      expect(props.isValid, isTrue);
      expect(const ComponentProps({'isValid': false}).isValid, isFalse);
    });

    test('keeps only string validation errors', () {
      expect(props.validationErrors, ['First']);
    });
  });

  group('ComponentProps.asString', () {
    test('converts numbers the way JavaScript String() does', () {
      expect(ComponentProps.asString(3), '3');
      expect(ComponentProps.asString(3.0), '3');
      expect(ComponentProps.asString(-3.0), '-3');
      expect(ComponentProps.asString(-0.0), '0');
      expect(ComponentProps.asString(2.5), '2.5');
      expect(ComponentProps.asString(0.1), '0.1');
      expect(ComponentProps.asString(1e20), '100000000000000000000');
      expect(ComponentProps.asString(1e21), '1e+21');
      expect(ComponentProps.asString(double.nan), 'NaN');
      expect(ComponentProps.asString(double.infinity), 'Infinity');
    });

    test('converts booleans and leaves collections unconverted', () {
      expect(ComponentProps.asString(true), 'true');
      expect(
        ComponentProps.asString(const ResolvedBinding<Object?>(false)),
        'false',
      );
      expect(ComponentProps.asString(const <Object?>[]), isNull);
      expect(ComponentProps.asString(const <String, Object?>{}), isNull);
      expect(ComponentProps.asString(null), isNull);
    });
  });
}

void _voidCallback() {}
