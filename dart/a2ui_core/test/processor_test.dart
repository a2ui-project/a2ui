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
import 'package:a2ui_core/src/core/component_model.dart';
import 'package:a2ui_core/src/core/messages.dart';
import 'package:a2ui_core/src/core/minimal_catalog.dart';
import 'package:a2ui_core/src/core/surface_model.dart';
import 'package:a2ui_core/src/primitives/errors.dart';
import 'package:a2ui_core/src/primitives/protocol_version.dart';
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
          protocolVersion: 'v0.9',
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

      // _processRefs mutates maps in-place to replace REF: descriptions
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
        version: 'v0.9', surfaceId: 's1', catalogId: catalog.id);

    UpdateComponentsMessage update(List<Map<String, Object?>> components) =>
        UpdateComponentsMessage(
            version: 'v0.9', surfaceId: 's1', components: components);

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

    test('deleteSurface for an unknown surface throws', () {
      expect(
        () => send(processorWith(),
            [DeleteSurfaceMessage(version: 'v0.9', surfaceId: 'nope')]),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains('nope'),
          ),
        ),
      );
    });

    test('checks path syntax before looking up the surface', () {
      // The payload names a surface nobody created, and the malformed path is
      // what is reported.
      expect(
        () => send(processorWith(), [
          UpdateDataModelMessage(
              version: 'v0.9', surfaceId: 's1', path: '/a~2', value: 'x'),
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

    group('ValidationConfig', () {
      test('none skips schema checks', () {
        final MessageProcessor processor = processorWith(ValidationConfig.none);
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

      test('none still rejects a cycle', () {
        final MessageProcessor processor = processorWith(ValidationConfig.none);
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
          throwsA(isA<A2uiRecursionError>()),
        );
      });

      test('none still rejects a dangling reference', () {
        final MessageProcessor processor = processorWith(ValidationConfig.none);
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
      });

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
                version: 'v0.9', surfaceId: 's1', path: '/a', value: 1),
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
        catalog: catalog,
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
          protocolVersion: 'v0.9',
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
              version: 'v0.9', surfaceId: 's1', catalogId: 'cat1'),
        ]),
      );
    });

    void update(Map<String, Object?> component) => processor.processMessages(
          AgentToRendererMessagePayload([
            UpdateComponentsMessage(
                version: 'v0.9', surfaceId: 's1', components: [component]),
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
}
