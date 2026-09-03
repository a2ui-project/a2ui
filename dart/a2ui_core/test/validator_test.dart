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
import 'package:a2ui_core/src/validation/component_graph.dart';
import 'package:a2ui_core/src/validation/component_refs.dart';
import 'package:test/test.dart';

const String catalogId = 'https://example.com/catalogs/test.json';

/// The pointers a catalog document uses to mark child references, spelled the
/// way the shared conformance suites spell them.
const String componentIdRef =
    'https://a2ui.org/specification/v0_9/common_types.json#/\$defs/ComponentId';
const String childListRef =
    'https://a2ui.org/specification/v0_9/common_types.json#/\$defs/ChildList';

Map<String, Object?> createSurface({String version = 'v0.9'}) => {
  'version': version,
  'createSurface': {'surfaceId': 's1', 'catalogId': catalogId},
};

Map<String, Object?> updateComponents(List<Map<String, Object?>> components) =>
    {
      'version': 'v0.9',
      'updateComponents': {'surfaceId': 's1', 'components': components},
    };

/// A catalog exercising every way a component can reference another: a single
/// id, a `ChildList`, and an array of objects with id-bearing keys.
SchemaCatalog testCatalog() => Catalog.fromJson({
  'catalogId': catalogId,
  'components': {
    'Card': {
      'type': 'object',
      'properties': {
        'component': {'const': 'Card'},
        'child': {r'$ref': componentIdRef},
      },
      'required': ['component'],
    },
    'Text': {
      'type': 'object',
      'properties': {
        'component': {'const': 'Text'},
        'text': {'type': 'string'},
      },
      'required': ['component', 'text'],
    },
    'Column': {
      'type': 'object',
      'properties': {
        'component': {'const': 'Column'},
        'children': {r'$ref': childListRef},
      },
      'required': ['component', 'children'],
    },
    'Tabs': {
      'type': 'object',
      'properties': {
        'component': {'const': 'Tabs'},
        'items': {
          'type': 'array',
          'items': {
            'type': 'object',
            'properties': {
              'label': {'type': 'string'},
              'child': {r'$ref': componentIdRef},
            },
          },
        },
      },
      'required': ['component'],
    },
  },
});

/// The parts of `common_types.json` this catalog references.
Map<String, Object?> commonTypes() => {
  r'$defs': {
    'ComponentId': {'type': 'string'},
    'ChildList': {
      'oneOf': [
        {
          'type': 'array',
          'items': {r'$ref': '#/\$defs/ComponentId'},
        },
        {
          'type': 'object',
          'properties': {
            'componentId': {r'$ref': '#/\$defs/ComponentId'},
            'path': {'type': 'string'},
          },
          'required': ['componentId', 'path'],
          'additionalProperties': false,
        },
      ],
    },
  },
};

/// A validator over [testCatalog].
///
/// Overrides the shared types rather than taking the published document, so
/// these tests exercise the definitions above: an empty map leaves them
/// unresolvable, which is the case the SDK skips rather than rejects.
A2uiValidator<ComponentApi, FunctionApi> newValidator({
  bool withCommonTypes = false,
}) => A2uiValidator(
  catalogs: [testCatalog()],
  commonTypesSchema: withCommonTypes ? commonTypes() : const {},
);

Map<String, Object?> text(String id, [String value = 'x']) => {
  'id': id,
  'component': 'Text',
  'text': value,
};

Map<String, Object?> card(String id, String child) => {
  'id': id,
  'component': 'Card',
  'child': child,
};

void main() {
  group('A2uiValidator version gating', () {
    test('accepts payloads declaring the supported version', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();

      expect(validator.checkVersion(createSurface()), A2uiProtocolVersion.v0_9);
      expect(validator.parseMessages([createSurface()]), hasLength(1));
      expect(
        validator.parseMessages([createSurface()]).single,
        isA<CreateSurfaceMessage>(),
      );
    });

    test('rejects payloads declaring another protocol version', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();

      for (final version in ['v0.8', 'v0.9.1', 'v1.0']) {
        expect(
          () => validator.checkVersion(createSurface(version: version)),
          throwsA(isA<A2uiValidationError>()),
          reason: version,
        );
        expect(
          () => validator.parseMessages([createSurface(version: version)]),
          throwsA(isA<A2uiValidationError>()),
          reason: version,
        );
      }
    });

    test('rejects payloads that omit the version', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final Map<String, Map<String, String>> message = {
        'createSurface': {'surfaceId': 's1', 'catalogId': catalogId},
      };

      expect(
        () => validator.checkVersion(message),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator.parseMessages([message]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects an envelope naming no known message body', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();

      expect(
        () => validator.parseMessages([
          {'version': 'v0.9', 'notAMessage': <String, Object?>{}},
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('is constructed for a supported version by name', () {
      expect(
        A2uiValidator.forVersion('v0.9').protocolVersion,
        A2uiProtocolVersion.v0_9,
      );
    });

    test('cannot be constructed for an unsupported version', () {
      expect(
        () => A2uiValidator.forVersion('v1.0'),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => A2uiValidator.forVersion(null),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('indexes the catalogs it validates against by id', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      expect(validator.catalogs.keys, [catalogId]);
    });
  });

  group('A2uiValidator.validateStructure', () {
    test('accepts a well formed component graph', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([card('root', 'label'), text('label', 'Hello')]),
      ]);

      expect(() => validator.validateStructure(messages), returnsNormally);
    });

    test('rejects duplicate component ids', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([text('root', 'a'), text('root', 'b')]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains('Duplicate component ID: root'),
          ),
        ),
      );
    });

    test('rejects a child reference that names no component', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([card('root', 'missing')]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains('references non-existent component'),
          ),
        ),
      );
    });

    test('rejects a payload that declares no root component', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([text('label', 'Hello')]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains('Missing root component'),
          ),
        ),
      );
    });

    test('rejects a component unreachable from the root', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          card('root', 'label'),
          text('label', 'Hello'),
          text('orphan', 'Nobody points at me'),
        ]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains("Component 'orphan' is not reachable"),
          ),
        ),
      );
    });

    test('rejects a self reference', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([card('root', 'root')]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiRecursionError>()
              .having(
                (e) => e.message,
                'message',
                contains('Self-reference detected'),
              )
              .having((e) => e.cycle, 'cycle', ['root']),
        ),
      );
    });

    test('rejects a cycle in the component graph', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([card('root', 'b'), card('b', 'root')]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiRecursionError>().having(
            (e) => e.message,
            'message',
            contains('Circular reference detected'),
          ),
        ),
      );
    });

    test('rejects a chain deeper than the cap', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final components = <Map<String, Object?>>[card('root', 'c0')];
      const int chain = maxComponentDepth + 5;
      for (var i = 0; i < chain; i++) {
        components.add(card('c$i', 'c${i + 1}'));
      }
      components.add(text('c$chain', 'leaf'));

      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents(components),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiRecursionError>().having(
            (e) => e.message,
            'message',
            contains('recursion limit exceeded'),
          ),
        ),
      );
    });

    test('follows a static child list', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> valid = validator.parseMessages([
        createSurface(),
        updateComponents([
          {
            'id': 'root',
            'component': 'Column',
            'children': ['a', 'b'],
          },
          text('a'),
          text('b'),
        ]),
      ]);
      expect(() => validator.validateStructure(valid), returnsNormally);

      final List<A2uiMessage> dangling = validator.parseMessages([
        createSurface(),
        updateComponents([
          {
            'id': 'root',
            'component': 'Column',
            'children': ['a', 'missing'],
          },
          text('a'),
        ]),
      ]);
      expect(
        () => validator.validateStructure(dangling),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('follows a child list template', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {
            'id': 'root',
            'component': 'Column',
            'children': {'componentId': 'row', 'path': '/items'},
          },
          text('row'),
        ]),
      ]);
      expect(() => validator.validateStructure(messages), returnsNormally);

      final List<A2uiMessage> dangling = validator.parseMessages([
        createSurface(),
        updateComponents([
          {
            'id': 'root',
            'component': 'Column',
            'children': {'componentId': 'missing', 'path': '/items'},
          },
        ]),
      ]);
      expect(
        () => validator.validateStructure(dangling),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('follows references nested in an array of objects', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {
            'id': 'root',
            'component': 'Tabs',
            'items': [
              {'label': 'One', 'child': 'a'},
              {'label': 'Two', 'child': 'missing'},
            ],
          },
          text('a'),
        ]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains("in field 'items[1].child'"),
          ),
        ),
      );
    });

    test('ignores a property that does not reference components', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      // `text` is a plain string, so 'root' inside it is not a reference and
      // must not read as a self-reference.
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([text('root', 'root')]),
      ]);

      expect(() => validator.validateStructure(messages), returnsNormally);
    });

    test('does not read a component id as a reference to itself', () {
      // A catalog that inlines `ComponentCommon` declares `id` as a
      // `ComponentId`. That names the component itself, so reading it as a
      // child reference would make every component self-referential.
      final SchemaCatalog inlined = Catalog.fromJson({
        'catalogId': catalogId,
        'components': {
          'Card': {
            'type': 'object',
            'allOf': [
              {r'$ref': '#/\$defs/ComponentCommon'},
              {
                'type': 'object',
                'properties': {
                  'component': {'const': 'Card'},
                  'child': {r'$ref': componentIdRef},
                },
              },
            ],
          },
        },
        r'$defs': {
          'ComponentCommon': {
            'type': 'object',
            'properties': {
              'id': {r'$ref': componentIdRef},
            },
            'required': ['id'],
          },
        },
      });

      expect(extractComponentRefFields(inlined)['Card']!.single, {
        'child',
      }, reason: 'id must not be read as a child reference');

      final A2uiValidator<ComponentApi, FunctionApi> validator = A2uiValidator(
        catalogs: [inlined],
      );
      expect(
        () => validator.validateStructure(
          validator.parseMessages([
            createSurface(),
            updateComponents([
              {'id': 'root', 'component': 'Card', 'child': 'a'},
              {'id': 'a', 'component': 'Card'},
            ]),
          ]),
        ),
        returnsNormally,
      );
    });

    test('rejects a malformed data model path', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        {
          'version': 'v0.9',
          'updateDataModel': {'surfaceId': 's1', 'path': 'a~2b', 'value': 1},
        },
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('Invalid path syntax'),
          ),
        ),
      );
    });

    test('rejects function calls nested past the cap', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      Map<String, Object?> call = {'call': 'f', 'args': <String, Object?>{}};
      for (var i = 0; i < maxFunctionCallDepth + 1; i++) {
        call = {
          'call': 'f',
          'args': {'inner': call},
        };
      }
      final List<A2uiMessage> messages = validator.parseMessages([
        updateComponents([
          {'id': 'root', 'component': 'Text', 'text': call},
        ]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(
          isA<A2uiRecursionError>().having(
            (e) => e.message,
            'message',
            contains('functionCall depth'),
          ),
        ),
      );
    });

    group('incremental updates', () {
      test('allow a missing root and references to existing components', () {
        final A2uiValidator<ComponentApi, FunctionApi> validator =
            newValidator();
        final List<A2uiMessage> messages = validator.parseMessages([
          updateComponents([card('panel', 'alreadyOnTheClient')]),
        ]);

        expect(() => validator.validateStructure(messages), returnsNormally);
      });

      test('still reject duplicate ids', () {
        final A2uiValidator<ComponentApi, FunctionApi> validator =
            newValidator();
        final List<A2uiMessage> messages = validator.parseMessages([
          updateComponents([text('a', 'one'), text('a', 'two')]),
        ]);

        expect(
          () => validator.validateStructure(messages),
          throwsA(isA<A2uiIntegrityError>()),
        );
      });

      test('still reject a self reference', () {
        final A2uiValidator<ComponentApi, FunctionApi> validator =
            newValidator();
        final List<A2uiMessage> messages = validator.parseMessages([
          updateComponents([card('a', 'a')]),
        ]);

        expect(
          () => validator.validateStructure(messages),
          throwsA(isA<A2uiRecursionError>()),
        );
      });

      test('still reject a cycle', () {
        final A2uiValidator<ComponentApi, FunctionApi> validator =
            newValidator();
        final List<A2uiMessage> messages = validator.parseMessages([
          updateComponents([card('a', 'b'), card('b', 'a')]),
        ]);

        expect(
          () => validator.validateStructure(messages),
          throwsA(isA<A2uiRecursionError>()),
        );
      });
    });

    test('accumulates components across updates to the same surface', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([card('root', 'label')]),
        updateComponents([text('label', 'Hello')]),
      ]);

      expect(() => validator.validateStructure(messages), returnsNormally);
    });

    test('treats an id repeated in a later message as an update', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      // The second message replaces `root`, pointing it at `b` instead of
      // `a`. That is how the basic catalog's `00_incremental` example swaps
      // a placeholder out, so it must not read as a duplicate id — and `a`,
      // now unreachable, is the residue of the replacement rather than an
      // orphan. A surface declared in one message is still held to full
      // reachability, which the test above covers.
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([card('root', 'a'), text('a')]),
        updateComponents([card('root', 'b'), text('b')]),
      ]);

      expect(() => validator.validateStructure(messages), returnsNormally);
    });

    test('drops the components of a surface deleted in the same payload', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([card('root', 'missing')]),
        {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's1'},
        },
      ]);

      expect(() => validator.validateStructure(messages), returnsNormally);
    });
  });

  group('A2uiValidator.validateAgainstCatalogs', () {
    test('accepts components that satisfy the catalog schema', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([text('label', 'Hello')]),
      ]);

      expect(
        () => validator.validateAgainstCatalogs(messages),
        returnsNormally,
      );
    });

    test('rejects a component missing a required property', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {'id': 'label', 'component': 'Text'},
        ]),
      ]);

      expect(
        () => validator.validateAgainstCatalogs(messages),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a property of the wrong type', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {'id': 'label', 'component': 'Text', 'text': 42},
        ]),
      ]);

      expect(
        () => validator.validateAgainstCatalogs(messages),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a component the catalog does not declare', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {'id': 'label', 'component': 'Nonexistent'},
        ]),
      ]);

      expect(
        () => validator.validateAgainstCatalogs(messages),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('declares no component'),
          ),
        ),
      );
    });

    test('rejects a surface created against an unregistered catalog', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        {
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': 's1',
            'catalogId': 'https://example.com/catalogs/other.json',
          },
        },
      ]);

      expect(
        () => validator.validateAgainstCatalogs(messages),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('enforces common_types definitions when they are supplied', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator(
        withCommonTypes: true,
      );
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {
            'id': 'root',
            'component': 'Column',
            // Neither a list of ids nor a `{componentId, path}` template.
            'children': {'componentId': 'row'},
          },
        ]),
      ]);

      expect(
        () => validator.validateAgainstCatalogs(messages),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('treats an unresolvable reference as unconstrained', () {
      // Given shared types that define no `ChildList`, the reference to it
      // cannot be resolved. The surrounding constraints still apply, but the
      // reference itself is skipped rather than failing the payload.
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {
            'id': 'root',
            'component': 'Column',
            'children': {'componentId': 'row'},
          },
        ]),
      ]);

      expect(
        () => validator.validateAgainstCatalogs(messages),
        returnsNormally,
      );
    });
  });

  group('A2uiValidator surface-to-catalog resolution', () {
    SchemaCatalog namedCatalog(String id, String component) =>
        Catalog.fromJson({
          'catalogId': id,
          'components': {
            component: {
              'type': 'object',
              'properties': {
                'id': {'type': 'string'},
                'component': {'const': component},
                'a': {'type': 'string'},
              },
              'required': ['component', 'a'],
              'additionalProperties': false,
            },
          },
        });

    /// An incremental payload: v0.9 declares `catalogId` on `createSurface`
    /// only, so this carries none.
    List<Map<String, Object?>> incremental(Map<String, Object?> component) => [
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 's1',
          'components': [component],
        },
      },
    ];

    final Map<String, Object?> valid = {
      'id': 'root',
      'component': 'Alpha',
      'a': 'x',
    };
    final Map<String, Object?> bogus = {
      'id': 'root',
      'component': 'Nonexistent',
      'totally': 'bogus',
    };

    A2uiValidator<ComponentApi, FunctionApi> over(List<String> ids) =>
        A2uiValidator(
          catalogs: [
            for (final String id in ids)
              namedCatalog(id, id == 'cat1' ? 'Alpha' : 'Beta'),
          ],
        );

    test('uses the only catalog when the validator holds one', () {
      expect(
        () => over(['cat1']).validate(incremental(valid)),
        returnsNormally,
      );
      expect(
        () => over(['cat1']).validate(incremental(bogus)),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws rather than skip when several catalogs are ambiguous', () {
      // Reporting a payload valid that nothing checked is the worse failure.
      expect(
        () => over(['cat1', 'cat2']).validate(incremental(bogus)),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => over(['cat1', 'cat2']).validate(incremental(valid)),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('checks against the catalog surfaceCatalogs names', () {
      expect(
        () => over([
          'cat1',
          'cat2',
        ]).validate(incremental(valid), surfaceCatalogs: const {'s1': 'cat1'}),
        returnsNormally,
      );
      expect(
        () => over([
          'cat1',
          'cat2',
        ]).validate(incremental(bogus), surfaceCatalogs: const {'s1': 'cat1'}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a component belonging to another catalog', () {
      expect(
        () => over([
          'cat1',
          'cat2',
        ]).validate(incremental(valid), surfaceCatalogs: const {'s1': 'cat2'}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when surfaceCatalogs names a catalog it does not hold', () {
      expect(
        () => over([
          'cat1',
          'cat2',
        ]).validate(incremental(valid), surfaceCatalogs: const {'s1': 'nope'}),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('A2uiValidator.validate', () {
    test('returns the parsed messages for a valid payload', () async {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();

      final List<A2uiMessage> messages = validator.validate([
        createSurface(),
        updateComponents([card('root', 'label'), text('label', 'Hello')]),
      ]);

      expect(messages, hasLength(2));
      expect(messages.first, isA<CreateSurfaceMessage>());
    });

    test('rejects an unsupported version before any deep check runs', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();

      expect(
        () => validator.validate([createSurface(version: 'v1.0')]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('reports a structural failure before a catalog failure', () {
      final A2uiValidator<ComponentApi, FunctionApi> validator = newValidator();

      // `root` is both a dangling reference and missing its required `text`.
      // Structure runs first, so the integrity error is what surfaces.
      expect(
        () => validator.validate([
          createSurface(),
          updateComponents([
            {'id': 'root', 'component': 'Card', 'child': 'missing'},
          ]),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });
  });
}
