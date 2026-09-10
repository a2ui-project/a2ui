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

import 'support/renderer_catalog.dart';

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
Map<String, Object?> testCatalogDocument() => {
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
};

SchemaCatalog testCatalog() => Catalog.fromJson(testCatalogDocument());

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
PayloadValidator<ComponentApi, FunctionApi> newValidator({
  bool withCommonTypes = false,
}) => PayloadValidator(
  catalog: testCatalog(),
  protocolVersion: A2uiProtocolVersion.v0_9,
  commonTypesSchema: withCommonTypes ? commonTypes() : const {},
);

/// A processor over [testCatalog], for the payload-level checks.
///
/// Structure and catalog checks span a whole payload, and a payload may name
/// several catalogs, so they run on the processor rather than on a validator
/// scoped to one catalog.
MessageProcessor<ComponentApi> newProcessor({bool withCommonTypes = false}) =>
    MessageProcessor<ComponentApi>(
      catalogs: [rendererCatalog(testCatalogDocument())],
      protocolVersion: A2uiProtocolVersion.v0_9,
      commonTypesSchema: withCommonTypes ? commonTypes() : const {},
    );

/// A processor that already holds surface `s1`.
///
/// An incremental payload updates a surface the client already has, so the
/// cases below establish that surface before applying one.
MessageProcessor<ComponentApi> newProcessorWithSurface() {
  final MessageProcessor<ComponentApi> processor = newProcessor();
  processor.processMessages(parse([createSurface()]));
  return processor;
}

/// Parses a payload's envelopes, which needs no catalog.
List<A2uiMessage> parse(List<Map<String, Object?>> payload) =>
    A2uiMessage.parseAll(payload, protocolVersion: A2uiProtocolVersion.v0_9);

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
  group('PayloadValidator version gating', () {
    test('accepts payloads declaring the supported version', () {
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          newValidator();

      expect(validator.checkVersion(createSurface()), A2uiProtocolVersion.v0_9);
      expect(parse([createSurface()]), hasLength(1));
      expect(parse([createSurface()]).single, isA<CreateSurfaceMessage>());
    });

    test('rejects payloads declaring another protocol version', () {
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          newValidator();

      for (final version in ['v0.8', 'v0.9.1', 'v1.0']) {
        expect(
          () => validator.checkVersion(createSurface(version: version)),
          throwsA(isA<A2uiValidationError>()),
          reason: version,
        );
        expect(
          () => parse([createSurface(version: version)]),
          throwsA(isA<A2uiValidationError>()),
          reason: version,
        );
      }
    });

    test('rejects payloads that omit the version', () {
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          newValidator();
      final Map<String, Map<String, String>> message = {
        'createSurface': {'surfaceId': 's1', 'catalogId': catalogId},
      };

      expect(
        () => validator.checkVersion(message),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(() => parse([message]), throwsA(isA<A2uiValidationError>()));
    });

    test('rejects an envelope naming no known message body', () {
      expect(
        () => parse([
          {'version': 'v0.9', 'notAMessage': <String, Object?>{}},
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('is constructed for a supported version by name', () {
      expect(
        PayloadValidator.forVersion(
          'v0.9',
          catalog: testCatalog(),
        ).protocolVersion,
        A2uiProtocolVersion.v0_9,
      );
    });

    test('cannot be constructed for an unsupported version', () {
      expect(
        () => PayloadValidator.forVersion('v1.0', catalog: testCatalog()),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => PayloadValidator.forVersion(null, catalog: testCatalog()),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('is scoped to the catalog it validates against', () {
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          newValidator();
      expect(validator.catalog.id, catalogId);
    });
  });

  group('PayloadValidator single-item checks', () {
    /// A catalog with one component, one function and a theme, so each of the
    /// three per-item entry points has something to check against.
    PayloadValidator<ComponentApi, FunctionApi> validator() =>
        PayloadValidator<ComponentApi, FunctionApi>(
          protocolVersion: A2uiProtocolVersion.v0_9,
          commonTypesSchema: const {},
          catalog: Catalog.fromJson({
            'catalogId': catalogId,
            'components': {
              'Text': {
                'type': 'object',
                'properties': {
                  'component': {'const': 'Text'},
                  'text': {'type': 'string'},
                },
                'required': ['component', 'text'],
              },
            },
            'functions': {
              'formatString': {
                'type': 'object',
                'properties': {
                  'call': {'const': 'formatString'},
                  'returnType': {'const': 'string'},
                  'args': {
                    'type': 'object',
                    'properties': {
                      'value': {'type': 'string'},
                    },
                    'required': ['value'],
                    'additionalProperties': false,
                  },
                },
              },
            },
            'theme': {
              'type': 'object',
              'properties': {
                'primaryColor': {'type': 'string'},
              },
              'additionalProperties': false,
            },
          }),
        );

    test('validateComponent checks one component against the catalog', () {
      expect(() => validator().validateComponent(text('a')), returnsNormally);
      expect(
        () => validator().validateComponent({'id': 'a', 'component': 'Text'}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator().validateComponent({'id': 'a', 'component': 'Card'}),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('declares no component'),
          ),
        ),
      );
      expect(
        () => validator().validateComponent({'id': 'a'}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('validateFunction checks one call against the catalog', () {
      expect(
        () => validator().validateFunction('formatString', {'value': 'x'}),
        returnsNormally,
      );
      expect(
        () => validator().validateFunction('formatString', {'value': 42}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator().validateFunction('noSuchFunction', const {}),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('declares no function'),
          ),
        ),
      );
    });

    test('validateTheme checks one theme against the catalog', () {
      expect(
        () => validator().validateTheme({'primaryColor': '#fff'}),
        returnsNormally,
      );
      expect(
        () => validator().validateTheme({'notATheme': 1}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator().validateTheme(null),
        returnsNormally,
        reason: 'a surface may declare no theme',
      );
    });

    test('a catalog with no theme schema constrains no theme', () {
      expect(
        () => newValidator().validateTheme({'anything': 1}),
        returnsNormally,
      );
    });
  });

  group('MessageProcessor.processMessages', () {
    test('accepts a well formed component graph', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([card('root', 'label'), text('label', 'Hello')]),
      ]);

      expect(() => processor.processMessages(messages), returnsNormally);
    });

    test('rejects duplicate component ids', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([text('root', 'a'), text('root', 'b')]),
      ]);

      expect(
        () => processor.processMessages(messages),
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
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([card('root', 'missing')]),
      ]);

      expect(
        () => processor.processMessages(messages),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains('references non-existent component'),
          ),
        ),
      );
    });

    test('a surface with no root component is incomplete', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([text('label', 'Hello')]),
      ]);

      // Applying is fine: the root may still arrive in a later message.
      processor.processMessages(messages);

      expect(
        () => processor.checkSurfaceComplete('s1'),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains('Missing root component'),
          ),
        ),
      );
    });

    test('a surface with an unreachable component is incomplete', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([
          card('root', 'label'),
          text('label', 'Hello'),
          text('orphan', 'Nobody points at me'),
        ]),
      ]);

      // A component nothing points at may still be adopted by a later
      // message, so it fails the completeness check rather than the apply.
      processor.processMessages(messages);

      expect(
        () => processor.checkSurfaceComplete('s1'),
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
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([card('root', 'root')]),
      ]);

      expect(
        () => processor.processMessages(messages),
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
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([card('root', 'b'), card('b', 'root')]),
      ]);

      expect(
        () => processor.processMessages(messages),
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
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final components = <Map<String, Object?>>[card('root', 'c0')];
      const int chain = maxComponentDepth + 5;
      for (var i = 0; i < chain; i++) {
        components.add(card('c$i', 'c${i + 1}'));
      }
      components.add(text('c$chain', 'leaf'));

      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents(components),
      ]);

      expect(
        () => processor.processMessages(messages),
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
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> valid = parse([
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
      expect(() => processor.processMessages(valid), returnsNormally);

      final MessageProcessor<ComponentApi> second = newProcessor();
      final List<A2uiMessage> dangling = parse([
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
        () => second.processMessages(dangling),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('follows a child list template', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
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
      expect(() => processor.processMessages(messages), returnsNormally);

      final MessageProcessor<ComponentApi> second = newProcessor();
      final List<A2uiMessage> dangling = parse([
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
        () => second.processMessages(dangling),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('follows references nested in an array of objects', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
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
        () => processor.processMessages(messages),
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
      final MessageProcessor<ComponentApi> processor = newProcessor();
      // `text` is a plain string, so 'root' inside it is not a reference and
      // must not read as a self-reference.
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([text('root', 'root')]),
      ]);

      expect(() => processor.processMessages(messages), returnsNormally);
    });

    test('does not read a component id as a reference to itself', () {
      // A catalog that inlines `ComponentCommon` declares `id` as a
      // `ComponentId`. That names the component itself, so reading it as a
      // child reference would make every component self-referential.
      final Map<String, Object?> document = {
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
      };

      expect(
        extractComponentRefFields(Catalog.fromJson(document))['Card']!.single,
        {'child'},
        reason: 'id must not be read as a child reference',
      );

      final inlinedProcessor = MessageProcessor<ComponentApi>(
        catalogs: [rendererCatalog(document)],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      expect(
        () => inlinedProcessor.processMessages(
          parse([
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
      final MessageProcessor<ComponentApi> processor =
          newProcessorWithSurface();
      final List<A2uiMessage> messages = parse([
        {
          'version': 'v0.9',
          'updateDataModel': {'surfaceId': 's1', 'path': 'a~2b', 'value': 1},
        },
      ]);

      expect(
        () => processor.processMessages(messages),
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
      final MessageProcessor<ComponentApi> processor =
          newProcessorWithSurface();
      Map<String, Object?> call = {'call': 'f', 'args': <String, Object?>{}};
      for (var i = 0; i < maxFunctionCallDepth + 1; i++) {
        call = {
          'call': 'f',
          'args': {'inner': call},
        };
      }
      final List<A2uiMessage> messages = parse([
        updateComponents([
          {'id': 'root', 'component': 'Text', 'text': call},
        ]),
      ]);

      expect(
        () => processor.processMessages(messages),
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
        final MessageProcessor<ComponentApi> processor =
            newProcessorWithSurface();
        final List<A2uiMessage> messages = parse([
          updateComponents([card('panel', 'alreadyOnTheClient')]),
        ]);

        expect(() => processor.processMessages(messages), returnsNormally);
      });

      test('still reject duplicate ids', () {
        final MessageProcessor<ComponentApi> processor =
            newProcessorWithSurface();
        final List<A2uiMessage> messages = parse([
          updateComponents([text('a', 'one'), text('a', 'two')]),
        ]);

        expect(
          () => processor.processMessages(messages),
          throwsA(isA<A2uiIntegrityError>()),
        );
      });

      test('still reject a self reference', () {
        final MessageProcessor<ComponentApi> processor =
            newProcessorWithSurface();
        final List<A2uiMessage> messages = parse([
          updateComponents([card('a', 'a')]),
        ]);

        expect(
          () => processor.processMessages(messages),
          throwsA(isA<A2uiRecursionError>()),
        );
      });

      test('still reject a cycle', () {
        final MessageProcessor<ComponentApi> processor =
            newProcessorWithSurface();
        final List<A2uiMessage> messages = parse([
          updateComponents([card('a', 'b'), card('b', 'a')]),
        ]);

        expect(
          () => processor.processMessages(messages),
          throwsA(isA<A2uiRecursionError>()),
        );
      });
    });

    test('accumulates components across updates to the same surface', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([card('root', 'label')]),
        updateComponents([text('label', 'Hello')]),
      ]);

      expect(() => processor.processMessages(messages), returnsNormally);
    });

    test('treats an id repeated in a later message as an update', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      // The second message replaces `root`, pointing it at `b` instead of
      // `a`. That is how the basic catalog's `00_incremental` example swaps
      // a placeholder out, so it must not read as a duplicate id — and `a`,
      // now unreachable, is the residue of the replacement rather than an
      // orphan. A surface declared in one message is still held to full
      // reachability, which the test above covers.
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([card('root', 'a'), text('a')]),
        updateComponents([card('root', 'b'), text('b')]),
      ]);

      expect(() => processor.processMessages(messages), returnsNormally);
    });

    test('drops the components of a surface deleted in the same payload', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([card('root', 'missing')]),
        {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's1'},
        },
      ]);

      expect(() => processor.processMessages(messages), returnsNormally);
    });
  });

  group('MessageProcessor.processMessages', () {
    test('accepts components that satisfy the catalog schema', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([text('label', 'Hello')]),
      ]);

      expect(() => processor.processMessages(messages), returnsNormally);
    });

    test('rejects a component missing a required property', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([
          {'id': 'label', 'component': 'Text'},
        ]),
      ]);

      expect(
        () => processor.processMessages(messages),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a property of the wrong type', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([
          {'id': 'label', 'component': 'Text', 'text': 42},
        ]),
      ]);

      expect(
        () => processor.processMessages(messages),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a component the catalog does not declare', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([
          {'id': 'label', 'component': 'Nonexistent'},
        ]),
      ]);

      expect(
        () => processor.processMessages(messages),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('declares no component'),
          ),
        ),
      );
    });

    test('rejects a surface created against an unsupported catalog', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        {
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': 's1',
            'catalogId': 'https://example.com/catalogs/other.json',
          },
        },
      ]);

      expect(
        () => processor.processMessages(messages),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('enforces common_types definitions when they are supplied', () {
      final MessageProcessor<ComponentApi> processor = newProcessor(
        withCommonTypes: true,
      );
      final List<A2uiMessage> messages = parse([
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
        () => processor.processMessages(messages),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('treats an unresolvable reference as unconstrained', () {
      // Given shared types that define no `ChildList`, the reference to it
      // cannot be resolved. The surrounding constraints still apply, but the
      // reference itself is skipped rather than failing the payload.
      final MessageProcessor<ComponentApi> processor = newProcessor();
      final List<A2uiMessage> messages = parse([
        createSurface(),
        updateComponents([
          {
            'id': 'root',
            'component': 'Column',
            'children': {'componentId': 'row'},
          },
        ]),
      ]);

      expect(() => processor.processMessages(messages), returnsNormally);
    });
  });

  group('MessageProcessor catalog resolution', () {
    Map<String, Object?> namedCatalogDocument(String id, String component) => {
      'catalogId': id,
      'components': {
        component: {
          'type': 'object',
          'properties': {
            'id': {'type': 'string'},
            'component': {'const': component},
            // v1.0 lets a component name a catalog of its own, overriding the
            // surface-level default.
            'catalogId': {'type': 'string'},
            'a': {'type': 'string'},
          },
          'required': ['component', 'a'],
          'additionalProperties': false,
        },
      },
    };

    Catalog<ComponentApi, FunctionImplementation> namedCatalog(
      String id,
      String component,
    ) => rendererCatalog(namedCatalogDocument(id, component));

    /// A processor supporting [ids], each with one component named after it.
    MessageProcessor<ComponentApi> over(List<String> ids) =>
        MessageProcessor<ComponentApi>(
          catalogs: [
            for (final String id in ids)
              namedCatalog(id, id == 'cat1' ? 'Alpha' : 'Beta'),
          ],
          protocolVersion: A2uiProtocolVersion.v0_9,
        );

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

    /// A payload creating [surfaceId] against [catalogId] and putting
    /// [component] on it.
    List<Map<String, Object?>> render(
      String surfaceId,
      String catalogId,
      Map<String, Object?> component,
    ) => [
      {
        'version': 'v0.9',
        'createSurface': {'surfaceId': surfaceId, 'catalogId': catalogId},
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': surfaceId,
          'components': [component],
        },
      },
    ];

    Map<String, Object?> alpha({String? catalogId}) => {
      'id': 'root',
      'component': 'Alpha',
      'catalogId': ?catalogId,
      'a': 'x',
    };
    Map<String, Object?> beta({String? catalogId}) => {
      'id': 'root',
      'component': 'Beta',
      'catalogId': ?catalogId,
      'a': 'x',
    };
    final Map<String, Object?> bogus = {
      'id': 'root',
      'component': 'Nonexistent',
      'a': 'x',
    };

    test('checks an incremental payload against the sole catalog', () {
      // A payload that only updates a surface carries no catalog id, and an
      // agent negotiates one catalog before it generates anything, so the
      // components are checked rather than skipped.
      expect(
        () => over(['cat1']).processPayload(incremental(alpha())),
        returnsNormally,
      );
      expect(
        () => over(['cat1']).processPayload(incremental(bogus)),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a component belonging to another catalog', () {
      expect(
        () => over(['cat2']).processPayload(incremental(alpha())),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('checks each surface against the catalog it names', () {
      // A renderer supports several catalogs at once, and one payload may
      // create surfaces against different ones.
      expect(
        () => over(['cat1', 'cat2']).processPayload([
          ...render('s1', 'cat1', alpha()),
          ...render('s2', 'cat2', beta()),
        ]),
        returnsNormally,
      );
      expect(
        () => over([
          'cat1',
          'cat2',
        ]).processPayload([...render('s1', 'cat1', beta())]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('checks a component against the catalog it names for itself', () {
      // v1.0 lets one surface mix catalogs: a component may override the
      // surface-level default with a `catalogId` of its own. The component
      // below is not in the surface's catalog, and passes only because it
      // names the catalog it does belong to.
      expect(
        () => over([
          'cat1',
          'cat2',
        ]).processPayload(render('s1', 'cat1', beta(catalogId: 'cat2'))),
        returnsNormally,
      );
      expect(
        () =>
            over(['cat1', 'cat2']).processPayload(render('s1', 'cat1', beta())),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a catalog the processor does not support', () {
      expect(
        () => over(['cat1']).processPayload(render('s1', 'cat2', alpha())),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.catalogId,
            'catalogId',
            'cat2',
          ),
        ),
      );
      expect(
        () => over([
          'cat1',
        ]).processPayload(render('s1', 'cat1', alpha(catalogId: 'cat2'))),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rejects an incremental payload it cannot attribute', () {
      // Several catalogs supported, none named: nothing settles which one the
      // component belongs to, and reporting it valid would mean reporting a
      // payload nothing had checked.
      expect(
        () => over(['cat1', 'cat2']).processPayload(incremental(alpha())),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('MessageProcessor.processPayload', () {
    test('returns the parsed messages for a valid payload', () async {
      final MessageProcessor<ComponentApi> processor = newProcessor();

      final List<A2uiMessage> messages = processor.processPayload([
        createSurface(),
        updateComponents([card('root', 'label'), text('label', 'Hello')]),
      ]);

      expect(messages, hasLength(2));
      expect(messages.first, isA<CreateSurfaceMessage>());
    });

    test('rejects an unsupported version before any deep check runs', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();

      expect(
        () => processor.processPayload([createSurface(version: 'v1.0')]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('reports a structural failure before a catalog failure', () {
      final MessageProcessor<ComponentApi> processor = newProcessor();

      // `root` is both a dangling reference and missing its required `text`.
      // Structure runs first, so the integrity error is what surfaces.
      expect(
        () => processor.processPayload([
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
