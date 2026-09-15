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
import 'package:a2ui_core/src/resolution/ref_fields.dart';
import 'package:a2ui_core/src/validation/component_refs.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

const Map<String, Object?> _single = {
  r'$ref': r'common_types.json#/$defs/ComponentId',
};
const Map<String, Object?> _list = {
  r'$ref': r'common_types.json#/$defs/ChildList',
};
const Map<String, Object?> _template = {
  'type': 'object',
  'properties': {
    'componentId': {'type': 'string'},
    'path': {'type': 'string'},
  },
};

Catalog<ComponentApi, FunctionImplementation> _catalog(
  Map<String, Object?> schema,
) => Catalog<ComponentApi, FunctionImplementation>(
  id: 'references',
  components: [
    ComponentApi(name: 'Parent', schema: Schema.fromMap(schema)),
    ComponentApi(name: 'Leaf', schema: Schema.object()),
  ],
);

void _expectFields(
  Map<String, Object?> schema, {
  Set<String> single = const {},
  Set<String> list = const {},
  Map<String, Set<String>> nested = const {},
}) {
  final Catalog<ComponentApi, FunctionImplementation> catalog = _catalog(
    schema,
  );
  final RefFields resolution = extractRefFields(
    catalog.components['Parent']!.schema,
    document: catalog.catalogSchema,
  );
  final ComponentRefFields? validation = extractComponentRefFields(
    catalog,
  )['Parent'];
  expect(validation?.single ?? <String>{}, single);
  expect(validation?.list ?? <String>{}, {...list, ...nested.keys});
  expect(validation?.nested ?? <String, Set<String>>{}, nested);
  expect(resolution.keys.toSet(), {...single, ...list, ...nested.keys});
  for (final key in single) {
    expect(resolution[key], isA<SingleRef>());
  }
  for (final key in list) {
    expect(resolution[key], isA<ListRef>());
  }
  for (final MapEntry<String, Set<String>> entry in nested.entries) {
    expect(
      (resolution[entry.key]! as NestedRef).fields.keys.toSet(),
      entry.value,
    );
  }
}

void main() {
  group('shared reference schemas', () {
    for (final (label, single, list)
        in <(String, Map<String, Object?>, Map<String, Object?>)>[
          ('wire pointers', _single, _list),
          (
            'local common-type pointers',
            {r'$ref': r'#/$defs/ComponentId'},
            {r'$ref': r'#/$defs/ChildList'},
          ),
          (
            'absolute wire pointers',
            {r'$ref': r'https://example.test/types#/$defs/ComponentId'},
            {r'$ref': r'https://example.test/types#/$defs/ChildList'},
          ),
          (
            'description markers',
            {'description': r'REF:common_types.json#/$defs/ComponentId|Child'},
            {'description': r'REF:common_types.json#/$defs/ChildList|Children'},
          ),
        ]) {
      test('validation and resolution agree on $label', () {
        _expectFields(
          {
            'type': 'object',
            'properties': {'child': single, 'children': list},
          },
          single: {'child'},
          list: {'children'},
        );
      });
    }

    for (final keyword in ['allOf', 'anyOf', 'oneOf']) {
      test('finds references through $keyword at each supported position', () {
        _expectFields(
          {
            keyword: [
              {
                'properties': {
                  'child': {
                    keyword: [_single],
                  },
                  'children': {
                    keyword: [_list],
                  },
                  'ids': {
                    keyword: [
                      {
                        'type': 'array',
                        'items': {
                          keyword: [_single],
                        },
                      },
                    ],
                  },
                  'tabs': {
                    keyword: [
                      {
                        'type': 'array',
                        'items': {
                          keyword: [
                            {
                              'properties': {
                                'child': {
                                  keyword: [_single],
                                },
                                'title': {'type': 'string'},
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
              {
                'properties': {
                  'child': {'type': 'string', 'minLength': 1},
                },
              },
            ],
          },
          single: {'child'},
          list: {'children', 'ids'},
          nested: {
            'tabs': {'child'},
          },
        );
      });
    }

    test('recognizes structural lists without description markers', () {
      _expectFields(
        {
          'properties': {
            'children': {
              'anyOf': [
                {
                  'type': 'array',
                  'items': {'type': 'string'},
                },
                _template,
              ],
            },
          },
        },
        list: {'children'},
      );
    });

    test('excludes self properties and unmarked strings', () {
      _expectFields({
        'properties': {
          'id': _single,
          'component': _single,
          'title': {'type': 'string'},
          'nearMarker': {
            'description': r'REF:common_types.json#/$defs/ComponentIdSuffix',
          },
        },
      });
    });

    test('retains component-local definitions across combinator branches', () {
      _expectFields(
        {
          r'$defs': {
            'child/alias~': _single,
            'children': _list,
            'properties': {
              'properties': {
                'child': {r'$ref': r'#/$defs/child~1alias~0'},
                'children': {r'$ref': r'#/$defs/children'},
              },
            },
          },
          'allOf': [
            {r'$ref': r'#/$defs/properties'},
          ],
        },
        single: {'child'},
        list: {'children'},
      );
    });

    test('local definitions take precedence over catalog definitions', () {
      final schema = Schema.fromMap({
        r'$defs': {'alias': _single},
        'properties': {
          'child': {r'$ref': r'#/$defs/alias'},
        },
      });
      final RefFields fields = extractRefFields(
        schema,
        document: {
          r'$defs': {'alias': _list},
        },
      );
      expect(fields['child'], isA<SingleRef>());
    });

    test('same schema is classified in its own catalog context', () {
      final schema = Schema.fromMap({
        'properties': {
          'child': {r'$ref': r'#/$defs/alias'},
        },
      });
      expect(
        extractRefFields(
          schema,
          document: {
            r'$defs': {'alias': _single},
          },
        )['child'],
        isA<SingleRef>(),
      );
      expect(
        extractRefFields(
          schema,
          document: {
            r'$defs': {'alias': _list},
          },
        )['child'],
        isA<ListRef>(),
      );
    });

    test('bounds cyclic local aliases and combinators', () {
      _expectFields(
        {
          r'$defs': {
            'a': {r'$ref': r'#/$defs/b'},
            'b': {
              'oneOf': [
                {r'$ref': r'#/$defs/a'},
                _single,
              ],
            },
          },
          'properties': {
            'child': {r'$ref': r'#/$defs/a'},
            'missing': {r'$ref': r'#/$defs/notFound'},
          },
        },
        single: {'child'},
      );
    });

    test(
      'validation checks nested list fields without treating labels as ids',
      () {
        final Catalog<ComponentApi, FunctionImplementation> catalog = _catalog({
          'properties': {
            'groups': {
              'type': 'array',
              'items': {
                'properties': {
                  'children': _list,
                  'label': {'type': 'string'},
                },
              },
            },
          },
        });
        final ComponentRefFields fields = extractComponentRefFields(
          catalog,
        )['Parent']!;
        final List<ComponentReference> refs = componentReferences({
          'groups': [
            {
              'children': ['a', 'b'],
              'label': 'not-an-id',
            },
            {
              'children': {'componentId': 'template', 'path': '/data'},
            },
          ],
        }, fields).toList();
        expect(refs.map((r) => r.id), ['a', 'b', 'template']);
        expect(refs.map((r) => r.field), [
          'groups[0].children[0]',
          'groups[0].children[1]',
          'groups[1].children.componentId',
        ]);
      },
    );
  });
}
