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
            isA<A2uiValidationError>().having(
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
            List<ComponentApi> components) =>
        MessageProcessor<ComponentApi>(
          catalogs: [
            Catalog<ComponentApi, FunctionImplementation>(
              id: 'cat',
              components: components,
            ),
          ],
          protocolVersion: A2uiProtocolVersion.v0_9,
        );

    Map<String, Object?> inlineComponents(
      MessageProcessor<ComponentApi> processor,
      A2uiProtocolVersion version, {
      String? componentEnvelopeRef,
    }) {
      final Map<String, Object?> json = processor
          .getRendererCapabilities(
            CapabilitiesOptions(
              versions: [version],
              includeInlineCatalogs: true,
              componentEnvelopeRef: componentEnvelopeRef,
            ),
          )
          .toJson();
      final versionCaps = json[version.jsonValue]! as Map<String, Object?>;
      final inline = versionCaps['inlineCatalogs']! as List<Object?>;
      final catalog = inline.single! as Map<String, Object?>;
      return catalog['components']! as Map<String, Object?>;
    }

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

    test('keeps anyOf and oneOf branches in the legacy shape', () {
      final MessageProcessor<ComponentApi> processor = processorFor([
        ComponentApi(
          name: 'Either',
          schema: Schema.combined(
            oneOf: [
              Schema.object(
                properties: {'x': Schema.string()},
                required: ['x'],
              ),
              Schema.object(
                properties: {'y': Schema.string()},
                required: ['y'],
              ),
            ],
          ),
        ),
        ComponentApi(
          name: 'Any',
          schema: Schema.fromMap({
            'type': 'object',
            'properties': {
              'z': {'type': 'boolean'},
            },
            'anyOf': [
              {
                'required': ['z'],
              },
            ],
          }),
        ),
      ]);

      expect(inlineComponents(processor, A2uiProtocolVersion.v0_9_1), {
        'Either': {
          'allOf': [
            {r'$ref': legacyEnvelope},
            {
              'properties': {
                'component': {'const': 'Either'},
              },
              'required': ['component'],
              'oneOf': [
                {
                  'properties': {
                    'x': {'type': 'string'},
                  },
                  'required': ['x'],
                },
                {
                  'properties': {
                    'y': {'type': 'string'},
                  },
                  'required': ['y'],
                },
              ],
            },
          ],
        },
        'Any': {
          'allOf': [
            {r'$ref': legacyEnvelope},
            {
              'properties': {
                'component': {'const': 'Any'},
                'z': {'type': 'boolean'},
              },
              'required': ['component'],
              'anyOf': [
                {
                  'required': ['z'],
                },
              ],
            },
          ],
        },
      });
    });

    test('honors componentEnvelopeRef in the legacy shape', () {
      final MessageProcessor<ComponentApi> processor = processorFor([
        ComponentApi(name: 'Plain', schema: Schema.object()),
      ]);

      expect(
        inlineComponents(
          processor,
          A2uiProtocolVersion.v0_9,
          componentEnvelopeRef: 'custom.json#/Envelope',
        ),
        {
          'Plain': {
            'allOf': [
              {r'$ref': 'custom.json#/Envelope'},
              {
                'properties': {
                  'component': {'const': 'Plain'},
                },
                'required': ['component'],
              },
            ],
          },
        },
      );
    });

    test('emits the standalone catalog document for v1.0', () {
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
        protocolVersion: A2uiProtocolVersion.v0_9,
      );

      final Map<String, Object?> json = processor
          .getRendererCapabilities(
            const CapabilitiesOptions(
              versions: [A2uiProtocolVersion.v1_0],
              includeInlineCatalogs: true,
            ),
          )
          .toJson();

      expect(json, {
        'v1.0': {
          'supportedCatalogIds': ['cat'],
          'inlineCatalogs': [catalog.catalogSchema],
        },
      });
    });

    test('wraps v1.0 components in componentEnvelopeRef when given', () {
      final schema = Schema.object(
        properties: {'text': Schema.string()},
      );
      final MessageProcessor<ComponentApi> processor = processorFor([
        ComponentApi(name: 'Label', schema: schema),
      ]);

      expect(
        inlineComponents(
          processor,
          A2uiProtocolVersion.v1_0,
          componentEnvelopeRef: 'custom.json#/Envelope',
        ),
        {
          'Label': {
            'allOf': [
              {r'$ref': 'custom.json#/Envelope'},
              schema.value,
            ],
          },
        },
      );
    });

    test('resolves REF: descriptions to \$ref in both shapes', () {
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

      final legacyText = ((((legacy['Label']! as Map)['allOf'] as List)[1]
          as Map)['properties'] as Map)['text'] as Map;
      final currentText =
          ((current['Label']! as Map)['properties'] as Map)['text'] as Map;
      expect(legacyText[r'$ref'], r'common_types.json#/$defs/DynamicString');
      expect(currentText[r'$ref'], r'common_types.json#/$defs/DynamicString');
      expect(CommonSchemas.dynamicString.value['description'], descBefore);
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
        protocolVersion: A2uiProtocolVersion.v0_9,
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
    });
  });
}
