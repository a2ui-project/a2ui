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

import 'package:a2ui_core/src/basic_catalog/basic_catalog.dart';
import 'package:a2ui_core/src/core/catalog.dart';
import 'package:a2ui_core/src/core/common_schemas.dart';
import 'package:a2ui_core/src/core/component_model.dart';
import 'package:a2ui_core/src/core/contexts.dart';
import 'package:a2ui_core/src/core/messages.dart';
import 'package:a2ui_core/src/core/minimal_catalog.dart';
import 'package:a2ui_core/src/core/surface_model.dart';
import 'package:a2ui_core/src/primitives/errors.dart';
import 'package:a2ui_core/src/primitives/protocol_version.dart';
import 'package:a2ui_core/src/primitives/reactivity.dart';
import 'package:a2ui_core/src/processing/processor.dart';
import 'package:a2ui_core/src/resolution/node_resolver.dart';
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
          protocolVersion: A2uiProtocolVersion.v0_9,
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
        defaultVersion: A2uiProtocolVersion.v0_9,
        // Strict, so that a type outside the surface's catalog is rejected.
        validationConfig: ValidationConfig.strict,
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
      expect(
          processor
              .validatorFor(cat1, version: A2uiProtocolVersion.v0_9)
              .catalog
              .id,
          'cat1');
      expect(
        processor.validatorFor(cat1, version: A2uiProtocolVersion.v0_9),
        same(processor.validatorFor(cat1, version: A2uiProtocolVersion.v0_9)),
        reason: 'resolved component schemas are cached on the validator',
      );
      expect(
        processor
            .validatorFor(
              processor.catalogs.last,
              version: A2uiProtocolVersion.v0_9,
            )
            .catalog
            .id,
        'cat2',
      );
    });
  });

  group('MessageProcessor available catalogs', () {
    Catalog<ComponentApi, FunctionImplementation> catalogNamed(
      String id, {
      A2uiProtocolVersion? protocolVersion,
    }) =>
        Catalog<ComponentApi, FunctionImplementation>(
          id: id,
          components: const [],
          protocolVersion: protocolVersion,
        );

    Map<String, Catalog<ComponentApi, FunctionImplementation>> availableFor(
      A2uiProtocolVersion version, {
      required String catalogId,
    }) {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [
          catalogNamed('modern', protocolVersion: A2uiProtocolVersion.v1_0),
          catalogNamed('legacy'),
        ],
        defaultVersion: version,
        // This package embeds no v1.0 common types; the surface's catalog
        // set, not schema checking, is the subject here.
        commonTypesSchema: const {},
      );
      processor.processMessages(
        AgentToRendererMessagePayload([
          CreateSurfaceMessage(
            version: version.jsonValue,
            surfaceId: 's1',
            catalogId: catalogId,
          ),
        ]),
      );
      return processor.groupModel.getSurface('s1')!.availableCatalogs;
    }

    test('a v1.0 surface excludes unversioned catalogs', () {
      expect(
        availableFor(A2uiProtocolVersion.v1_0, catalogId: 'modern').keys,
        ['modern'],
      );
    });

    test('a v0.9 surface includes unversioned catalogs', () {
      expect(
        availableFor(A2uiProtocolVersion.v0_9, catalogId: 'legacy').keys,
        ['legacy'],
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
        defaultVersion: A2uiProtocolVersion.v0_9,
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
            defaultVersion: A2uiProtocolVersion.v0_9,
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

    test('getClientCapabilities does not corrupt shared schemas', () {
      final Object? descBefore =
          CommonSchemas.dynamicString.value['description'];

      processor.getClientCapabilities(includeInlineCatalogs: true);

      // _processRefs mutates maps in-place to replace commonTypesRef metadata
      // with $ref pointers. If toJsonMap uses a shallow copy, the shared
      // CommonSchemas statics are corrupted.
      expect(
        CommonSchemas.dynamicString.value['description'],
        equals(descBefore),
        reason: 'CommonSchemas.dynamicString should not be mutated by '
            'getClientCapabilities',
      );
    });

    test('applies a fully valid batch of components', () {
      // `Text` takes no children, so `second` can only ever be unreachable.
      // The subject here is that both components land on the surface, so the
      // reachability check is relaxed rather than the batch reshaped.
      final MessageProcessor processor = MessageProcessor(
        catalogs: [catalog],
        defaultVersion: A2uiProtocolVersion.v0_9,
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

  group('MessageProcessor per-update integrity', () {
    late MinimalCatalog catalog;

    setUp(() => catalog = MinimalCatalog());

    MessageProcessor processorWith([
      ValidationConfig config = ValidationConfig.strict,
    ]) =>
        MessageProcessor(
          catalogs: [catalog],
          defaultVersion: A2uiProtocolVersion.v0_9,
          validationConfig: config,
        );

    void send(MessageProcessor processor, List<AgentToRendererMessage> m) =>
        processor.processMessages(AgentToRendererMessagePayload(m));

    CreateSurfaceMessage create() => CreateSurfaceMessage(
          version: 'v0.9',
          surfaceId: 's1',
          catalogId: catalog.id,
        );

    UpdateComponentsMessage update(List<Map<String, Object?>> components) =>
        UpdateComponentsMessage(
          version: 'v0.9',
          surfaceId: 's1',
          components: components,
        );

    SurfaceComponentsModel componentsOf(MessageProcessor processor) =>
        processor.groupModel.getSurface('s1')!.componentsModel;

    test('checks completeness on each update, not once per payload', () {
      final MessageProcessor processor = processorWith();
      send(processor, [create()]);

      expect(
        () => send(processor, [
          update([
            {
              'id': 'root',
              'component': 'Column',
              'children': ['missing'],
            },
          ]),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
      expect(componentsOf(processor).get('root'), isNull);
    });

    test('rejects an update that orphans a component', () {
      List<AgentToRendererMessage> initial() => [
            create(),
            update([
              {
                'id': 'root',
                'component': 'Column',
                'children': ['a'],
              },
              {'id': 'a', 'component': 'Text', 'text': 'x'},
            ]),
          ];
      final UpdateComponentsMessage orphaning = update([
        {'id': 'root', 'component': 'Column', 'children': <String>[]},
      ]);

      final MessageProcessor strict = processorWith();
      send(strict, initial());
      expect(
        () => send(strict, [orphaning]),
        throwsA(isA<A2uiIntegrityError>()),
      );

      final MessageProcessor lenient = processorWith(
        const ValidationConfig(allowOrphanComponents: true),
      );
      send(lenient, initial());
      expect(() => send(lenient, [orphaning]), returnsNormally);
    });

    test('validates a partial update against the existing type', () {
      final MessageProcessor processor = processorWith();
      send(processor, [
        create(),
        update([
          {'id': 'root', 'component': 'Text', 'text': 'x'},
        ]),
      ]);

      expect(
        () => send(processor, [
          update([
            {'id': 'root', 'text': 42},
          ]),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(componentsOf(processor).get('root')!.properties, {'text': 'x'});

      send(processor, [
        update([
          {'id': 'root', 'text': 'y'},
        ]),
      ]);
      final ComponentModel root = componentsOf(processor).get('root')!;
      expect(root.type, 'Text');
      expect(root.properties, {'text': 'y'});
    });

    test('deleteSurface for an unknown surface is a no-op', () {
      final MessageProcessor<ComponentApi> processor = processorWith();
      send(processor, [
        DeleteSurfaceMessage(version: 'v0.9', surfaceId: 'nope'),
      ]);
      expect(processor.groupModel.getSurface('nope'), isNull);
    });

    test('checks path syntax before looking up the surface', () {
      // The payload names a surface nobody created, and the malformed path is
      // what is reported.
      expect(
        () => send(processorWith(), [
          UpdateDataModelMessage(
            version: 'v0.9',
            surfaceId: 's1',
            path: '/a~2',
            value: 'x',
          ),
        ]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('Invalid path syntax'),
          ),
        ),
      );
    });

    test('an update to a missing surface is an integrity error', () {
      // The payload of conformance `test_v10_invalid_json_pointer_path_error`.
      // Its path is a valid relative path under v0.9's pattern, so the missing
      // surface is what is reported. `A2uiIntegrityError` is still in the
      // `ValidationError` category the case expects.
      expect(
        () => send(processorWith(), [
          UpdateDataModelMessage(
            version: 'v0.9',
            surfaceId: 's1',
            path: 'invalid path [0]',
            value: 'data',
          ),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    group('without a ValidationConfig', () {
      // The default. Passing no config is the opt-out from the graph checks;
      // what is settled by the batch alone is still checked.
      MessageProcessor unchecked() => MessageProcessor(
            catalogs: [catalog],
            defaultVersion: A2uiProtocolVersion.v0_9,
          );

      test('is the default', () {
        expect(unchecked().validationConfig, isNull);
      });

      test('accepts a parent whose child arrives in a later message', () {
        final MessageProcessor processor = unchecked();
        send(processor, [create()]);
        expect(
          () => send(processor, [
            update([
              {
                'id': 'root',
                'component': 'Column',
                'children': ['later'],
              },
            ]),
          ]),
          returnsNormally,
        );
        expect(
          () => send(processor, [
            update([
              {'id': 'later', 'component': 'Text', 'text': 'x'},
            ]),
          ]),
          returnsNormally,
        );
        expect(componentsOf(processor).size, 2);
      });

      test('accepts a parent re-sent with fewer children', () {
        final MessageProcessor processor = unchecked();
        send(processor, [
          create(),
          update([
            {
              'id': 'root',
              'component': 'Column',
              'children': ['a', 'b'],
            },
            {'id': 'a', 'component': 'Text', 'text': 'a'},
            {'id': 'b', 'component': 'Text', 'text': 'b'},
          ]),
        ]);
        expect(
          () => send(processor, [
            update([
              {
                'id': 'root',
                'component': 'Column',
                'children': ['a'],
              },
            ]),
          ]),
          returnsNormally,
        );
        expect(componentsOf(processor).get('root')!.properties['children'], [
          'a',
        ]);
        expect(componentsOf(processor).get('b'), isNotNull);
      });

      test('accepts a cycle', () {
        final MessageProcessor processor = unchecked();
        send(processor, [create()]);
        expect(
          () => send(processor, [
            update([
              {
                'id': 'root',
                'component': 'Column',
                'children': ['a'],
              },
              {
                'id': 'a',
                'component': 'Column',
                'children': ['root'],
              },
            ]),
          ]),
          returnsNormally,
        );
      });

      test('still rejects a duplicate id within a batch', () {
        final MessageProcessor processor = unchecked();
        send(processor, [create()]);
        expect(
          () => send(processor, [
            update([
              {'id': 'root', 'component': 'Text', 'text': 'x'},
              {'id': 'root', 'component': 'Text', 'text': 'y'},
            ]),
          ]),
          throwsA(isA<A2uiIntegrityError>()),
        );
        expect(componentsOf(processor).get('root'), isNull);
      });

      test('still checks a known type against its schema', () {
        final MessageProcessor processor = unchecked();
        send(processor, [create()]);
        expect(
          () => send(processor, [
            update([
              {'id': 'root', 'component': 'Text', 'text': 42},
            ]),
          ]),
          throwsA(isA<A2uiValidationError>()),
        );
      });

      test('accepts an undeclared type', () {
        final MessageProcessor processor = unchecked();
        send(processor, [create()]);
        expect(
          () => send(processor, [
            update([
              {'id': 'root', 'component': 'NoSuchType'},
            ]),
          ]),
          returnsNormally,
        );
      });

      test('accepts a malformed data-model path', () {
        // The path check belongs to the validation phase a config turns on;
        // see the strict case above.
        final MessageProcessor processor = unchecked();
        send(processor, [create()]);
        expect(
          () => send(processor, [
            UpdateDataModelMessage(
              version: 'v0.9',
              surfaceId: 's1',
              path: 'invalid path [0]',
              value: 'data',
            ),
          ]),
          returnsNormally,
        );
      });
    });

    group('ValidationConfig', () {
      test('allowUnknownElements accepts an undeclared type', () {
        final UpdateComponentsMessage unknown = update([
          {'id': 'root', 'component': 'NoSuchType'},
        ]);

        final MessageProcessor strict = processorWith();
        send(strict, [create()]);
        expect(
          () => send(strict, [unknown]),
          throwsA(isA<A2uiValidationError>()),
        );

        final MessageProcessor lenient = processorWith(
          const ValidationConfig(allowUnknownElements: true),
        );
        send(lenient, [create()]);
        expect(() => send(lenient, [unknown]), returnsNormally);
      });

      test('allowedMessages rejects an unlisted message', () {
        final MessageProcessor processor = processorWith(
          const ValidationConfig(allowedMessages: ['createSurface']),
        );
        send(processor, [create()]);
        expect(
          () => send(processor, [
            UpdateDataModelMessage(
              version: 'v0.9',
              surfaceId: 's1',
              path: '/a',
              value: 1,
            ),
          ]),
          throwsA(isA<A2uiValidationError>()),
        );
      });

      test('rootId names the component the surface is rooted at', () {
        const config = ValidationConfig(rootId: 'main');

        final MessageProcessor accepted = processorWith(config);
        send(accepted, [
          create(),
          update([
            {'id': 'main', 'component': 'Text', 'text': 'hi'},
          ]),
        ]);
        expect(accepted.groupModel.getSurface('s1')!.rootId, 'main');

        final MessageProcessor rejected = processorWith(config);
        send(rejected, [create()]);
        expect(
          () => send(rejected, [
            update([
              {'id': 'root', 'component': 'Text', 'text': 'hi'},
            ]),
          ]),
          throwsA(isA<A2uiIntegrityError>()),
        );
      });
    });

    test('NodeResolver roots the tree at the surface rootId', () {
      final surface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: catalog,
        rootId: 'main',
      );
      final resolver = NodeResolver<ComponentApi>(surface);
      addTearDown(() {
        resolver.dispose();
        surface.dispose();
      });

      surface.componentsModel.addComponent(
        ComponentModel('root', 'Text', {'text': 'not the root'}),
      );
      expect(resolver.rootNode.value, isNull);

      surface.componentsModel.addComponent(
        ComponentModel('main', 'Text', {'text': 'hi'}),
      );
      expect(resolver.rootNode.value?.componentId, 'main');
    });
  });

  group('MessageProcessor component envelope', () {
    Catalog<ComponentApi, FunctionImplementation> alphaCatalog(String id) =>
        Catalog<ComponentApi, FunctionImplementation>(
          id: id,
          protocolVersion: A2uiProtocolVersion.v0_9,
          components: [
            ComponentApi(
              name: 'Alpha',
              schema: Schema.object(
                properties: {'a': Schema.string()},
                required: ['a'],
              ),
            ),
          ],
        );

    late MessageProcessor<ComponentApi> processor;

    setUp(() {
      processor = MessageProcessor<ComponentApi>(
        catalogs: [alphaCatalog('cat1'), alphaCatalog('cat2')],
        defaultVersion: A2uiProtocolVersion.v0_9,
      );
      processor.processMessages(
        AgentToRendererMessagePayload([
          CreateSurfaceMessage(
            version: 'v0.9',
            surfaceId: 's1',
            catalogId: 'cat1',
          ),
        ]),
      );
    });

    void update(Map<String, Object?> component) => processor.processMessages(
          AgentToRendererMessagePayload([
            UpdateComponentsMessage(
              version: 'v0.9',
              surfaceId: 's1',
              components: [component],
            ),
          ]),
        );

    SurfaceComponentsModel components() =>
        processor.groupModel.getSurface('s1')!.componentsModel;

    test('keeps catalogId and metadata out of properties', () {
      update({
        'id': 'root',
        'component': 'Alpha',
        'a': 'x',
        'catalogId': 'cat2',
        'metadata': {'k': 'v'},
      });

      final ComponentModel root = components().get('root')!;
      expect(root.properties, {'a': 'x'});
      expect(root.catalog, 'cat2');
      expect(root.metadata, {'k': 'v'});
      expect(root.toJson(), {
        'id': 'root',
        'component': 'Alpha',
        'catalogId': 'cat2',
        'metadata': {'k': 'v'},
        'a': 'x',
      });
    });

    test('recreates a component whose catalogId changes', () {
      update({'id': 'root', 'component': 'Alpha', 'a': 'x'});
      final events = <String>[];
      components().onDeleted.addListener((id) => events.add('deleted:$id'));
      components().onCreated.addListener((c) => events.add('created:${c.id}'));

      update({
        'id': 'root',
        'component': 'Alpha',
        'a': 'y',
        'catalogId': 'cat2',
      });
      expect(events, ['deleted:root', 'created:root']);
      expect(components().get('root')!.catalog, 'cat2');

      // A partial update inherits the catalog rather than changing it.
      update({'id': 'root', 'a': 'z'});
      expect(events, ['deleted:root', 'created:root']);
      expect(components().get('root')!.catalog, 'cat2');
      expect(components().get('root')!.properties, {'a': 'z'});
    });
  });

  group('MessageProcessor version routing', () {
    /// A v1.0 catalog whose components take any properties.
    Catalog<ComponentApi, FunctionImplementation> v10Catalog([
      String id = 'v10',
    ]) =>
        Catalog<ComponentApi, FunctionImplementation>(
          id: id,
          protocolVersion: A2uiProtocolVersion.v1_0,
          components: [
            ComponentApi(name: 'Text', schema: Schema.fromMap({})),
            ComponentApi(
              name: 'Column',
              schema: Schema.fromMap({
                'type': 'object',
                'properties': {
                  'children': {
                    'type': 'array',
                    'items': {r'$ref': r'common_types.json#/$defs/ComponentId'},
                  },
                },
              }),
            ),
          ],
        );

    final String minimalId = MinimalCatalog().id;

    test('holds v0.9 and v1.0 surfaces side by side', () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [MinimalCatalog(), v10Catalog()],
      );
      processor.processMessages([
        {
          'version': 'v0.9',
          'createSurface': {'surfaceId': 'old', 'catalogId': minimalId},
        },
        {
          'version': 'v1.0',
          'createSurface': {'surfaceId': 'new', 'catalogId': 'v10'},
        },
      ]);

      final SurfaceModel<ComponentApi> old = processor.groupModel.getSurface(
        'old',
      )!;
      final SurfaceModel<ComponentApi> fresh =
          processor.groupModel.getSurface('new')!;
      expect(old.protocolVersion, 'v0.9');
      expect(fresh.protocolVersion, 'v1.0');
      bool isV10(SurfaceModel<ComponentApi> s) => DataContext(
            s.dataModel,
            (_, __, ___) => null,
            '/',
            protocolVersion: s.protocolVersion,
          ).isV10;
      expect(isV10(old), isFalse);
      expect(isV10(fresh), isTrue);
    });

    test('accepts a lone raw envelope, a raw list and the wrapper', () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [MinimalCatalog()],
      );
      processor.processMessages({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 'a', 'catalogId': minimalId},
      });
      processor.processMessages([
        {
          'version': 'v0.9',
          'createSurface': {'surfaceId': 'b', 'catalogId': minimalId},
        },
      ]);
      processor.processMessages({
        'messages': [
          {
            'version': 'v0.9.1',
            'createSurface': {'surfaceId': 'c', 'catalogId': minimalId},
          },
        ],
      });
      processor.processMessages([
        DeleteSurfaceMessage(version: 'v0.9', surfaceId: 'a'),
        {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 'b'},
        },
      ]);
      processor.processMessages(null);

      expect(processor.groupModel.allSurfaces.map((s) => s.id), ['c']);
      expect(processor.groupModel.getSurface('c')!.protocolVersion, 'v0.9.1');
    });

    test('rejects a malformed payload before applying any of it', () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [MinimalCatalog()],
      );
      expect(
        () => processor.processMessages([
          {
            'version': 'v0.9',
            'createSurface': {'surfaceId': 'a', 'catalogId': minimalId},
          },
          {
            'version': 'v0.9',
            'callRendererFunction': {'functionCallId': 'f'},
          },
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(processor.groupModel.getSurface('a'), isNull);
      expect(
        () => processor.processMessages('not a payload'),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => processor.processMessages([42]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('processMessagesAsync applies the payload', () async {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [MinimalCatalog()],
      );
      await processor.processMessagesAsync({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 'a', 'catalogId': minimalId},
      });
      expect(processor.groupModel.getSurface('a'), isNotNull);
    });

    test(
        'an inline createSurface carries its metadata and writes the data '
        'model, then components', () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [v10Catalog()],
        validationConfig: ValidationConfig.strict,
        // This package embeds no v1.0 common types yet.
        commonTypesSchema: const {},
      );
      final events = <String>[];
      final rootValues = <Object?>[];
      processor.groupModel.onSurfaceCreated.addListener((surface) {
        events.add(
          'created: data=${surface.dataModel.get('/')} '
          'components=${surface.componentsModel.all.length} '
          'metadata=${surface.metadata}',
        );
        final ReadonlySignal<Object?> root = surface.dataModel.watch<Object?>(
          '/',
        );
        var initial = true;
        root.subscribe((value) {
          // The subscription reports the current value once on attach.
          if (initial) {
            initial = false;
            return;
          }
          rootValues.add(value);
          events.add(
            'data: components=${surface.componentsModel.all.length}',
          );
        });
        surface.componentsModel.onCreated.addListener(
          (c) => events.add('component ${c.id}'),
        );
      });

      processor.processMessages({
        'version': 'v1.0',
        'createSurface': {
          'surfaceId': 's1',
          'catalogId': 'v10',
          'components': [
            {
              'id': 'root',
              'component': 'Column',
              'children': ['t'],
            },
            {'id': 't', 'component': 'Text', 'text': 'Hi'},
          ],
          'dataModel': {
            'user': {'name': 'Ada'},
            'count': 2,
          },
          'metadata': {
            'extensions': {'trace': true},
          },
        },
      });

      expect(events, [
        'created: data={} components=0 metadata={extensions: {trace: true}}',
        'data: components=0',
        'component root',
        'component t',
      ]);
      expect(rootValues, [
        {
          'user': {'name': 'Ada'},
          'count': 2,
        },
      ]);
      final SurfaceModel<ComponentApi> surface =
          processor.groupModel.getSurface('s1')!;
      expect(surface.defaultCatalog!.id, 'v10');
      expect(surface.metadata, {
        'extensions': {'trace': true},
      });
    });

    test('an inline createSurface whose components fail creates nothing', () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [v10Catalog()],
        validationConfig: ValidationConfig.strict,
        // This package embeds no v1.0 common types yet.
        commonTypesSchema: const {},
      );
      expect(
        () => processor.processMessages({
          'version': 'v1.0',
          'createSurface': {
            'surfaceId': 's1',
            'catalogId': 'v10',
            'components': [
              {'id': 'other', 'component': 'Text'},
            ],
          },
        }),
        throwsA(isA<A2uiIntegrityError>()),
      );
      expect(processor.groupModel.getSurface('s1'), isNull);
    });

    test('a v1.0 createSurface without catalogId has no default catalog', () {
      // No fallback to the processor's catalogs, even when it supports
      // exactly one: an item on such a surface must name its catalog.
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [v10Catalog()],
        // This package embeds no v1.0 common types yet.
        commonTypesSchema: const {},
      );
      processor.processMessages({
        'version': 'v1.0',
        'createSurface': {'surfaceId': 's1'},
      });
      final SurfaceModel<ComponentApi> surface =
          processor.groupModel.getSurface('s1')!;
      expect(surface.defaultCatalog, isNull);
      expect(surface.availableCatalogs.keys, ['v10']);

      Map<String, Object?> update(Map<String, Object?> component) => {
            'version': 'v1.0',
            'updateComponents': {
              'surfaceId': 's1',
              'components': [component],
            },
          };
      expect(
        () => processor.processMessages(
          update({'id': 'root', 'component': 'Text'}),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => processor.processMessages(
          update({'id': 'root', 'component': 'Text', 'catalogId': 'v10'}),
        ),
        returnsNormally,
      );
      expect(surface.componentsModel.all.map((c) => c.id), ['root']);
    });

    test('BasicCatalog.v1_0 backs a v1.0 surface', () {
      final Catalog<ComponentApi, FunctionImplementation> basic =
          BasicCatalog.v1_0();
      expect(basic.protocolVersion, A2uiProtocolVersion.v1_0);
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [basic],
        commonTypesSchema: const {},
      );
      processor.processMessages({
        'version': 'v1.0',
        'createSurface': {'surfaceId': 's1', 'catalogId': basic.id},
      });
      expect(
        processor.groupModel.getSurface('s1')!.defaultCatalog,
        same(basic),
      );
    });

    test('an unversioned catalog is pre-v1.0', () {
      final unversioned = Catalog<ComponentApi, FunctionImplementation>(
        id: 'plain',
        components: const [],
      );
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [unversioned],
      );
      // Accepted below v1.0.
      for (final version in ['v0.9', 'v0.9.1']) {
        processor.processMessages({
          'version': version,
          'createSurface': {'surfaceId': 's_$version', 'catalogId': 'plain'},
        });
        expect(
          processor.groupModel.getSurface('s_$version')!.defaultCatalog,
          same(unversioned),
          reason: version,
        );
      }
      // Rejected from v1.0 on.
      expect(
        () => processor.processMessages({
          'version': 'v1.0',
          'createSurface': {'surfaceId': 's_v1', 'catalogId': 'plain'},
        }),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            allOf(contains('declares no protocolVersion'),
                contains('incompatible')),
          ),
        ),
      );
      expect(processor.groupModel.getSurface('s_v1'), isNull);
    });

    test('rejects a catalog with an incompatible version', () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [MinimalCatalog(), v10Catalog()],
      );
      expect(
        () => processor.processMessages({
          'version': 'v1.0',
          'createSurface': {'surfaceId': 's1', 'catalogId': minimalId},
        }),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('incompatible'),
          ),
        ),
      );
      expect(
        () => processor.processMessages({
          'version': 'v0.9',
          'createSurface': {'surfaceId': 's2', 'catalogId': 'v10'},
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(processor.groupModel.allSurfaces, isEmpty);
    });
  });
}
