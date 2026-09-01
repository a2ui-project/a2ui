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
import 'package:a2ui_core/src/processing/processor.dart';
import 'package:test/test.dart';

void main() {
  group('MessageProcessor', () {
    late MinimalCatalog catalog;
    late MessageProcessor processor;

    setUp(() {
      catalog = MinimalCatalog();
      processor = MessageProcessor(catalogs: [catalog]);
    });

    test('creates surface', () {
      processor.processMessages([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: catalog.id),
      ]);

      final SurfaceModel<ComponentApi>? surface = processor.groupModel
          .getSurface('s1');
      expect(surface, isNotNull);
      expect(surface?.id, 's1');
      expect(surface?.catalog.id, catalog.id);
    });

    test('updates components', () {
      processor.processMessages([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: catalog.id),
        UpdateComponentsMessage(
          surfaceId: 's1',
          components: [
            {'id': 'root', 'component': 'Text', 'text': 'Hello'},
          ],
        ),
      ]);

      final SurfaceModel<ComponentApi>? surface = processor.groupModel
          .getSurface('s1');
      final ComponentModel? root = surface?.componentsModel.get('root');
      expect(root, isNotNull);
      expect(root?.type, 'Text');
      expect(root?.properties['text'], 'Hello');
    });

    test('updates data model', () {
      processor.processMessages([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: catalog.id),
        UpdateDataModelMessage(
          surfaceId: 's1',
          path: '/user/name',
          value: 'Alice',
        ),
      ]);

      final SurfaceModel<ComponentApi>? surface = processor.groupModel
          .getSurface('s1');
      expect(surface?.dataModel.get('/user/name'), 'Alice');
    });

    test('deletes surface', () {
      processor.processMessages([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: catalog.id),
        DeleteSurfaceMessage(surfaceId: 's1'),
      ]);

      expect(processor.groupModel.getSurface('s1'), isNull);
    });

    test('generates client capabilities with inline catalogs', () {
      final Map<String, dynamic> caps = processor.getClientCapabilities(
        includeInlineCatalogs: true,
      );
      final v09 = caps['v0.9'] as Map<String, dynamic>;
      expect(v09['supportedCatalogIds'], contains(catalog.id));

      final inline = v09['inlineCatalogs'] as List;
      final first = inline.first as Map<String, dynamic>;
      expect(first['catalogId'], catalog.id);
      expect(first['components'], contains('Text'));
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
        reason:
            'CommonSchemas.dynamicString should not be mutated by '
            'getClientCapabilities',
      );
    });

    test('aggregates client data model', () {
      processor.processMessages([
        CreateSurfaceMessage(
          surfaceId: 's1',
          catalogId: catalog.id,
          sendDataModel: true,
        ),
        UpdateDataModelMessage(surfaceId: 's1', path: '/foo', value: 'bar'),
        CreateSurfaceMessage(
          surfaceId: 's2',
          catalogId: catalog.id,
          sendDataModel: false,
        ),
        UpdateDataModelMessage(surfaceId: 's2', path: '/secret', value: 'baz'),
      ]);

      final Map<String, dynamic>? dataModel = processor.getClientDataModel();
      expect(dataModel, isNotNull);
      final surfaces = dataModel?['surfaces'] as Map<String, dynamic>?;
      expect(surfaces, contains('s1'));
      expect(surfaces, isNot(contains('s2')));
      expect(surfaces?['s1'], {'foo': 'bar'});
    });
    test('applies a fully valid batch of components', () {
      processor.processMessages([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: catalog.id),
        UpdateComponentsMessage(
          surfaceId: 's1',
          components: [
            {'id': 'root', 'component': 'Text', 'text': 'first'},
            {'id': 'second', 'component': 'Text', 'text': 'second'},
          ],
        ),
      ]);

      final SurfaceModel<ComponentApi>? surface = processor.groupModel
          .getSurface('s1');
      expect(surface?.componentsModel.get('root'), isNotNull);
      expect(surface?.componentsModel.get('second'), isNotNull);
    });

    test('rejects a batch with a component missing an id without mutating '
        'the surface', () {
      processor.processMessages([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: catalog.id),
      ]);
      final SurfaceModel<ComponentApi> surface = processor.groupModel
          .getSurface('s1')!;

      expect(
        () => processor.processMessages([
          UpdateComponentsMessage(
            surfaceId: 's1',
            components: [
              {'id': 'root', 'component': 'Text', 'text': 'valid'},
              {'component': 'Text', 'text': 'no id'},
            ],
          ),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );

      expect(surface.componentsModel.get('root'), isNull);
      expect(surface.componentsModel.all, isEmpty);
    });

    test('rejects a batch that creates a component without a type without '
        'mutating the surface', () {
      processor.processMessages([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: catalog.id),
      ]);
      final SurfaceModel<ComponentApi> surface = processor.groupModel
          .getSurface('s1')!;

      expect(
        () => processor.processMessages([
          UpdateComponentsMessage(
            surfaceId: 's1',
            components: [
              {'id': 'root', 'component': 'Text', 'text': 'valid'},
              {'id': 'typeless', 'text': 'no component type'},
            ],
          ),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );

      expect(surface.componentsModel.all, isEmpty);
    });

    test('leaves previously applied components untouched when a later batch '
        'is rejected', () {
      processor.processMessages([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: catalog.id),
        UpdateComponentsMessage(
          surfaceId: 's1',
          components: [
            {'id': 'root', 'component': 'Text', 'text': 'original'},
          ],
        ),
      ]);
      final SurfaceModel<ComponentApi> surface = processor.groupModel
          .getSurface('s1')!;

      expect(
        () => processor.processMessages([
          UpdateComponentsMessage(
            surfaceId: 's1',
            components: [
              {'id': 'root', 'component': 'Text', 'text': 'updated'},
              {'component': 'Text', 'text': 'no id'},
            ],
          ),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );

      final ComponentModel? root = surface.componentsModel.get('root');
      expect(root, isNotNull);
      expect(root?.properties['text'], 'original');
      expect(surface.componentsModel.all, hasLength(1));
    });

    test('updating an existing component without repeating its type is '
        'allowed', () {
      processor.processMessages([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: catalog.id),
        UpdateComponentsMessage(
          surfaceId: 's1',
          components: [
            {'id': 'root', 'component': 'Text', 'text': 'original'},
          ],
        ),
        UpdateComponentsMessage(
          surfaceId: 's1',
          components: [
            {'id': 'root', 'text': 'updated'},
          ],
        ),
      ]);

      final SurfaceModel<ComponentApi>? surface = processor.groupModel
          .getSurface('s1');
      final ComponentModel? root = surface?.componentsModel.get('root');
      expect(root?.type, 'Text');
      expect(root?.properties['text'], 'updated');
    });
  });
}
