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

import 'dart:convert';

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test_infra/message_builders.dart';

void main() {
  group('SurfaceController Validation', () {
    test('CreateSurface fails validation with empty surfaceId', () async {
      final controller = SurfaceController(catalogs: []);

      // Expect an error message on the submit stream
      final Future<void> future = expectLater(
        controller.onSubmit,
        emits(
          predicate((ChatMessage message) {
            final UiInteractionPart part =
                message.parts.uiInteractionParts.first;
            final json = jsonDecode(part.interaction) as Map<String, dynamic>;
            final error = json['error'] as Map<String, dynamic>;
            return error['code'] == 'VALIDATION_FAILED' &&
                error['path'] == 'surfaceId';
          }),
        ),
      );

      controller.handleMessage(
        createSurface(surfaceId: '', catalogId: 'default'),
      );

      await future;
    });

    test(
      'CreateSurface fails schema validation for invalid component',
      () async {
        final controller = SurfaceController(
          catalogs: [BasicCatalogItems.asCatalog()],
        );

        final Future<void> future = expectLater(
          controller.onSubmit,
          emits(
            predicate((ChatMessage message) {
              final UiInteractionPart part =
                  message.parts.uiInteractionParts.first;
              final json = jsonDecode(part.interaction) as Map<String, dynamic>;
              final error = json['error'] as Map<String, dynamic>;
              return error['code'] == 'VALIDATION_FAILED' &&
                  (error['message'] as String).contains('badText');
            }),
          ),
        );

        controller.handleMessage(
          createSurface(surfaceId: 'surf1', catalogId: basicCatalogId),
        );

        controller.handleMessage(
          updateComponents(
            surfaceId: 'surf1',
            components: [
              component(
                id: 'badText',
                type: 'Text',
                properties: {},
              ), // Missing 'text' property
            ],
          ),
        );

        await future;
      },
    );

    test(
      'UpdateDataModel write failure reports its surfaceId and path',
      () async {
        final controller = SurfaceController(
          catalogs: [BasicCatalogItems.asCatalog()],
        );

        final Future<void> future = expectLater(
          controller.onSubmit,
          emits(
            predicate((ChatMessage message) {
              final UiInteractionPart part =
                  message.parts.uiInteractionParts.first;
              final json = jsonDecode(part.interaction) as Map<String, Object?>;
              final error = json['error'] as Map<String, Object?>;
              return error['code'] == 'VALIDATION_FAILED' &&
                  error['surfaceId'] == 'surf1' &&
                  error['path'] == '/scalar/child/leaf';
            }),
          ),
        );

        controller.handleMessage(
          createSurface(surfaceId: 'surf1', catalogId: basicCatalogId),
        );
        // The core data model rejects writing through a primitive intermediate;
        // the controller surfaces it with the offending surfaceId and path.
        controller.handleMessage(
          updateDataModel(
            surfaceId: 'surf1',
            path: DataPath('/scalar'),
            value: 5,
          ),
        );
        controller.handleMessage(
          updateDataModel(
            surfaceId: 'surf1',
            path: DataPath('/scalar/child/leaf'),
            value: 'x',
          ),
        );

        await future;
      },
    );

    test(
      'validates components against an inline catalog (catalogId == null)',
      () async {
        // An inline catalog (no explicit id) is registered under a synthesized
        // id; the controller must resolve a surface back to it, or validation
        // is silently skipped.
        final inlineCatalog = Catalog(BasicCatalogItems.asCatalog().items);
        final controller = SurfaceController(catalogs: [inlineCatalog]);

        final Future<void> future = expectLater(
          controller.onSubmit,
          emits(
            predicate((ChatMessage message) {
              final UiInteractionPart part =
                  message.parts.uiInteractionParts.first;
              final json = jsonDecode(part.interaction) as Map<String, Object?>;
              final error = json['error'] as Map<String, Object?>;
              return error['code'] == 'VALIDATION_FAILED' &&
                  (error['message'] as String).contains('badText');
            }),
          ),
        );

        controller.handleMessage(
          createSurface(
            surfaceId: 'surf1',
            catalogId: inlineCatalog.effectiveCatalogId,
          ),
        );
        controller.handleMessage(
          updateComponents(
            surfaceId: 'surf1',
            components: [
              component(id: 'badText', type: 'Text', properties: {}),
            ],
          ),
        );

        await future;
      },
    );
  });
}
