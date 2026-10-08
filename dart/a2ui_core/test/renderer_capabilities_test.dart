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
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

void main() {
  group('A2uiVersionCapabilities', () {
    test('parses supported catalog ids', () {
      final caps = A2uiVersionCapabilities.fromJson({
        'supportedCatalogIds': ['a', 'b'],
      });

      expect(caps.supportedCatalogIds, ['a', 'b']);
      expect(caps.inlineCatalogs, isEmpty);
    });

    test('parses inline catalogs into schema catalogs', () {
      final caps = A2uiVersionCapabilities.fromJson({
        'supportedCatalogIds': <String>[],
        'inlineCatalogs': [
          {
            'catalogId': 'inline',
            'components': {
              'Gauge': {'type': 'object'},
            },
          },
        ],
      });

      expect(caps.inlineCatalogs, hasLength(1));
      expect(caps.inlineCatalogs.single.id, 'inline');
      expect(caps.inlineCatalogs.single.components.keys, ['Gauge']);
    });

    test('rejects an inline catalog that is not an object', () {
      for (final malformed in <Object?>[null, 'nope', 42, <Object?>[]]) {
        expect(
          () => A2uiVersionCapabilities.fromJson({
            'supportedCatalogIds': <String>[],
            'inlineCatalogs': [malformed],
          }),
          throwsA(
            isA<A2uiCatalogError>().having(
              (e) => e.message,
              'message',
              contains('inlineCatalogs'),
            ),
          ),
          reason: '$malformed',
        );
      }
    });

    test('rejects inlineCatalogs that is not an array', () {
      for (final malformed in <Object?>['nope', 42, <String, Object?>{}]) {
        expect(
          () => A2uiVersionCapabilities.fromJson({
            'supportedCatalogIds': <String>[],
            'inlineCatalogs': malformed,
          }),
          throwsA(
            isA<A2uiCatalogError>().having(
              (e) => e.message,
              'message',
              contains('inlineCatalogs'),
            ),
          ),
          reason: '$malformed',
        );
      }
    });

    test('rejects missing or malformed supportedCatalogIds', () {
      expect(
        () => A2uiVersionCapabilities.fromJson(<String, Object?>{}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => A2uiVersionCapabilities.fromJson({
          'supportedCatalogIds': [1, 2],
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('round trips through JSON', () {
      final caps = A2uiVersionCapabilities(supportedCatalogIds: ['a']);
      expect(caps.toJson(version: A2uiProtocolVersion.v0_9), {
        'supportedCatalogIds': ['a'],
      });
    });
  });

  group('A2uiRendererCapabilities', () {
    test('parses a v0.9 capabilities object', () {
      final caps = A2uiRendererCapabilities.fromJson({
        'v0.9': {
          'supportedCatalogIds': ['basic'],
        },
      });

      expect(caps.versions.keys, [A2uiProtocolVersion.v0_9]);
      expect(caps.forVersion(A2uiProtocolVersion.v0_9)!.supportedCatalogIds, [
        'basic',
      ]);
      expect(caps.unsupportedVersions, isEmpty);
    });

    test('records version entries this SDK does not implement', () {
      final caps = A2uiRendererCapabilities.fromJson({
        'v0.9': {
          'supportedCatalogIds': ['basic'],
        },
        'v2.0': {
          'supportedCatalogIds': ['basic'],
        },
      });

      expect(caps.unsupportedVersions, ['v2.0']);
    });

    test('rejects capabilities carrying no supported version entry', () {
      expect(
        () => A2uiRendererCapabilities.fromJson({
          'v2.0': {
            'supportedCatalogIds': ['basic'],
          },
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('supported version'),
          ),
        ),
      );
      expect(
        () => A2uiRendererCapabilities.fromJson(<String, Object?>{}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('builds capabilities from a list of catalog ids', () {
      final caps = A2uiRendererCapabilities.forCatalogIds(['basic']);
      expect(caps.forVersion(A2uiProtocolVersion.v0_9)!.supportedCatalogIds, [
        'basic',
      ]);
    });

    test('resolves capabilities for a supported version', () {
      final caps = A2uiRendererCapabilities.forCatalogIds(['basic']);
      expect(caps.forVersion(A2uiProtocolVersion.v0_9)!.supportedCatalogIds, [
        'basic',
      ]);
    });

    test('rejects a version entry that is not an object', () {
      expect(
        () => A2uiRendererCapabilities.fromJson({'v0.9': 'nope'}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('drops unimplemented version entries when serialising', () {
      final caps = A2uiRendererCapabilities.fromJson({
        'v0.9': {
          'supportedCatalogIds': ['basic'],
        },
        'v1.0': {
          'supportedCatalogIds': ['basic', 'extra'],
        },
        'v2.0': {
          'supportedCatalogIds': ['basic'],
        },
      });

      expect(caps.unsupportedVersions, ['v2.0']);
      expect(caps.toJson(), {
        'v0.9': {
          'supportedCatalogIds': ['basic'],
        },
        'v1.0': {
          'supportedCatalogIds': ['basic', 'extra'],
        },
      });
    });

    test('round trips a multi-version object through JSON', () {
      final json = {
        'v0.9': {
          'supportedCatalogIds': ['basic'],
        },
        'v0.9.1': {
          'supportedCatalogIds': ['basic'],
        },
        'v1.0': {
          'supportedCatalogIds': ['basic', 'extra'],
        },
      };
      expect(A2uiRendererCapabilities.fromJson(json).toJson(), json);
    });

    test('resolves a compatible version when the exact one is undeclared', () {
      final caps = A2uiRendererCapabilities.fromJson({
        'v0.9.1': {
          'supportedCatalogIds': ['basic'],
        },
      });
      expect(
        caps.forVersion(A2uiProtocolVersion.v0_9)!.supportedCatalogIds,
        ['basic'],
      );
      expect(caps.forVersion(A2uiProtocolVersion.v1_0), isNull);
    });
  });

  group('MessageProcessor.getRendererCapabilities', () {
    const legacyEnvelope = r'common_types.json#/$defs/ComponentCommon';

    MessageProcessor<ComponentApi> processorFor(
      List<ComponentApi> components, {
      List<FunctionImplementation> functions = const [],
      Schema? themeSchema,
    }) =>
        MessageProcessor<ComponentApi>(
          catalogs: [
            Catalog<ComponentApi, FunctionImplementation>(
              id: 'cat',
              components: components,
              functions: functions,
              themeSchema: themeSchema,
            ),
          ],
          defaultVersion: A2uiProtocolVersion.v0_9,
        );

    Map<String, Object?> inlineCatalog(
      MessageProcessor<ComponentApi> processor,
      A2uiProtocolVersion version,
    ) {
      final Map<String, Object?> json = processor
          .getRendererCapabilities(
            CapabilitiesOptions(
              versions: [version],
              includeInlineCatalogs: true,
            ),
          )
          .toJson();
      final versionCaps = json[version.jsonValue]! as Map<String, Object?>;
      final inline = versionCaps['inlineCatalogs']! as List<Object?>;
      return inline.single! as Map<String, Object?>;
    }

    Map<String, Object?> inlineComponents(
      MessageProcessor<ComponentApi> processor,
      A2uiProtocolVersion version,
    ) =>
        inlineCatalog(processor, version)['components']!
            as Map<String, Object?>;

    Map<String, Object?> legacyBody(
      Map<String, Object?> components,
      String name,
    ) =>
        ((components[name]! as Map)['allOf'] as List)[1]
            as Map<String, Object?>;

    test('rejects an empty version list', () {
      final MessageProcessor<ComponentApi> processor = processorFor([]);
      expect(
        () => processor.getRendererCapabilities(
          const CapabilitiesOptions(versions: []),
        ),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('At least one protocol version'),
          ),
        ),
      );
    });

    test('emits one entry per requested version', () {
      final MessageProcessor<ComponentApi> processor = processorFor([]);
      final A2uiRendererCapabilities caps = processor.getRendererCapabilities(
        const CapabilitiesOptions(
          versions: [A2uiProtocolVersion.v0_9, A2uiProtocolVersion.v1_0],
        ),
      );
      expect(caps.toJson(), {
        'v0.9': {
          'supportedCatalogIds': ['cat'],
        },
        'v1.0': {
          'supportedCatalogIds': ['cat'],
        },
      });
    });

    test('flattens an allOf component schema in the legacy shape', () {
      final MessageProcessor<ComponentApi> processor = processorFor([
        ComponentApi(
          name: 'Merged',
          schema: Schema.combined(
            allOf: [
              Schema.object(
                properties: {'a': Schema.string()},
                required: ['a'],
              ),
              Schema.object(
                properties: {
                  'id': Schema.string(),
                  'component': Schema.string(),
                  'b': Schema.integer(),
                },
                required: ['id', 'component', 'b'],
                additionalProperties: false,
              ),
            ],
          ),
        ),
      ]);

      expect(inlineComponents(processor, A2uiProtocolVersion.v0_9), {
        'Merged': {
          'allOf': [
            {r'$ref': legacyEnvelope},
            {
              'properties': {
                'component': {'const': 'Merged'},
                'a': {'type': 'string'},
                'b': {'type': 'integer'},
              },
              'required': ['component', 'a', 'b'],
            },
          ],
        },
      });
    });

    test('derives the legacy body from the catalog document', () {
      final MessageProcessor<ComponentApi> processor = processorFor([
        ComponentApi(
          name: 'Button',
          schema: Schema.object(
            description: 'A button.',
            properties: {
              'label': Schema.string(),
              'variant': Schema.string(),
            },
            required: ['label'],
            additionalProperties: false,
          ),
        ),
      ]);
      final Map<String, Object?> document =
          processor.catalogs.single.catalogSchema;
      final serialized =
          (document['components']! as Map)['Button'] as Map<String, Object?>;
      // The document form carries the v1.0 envelope keys the legacy body
      // leaves to its ComponentCommon wrapper.
      expect(serialized['type'], 'object');
      expect((serialized['properties']! as Map).keys, [
        'id',
        'component',
        'label',
        'variant',
      ]);

      final Map<String, Object?> body = legacyBody(
        inlineComponents(processor, A2uiProtocolVersion.v0_9_1),
        'Button',
      );
      expect(body, {
        'properties': {
          'component': {'const': 'Button'},
          'label': (serialized['properties']! as Map)['label'],
          'variant': (serialized['properties']! as Map)['variant'],
        },
        'required': ['component', 'label'],
      });
    });

    test('remaps bundled common-type refs to common_types.json', () {
      final MessageProcessor<ComponentApi> processor = processorFor([
        ComponentApi(
          name: 'Label',
          schema: Schema.object(
            properties: {'text': CommonSchemas.dynamicString},
          ),
        ),
      ]);
      final Object? descBefore =
          CommonSchemas.dynamicString.value['description'];

      final Map<String, Object?> legacy =
          inlineComponents(processor, A2uiProtocolVersion.v0_9);
      final Map<String, Object?> current =
          inlineComponents(processor, A2uiProtocolVersion.v1_0);

      final legacyText =
          (legacyBody(legacy, 'Label')['properties'] as Map)['text'] as Map;
      final currentText =
          ((current['Label']! as Map)['properties'] as Map)['text'] as Map;
      // The legacy shape has no `$defs`, so the bundled local ref becomes the
      // relative common_types.json ref again.
      expect(legacyText[r'$ref'], r'common_types.json#/$defs/DynamicString');
      expect(legacyText['description'], descBefore);
      expect(currentText[r'$ref'], r'#/$defs/DynamicString');
      expect(CommonSchemas.dynamicString.value['description'], descBefore);
    });

    test('inlines resolvable local refs and drops dangling ones', () {
      final MessageProcessor<ComponentApi> processor = processorFor(
        [
          ComponentApi(
            name: 'Themed',
            schema: Schema.fromMap({
              'type': 'object',
              'properties': {
                'palette': {
                  r'$ref': r'#/$defs/theme',
                  'description': 'The palette.',
                },
                'base': {
                  r'$ref': r'#/$defs/Base',
                  'description': 'Not in this catalog.',
                },
              },
            }),
          ),
        ],
        themeSchema: Schema.object(
          properties: {'primary': Schema.string()},
        ),
      );

      final Map<String, Object?> body = legacyBody(
        inlineComponents(processor, A2uiProtocolVersion.v0_9),
        'Themed',
      );
      expect((body['properties'] as Map)['palette'], {
        'type': 'object',
        'properties': {
          'primary': {'type': 'string'},
        },
        'description': 'The palette.',
      });
      expect((body['properties'] as Map)['base'], {
        'description': 'Not in this catalog.',
      });
    });

    test('emits legacy functions and theme from the catalog document', () {
      final MessageProcessor<ComponentApi> processor = processorFor(
        [],
        functions: [
          _AddFunction(),
        ],
        themeSchema: Schema.object(
          properties: {
            'primaryColor': Schema.string(description: 'The main color'),
          },
        ),
      );

      final Map<String, Object?> legacy =
          inlineCatalog(processor, A2uiProtocolVersion.v0_9);
      expect(legacy['functions'], [
        {
          'name': 'add',
          'description': 'Adds two numbers.',
          'returnType': 'number',
          'parameters': {
            'type': 'object',
            'properties': {
              'a': {'type': 'number'},
              'b': {'type': 'number'},
            },
            'required': ['a', 'b'],
          },
        },
      ]);
      expect(legacy['theme'], {
        'primaryColor': {'type': 'string', 'description': 'The main color'},
      });
      expect(legacy.containsKey('components'), isFalse);
    });

    test('emits a copy of the catalog document for v1.0', () {
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'cat',
        components: [
          ComponentApi(
            name: 'Label',
            schema: Schema.object(
              properties: {'text': Schema.string()},
              required: ['text'],
            ),
          ),
        ],
      );
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [catalog],
        defaultVersion: A2uiProtocolVersion.v0_9,
      );
      const options = CapabilitiesOptions(
        versions: [A2uiProtocolVersion.v1_0],
        includeInlineCatalogs: true,
      );

      final Map<String, Object?> json =
          processor.getRendererCapabilities(options).toJson();
      expect(json, {
        'v1.0': {
          'supportedCatalogIds': ['cat'],
          'inlineCatalogs': [catalog.catalogSchema],
        },
      });

      // catalogSchema is memoized, so the emitter must hand out a copy:
      // mutating the result leaves the catalog, and a second call, intact.
      final inline = ((json['v1.0']! as Map)['inlineCatalogs'] as List).single
          as Map<String, Object?>;
      expect(identical(inline, catalog.catalogSchema), isFalse);
      (inline['components']! as Map).remove('Label');
      expect((catalog.catalogSchema['components']! as Map).keys, ['Label']);
      expect(
        processor.getRendererCapabilities(options).toJson(),
        json
          ..['v1.0'] = {
            'supportedCatalogIds': ['cat'],
            'inlineCatalogs': [catalog.catalogSchema],
          },
      );
    });
  });

  group('A2uiVersionCapabilities.toJson', () {
    final catalog = Catalog<ComponentApi, FunctionApi>(
      id: 'cat',
      components: [ComponentApi(name: 'Plain', schema: Schema.object())],
    );
    final caps = A2uiVersionCapabilities(
      supportedCatalogIds: ['cat'],
      inlineCatalogs: [catalog],
    );

    test('emits the legacy inline catalog shape below v1.0', () {
      expect(caps.toJson(version: A2uiProtocolVersion.v0_9), {
        'supportedCatalogIds': ['cat'],
        'inlineCatalogs': [
          {
            'catalogId': 'cat',
            'components': {
              'Plain': {
                'allOf': [
                  {r'$ref': r'common_types.json#/$defs/ComponentCommon'},
                  {
                    'properties': {
                      'component': {'const': 'Plain'},
                    },
                    'required': ['component'],
                  },
                ],
              },
            },
          },
        ],
      });
    });

    test('emits the catalog schema document at v1.0', () {
      expect(caps.toJson(version: A2uiProtocolVersion.v1_0), {
        'supportedCatalogIds': ['cat'],
        'inlineCatalogs': [catalog.catalogSchema],
      });
    });

    test('matches the processor emitter for every version', () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [
          Catalog<ComponentApi, FunctionImplementation>(
            id: 'cat',
            components: [ComponentApi(name: 'Plain', schema: Schema.object())],
          ),
        ],
        defaultVersion: A2uiProtocolVersion.v0_9,
      );
      final Map<String, Object?> emitted = processor
          .getRendererCapabilities(
            const CapabilitiesOptions(
              versions: A2uiProtocolVersion.values,
              includeInlineCatalogs: true,
            ),
          )
          .toJson();
      expect(emitted, {
        for (final A2uiProtocolVersion version in A2uiProtocolVersion.values)
          version.jsonValue: caps.toJson(version: version),
      });
      // Pin the shapes independently of toJson: both v0.9 releases share the
      // legacy shape, and v1.0 carries the catalog document.
      expect(emitted['v0.9.1'], emitted['v0.9']);
      expect(
        ((emitted['v0.9']! as Map)['inlineCatalogs'] as List).single,
        isNot(contains(r'$schema')),
      );
      expect((emitted['v1.0']! as Map)['inlineCatalogs'], [
        catalog.catalogSchema,
      ]);
    });
  });
}

class _AddFunction extends FunctionImplementation {
  _AddFunction()
      : super(
          name: 'add',
          description: 'Adds two numbers.',
          returnType: A2uiReturnType.number,
          argumentSchema: Schema.object(
            properties: {'a': Schema.number(), 'b': Schema.number()},
            required: ['a', 'b'],
          ),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      (args['a']! as num) + (args['b']! as num);
}
