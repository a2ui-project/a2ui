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

import 'package:a2ui_core/src/core/catalog.dart';
import 'package:a2ui_core/src/core/common_schemas.dart';
import 'package:a2ui_core/src/core/messages.dart';
import 'package:a2ui_core/src/core/minimal_catalog.dart';
import 'package:a2ui_core/src/core/renderer_capabilities.dart';
import 'package:a2ui_core/src/core/surface_model.dart';
import 'package:a2ui_core/src/primitives/errors.dart';
import 'package:a2ui_core/src/primitives/protocol_version.dart';
import 'package:a2ui_core/src/processing/processor.dart';
import 'package:a2ui_core/src/validation/validation_config.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

void main() {
  group('MessageProcessor catalog scope', () {
    Catalog<ComponentApi, FunctionImplementation> namedCatalog(
      String id,
      String component,
    ) =>
        Catalog<ComponentApi, FunctionImplementation>(
          id: id,
          components: [
            ComponentApi(
              name: component,
              schema: Schema.object(
                properties: {
                  'id': Schema.string(),
                  'component': Schema.string(),
                  'a': Schema.string(),
                },
                required: ['component', 'a'],
                additionalProperties: false,
              ),
            ),
          ],
        );

    late MessageProcessor<ComponentApi> processor;

    setUp(() {
      processor = MessageProcessor<ComponentApi>(
        catalogs: [namedCatalog('cat1', 'Alpha'), namedCatalog('cat2', 'Beta')],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.processMessages(
        AgentToRendererMessagePayload([
          CreateSurfaceMessage(
              version: 'v0.9', surfaceId: 's1', catalogId: 'cat1'),
          CreateSurfaceMessage(
              version: 'v0.9', surfaceId: 's2', catalogId: 'cat2'),
        ]),
      );
    });

    void update(String surfaceId, String component) =>
        processor.processMessages(
          AgentToRendererMessagePayload([
            UpdateComponentsMessage(
              version: 'v0.9',
              surfaceId: surfaceId,
              components: [
                {'id': 'root', 'component': component, 'a': 'x'},
              ],
            ),
          ]),
        );

    test('checks each surface against the catalog it was created with', () {
      // A processor supports several catalogs at once, but a component belongs
      // to exactly one. Each surface is checked against its own catalog, not
      // against the union of everything the processor supports.
      expect(() => update('s1', 'Alpha'), returnsNormally);
      expect(() => update('s2', 'Beta'), returnsNormally);
    });

    test('rejects a component from another surface\'s catalog', () {
      expect(() => update('s1', 'Beta'), throwsA(isA<A2uiValidationError>()));
      expect(() => update('s2', 'Alpha'), throwsA(isA<A2uiValidationError>()));
    });

    test('builds one validator per catalog and reuses it', () {
      final Catalog<ComponentApi, FunctionImplementation> cat1 =
          processor.catalogs.first;
      expect(processor.validatorFor(cat1).catalog.id, 'cat1');
      expect(
        processor.validatorFor(cat1),
        same(processor.validatorFor(cat1)),
        reason: 'resolved component schemas are cached on the validator',
      );
      expect(
        processor.validatorFor(processor.catalogs.last).catalog.id,
        'cat2',
      );
    });
  });

  group('MessageProcessor', () {
    late MinimalCatalog catalog;
    late MessageProcessor processor;

    setUp(() {
      catalog = MinimalCatalog();
      processor = MessageProcessor(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
    });

    group('component graph checks', () {
      /// A processor for a surface that arrives across several payloads.
      ///
      /// The root and the reachable set answer for the surface one payload
      /// leaves behind, so an instalment of a render fails the strict default.
      /// These cases are about what a later batch is checked against, so they
      /// relax the checks that span payloads; see [ValidationConfig].
      MessageProcessor streaming() => MessageProcessor(
            catalogs: [catalog],
            protocolVersion: A2uiProtocolVersion.v0_9,
            validationConfig: ValidationConfig.relaxed,
          );

      List<Map<String, Object?>> update(
        List<Map<String, Object?>> components,
      ) =>
          [
            {
              'version': 'v0.9',
              'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
            },
            {
              'version': 'v0.9',
              'updateComponents': {'surfaceId': 's1', 'components': components},
            },
          ];

      test('accepts a reference to a component the surface already holds', () {
        final MessageProcessor processor = streaming();
        // The payload-scoped validator cannot make this call: it waves the
        //second batch through because it cannot see the first.
        processor.processMessages(
          AgentToRendererMessage.parseAll(
            update([
              {'id': 'a', 'component': 'Text', 'text': 'held'},
            ]),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        );

        expect(
          () => processor.processMessages(
            AgentToRendererMessagePayload([
              UpdateComponentsMessage(
                version: 'v0.9',
                surfaceId: 's1',
                components: [
                  {
                    'id': 'root',
                    'component': 'Column',
                    'children': ['a'],
                  },
                ],
              ),
            ]),
          ),
          returnsNormally,
        );
      });

      test('rejects a cycle closed through an existing component', () {
        final MessageProcessor processor = streaming();
        processor.processMessages(
          AgentToRendererMessage.parseAll(
            update([
              {
                'id': 'a',
                'component': 'Column',
                'children': ['b'],
              },
              {'id': 'b', 'component': 'Text', 'text': 'leaf'},
            ]),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        );

        // Retyping `b` as a Column pointing back at `a` closes the loop only
        // when the existing components are taken into account.
        expect(
          () => processor.processMessages(
            AgentToRendererMessagePayload([
              UpdateComponentsMessage(
                version: 'v0.9',
                surfaceId: 's1',
                components: [
                  {
                    'id': 'b',
                    'component': 'Column',
                    'children': ['a'],
                  },
                ],
              ),
            ]),
          ),
          throwsA(isA<A2uiRecursionError>()),
        );
      });

      test('leaves the surface unchanged when the graph check fails', () {
        final MessageProcessor processor = streaming();
        processor.processMessages(
          AgentToRendererMessage.parseAll(
            update([
              {'id': 'a', 'component': 'Text', 'text': 'held'},
            ]),
            protocolVersion: A2uiProtocolVersion.v0_9,
          ),
        );

        // A duplicate id is settled by the batch alone, so it is rejected as
        // the batch arrives and nothing in it is applied.
        expect(
          () => processor.processMessages(
            AgentToRendererMessagePayload([
              UpdateComponentsMessage(
                version: 'v0.9',
                surfaceId: 's1',
                components: [
                  {'id': 'b', 'component': 'Text', 'text': 'new'},
                  {'id': 'b', 'component': 'Text', 'text': 'again'},
                ],
              ),
            ]),
          ),
          throwsA(isA<A2uiIntegrityError>()),
        );
        final SurfaceModel surface = processor.groupModel.getSurface('s1')!;
        expect(surface.componentsModel.get('b'), isNull);
        expect(surface.componentsModel.get('a'), isNotNull);
      });
    });

    test('processMessages applies a payload built from raw JSON', () {
      // What a transport hands over: decoded JSON in the wrapper shape, not
      // messages that have been through the models yet. Parsing it is the
      // payload type's job, so a transport normalizes nothing itself.
      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'messages': [
            {
              'version': 'v0.9',
              'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
            },
            {
              'version': 'v0.9',
              'updateDataModel': {
                'surfaceId': 's1',
                'path': '/greeting',
                'value': 'hello',
              },
            },
          ],
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      final SurfaceModel<ComponentApi> surface =
          processor.groupModel.getSurface('s1')!;
      expect(surface.dataModel.get('/greeting'), 'hello');
    });

    test('processMessages applies a lone message', () {
      processor.processMessages(
        AgentToRendererMessagePayload.of(
          CreateSurfaceMessage(
              version: 'v0.9', surfaceId: 's1', catalogId: catalog.id),
        ),
      );

      expect(processor.groupModel.getSurface('s1'), isNotNull);
    });

    test('processMessages applies a parsed payload', () {
      final AgentToRendererMessagePayload payload =
          AgentToRendererMessage.parseAll([
        {
          'version': 'v0.9',
          'createSurface': {'surfaceId': 's1', 'catalogId': catalog.id},
        },
      ], protocolVersion: A2uiProtocolVersion.v0_9);
      expect(payload.messages, hasLength(1));

      processor.processMessages(payload);

      expect(processor.groupModel.getSurface('s1'), isNotNull);
    });

    test('getRendererCapabilities emits both inline catalog shapes', () {
      final Object? descBefore =
          CommonSchemas.dynamicString.value['description'];

      final Map<String, Object?> json = processor
          .getRendererCapabilities(
            const CapabilitiesOptions(
              versions: [A2uiProtocolVersion.v0_9, A2uiProtocolVersion.v1_0],
              includeInlineCatalogs: true,
            ),
          )
          .toJson();

      Map<String, Object?> firstInline(String version) =>
          ((json[version]! as Map)['inlineCatalogs'] as List).first
              as Map<String, Object?>;

      // Below v1.0: the legacy shape, with components wrapped in the
      // ComponentCommon envelope and no `$schema`.
      final Map<String, Object?> legacy = firstInline('v0.9');
      expect(legacy.containsKey(r'$schema'), isFalse);
      expect((legacy['components']! as Map)['Alpha'], {
        'allOf': [
          {r'$ref': r'common_types.json#/$defs/ComponentCommon'},
          {
            'properties': {
              'component': {'const': 'Alpha'},
              'a': {'type': 'string'},
            },
            'required': ['component', 'a'],
          },
        ],
      });

      // At v1.0: the standalone catalog schema document.
      final Map<String, Object?> current = firstInline('v1.0');
      expect(current[r'$schema'], Catalog.jsonSchemaDialect);
      expect(current['catalogId'], 'cat1');
      expect(
        ((current[r'$defs']! as Map)['anyComponent'] as Map)['oneOf'],
        [
          {r'$ref': '#/components/Alpha'},
        ],
      );

      // _processRefs rewrites maps in place, so the emitter must work on
      // copies rather than on the shared CommonSchemas statics.
      expect(
        CommonSchemas.dynamicString.value['description'],
        equals(descBefore),
      );
    });

    test('getClientCapabilities is a v0.9 call-through', () {
      expect(processor.getClientCapabilities(includeInlineCatalogs: true), {
        'v0.9': processor
            .getRendererCapabilities(
              const CapabilitiesOptions(
                versions: [A2uiProtocolVersion.v0_9],
                includeInlineCatalogs: true,
              ),
            )
            .toJson()['v0.9'],
      });
    });

    group('getRendererDataModel', () {
      late MessageProcessor<ComponentApi> dataProcessor;

      void addSurface(String id, String? version, {bool send = true}) {
        final surface = SurfaceModel<ComponentApi>(
          id,
          catalog: namedCatalog('cat1', 'Alpha'),
          sendDataModel: send,
          protocolVersion: version,
        );
        surface.dataModel.set('/', {'id': id});
        dataProcessor.groupModel.addSurface(surface);
      }

      setUp(() {
        dataProcessor = MessageProcessor<ComponentApi>(
          catalogs: [namedCatalog('cat1', 'Alpha')],
          protocolVersion: A2uiProtocolVersion.v0_9,
        );
      });

      test('returns null when no surface sends its data model', () {
        addSurface('s1', 'v0.9', send: false);
        expect(dataProcessor.getRendererDataModel(), isNull);
      });

      test('derives the version from the surfaces', () {
        addSurface('s1', 'v0.9');
        addSurface('s2', 'v0.9', send: false);
        expect(dataProcessor.getRendererDataModel(), {
          'version': 'v0.9',
          'surfaces': {
            's1': {'id': 's1'},
          },
        });
      });

      test('defaults to v1.0 when no surface declares a version', () {
        addSurface('s1', null);
        expect(dataProcessor.getRendererDataModel(), {
          'version': 'v1.0',
          'surfaces': {
            's1': {'id': 's1'},
          },
        });
      });

      test('raises when surfaces carry different versions', () {
        addSurface('s1', 'v0.9');
        addSurface('s2', 'v1.0');
        expect(
          () => dataProcessor.getRendererDataModel(),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              allOf(contains('v0.9, v1.0'), contains('getRendererDataModel')),
            ),
          ),
        );
      });

      test('filters surfaces by the requested version', () {
        addSurface('s1', 'v0.9');
        addSurface('s2', 'v1.0');
        addSurface('s3', 'v0.9.1');
        addSurface('s4', null);

        expect(
          dataProcessor.getRendererDataModel(
            version: A2uiProtocolVersion.v1_0,
          ),
          {
            'version': 'v1.0',
            'surfaces': {
              's2': {'id': 's2'},
              's4': {'id': 's4'},
            },
          },
        );
        expect(
          dataProcessor.getRendererDataModel(
            version: A2uiProtocolVersion.v0_9,
          ),
          {
            'version': 'v0.9',
            'surfaces': {
              's1': {'id': 's1'},
              's3': {'id': 's3'},
              's4': {'id': 's4'},
            },
          },
        );
      });

      test('returns null when no surface matches the requested version', () {
        addSurface('s1', 'v0.9');
        expect(
          dataProcessor.getRendererDataModel(
            version: A2uiProtocolVersion.v1_0,
          ),
          isNull,
        );
      });

      test('getClientDataModel is a call-through', () {
        addSurface('s1', 'v0.9');
        expect(
          dataProcessor.getClientDataModel(),
          dataProcessor.getRendererDataModel(),
        );
      });
    });

    test('applies a fully valid batch of components', () {
      // `Text` takes no children, so `second` can only ever be unreachable.
      // The subject here is that both components land on the surface, so the
      // reachability check is relaxed rather than the batch reshaped.
      final MessageProcessor processor = MessageProcessor(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
        validationConfig: const ValidationConfig(allowOrphanComponents: true),
      );
      processor.processMessages(
        AgentToRendererMessagePayload([
          CreateSurfaceMessage(
              version: 'v0.9', surfaceId: 's1', catalogId: catalog.id),
          UpdateComponentsMessage(
            version: 'v0.9',
            surfaceId: 's1',
            components: [
              {'id': 'root', 'component': 'Text', 'text': 'first'},
              {'id': 'second', 'component': 'Text', 'text': 'second'},
            ],
          ),
        ]),
      );

      final SurfaceModel<ComponentApi>? surface =
          processor.groupModel.getSurface('s1');
      expect(surface?.componentsModel.get('root'), isNotNull);
      expect(surface?.componentsModel.get('second'), isNotNull);
    });
  });
}
