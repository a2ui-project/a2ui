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

import 'dart:async';
import 'dart:convert';

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../test_infra/message_builders.dart';

void main() {
  group('$SurfaceController', () {
    late SurfaceController controller;

    setUp(() {
      // a2ui_core validates every component against the catalog its surface
      // names, so the catalog must carry the id the tests create surfaces
      // with.
      controller = SurfaceController(
        catalogs: [
          Catalog(
            BasicCatalogItems.asCatalog().items,
            catalogId: 'test_catalog',
          ),
        ],
      );
    });

    tearDown(() {
      controller.dispose();
    });

    test('can be initialized with multiple catalogs', () {
      final catalog1 = const Catalog([], catalogId: 'cat1');
      final catalog2 = const Catalog([], catalogId: 'cat2');
      final multiManager = SurfaceController(catalogs: [catalog1, catalog2]);
      expect(multiManager.catalogs, contains(catalog1));
      expect(multiManager.catalogs, contains(catalog2));
      expect(multiManager.catalogs.length, 2);
    });

    test('handleMessage adds a new surface and fires SurfaceAdded with '
        'definition', () async {
      const surfaceId = 's1';
      final List<JsonMap> components = [
        component(id: 'root', type: 'Text', properties: {'text': 'Hello'}),
      ];

      controller.handleMessage(
        updateComponents(surfaceId: surfaceId, components: components),
      );

      final Future<List<SurfaceUpdate>> futureUpdates = controller
          .surfaceUpdates
          .take(2)
          .toList();
      controller.handleMessage(
        createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
      );
      final List<SurfaceUpdate> updates = await futureUpdates;

      expect(updates[0], isA<SurfaceAdded>());
      expect(updates[0].surfaceId, surfaceId);

      final SurfaceUpdate update2 = updates[1];
      expect(update2, isA<ComponentsUpdated>());
      final SurfaceDefinition definition =
          (update2 as ComponentsUpdated).definition;

      expect(definition, isNotNull);
      expect(
        definition.components['root'],
        isNotNull,
      ); // Check if root (or any component) exists
      expect(definition.catalogId, 'test_catalog');
      expect(controller.registry.getSurface(surfaceId), isNotNull);
      expect(
        controller.registry.getSurface(surfaceId)!.catalogId,
        'test_catalog',
      );
    });

    test(
      'handleMessage updates an existing surface and fires ComponentsUpdated',
      () async {
        const surfaceId = 's1';
        final List<JsonMap> oldComponents = [
          component(id: 'root', type: 'Text', properties: {'text': 'Old'}),
        ];
        final List<JsonMap> newComponents = [
          component(id: 'root', type: 'Text', properties: {'text': 'New'}),
        ];

        final Future<void> expectation = expectLater(
          controller.surfaceUpdates,
          emitsInOrder([
            isA<SurfaceAdded>(),
            isA<ComponentsUpdated>(),
            isA<ComponentsUpdated>(),
          ]),
        );

        controller.handleMessage(
          createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
        );
        controller.handleMessage(
          updateComponents(surfaceId: surfaceId, components: oldComponents),
        );
        controller.handleMessage(
          updateComponents(surfaceId: surfaceId, components: newComponents),
        );

        await expectation;
      },
    );

    test('handleMessage removes a surface and fires SurfaceRemoved', () async {
      const surfaceId = 's1';
      final List<JsonMap> components = [
        component(id: 'root', type: 'Text', properties: {'text': 'Hello'}),
      ];
      controller.handleMessage(
        createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
      );
      controller.handleMessage(
        updateComponents(surfaceId: surfaceId, components: components),
      );

      final Future<SurfaceUpdate> futureUpdate =
          controller.surfaceUpdates.first;

      controller.handleMessage(deleteSurface(surfaceId: surfaceId));
      final SurfaceUpdate update = await futureUpdate;

      expect(update, isA<SurfaceRemoved>());
      expect(update.surfaceId, surfaceId);
      expect(controller.registry.hasSurface(surfaceId), isFalse);
    });

    test('watchSurface notifies null when the surface is removed', () {
      const surfaceId = 's1';
      controller.handleMessage(
        createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
      );
      controller.handleMessage(
        updateComponents(
          surfaceId: surfaceId,
          components: [
            component(id: 'root', type: 'Text', properties: {'text': 'Hello'}),
          ],
        ),
      );

      final ValueListenable<SurfaceDefinition?> watched = controller.registry
          .watchSurface(surfaceId);
      expect(watched.value, isNotNull);

      var notified = false;
      watched.addListener(() => notified = true);

      controller.handleMessage(deleteSurface(surfaceId: surfaceId));

      expect(notified, isTrue);
      expect(watched.value, isNull);
    });

    test('surface() creates a new ValueNotifier if one does not exist', () {
      final ValueListenable<SurfaceDefinition?> notifier1 = controller.registry
          .watchSurface('s1');
      final ValueListenable<SurfaceDefinition?> notifier2 = controller.registry
          .watchSurface('s1');
      expect(notifier1, same(notifier2));
      expect(notifier1.value, isNull);
    });

    test('public SurfaceAdded / ComponentsUpdated constructors are '
        'definition-based', () {
      final def = SurfaceDefinition(surfaceId: 's1');
      final added = SurfaceAdded('s1', def);
      expect(added.surfaceId, 's1');
      expect(added.definition, same(def));

      final updated = ComponentsUpdated('s1', def);
      expect(updated.surfaceId, 's1');
      expect(updated.definition, same(def));
    });

    test(
      'registry watchSurface/getSurface expose SurfaceDefinition snapshots',
      () {
        const surfaceId = 's1';
        final ValueListenable<SurfaceDefinition?> notifier = controller.registry
            .watchSurface(surfaceId);
        expect(notifier.value, isNull);
        expect(controller.registry.getSurface(surfaceId), isNull);

        controller.handleMessage(
          createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
        );

        final SurfaceDefinition? def = controller.registry.getSurface(
          surfaceId,
        );
        expect(def, isNotNull);
        expect(def!.catalogId, 'test_catalog');
        expect(notifier.value, same(def));
      },
    );

    test('contextFor exposes the live surface data model', () {
      const surfaceId = 's1';
      controller.handleMessage(
        createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
      );
      controller.handleMessage(
        updateDataModel(
          surfaceId: surfaceId,
          path: DataPath.root,
          value: {'name': 'Alice'},
        ),
      );

      final DataModel model = controller.contextFor(surfaceId).dataModel;
      expect(model.getValue<String>(DataPath('/name')), 'Alice');
      expect(controller.contextFor(surfaceId).dataModel, same(model));

      controller.handleMessage(
        updateDataModel(
          surfaceId: surfaceId,
          path: DataPath('/name'),
          value: 'Bob',
        ),
      );
      expect(model.getValue<String>(DataPath('/name')), 'Bob');
    });

    test('contextFor.dataModel throws before the surface exists', () {
      expect(
        () => controller.contextFor('missing').dataModel,
        throwsStateError,
      );
    });

    test('dispose() closes the updates stream', () async {
      var isClosed = false;
      controller.surfaceUpdates.listen(
        null,
        onDone: () {
          isClosed = true;
        },
      );

      controller.dispose();

      await Future<void>.delayed(Duration.zero);
      expect(isClosed, isTrue);
    });

    test('can handle UI event', () async {
      final Future<ChatMessage> future = controller.onSubmit.first;
      final now = DateTime.now();
      final event = UserActionEvent(
        surfaceId: 'testSurface',
        name: 'testAction',
        sourceComponentId: 'testWidget',
        timestamp: now,
        context: {'key': 'value'},
      );
      controller.handleUiEvent(event);
      final ChatMessage message = await future;
      expect(message, isA<ChatMessage>());
      expect(message.role, ChatMessageRole.user);
      expect(message.parts.uiInteractionParts, hasLength(1));

      final String expectedJson = jsonEncode({
        'version': 'v0.9',
        'action': {
          'surfaceId': 'testSurface',
          'name': 'testAction',
          'sourceComponentId': 'testWidget',
          'timestamp': now.toIso8601String(),
          'context': {'key': 'value'},
        },
      });
      final UiInteractionPart part = message.parts.uiInteractionParts.first;
      // Depending on implementation, part.interaction might be the string or
      // data map. UiInteractionPart.create took jsonEncode string.
      // UiInteractionPart.interaction is String.
      expect(part.interaction, expectedJson);
    });

    test('handleUiEvent ignores non-action UiEvents', () async {
      var submitted = false;
      final StreamSubscription<ChatMessage> sub = controller.onSubmit.listen(
        (_) => submitted = true,
      );
      final event = UiEvent.fromMap({
        'widgetId': 'testWidget',
        'eventType': 'onChanged',
        'value': 'hello',
        'timestamp': DateTime.now().toIso8601String(),
      });
      controller.handleUiEvent(event);
      await Future<void>.delayed(Duration.zero);
      expect(submitted, isFalse);
      await sub.cancel();
    });

    test(
      'handleMessage reports validation error with correct structure',
      () async {
        // Trigger validation error by using an empty surface ID.
        final Future<ChatMessage> messageFuture = controller.onSubmit.first;
        controller.handleMessage(
          createSurface(surfaceId: '', catalogId: 'test_catalog'),
        );

        final ChatMessage message = await messageFuture;
        expect(message.role, ChatMessageRole.user);
        final UiInteractionPart part = message.parts.uiInteractionParts.first;
        final errorJson = jsonDecode(part.interaction) as Map<String, dynamic>;

        expect(errorJson['version'], 'v0.9');
        final Object? errorObj = errorJson['error'];
        expect(errorObj, isA<Map<String, dynamic>>());
        final errorMap = errorObj! as Map<String, dynamic>;
        expect(errorMap['code'], 'VALIDATION_FAILED');
        expect(errorMap['surfaceId'], '');
        expect(errorMap['path'], 'surfaceId');
      },
    );

    test('rejects empty surfaceId on non-create messages', () async {
      final Future<ChatMessage> messageFuture = controller.onSubmit.first;
      controller.handleMessage(updateDataModel(surfaceId: '', value: 1));

      final ChatMessage message = await messageFuture;
      final UiInteractionPart part = message.parts.uiInteractionParts.first;
      final errorJson = jsonDecode(part.interaction) as Map<String, dynamic>;
      final errorMap = errorJson['error']! as Map<String, dynamic>;
      expect(errorMap['code'], 'VALIDATION_FAILED');
      expect(errorMap['surfaceId'], '');
      expect(errorMap['path'], 'surfaceId');
    });

    test(
      'duplicate createSurface for an active surface reports an error',
      () async {
        controller.handleMessage(
          createSurface(surfaceId: 's1', catalogId: 'test_catalog'),
        );
        final Future<ChatMessage> messageFuture = controller.onSubmit.first;
        controller.handleMessage(
          createSurface(surfaceId: 's1', catalogId: 'test_catalog'),
        );

        final ChatMessage message = await messageFuture;
        final UiInteractionPart part = message.parts.uiInteractionParts.first;
        final errorJson = jsonDecode(part.interaction) as Map<String, dynamic>;
        final errorMap = errorJson['error']! as Map<String, dynamic>;
        expect(errorMap['surfaceId'], 's1');
      },
    );

    test('drops pending updates after timeout', () async {
      // Create controller with short timeout
      final shortTimeoutController = SurfaceController(
        catalogs: [BasicCatalogItems.asCatalog()],
        pendingUpdateTimeout: const Duration(milliseconds: 100),
      );
      addTearDown(shortTimeoutController.dispose);

      const surfaceId = 'timedOutSurface';
      final List<JsonMap> components = [
        component(
          id: 'root',
          type: 'Text',
          properties: {'text': 'Should not be seen'},
        ),
      ];

      // 1. Send update for non-existent surface (buffered)
      shortTimeoutController.handleMessage(
        updateComponents(surfaceId: surfaceId, components: components),
      );

      // 2. Wait for timeout
      await Future<void>.delayed(const Duration(milliseconds: 200));

      // 3. Create surface (but first setup listener)
      final Future<List<SurfaceUpdate>> updatesFuture = shortTimeoutController
          .surfaceUpdates
          .take(1)
          .toList();
      shortTimeoutController.handleMessage(
        createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
      );

      // 4. Verify surface created but NO update applied
      // If update was applied, we'd see [SurfaceAdded, ComponentsUpdated]
      // If dropped, we only see [SurfaceAdded] (and potentially components from
      // CreateSurface if any, but default is empty)
      final List<SurfaceUpdate> updates = await updatesFuture;
      expect(updates.length, 1);
      expect(updates[0], isA<SurfaceAdded>());

      // Allow a small delay to ensure no other events come through
      // Testing emptiness of a stream is tricky, checking registry state is
      // better.
      await Future<void>.delayed(Duration.zero);

      final SurfaceDefinition? surface = shortTimeoutController.registry
          .watchSurface(surfaceId)
          .value;
      expect(surface, isNotNull);
      // Updates NOT applied, so components should be empty (or default)
      expect(surface!.components, isEmpty);
    });

    test(
      'handleMessage reports schema validation error for invalid component',
      () async {
        final catalog = Catalog([
          CatalogItem(
            name: 'StrictWidget',
            dataSchema: Schema.object(
              properties: {
                'component': Schema.string(enumValues: ['StrictWidget']),
                'requiredProp': Schema.string(),
              },
              required: ['component', 'requiredProp'],
            ),
            widgetBuilder: _dummyBuilder,
          ),
        ], catalogId: 'strict_catalog');
        final strictController = SurfaceController(catalogs: [catalog]);
        addTearDown(strictController.dispose);

        const surfaceId = 'strictSurface';
        strictController.handleMessage(
          createSurface(surfaceId: surfaceId, catalogId: 'strict_catalog'),
        );

        final Future<ChatMessage> future = strictController.onSubmit.first;

        // Send invalid component (missing requiredProp)
        strictController.handleMessage(
          updateComponents(
            surfaceId: surfaceId,
            components: [
              component(id: 'bad', type: 'StrictWidget', properties: {}),
            ],
          ),
        );

        final ChatMessage message = await future;
        final UiInteractionPart part = message.parts.uiInteractionParts.first;
        final errorJson = jsonDecode(part.interaction) as Map<String, dynamic>;

        final errorObj = errorJson['error'] as Map<String, dynamic>;
        expect(errorObj['code'], 'VALIDATION_FAILED');
        expect(errorObj['message'], contains('Required property'));
      },
    );
  });

  group('$SurfaceController catalog ID aliases', () {
    const canonicalId = 'canonical_catalog';
    const legacyId = 'legacy_catalog';

    Catalog aliasedCatalog() => Catalog(
      [
        CatalogItem(
          name: 'StrictWidget',
          dataSchema: Schema.object(
            properties: {
              'component': Schema.string(enumValues: ['StrictWidget']),
              'requiredProp': Schema.string(),
            },
            required: ['component', 'requiredProp'],
          ),
          widgetBuilder: _dummyBuilder,
        ),
      ],
      catalogId: canonicalId,
      catalogIdAliases: const [legacyId],
    );

    test('a surface created with an alias resolves to the catalog', () {
      final Catalog catalog = aliasedCatalog();
      final controller = SurfaceController(catalogs: [catalog]);
      addTearDown(controller.dispose);

      controller.handleMessage(
        createSurface(surfaceId: 'aliased', catalogId: legacyId),
      );

      expect(controller.contextFor('aliased').catalog, same(catalog));
    });

    test('a surface created with the canonical ID resolves to the catalog', () {
      final Catalog catalog = aliasedCatalog();
      final controller = SurfaceController(catalogs: [catalog]);
      addTearDown(controller.dispose);

      controller.handleMessage(
        createSurface(surfaceId: 'canonical', catalogId: canonicalId),
      );

      expect(controller.contextFor('canonical').catalog, same(catalog));
    });

    test('a surface created with an unrelated ID resolves to no catalog', () {
      final controller = SurfaceController(catalogs: [aliasedCatalog()]);
      addTearDown(controller.dispose);

      controller.handleMessage(
        createSurface(surfaceId: 'other', catalogId: 'some_other_catalog'),
      );

      expect(controller.contextFor('other').catalog, isNull);
    });

    test(
      'components on an alias surface are validated against the catalog',
      () async {
        final controller = SurfaceController(catalogs: [aliasedCatalog()]);
        addTearDown(controller.dispose);

        const surfaceId = 'aliased';
        controller.handleMessage(
          createSurface(surfaceId: surfaceId, catalogId: legacyId),
        );

        final Future<ChatMessage> future = controller.onSubmit.first;

        // Missing the required `requiredProp`.
        controller.handleMessage(
          updateComponents(
            surfaceId: surfaceId,
            components: [
              component(id: 'bad', type: 'StrictWidget', properties: {}),
            ],
          ),
        );

        final ChatMessage message = await future;
        final UiInteractionPart part = message.parts.uiInteractionParts.first;
        final errorJson = jsonDecode(part.interaction) as Map<String, dynamic>;
        final errorObj = errorJson['error'] as Map<String, dynamic>;

        expect(errorObj['code'], 'VALIDATION_FAILED');
        expect(errorObj['message'], contains('Required property'));
      },
    );

    test('valid components on an alias surface are accepted', () async {
      final controller = SurfaceController(catalogs: [aliasedCatalog()]);
      addTearDown(controller.dispose);

      const surfaceId = 'aliased';
      final updates = <SurfaceUpdate>[];
      final StreamSubscription<SurfaceUpdate> updateSub = controller
          .surfaceUpdates
          .listen(updates.add);
      addTearDown(updateSub.cancel);

      final errors = <ChatMessage>[];
      final StreamSubscription<ChatMessage> errorSub = controller.onSubmit
          .listen(errors.add);
      addTearDown(errorSub.cancel);

      controller.handleMessage(
        createSurface(surfaceId: surfaceId, catalogId: legacyId),
      );
      controller.handleMessage(
        updateComponents(
          surfaceId: surfaceId,
          components: [
            component(
              id: 'root',
              type: 'StrictWidget',
              properties: {'requiredProp': 'ok'},
            ),
          ],
        ),
      );

      // Let the asynchronous validation settle.
      await Future<void>.delayed(Duration.zero);

      expect(errors, isEmpty);
      expect(updates.map((u) => u.surfaceId), contains(surfaceId));
      expect(controller.registry.getSurface(surfaceId), isNotNull);
    });

    test('the basic catalog accepts surfaces created with the legacy ID', () {
      final Catalog catalog = BasicCatalogItems.asCatalog();
      final controller = SurfaceController(catalogs: [catalog]);
      addTearDown(controller.dispose);

      controller.handleMessage(
        createSurface(
          surfaceId: 'basic',
          // ignore: deprecated_member_use_from_same_package
          catalogId: legacyBasicCatalogId,
        ),
      );

      expect(controller.contextFor('basic').catalog, same(catalog));
    });
  });
}

Widget _dummyBuilder(CatalogItemContext context) => const SizedBox();
