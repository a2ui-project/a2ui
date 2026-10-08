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

CatalogApi testCatalog() => Catalog.fromJson(testCatalogDocument());

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
}) =>
    PayloadValidator(
      catalog: testCatalog(),
      protocolVersion: A2uiProtocolVersion.v0_9,
      commonTypesSchema: withCommonTypes ? commonTypes() : const {},
    );

/// A processor over [testCatalog], for the payload-level checks.
///
/// Structure and catalog checks span a whole payload, and a payload may name
/// several catalogs, so they run on the processor rather than on a validator
/// scoped to one catalog.
MessageProcessor<ComponentApi> newProcessor({
  bool withCommonTypes = false,
  ValidationConfig validationConfig = ValidationConfig.strict,
}) =>
    MessageProcessor<ComponentApi>(
      catalogs: [rendererCatalog(testCatalogDocument())],
      protocolVersion: A2uiProtocolVersion.v0_9,
      validationConfig: validationConfig,
      commonTypesSchema: withCommonTypes ? commonTypes() : const {},
    );

/// A processor for a surface that arrives across several payloads.
///
/// The root, the references and the reachable set answer for the surface a
/// payload leaves behind, so a payload carrying one instalment of a render
/// fails the strict default. A caller whose transport works that way relaxes
/// them; see [ValidationConfig].
MessageProcessor<ComponentApi> newStreamingProcessor() =>
    newProcessor(validationConfig: ValidationConfig.relaxed);

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
AgentToRendererMessagePayload parse(List<Map<String, Object?>> payload) =>
    AgentToRendererMessage.parseAll(
      payload,
      protocolVersion: A2uiProtocolVersion.v0_9,
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
  v1RulesTests();

  group('PayloadValidator version gating', () {
    test('accepts payloads declaring the supported version', () {
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          newValidator();

      expect(validator.checkVersion(createSurface()), A2uiProtocolVersion.v0_9);
      expect(
        validator.checkVersion(createSurface(version: 'v0.9.1')),
        A2uiProtocolVersion.v0_9,
      );
      expect(parse([createSurface()]).messages, hasLength(1));
      expect(
        parse([createSurface()]).messages.single,
        isA<CreateSurfaceMessage>(),
      );
    });

    test('rejects payloads declaring another protocol version', () {
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          newValidator();

      for (final version in ['v0.8', 'v1.0']) {
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
        () => PayloadValidator.forVersion('v0.8', catalog: testCatalog()),
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
    group('under a relaxed ValidationConfig', () {
      test('accepts a payload that renders only part of a surface', () {
        final MessageProcessor<ComponentApi> processor =
            newStreamingProcessor();

        // No root, a reference to a component that never arrives, and a
        // component nothing points at: all three of the checks that wait on
        // the rest of the render.
        expect(
          () => processor.processMessages(
            parse([
              createSurface(),
              updateComponents([card('panel', 'missing'), text('aside')]),
            ]),
          ),
          returnsNormally,
        );
      });

      test('still rejects what no later payload can repair', () {
        final MessageProcessor<ComponentApi> processor =
            newStreamingProcessor();

        expect(
          () => processor.processMessages(
            parse([
              createSurface(),
              updateComponents([card('root', 'root')]),
            ]),
          ),
          throwsA(isA<A2uiRecursionError>()),
        );
      });

      test('relaxes one check without relaxing the others', () {
        final MessageProcessor<ComponentApi> processor = newProcessor(
          validationConfig: const ValidationConfig(allowMissingRoot: true),
        );

        // The root is excused; the reference it carries is not.
        expect(
          () => processor.processMessages(
            parse([
              createSurface(),
              updateComponents([card('panel', 'missing')]),
            ]),
          ),
          throwsA(
            isA<A2uiIntegrityError>().having(
              (e) => e.message,
              'message',
              contains('references non-existent component'),
            ),
          ),
        );
      });
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
      final AgentToRendererMessagePayload messages = parse([
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

    test('enforces common_types definitions when they are supplied', () {
      final MessageProcessor<ComponentApi> processor = newProcessor(
        withCommonTypes: true,
      );
      final AgentToRendererMessagePayload messages = parse([
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
      // reference itself is skipped rather than failing the payload. The
      // component `row` it names is never declared, so the graph checks are
      // relaxed to leave the schema question on its own.
      final MessageProcessor<ComponentApi> processor = newStreamingProcessor();
      final AgentToRendererMessagePayload messages = parse([
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
                // v1.0 lets a component name a catalog of its own,
                // overriding the surface-level default.
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
    ) =>
        rendererCatalog(namedCatalogDocument(id, component));

    /// A processor supporting [ids], each with one component named after it.
    // Strict, so that a type the catalog does not declare is rejected rather
    // than tolerated as it is without a config.
    MessageProcessor<ComponentApi> over(List<String> ids) =>
        MessageProcessor<ComponentApi>(
          catalogs: [
            for (final String id in ids)
              namedCatalog(id, id == 'cat1' ? 'Alpha' : 'Beta'),
          ],
          protocolVersion: A2uiProtocolVersion.v0_9,
          validationConfig: ValidationConfig.strict,
        );

    /// A processor over [ids] already holding surface `s1`, created against
    /// [surfaceCatalog]. An incremental payload updates a surface the client
    /// has, so the surface and its catalog are established first.
    MessageProcessor<ComponentApi> holding(
      List<String> ids, {
      required String surfaceCatalog,
    }) {
      final MessageProcessor<ComponentApi> processor = over(ids);
      processor.processMessages(
        AgentToRendererMessage.parseAll([
          {
            'version': 'v0.9',
            'createSurface': {'surfaceId': 's1', 'catalogId': surfaceCatalog},
          },
        ], protocolVersion: A2uiProtocolVersion.v0_9),
      );
      return processor;
    }

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
    ) =>
        [
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
          if (catalogId != null) 'catalogId': catalogId,
          'a': 'x',
        };
    Map<String, Object?> beta({String? catalogId}) => {
          'id': 'root',
          'component': 'Beta',
          if (catalogId != null) 'catalogId': catalogId,
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
        () => holding(['cat1'], surfaceCatalog: 'cat1').processMessages(
          AgentToRendererMessage.parseAll(
            incremental(alpha()),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        ),
        returnsNormally,
      );
      expect(
        () => holding(['cat1'], surfaceCatalog: 'cat1').processMessages(
          AgentToRendererMessage.parseAll(
            incremental(bogus),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a component belonging to another catalog', () {
      expect(
        () => holding(['cat2'], surfaceCatalog: 'cat2').processMessages(
          AgentToRendererMessage.parseAll(
            incremental(alpha()),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('checks each surface against the catalog it names', () {
      // A renderer supports several catalogs at once, and one payload may
      // create surfaces against different ones.
      expect(
        () => over(['cat1', 'cat2']).processMessages(
          AgentToRendererMessage.parseAll([
            ...render('s1', 'cat1', alpha()),
            ...render('s2', 'cat2', beta()),
          ], protocolVersion: A2uiProtocolVersion.v0_9),
        ),
        returnsNormally,
      );
      expect(
        () => over(['cat1', 'cat2']).processMessages(
          AgentToRendererMessage.parseAll([
            ...render('s1', 'cat1', beta()),
          ], protocolVersion: A2uiProtocolVersion.v0_9),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('checks a component against the catalog it names for itself', () {
      // v1.0 lets one surface mix catalogs: a component may override the
      // surface-level default with a `catalogId` of its own. The component
      // below is not in the surface's catalog, and passes only because it
      // names the catalog it does belong to.
      expect(
        () => over(['cat1', 'cat2']).processMessages(
          AgentToRendererMessage.parseAll(
            render('s1', 'cat1', beta(catalogId: 'cat2')),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        ),
        returnsNormally,
      );
      expect(
        () => over(['cat1', 'cat2']).processMessages(
          AgentToRendererMessage.parseAll(
            render('s1', 'cat1', beta()),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a catalog the processor does not support', () {
      expect(
        () => over(['cat1']).processMessages(
          AgentToRendererMessage.parseAll(
            render('s1', 'cat2', alpha()),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        ),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.catalogId,
            'catalogId',
            'cat2',
          ),
        ),
      );
      expect(
        () => over(['cat1']).processMessages(
          AgentToRendererMessage.parseAll(
            render('s1', 'cat1', alpha(catalogId: 'cat2')),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test(
      'A2uiIntegrityError and A2uiRecursionError are A2uiValidationErrors',
      () {
        final integrity = A2uiIntegrityError('integrity message');
        final recursion = A2uiRecursionError('recursion message');

        expect(integrity, isA<A2uiValidationError>());
        expect(integrity.code, 'INTEGRITY_ERROR');
        expect(recursion, isA<A2uiValidationError>());
        expect(recursion.code, 'RECURSION_ERROR');
      },
    );
  });
}

const String _v1CommonTypes =
    'https://a2ui.org/specification/v1_0/common_types.json';
const String _v0_9CommonTypes =
    'https://a2ui.org/specification/v0_9/common_types.json';

/// A function document shaped as a protocol version spells a call: `@call` from
/// v1.0, `call` before it.
Map<String, Object?> _functionDocument(String name, {required bool v1}) => {
      'type': 'object',
      'properties': {
        if (v1) '@call': {'const': name} else 'call': {'const': name},
        'args': {
          'type': 'object',
          'properties': {
            'value': {'type': 'string'},
          },
          'required': ['value'],
          'additionalProperties': false,
        },
      },
      'required': [if (v1) '@call' else 'call', 'args'],
    };

/// A catalog with one `Box` component whose `value` is a `DynamicValue` (v1.0)
/// or `DynamicString` (v0.9), one `Loose` component whose `value` is
/// unconstrained, and one function `f` taking a string `value`.
CatalogApi _versionedCatalog(String? protocolVersion) {
  final bool v1 = protocolVersion == 'v1.0' || protocolVersion == '1.0';
  final String common = v1 ? _v1CommonTypes : _v0_9CommonTypes;
  return Catalog.fromJson({
    'catalogId': 'versioned',
    if (protocolVersion != null) 'protocolVersion': protocolVersion,
    'components': {
      'Box': {
        'type': 'object',
        'properties': {
          'value': {
            r'$ref': v1
                ? '$common#/\$defs/DynamicValue'
                : '$common#/\$defs/DynamicString',
          },
        },
        'additionalProperties': false,
      },
      'Loose': {
        'type': 'object',
        'properties': {'value': <String, Object?>{}},
        'additionalProperties': false,
      },
    },
    'functions': {'f': _functionDocument('f', v1: v1)},
  });
}

PayloadValidator<ComponentApi, FunctionApi> _versionedValidator(
  String? protocolVersion, {
  ValidationConfig config = ValidationConfig.strict,
}) =>
    PayloadValidator(
      catalog: _versionedCatalog(protocolVersion),
      config: config,
    );

Map<String, Object?> _box(Object? value, {String type = 'Box'}) => {
      'id': 'b',
      'component': type,
      'value': value,
    };

Matcher _validationError({String? code, String? path, Object? message}) =>
    isA<A2uiValidationError>()
        .having((e) => e.code, 'code', code ?? anything)
        .having((e) => e.path, 'path', path ?? anything)
        .having((e) => e.message, 'message', message ?? anything);

void v1RulesTests() {
  group('PayloadValidator catalog-driven versioning', () {
    test('resolves against the common types of the catalog version', () {
      expect(
        _versionedValidator('v1.0').commonTypesSchema[r'$id'],
        'https://a2ui.org/specification/v1_0/common_types.json',
      );
      expect(
        _versionedValidator('1.0').commonTypesSchema[r'$id'],
        'https://a2ui.org/specification/v1_0/common_types.json',
      );
      expect(
        _versionedValidator('v0.9').commonTypesSchema[r'$id'],
        'https://a2ui.org/specification/v0_9/common_types.json',
      );
      expect(
        _versionedValidator(null).commonTypesSchema[r'$id'],
        'https://a2ui.org/specification/v0_9/common_types.json',
      );
    });

    test('lets an explicit common types document override the default', () {
      expect(
        PayloadValidator<ComponentApi, FunctionApi>(
          catalog: _versionedCatalog('v1.0'),
          commonTypesSchema: const {},
        ).commonTypesSchema,
        isEmpty,
      );
    });

    test('Catalog.fromJson keeps the declared protocolVersion', () {
      final CatalogApi catalog = _versionedCatalog('v1.0');

      expect(catalog.protocolVersion, A2uiProtocolVersion.v1_0);
      expect(catalog.copyWith().protocolVersion, A2uiProtocolVersion.v1_0);
      expect(catalog.catalogSchema['protocolVersion'], '1.0');
      expect(_versionedCatalog(null).protocolVersion, isNull);
    });
  });

  group('PayloadValidator envelope stripping', () {
    test('validates an allOf schema that forbids additional properties', () {
      final CatalogApi catalog = Catalog.fromJson({
        'catalogId': 'strict',
        'components': {
          'Strict': {
            'type': 'object',
            'allOf': [
              {
                'properties': {
                  'label': {'type': 'string'},
                },
              },
            ],
            'properties': {
              'component': {'const': 'Strict'},
              'label': {'type': 'string'},
            },
            'required': ['component', 'label'],
            'additionalProperties': false,
          },
        },
      });
      final validator = PayloadValidator<ComponentApi, FunctionApi>(
        catalog: catalog,
      );

      expect(
        () => validator.validateComponent({
          'id': 's',
          'component': 'Strict',
          'catalogId': 'strict',
          'label': 'x',
        }),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent({
          'id': 's',
          'component': 'Strict',
          'label': 'x',
          'extra': 1,
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('accepts v1.0 metadata and accessibility on a closed schema', () {
      expect(
        () => _versionedValidator('v1.0').validateComponent({
          ..._box('x'),
          'metadata': {'extensions': <String, Object?>{}},
          'accessibility': {'label': 'Box'},
        }),
        returnsNormally,
      );
    });

    test('does not walk v1.0 metadata extensions for directives', () {
      expect(
        () => _versionedValidator('v1.0').validateComponent({
          ..._box('x'),
          'metadata': {
            'extensions': {
              'ld': {'@context': 'https://schema.org'},
            },
          },
        }),
        returnsNormally,
      );
      expect(
        () => _versionedValidator('v1.0').validateComponent({
          ..._box('x'),
          'metadata': {
            'extensions': {'bad-key': 1},
          },
        }),
        throwsA(_validationError(path: '/metadata/extensions/bad-key')),
      );
    });

    test('still checks v1.0 accessibility against the common types', () {
      expect(
        () => _versionedValidator('v1.0').validateComponent({
          ..._box('x'),
          'accessibility': {'live': 'loudly'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('PayloadValidator v1.0 identifiers', () {
    test('rejects a component id that is not a UAX #31 identifier', () {
      expect(
        () => _versionedValidator('v1.0').validateComponent({
          ..._box('x'),
          'id': 'bad-id',
        }),
        throwsA(_validationError(path: '/id')),
      );
      expect(
        () => _versionedValidator('v0.9').validateComponent({
          ..._box('x'),
          'id': 'bad-id',
        }),
        returnsNormally,
      );
    });

    test('Catalog.fromJson rejects non-identifier names from v1.0', () {
      expect(
        () => Catalog.fromJson({
          'catalogId': 'c',
          'protocolVersion': 'v1.0',
          'components': {
            'my-box': {'type': 'object'},
          },
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => Catalog.fromJson({
          'catalogId': 'c',
          'protocolVersion': 'v1.0',
          'components': {
            '@Box': {'type': 'object'},
          },
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => Catalog.fromJson({
          'catalogId': 'c',
          'protocolVersion': 'v1.0',
          'functions': {
            'bad-fn': _functionDocument('bad-fn', v1: true),
          },
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => Catalog.fromJson({
          'catalogId': 'c',
          'protocolVersion': 'v1.0',
          'functions': {
            'f': {
              'type': 'object',
              'properties': {
                '@call': {'const': 'f'},
                'args': {
                  'type': 'object',
                  'properties': {
                    'bad-arg': {'type': 'string'},
                  },
                },
              },
            },
          },
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('Catalog.fromJson checks names reached through \$ref and allOf', () {
      // The property name arrives through a local `$defs` mixin, so it is only
      // visible once local references are inlined.
      expect(
        () => Catalog.fromJson({
          'catalogId': 'c',
          'protocolVersion': 'v1.0',
          r'$defs': {
            'Mixin': {
              'type': 'object',
              'properties': {
                'bad-prop': {'type': 'string'},
              },
            },
          },
          'components': {
            'Box': {
              'type': 'object',
              'allOf': [
                {r'$ref': r'#/$defs/Mixin'},
              ],
            },
          },
        }),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('bad-prop'),
          ),
        ),
      );
      // A well-formed name through the same path is accepted.
      expect(
        Catalog.fromJson({
          'catalogId': 'c',
          'protocolVersion': 'v1.0',
          r'$defs': {
            'Mixin': {
              'type': 'object',
              'properties': {
                'label': {'type': 'string'},
              },
            },
          },
          'components': {
            'Box': {
              'type': 'object',
              'allOf': [
                {r'$ref': r'#/$defs/Mixin'},
              ],
            },
          },
        }).components['Box']!.schema.value['properties'],
        containsPair('label', anything),
      );
    });

    test('rejects a call argument name that is not an identifier', () {
      expect(
        () => _versionedValidator('v1.0').validateComponent(
          _box({
            '@call': 'unknownFn',
            'args': {'bad-arg': 1},
          }),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('PayloadValidator nested function calls', () {
    test('validates a nested v1.0 call against its function schema', () {
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          _versionedValidator('v1.0');

      expect(
        () => validator.validateComponent(
          _box({
            '@call': 'f',
            'args': {'value': 'ok'},
          }),
        ),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent(
          _box({
            '@call': 'f',
            'args': {'value': 3},
          }),
        ),
        throwsA(
          _validationError(path: '/value', message: contains("Call to 'f'")),
        ),
      );
    });

    test('a v0.9 catalog still validates calls keyed on call', () {
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          _versionedValidator('v0.9');

      expect(
        () => validator.validateComponent(
          _box({
            'call': 'f',
            'args': {'value': 'ok'},
          }),
        ),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent(
          _box({
            'call': 'f',
            'args': {'value': 3},
          }),
        ),
        throwsA(_validationError(message: contains("Call to 'f'"))),
      );
    });

    test('rejects an unknown nested function in a v0.9 catalog', () {
      expect(
        () => _versionedValidator('v0.9').validateComponent(
          _box({'call': 'nope', 'args': <String, Object?>{}}),
        ),
        throwsA(_validationError(message: contains("'nope'"))),
      );
    });

    test('allowUnknownElements admits an unknown v0.9 function', () {
      expect(
        () => _versionedValidator(
          'v0.9',
          config: const ValidationConfig(allowUnknownElements: true),
        ).validateComponent(
          _box({'call': 'nope', 'args': <String, Object?>{}}, type: 'Loose'),
        ),
        returnsNormally,
      );
    });

    test('accepts an unknown nested function in a v1.0 catalog', () {
      expect(
        () => _versionedValidator('v1.0').validateComponent(
          _box({
            '@call': 'nope',
            'args': {'anything': 1},
          }),
        ),
        returnsNormally,
      );
    });

    test('rejects a call with more than maxFunctionCallArgs arguments', () {
      Map<String, Object?> call(int count) => {
            '@call': 'nope',
            'args': {for (var i = 0; i < count; i++) 'a$i': i},
          };
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          _versionedValidator('v1.0');

      expect(maxFunctionCallArgs, 1000);
      expect(
        () => validator.validateComponent(_box(call(1000), type: 'Loose')),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent(_box(call(1001), type: 'Loose')),
        throwsA(_validationError(message: contains('1000'))),
      );
      expect(
        () => _versionedValidator('v0.9').validateFunction('f', {
          for (var i = 0; i < 1001; i++) 'a$i': 'x',
        }),
        throwsA(_validationError(message: contains('1000'))),
      );
    });

    group('a key named call that is not a call', () {
      // A v0.9 catalog whose `Caller` component declares a property named
      // `call`, and whose function `g` takes an argument named `call` and an
      // unconstrained `inner`.
      final PayloadValidator<ComponentApi, FunctionApi> validator =
          PayloadValidator(
        catalog: Catalog.fromJson({
          'catalogId': 'caller',
          'protocolVersion': '0.9',
          'components': {
            'Caller': {
              'type': 'object',
              'properties': {
                'call': {'type': 'string'},
                'value': <String, Object?>{},
              },
              'additionalProperties': false,
            },
          },
          'functions': {
            'g': {
              'type': 'object',
              'properties': {
                'call': {'const': 'g'},
                'args': {
                  'type': 'object',
                  'properties': {
                    'call': {'type': 'string'},
                    'inner': <String, Object?>{},
                  },
                  'additionalProperties': false,
                },
              },
              'required': ['call', 'args'],
            },
          },
        }),
        config: ValidationConfig.strict,
      );

      test('a component property named call is a property', () {
        expect(
          () => validator.validateComponent({
            'id': 'c',
            'component': 'Caller',
            'call': 'nope',
          }),
          returnsNormally,
        );
      });

      test('a function argument named call is an argument', () {
        expect(
          () => validator.validateComponent({
            'id': 'c',
            'component': 'Caller',
            'value': {
              'call': 'g',
              'args': {'call': 'nope'},
            },
          }),
          returnsNormally,
        );
      });

      test('a call inside an argument value is still checked', () {
        expect(
          () => validator.validateComponent({
            'id': 'c',
            'component': 'Caller',
            'value': {
              'call': 'g',
              'args': {
                'call': 'fine',
                'inner': {'call': 'nope', 'args': <String, Object?>{}},
              },
            },
          }),
          throwsA(
            _validationError(
              path: '/value/args/inner',
              message: contains("'nope'"),
            ),
          ),
        );
      });
    });
  });

  group('PayloadValidator v1.0 reserved keys', () {
    test('rejects unknown single-@ directives', () {
      for (final Map<String, Object?> value in [
        {'@if': true},
        {'@': 'x'},
      ]) {
        expect(
          () => _versionedValidator('v1.0').validateComponent(_box(value)),
          throwsA(_validationError(code: 'INVALID_RESERVED_KEY')),
          reason: '$value',
        );
      }
    });

    test('accepts escaped keys and v0.9 key names as literals', () {
      for (final Map<String, Object?> value in [
        {'@@path': '/x'},
        {'path': 'a', 'call': 'b'},
      ]) {
        expect(
          () => _versionedValidator('v1.0').validateComponent(_box(value)),
          returnsNormally,
          reason: '$value',
        );
      }
    });

    test('ignores @ keys in v0.9 catalogs', () {
      expect(
        () => _versionedValidator('v0.9').validateComponent(
          _box({'@if': true}, type: 'Loose'),
        ),
        returnsNormally,
      );
    });
  });

  group('schema reference resolution', () {
    test('an unresolvable local reference throws at load', () {
      expect(
        () => Catalog.fromJson({
          'catalogId': 'c',
          'components': {
            'Broken': {r'$ref': '#/components/Missing'},
          },
        }),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains("Unresolvable schema reference: '#/components/Missing'"),
          ),
        ),
      );
    });

    test('an unresolvable common types reference throws', () {
      final validator = PayloadValidator<ComponentApi, FunctionApi>(
        catalog: Catalog.fromJson({
          'catalogId': 'c',
          'components': {
            'Broken': {
              'type': 'object',
              'properties': {
                'x': {r'$ref': '$_v0_9CommonTypes#/\$defs/Missing'},
                'y': {r'$ref': r'#/$defs/AlsoMissing'},
              },
            },
          },
        }),
      );

      expect(
        () => validator.validateComponent({
          'id': 'b',
          'component': 'Broken',
          'x': 1,
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('a version-less catalog borrows only v1.0-only types', () {
      final validator = PayloadValidator<ComponentApi, FunctionApi>(
        catalog: Catalog.fromJson({
          'catalogId': 'c',
          'components': {
            'Slot': {
              'type': 'object',
              'properties': {
                'child': {r'$ref': r'common_types.json#/$defs/Child'},
                'label': {r'$ref': r'common_types.json#/$defs/DynamicString'},
              },
            },
          },
        }),
      );

      expect(
        () => validator.validateComponent({
          'id': 's',
          'component': 'Slot',
          'child': 'leaf',
          'label': {'path': '/name'},
        }),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent({
          'id': 's',
          'component': 'Slot',
          'label': {'@path': '/name'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a fragment that is not a JSON Pointer', () {
      expect(
        () => PayloadValidator<ComponentApi, FunctionApi>(
          catalog: Catalog.fromJson({
            'catalogId': 'c',
            'components': {
              'Anchored': {
                'type': 'object',
                'properties': {
                  'x': {r'$ref': '$_v0_9CommonTypes#anchor'},
                },
              },
            },
          }),
        ).validateComponent({'id': 'a', 'component': 'Anchored', 'x': 1}),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('follows list indices in pointers', () {
      final validator = PayloadValidator<ComponentApi, FunctionApi>(
        catalog: Catalog.fromJson({
          'catalogId': 'c',
          'components': {
            'Indexed': {
              'type': 'object',
              'properties': {
                'x': {
                  r'$ref': '$_v0_9CommonTypes#/\$defs/DynamicString/oneOf/0',
                },
              },
            },
          },
        }),
      );

      expect(
        () => validator.validateComponent({
          'id': 'i',
          'component': 'Indexed',
          'x': 'text',
        }),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent({
          'id': 'i',
          'component': 'Indexed',
          'x': 3,
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });
}
