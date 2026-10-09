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
import 'package:a2ui_core/src/primitives/reference_schema.dart';
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
const Map<String, Object?> _child = {
  r'$ref': r'common_types.json#/$defs/Child',
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
) =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: 'references',
      // `Child` is a v1.0 common type.
      protocolVersion: A2uiProtocolVersion.v1_0,
      components: [
        ComponentApi(name: 'Parent', schema: Schema.fromMap(schema)),
        ComponentApi(name: 'Leaf', schema: Schema.object()),
      ],
    );

Catalog<ComponentApi, FunctionImplementation> _wireCatalog(
  Map<String, Object?> schema, {
  Map<String, Object?> definitions = const {},
}) {
  final CatalogApi parsed = Catalog.fromJson({
    'catalogId': 'wire-references',
    // `Child` is a v1.0 common type.
    'protocolVersion': 'v1.0',
    r'$defs': definitions,
    'components': {
      'Parent': schema,
      'Leaf': {'type': 'object'},
    },
  });
  // Function implementations are attached by renderer catalogs; this catalog
  // has no functions.
  return Catalog<ComponentApi, FunctionImplementation>(
    id: parsed.id,
    protocolVersion: parsed.protocolVersion,
    components: parsed.components.values.toList(),
  );
}

typedef _Fixture = ({
  SurfaceModel<ComponentApi> surface,
  NodeResolver<ComponentApi> resolver,
});

void _add(
  SurfaceModel<ComponentApi> surface,
  String id,
  String type,
  Map<String, Object?> properties,
) =>
    surface.componentsModel.addComponent(ComponentModel(id, type, properties));

_Fixture _fixture(Catalog<ComponentApi, FunctionImplementation> catalog) {
  final surface = SurfaceModel<ComponentApi>('s', defaultCatalog: catalog);
  final resolver = NodeResolver<ComponentApi>(surface);
  addTearDown(() {
    resolver.dispose();
    surface.dispose();
  });
  _add(surface, 'leaf', 'Leaf', {});
  return (surface: surface, resolver: resolver);
}

void _expectFields(
  Map<String, Object?> schema, {
  Set<String> single = const {},
  Set<String> list = const {},
  Map<String, Set<String>> nested = const {},
  // Properties the resolver classifies as child lists but graph validation
  // deliberately ignores, because only the resolver guesses at unmarked
  // structural templates.
  Set<String> resolutionOnlyList = const {},
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
  expect(resolution.keys.toSet(), {
    ...single,
    ...list,
    ...nested.keys,
    ...resolutionOnlyList,
  });
  for (final key in single) {
    expect(resolution[key], isA<SingleRef>());
  }
  for (final key in {...list, ...resolutionOnlyList}) {
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
        'commonTypesRef metadata markers',
        {
          'commonTypesRef': r'common_types.json#/$defs/ComponentId',
          'description': 'Child'
        },
        {
          'commonTypesRef': r'common_types.json#/$defs/ChildList',
          'description': 'Children'
        },
      ),
      ('v1.0 Child wire pointers', _child, _list),
      (
        'v1.0 local Child pointers',
        {r'$ref': r'#/$defs/Child'},
        {r'$ref': r'#/$defs/ChildList'},
      ),
      (
        'v1.0 Child description markers',
        {'description': r'REF:common_types.json#/$defs/Child|Child'},
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
      // The resolver has to guess here, or a catalog that declares a template
      // without a marker never mounts its children. Graph validation does not
      // guess: see the note on extractComponentRefFields.
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
        resolutionOnlyList: {'children'},
      );
    });

    for (final (label, itemRef) in <(String, Map<String, Object?>)>[
      ('ComponentId', _single),
      ('v1.0 Child', _child),
    ]) {
      test('an inlined ChildList with $label items is a validated list', () {
        // The template branch alone is only a guess, but an array of marked
        // ids in a sibling branch identifies the property as a child list,
        // so graph validation checks it too.
        _expectFields(
          {
            'properties': {
              'children': {
                'oneOf': [
                  {'type': 'array', 'items': itemRef},
                  {
                    'type': 'object',
                    'properties': {
                      'componentId': itemRef,
                      'path': {'type': 'string'},
                    },
                    'required': ['componentId', 'path'],
                    'additionalProperties': false,
                  },
                ],
              },
            },
          },
          list: {'children'},
        );
      });
    }

    test(
        'graph validation does not infer references from an unmarked '
        'componentId-and-path object', () {
      // Validation rejects a whole batch, so it keeps to what the catalog
      // marks rather than what a schema resembles.
      final Catalog<ComponentApi, FunctionImplementation> catalog = _catalog({
        'properties': {
          'auditRecord': {
            'type': 'object',
            'properties': {
              'componentId': {'type': 'string'},
              'path': {'type': 'string'},
              'recordedAt': {'type': 'string'},
            },
          },
        },
      });
      expect(extractComponentRefFields(catalog), isNot(contains('Parent')));
    });

    test('excludes self properties and unmarked strings', () {
      _expectFields({
        'properties': {
          'id': _single,
          'component': _single,
          'title': {'type': 'string'},
          'nearMarker': {
            'commonTypesRef': r'common_types.json#/$defs/ComponentIdSuffix',
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
        }, fields)
            .toList();
        expect(refs.map((r) => r.id), ['a', 'b', 'template']);
        expect(refs.map((r) => r.field), [
          'groups[0].children[0]',
          'groups[0].children[1]',
          'groups[1].children.componentId',
        ]);
      },
    );

    group('common-types document selection', () {
      // A minimal stand-in for the v1.0 common_types.json: `CheckRule` lists
      // only `condition` as required and types it as a `oneOf`, unlike v0.9.
      final v1CommonTypes = <String, Object?>{
        r'$defs': <String, Object?>{
          'DataBinding': <String, Object?>{'type': 'object'},
          'FunctionCall': <String, Object?>{'type': 'object'},
          'Checkable': <String, Object?>{
            'type': 'object',
            'properties': <String, Object?>{
              'checks': <String, Object?>{
                'type': 'array',
                'items': <String, Object?>{r'$ref': r'#/$defs/CheckRule'},
              },
            },
          },
          'CheckRule': <String, Object?>{
            'type': 'object',
            'properties': <String, Object?>{
              'condition': <String, Object?>{
                'oneOf': <Object?>[
                  <String, Object?>{r'$ref': r'#/$defs/DataBinding'},
                  <String, Object?>{r'$ref': r'#/$defs/FunctionCall'},
                ],
              },
              'message': <String, Object?>{'type': 'string'},
            },
            'required': <Object?>['condition'],
          },
        },
      };

      /// Resolves `common_types.json#/$defs/Checkable` through [reader] and
      /// returns the `CheckRule` item schema it leads to.
      Map<String, Object?> checkRuleVia(ReferenceSchemaReader reader) {
        final List<Map<String, Object?>> checkable = reader.schemas(
          <String, Object?>{r'$ref': r'common_types.json#/$defs/Checkable'},
        );
        final List<Map<String, Object?>> checks = reader.schemas(
          reader.properties(checkable)['checks'],
        );
        expect(reader.isCheckable(checks), isTrue);
        return reader
            .schemas(reader.items(checks))
            .firstWhere((schema) => schema.containsKey('required'));
      }

      test('defaults to the embedded v0.9 document', () {
        final Map<String, Object?> rule =
            checkRuleVia(ReferenceSchemaReader(<String, Object?>{}));
        expect(rule['required'], ['condition', 'message']);
        expect(
          (rule['properties']! as Map)['condition'],
          <String, Object?>{r'$ref': r'#/$defs/DynamicBoolean'},
        );
      });

      test(
          'resolves external and fallback pointers against an injected '
          'document', () {
        final reader = ReferenceSchemaReader(
          <String, Object?>{},
          commonTypes: v1CommonTypes,
        );
        final Map<String, Object?> rule = checkRuleVia(reader);
        expect(rule['required'], ['condition']);
        expect(
          ((rule['properties']! as Map)['condition'] as Map)['oneOf'],
          hasLength(2),
        );
      });

      test(
          'a local definition in the catalog document wins over the '
          'injected document', () {
        final reader = ReferenceSchemaReader(
          <String, Object?>{},
          document: <String, Object?>{
            r'$defs': <String, Object?>{
              'CheckRule': <String, Object?>{
                'type': 'object',
                'required': <Object?>['condition', 'local'],
              },
            },
          },
          commonTypes: v1CommonTypes,
        );
        final List<Map<String, Object?>> schemas = reader.schemas(
          <String, Object?>{r'$ref': r'#/$defs/CheckRule'},
        );
        expect(schemas.last['required'], ['condition', 'local']);
      });

      test('ComponentRefMap classifies against the injected document', () {
        // `Slot` exists only in this document; through it the property is a
        // structural child-list template, without it the pointer dangles.
        final slotDocument = <String, Object?>{
          r'$defs': <String, Object?>{
            'Slot': <String, Object?>{
              'type': 'object',
              'properties': <String, Object?>{
                'componentId': <String, Object?>{'type': 'string'},
                'path': <String, Object?>{'type': 'string'},
              },
            },
          },
        };
        final componentSchemas = <String, Map<String, Object?>>{
          'Panel': <String, Object?>{
            'type': 'object',
            'properties': <String, Object?>{
              'body': <String, Object?>{
                r'$ref': r'common_types.json#/$defs/Slot',
              },
            },
          },
        };

        expect(
          ComponentRefMap(componentSchemas, commonTypes: slotDocument)
              .fieldsFor('Panel'),
          {
            'body': isA<ListRef>()
                .having((ref) => ref.inferred, 'inferred', isTrue),
          },
        );
        expect(ComponentRefMap(componentSchemas).fieldsFor('Panel'), isEmpty);
      });
    });
  });

  group('one reference map for validation and resolution', () {
    MessageProcessor<ComponentApi> processorFor(
      Catalog<ComponentApi, FunctionImplementation> catalog,
    ) {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [catalog],
        defaultVersion: A2uiProtocolVersion.v1_0,
        // Strict, so that a dangling reference is rejected: these cases are
        // about the validator and the resolver reading one reference map.
        validationConfig: ValidationConfig.strict,
      );
      addTearDown(processor.groupModel.dispose);
      return processor;
    }

    // Creating the surface in the same payload makes the processor check the
    // component graph before applying it.
    AgentToRendererMessagePayload createAndUpdate(
      String catalogId,
      List<Map<String, Object?>> components,
    ) =>
        AgentToRendererMessage.parseAll([
          {
            'version': 'v1.0',
            'createSurface': {'surfaceId': 's', 'catalogId': catalogId},
          },
          {
            'version': 'v1.0',
            'updateComponents': {'surfaceId': 's', 'components': components},
          },
        ], protocolVersion: A2uiProtocolVersion.v1_0);

    Matcher danglingAt(String id, String field) => throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("'$id' in field '$field'"),
          ),
        );

    Map<String, Object?> renderedRootProps(
      Catalog<ComponentApi, FunctionImplementation> catalog,
      List<Map<String, Object?>> components,
    ) {
      final MessageProcessor<ComponentApi> processor = processorFor(catalog);
      processor.processMessages(createAndUpdate(catalog.id, components));
      final resolver = NodeResolver<ComponentApi>(
        processor.groupModel.getSurface('s')!,
      );
      addTearDown(resolver.dispose);
      return resolver.rootNode.peek()!.props.peek();
    }

    test('a v1.0 Child slot is checked for dangling ids and mounted', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _wireCatalog({
        'properties': {'child': _child},
      });
      expect(
        () => processorFor(catalog).processMessages(
          createAndUpdate(catalog.id, [
            {'id': 'root', 'component': 'Parent', 'child': 'missing'},
          ]),
        ),
        danglingAt('missing', 'child'),
      );
      final Map<String, Object?> props = renderedRootProps(catalog, [
        {'id': 'root', 'component': 'Parent', 'child': 'leaf'},
        {'id': 'leaf', 'component': 'Leaf'},
      ]);
      expect((props['child']! as ComponentNode).componentId, 'leaf');
    });

    test('child and children name fallbacks validate and render alike', () {
      final Map<String, Object?> schema = {
        'properties': {
          'child': {'type': 'string'},
          'children': {
            'type': 'array',
            'items': {'type': 'string'},
          },
        },
      };
      _expectFields(schema, single: {'child'}, list: {'children'});

      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _wireCatalog(schema);
      expect(
        () => processorFor(catalog).processMessages(
          createAndUpdate(catalog.id, [
            {
              'id': 'root',
              'component': 'Parent',
              'children': ['leaf', 'missing'],
            },
            {'id': 'leaf', 'component': 'Leaf'},
          ]),
        ),
        danglingAt('missing', 'children[1]'),
      );
      final Map<String, Object?> props = renderedRootProps(catalog, [
        {
          'id': 'root',
          'component': 'Parent',
          'child': 'a',
          'children': ['b'],
        },
        {'id': 'a', 'component': 'Leaf'},
        {'id': 'b', 'component': 'Leaf'},
      ]);
      expect((props['child']! as ComponentNode).componentId, 'a');
      expect(
        (props['children']! as List).cast<ComponentNode>().map(
              (n) => n.componentId,
            ),
        ['b'],
      );
    });

    test('a dangling list entry reports its index', () {
      final ComponentRefFields fields = extractComponentRefFields(
        _catalog({
          'properties': {'children': _list},
        }),
      )['Parent']!;
      expect(
        componentReferences({
          'children': ['a', 'b', 'missing'],
        }, fields)
            .map((r) => r.field),
        ['children[0]', 'children[1]', 'children[2]'],
      );

      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _wireCatalog({
        'properties': {'children': _list},
      });
      expect(
        () => processorFor(catalog).processMessages(
          createAndUpdate(catalog.id, [
            {
              'id': 'root',
              'component': 'Parent',
              'children': ['a', 'b', 'missing'],
            },
            {'id': 'a', 'component': 'Leaf'},
            {'id': 'b', 'component': 'Leaf'},
          ]),
        ),
        danglingAt('missing', 'children[2]'),
      );
    });

    test('only a componentId-and-path object is a template', () {
      final ComponentRefFields fields = extractComponentRefFields(
        _catalog({
          'properties': {'children': _list},
        }),
      )['Parent']!;
      List<String> ids(Object? children) => [
            for (final ComponentReference reference in componentReferences({
              'children': children,
            }, fields))
              reference.id,
          ];

      expect(ids({'componentId': 'row'}), isEmpty);
      expect(ids({'componentId': 'row', 'path': 3}), isEmpty);
      expect(ids({'componentId': 'row', 'path': '/items'}), ['row']);
    });

    test('Catalog.refMap is cached and drives both consumers', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog = _catalog({
        'properties': {'child': _child, 'children': _list},
      });
      expect(identical(catalog.refMap, catalog.refMap), isTrue);
      expect(catalog.refMap.fieldsFor('Parent').keys, {'child', 'children'});
      expect(catalog.refMap.fieldsFor('Leaf'), isEmpty);
      expect(catalog.refMap.fieldsFor('Unknown'), isEmpty);
      final ComponentRefFields validation =
          extractComponentRefFields(catalog)['Parent']!;
      expect(validation.single, {'child'});
      expect(validation.list, {'children'});
    });
  });

  group('wire-backed catalog mounting', () {
    for (final keyword in ['anyOf', 'oneOf']) {
      test(
        'mounts both direct and object-item references through $keyword',
        () {
          final Catalog<ComponentApi, FunctionImplementation> catalog =
              _catalog({
            keyword: [
              {
                'properties': {
                  'items': {'type': 'array', 'items': _single},
                },
              },
              {
                'properties': {
                  'items': {
                    'type': 'array',
                    'items': {
                      'type': 'object',
                      'properties': {
                        'child': _single,
                        'label': {'type': 'string'},
                      },
                    },
                  },
                },
              },
            ],
          });
          final processor = MessageProcessor<ComponentApi>(
            catalogs: [catalog],
            defaultVersion: A2uiProtocolVersion.v1_0,
          );
          processor.processMessages(
            AgentToRendererMessagePayload.of(
              CreateSurfaceMessage(
                  version: 'v1.0', surfaceId: 's', catalogId: catalog.id),
            ),
          );
          final SurfaceModel<ComponentApi> surface =
              processor.groupModel.getSurface('s')!;
          final resolver = NodeResolver<ComponentApi>(surface);
          addTearDown(() {
            resolver.dispose();
            processor.groupModel.dispose();
          });
          void process(List<Map<String, Object?>> components) {
            processor.processMessages(
              AgentToRendererMessage.parseAll([
                {
                  'version': 'v1.0',
                  'updateComponents': {
                    'surfaceId': 's',
                    'components': components,
                  },
                },
              ], protocolVersion: A2uiProtocolVersion.v1_0),
            );
          }

          process([
            {'id': 'leaf', 'component': 'Leaf'},
            {
              'id': 'root',
              'component': 'Parent',
              'items': [
                {'child': 'leaf', 'label': 'not-an-id'},
              ],
            },
          ]);
          final ComponentNode root = resolver.rootNode.peek()!;
          final item = (root.props.peek()['items']! as List).single as Map;
          expect((item['child']! as ComponentNode).componentId, 'leaf');
          expect(item['label'], 'not-an-id');
          expect(resolver.activeNodeCount, 2);
          process([
            {
              'id': 'root',
              'component': 'Parent',
              'items': ['leaf'],
            },
          ]);
          final direct =
              (root.props.peek()['items']! as List).single as ComponentNode;
          expect(direct.componentId, 'leaf');
          expect(direct.state, NodeState.resolved);
          expect(resolver.activeNodeCount, 2);
        },
      );
    }

    test('validates and mounts processed wire singles and templates', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _wireCatalog({
        'properties': {'child': _single, 'children': _list},
      });
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [catalog],
        defaultVersion: A2uiProtocolVersion.v1_0,
        validationConfig: const ValidationConfig(allowDanglingReferences: true),
      );
      processor.processMessages(
        AgentToRendererMessagePayload.of(
          CreateSurfaceMessage(
              version: 'v1.0', surfaceId: 's', catalogId: catalog.id),
        ),
      );
      final SurfaceModel<ComponentApi> surface =
          processor.groupModel.getSurface('s')!;
      final resolver = NodeResolver<ComponentApi>(surface);
      addTearDown(() {
        resolver.dispose();
        processor.groupModel.dispose();
      });
      void process(List<Map<String, Object?>> components) {
        processor.processMessages(
          AgentToRendererMessage.parseAll([
            {
              'version': 'v1.0',
              'updateComponents': {'surfaceId': 's', 'components': components},
            },
          ], protocolVersion: A2uiProtocolVersion.v1_0),
        );
      }

      surface.dataModel.set('/items', ['a', 'b']);
      // The processor allows dangling references, so this update is applied
      // and the resolver reports the template items as pending until a later
      // payload delivers the component.
      process([
        {
          'id': 'root',
          'component': 'Parent',
          'children': {'componentId': 'missing', 'path': '/items'},
        },
      ]);
      expect(surface.componentsModel.all, isNotEmpty);
      expect(
        (resolver.rootNode.value!.props.peek()['children']! as List)
            .cast<ComponentNode>()
            .map((n) => n.state),
        everyElement(NodeState.pending),
      );
      process([
        {
          'id': 'root',
          'component': 'Parent',
          'child': 'leaf',
          'children': {'componentId': 'leaf', 'path': '/items'},
        },
        {'id': 'leaf', 'component': 'Leaf'},
      ]);
      final Map<String, Object?> props = resolver.rootNode.value!.props.peek();
      expect((props['child']! as ComponentNode).componentId, 'leaf');
      expect(
        (props['children']! as List).cast<ComponentNode>().map(
              (n) => n.dataPath,
            ),
        ['/items/0', '/items/1'],
      );
      expect(resolver.activeNodeCount, 4);
    });

    test('mounts a single child through an escaped catalog-local alias', () {
      final _Fixture fixture = _fixture(
        _wireCatalog(
          {
            'properties': {
              'child': {r'$ref': r'#/$defs/child~1alias~0'},
            },
          },
          definitions: {'child/alias~': _single},
        ),
      );
      _add(fixture.surface, 'root', 'Parent', {'child': 'leaf'});
      final child = fixture.resolver.rootNode.value!.props.peek()['child']!
          as ComponentNode;
      expect(child.componentId, 'leaf');
      expect(child.state, NodeState.resolved);
      expect(fixture.resolver.activeNodeCount, 2);
    });

    test('mounts static wire ChildList arrays', () {
      final _Fixture fixture = _fixture(
        _wireCatalog({
          'properties': {'children': _list},
        }),
      );
      _add(fixture.surface, 'root', 'Parent', {
        'children': ['leaf'],
      });
      final children =
          fixture.resolver.rootNode.value!.props.peek()['children']! as List;
      expect(children.single, isA<ComponentNode>());
      expect((children.single as ComponentNode).componentId, 'leaf');
      expect((children.single as ComponentNode).dataPath, '/');
    });

    test(
      'expands wire ChildList templates with per-item scope and updates',
      () {
        final _Fixture fixture = _fixture(
          _wireCatalog({
            'properties': {'children': _list},
          }),
        );
        fixture.surface.dataModel.set('/items', ['a', 'b']);
        _add(fixture.surface, 'root', 'Parent', {
          'children': {'componentId': 'leaf', 'path': '/items'},
        });
        final ComponentNode root = fixture.resolver.rootNode.value!;
        List<ComponentNode> children() =>
            (root.props.peek()['children']! as List).cast<ComponentNode>();
        expect(children().map((n) => n.dataPath), ['/items/0', '/items/1']);
        final ComponentNode first = children().first;
        fixture.surface.dataModel.set('/items', ['a', 'b', 'c']);
        expect(children().map((n) => n.dataPath), [
          '/items/0',
          '/items/1',
          '/items/2',
        ]);
        expect(children().first, same(first));
      },
    );

    test('mounts wire reference arrays and array-object child keys', () {
      final _Fixture fixture = _fixture(
        _wireCatalog({
          'allOf': [
            {
              'properties': {
                'ids': {
                  'oneOf': [
                    {'type': 'array', 'items': _single},
                  ],
                },
                'tabs': {
                  'type': 'array',
                  'items': {
                    'allOf': [
                      {
                        'properties': {'child': _single},
                      },
                      {
                        'properties': {
                          'label': {'type': 'string'},
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        }),
      );
      _add(fixture.surface, 'root', 'Parent', {
        'ids': ['leaf'],
        'tabs': [
          {'child': 'leaf', 'label': 'not-an-id'},
        ],
      });
      final Map<String, Object?> props =
          fixture.resolver.rootNode.value!.props.peek();
      expect((props['ids']! as List).single, isA<ComponentNode>());
      final tab = (props['tabs']! as List).single as Map;
      expect(tab['child'], isA<ComponentNode>());
      expect(tab['label'], 'not-an-id');
      expect(fixture.resolver.activeNodeCount, 3);
    });

    test('leaves deeper wire templates scoped but unmounted', () {
      final _Fixture fixture = _fixture(
        _wireCatalog({
          'properties': {
            'groups': {
              'allOf': [
                {
                  'type': 'array',
                  'items': {
                    'properties': {
                      'label': {'type': 'string'},
                    },
                  },
                },
                {
                  'type': 'array',
                  'items': {
                    'properties': {'children': _list},
                  },
                },
              ],
            },
          },
        }),
      );
      fixture.surface.dataModel.set('/items', ['a', 'b']);
      _add(fixture.surface, 'root', 'Parent', {
        'groups': [
          {
            'children': {'componentId': 'leaf', 'path': '/items'},
          },
        ],
      });
      final group =
          (fixture.resolver.rootNode.value!.props.peek()['groups']! as List)
              .single as Map;
      final List<ChildNode> children =
          (group['children']! as List).cast<ChildNode>();
      expect(children.map((n) => n.basePath), ['/items/0', '/items/1']);
      expect(fixture.resolver.activeNodeCount, 1);
    });

    test('array items that are ChildLists remain scoped descriptors', () {
      final _Fixture fixture = _fixture(
        _wireCatalog({
          'properties': {
            'groups': {'type': 'array', 'items': _list},
          },
        }),
      );
      fixture.surface.dataModel.set('/items', ['a', 'b']);
      _add(fixture.surface, 'root', 'Parent', {
        'groups': [
          ['leaf'],
          {'componentId': 'leaf', 'path': '/items'},
        ],
      });
      final groups =
          fixture.resolver.rootNode.value!.props.peek()['groups']! as List;
      expect((groups[0] as List).cast<ChildNode>().single.basePath, '/');
      expect((groups[1] as List).cast<ChildNode>().map((n) => n.basePath), [
        '/items/0',
        '/items/1',
      ]);
      expect(fixture.resolver.activeNodeCount, 1);
    });

    test(
      'binder follows component-local aliases and bounds recursive shapes',
      () {
        final _Fixture fixture = _fixture(
          _catalog({
            r'$defs': {
              'children': _list,
              'recursive': {
                'properties': {
                  'next': {r'$ref': r'#/$defs/recursive'},
                },
              },
            },
            'properties': {
              'children': {r'$ref': r'#/$defs/children'},
              'recursive': {r'$ref': r'#/$defs/recursive'},
            },
          }),
        );
        fixture.surface.dataModel.set('/items', ['a']);
        _add(fixture.surface, 'root', 'Parent', {
          'children': {'componentId': 'leaf', 'path': '/items'},
          'recursive': {
            'next': {'value': 'literal'},
          },
        });
        final Map<String, Object?> props =
            fixture.resolver.rootNode.value!.props.peek();
        expect(
          ((props['children']! as List).single as ComponentNode).dataPath,
          '/items/0',
        );
        expect(props['recursive'], {
          'next': {'value': 'literal'},
        });
      },
    );
  });

  group('JSON pointer array traversal', () {
    test('array-indexed pointer', () {
      final root = <String, Object?>{
        'allOf': [
          {'type': 'string'},
        ],
      };
      final reader = ReferenceSchemaReader(root);
      final List<Map<String, Object?>> schemas = reader.schemas({
        r'$ref': '#/allOf/0',
      });
      expect(schemas.length, 2); // The referring object and the resolved target
      expect(schemas[1], {'type': 'string'});
    });

    test('out-of-range index', () {
      final root = <String, Object?>{
        'allOf': [
          {'type': 'string'},
        ],
      };
      final reader = ReferenceSchemaReader(root);
      final List<Map<String, Object?>> schemas = reader.schemas({
        r'$ref': '#/allOf/1',
      });
      expect(schemas.length, 1); // Only the referring object
    });

    test('non-numeric segment against a list', () {
      final root = <String, Object?>{
        'allOf': [
          {'type': 'string'},
        ],
      };
      final reader = ReferenceSchemaReader(root);
      final List<Map<String, Object?>> schemas = reader.schemas({
        r'$ref': '#/allOf/properties',
      });
      expect(schemas.length, 1); // Only the referring object
    });

    test('root pointer', () {
      final root = <String, Object?>{
        'type': 'object',
        'properties': {
          'a': {'type': 'string'},
        },
      };
      final reader = ReferenceSchemaReader(root);
      final List<Map<String, Object?>> schemas = reader.schemas({r'$ref': '#'});
      expect(schemas.length, 2);
      expect(schemas[1], root);
    });
  });
}
