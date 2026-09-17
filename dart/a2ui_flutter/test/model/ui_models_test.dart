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

import 'package:a2ui_flutter/src/model/ui_models.dart';
import 'package:a2ui_flutter/src/primitives/a2ui_validation_exception.dart';
import 'package:a2ui_flutter/src/primitives/simple_items.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

void main() {
  group('UserActionEvent', () {
    test('can be created and read', () {
      final now = DateTime.now();
      final event = UserActionEvent(
        surfaceId: 'testSurface',
        name: 'testAction',
        sourceComponentId: 'testWidget',
        timestamp: now,
        context: {'key': 'value'},
      );

      expect(event.surfaceId, 'testSurface');
      expect(event.name, 'testAction');
      expect(event.sourceComponentId, 'testWidget');
      expect(event.timestamp, now);
      expect(event.context, {'key': 'value'});
    });

    test('can be created from map and read', () {
      final now = DateTime.now();
      final event = UserActionEvent.fromMap({
        surfaceIdKey: 'testSurface',
        'name': 'testAction',
        'sourceComponentId': 'testWidget',
        'timestamp': now.toIso8601String(),
        'context': {'key': 'value'},
      });

      expect(event.surfaceId, 'testSurface');
      expect(event.name, 'testAction');
      expect(event.sourceComponentId, 'testWidget');
      expect(event.timestamp, now);
      expect(event.context, {'key': 'value'});
    });

    test('can be converted to map', () {
      final now = DateTime.now();
      final event = UserActionEvent(
        surfaceId: 'testSurface',
        name: 'testAction',
        sourceComponentId: 'testWidget',
        timestamp: now,
        context: {'key': 'value'},
      );

      final JsonMap map = event.toMap();

      expect(map[surfaceIdKey], 'testSurface');
      expect(map['name'], 'testAction');
      expect(map['sourceComponentId'], 'testWidget');
      expect(map['timestamp'], now.toIso8601String());
      expect(map['context'], {'key': 'value'});
    });
  });

  group('SurfaceDefinition', () {
    test('validate throws exception on mismatch', () async {
      final component = const Component(
        id: 'test',
        type: 'Text',
        properties: {'text': 'Hello'},
      );
      final surfaceDefinition = SurfaceDefinition(
        surfaceId: 's1',
        components: {'test': component},
      );

      // Schema invalidating the component (e.g., expecting type "Button")
      final schema = S.object(
        properties: {
          'components': S.list(
            items: S.object(
              properties: {'component': S.string(constValue: 'Button')},
            ),
          ),
        },
      );

      await expectLater(
        surfaceDefinition.validate(schema),
        throwsA(isA<A2uiValidationException>()),
      );
    });

    test('validate passes on correct match', () async {
      final component = const Component(
        id: 'test',
        type: 'Text',
        properties: {'text': 'Hello'},
      );
      final surfaceDefinition = SurfaceDefinition(
        surfaceId: 's1',
        components: {'test': component},
      );

      final schema = S.object(
        properties: {
          'components': S.list(
            items: S.object(
              properties: {
                'component': S.string(constValue: 'Text'),
                'text': S.string(),
              },
            ),
          ),
        },
      );

      await surfaceDefinition.validate(schema); // Should not throw
    });
  });

  group('SurfaceDefinition extended', () {
    test('copyWith works', () {
      final sd = SurfaceDefinition(
        surfaceId: 's1',
        catalogId: 'c1',
        components: const {},
      );
      final SurfaceDefinition copied = sd.copyWith(catalogId: 'c2');
      expect(copied.surfaceId, 's1');
      expect(copied.catalogId, 'c2');
    });

    test('asContextDescriptionText works', () {
      final sd = SurfaceDefinition(
        surfaceId: 's1',
        components: {
          'root': const Component(
            id: 'root',
            type: 'Text',
            properties: {'text': 'Hello'},
          ),
        },
      );
      final String text = sd.asContextDescriptionText();
      expect(text, contains('Text'));
      expect(text, contains('Hello'));
    });
  });

  group('Component', () {
    test('toJson', () {
      final c = const Component(
        id: 'c1',
        type: 'Button',
        properties: {'label': 'Click'},
      );
      expect(c.toJson(), {'id': 'c1', 'component': 'Button', 'label': 'Click'});
    });
  });
}
