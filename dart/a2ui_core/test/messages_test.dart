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
import 'package:test/test.dart';

void main() {
  group('A2uiMessage.fromJson', () {
    test('parses createSurface', () {
      final msg = A2uiMessage.fromJson({
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 's1',
          'catalogId': 'cat1',
          'theme': {'primaryColor': '#FF0000'},
          'sendDataModel': true,
        },
      });

      expect(msg, isA<CreateSurfaceMessage>());
      final cs = msg as CreateSurfaceMessage;
      expect(cs.surfaceId, 's1');
      expect(cs.catalogId, 'cat1');
      expect(cs.theme, {'primaryColor': '#FF0000'});
      expect(cs.sendDataModel, true);
      expect(cs.version, 'v0.9');
    });

    test('parses createSurface with defaults', () {
      final msg = A2uiMessage.fromJson({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 's1', 'catalogId': 'cat1'},
      });

      final cs = msg as CreateSurfaceMessage;
      expect(cs.theme, isNull);
      expect(cs.sendDataModel, false);
    });

    test('parses updateComponents', () {
      final msg = A2uiMessage.fromJson({
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 's1',
          'components': [
            {'id': 'root', 'component': 'Text', 'text': 'Hello'},
          ],
        },
      });

      expect(msg, isA<UpdateComponentsMessage>());
      final uc = msg as UpdateComponentsMessage;
      expect(uc.surfaceId, 's1');
      expect(uc.components, hasLength(1));
      expect(uc.components[0]['text'], 'Hello');
    });

    test('parses updateDataModel', () {
      final msg = A2uiMessage.fromJson({
        'version': 'v0.9',
        'updateDataModel': {
          'surfaceId': 's1',
          'path': '/user/name',
          'value': 'Alice',
        },
      });

      expect(msg, isA<UpdateDataModelMessage>());
      final ud = msg as UpdateDataModelMessage;
      expect(ud.surfaceId, 's1');
      expect(ud.path, '/user/name');
      expect(ud.value, 'Alice');
    });

    test('parses updateDataModel without path or value', () {
      final msg = A2uiMessage.fromJson({
        'version': 'v0.9',
        'updateDataModel': {'surfaceId': 's1'},
      });

      final ud = msg as UpdateDataModelMessage;
      expect(ud.path, isNull);
      expect(ud.value, isNull);
    });

    test('parses deleteSurface', () {
      final msg = A2uiMessage.fromJson({
        'version': 'v0.9',
        'deleteSurface': {'surfaceId': 's1'},
      });

      expect(msg, isA<DeleteSurfaceMessage>());
      final ds = msg as DeleteSurfaceMessage;
      expect(ds.surfaceId, 's1');
    });

    test('throws on unknown message type', () {
      expect(
        () => A2uiMessage.fromJson({
          'version': 'v0.9',
          'unknownType': {'surfaceId': 's1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when version field is missing', () {
      expect(
        () => A2uiMessage.fromJson({
          'createSurface': {'surfaceId': 's1', 'catalogId': 'c1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when version is not v0.9', () {
      expect(
        () => A2uiMessage.fromJson({
          'version': 'v0.8',
          'createSurface': {'surfaceId': 's1', 'catalogId': 'c1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when version is not a string', () {
      expect(
        () => A2uiMessage.fromJson({
          'version': 123,
          'createSurface': {'surfaceId': 's1', 'catalogId': 'c1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when a required body field is missing', () {
      // Reported as a validation error rather than left to fail as a cast: a
      // malformed envelope is a payload defect, not a programming error.
      expect(
        () => A2uiMessage.fromJson({
          'version': 'v0.9',
          'createSurface': {'surfaceId': 's1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => A2uiMessage.fromJson({
          'version': 'v0.9',
          'updateComponents': {'surfaceId': 's1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when a body field has the wrong type', () {
      expect(
        () => A2uiMessage.fromJson({
          'version': 'v0.9',
          'createSurface': {'surfaceId': 123, 'catalogId': 'c1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => A2uiMessage.fromJson({
          'version': 'v0.9',
          'updateComponents': {'surfaceId': 's1', 'components': 'nope'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => A2uiMessage.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 's1',
            'components': ['nope'],
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => A2uiMessage.fromJson({
          'version': 'v0.9',
          'updateDataModel': {'surfaceId': 's1', 'path': 7},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when the message body is not an object', () {
      expect(
        () => A2uiMessage.fromJson({'version': 'v0.9', 'deleteSurface': 's1'}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when more than one message type is present', () {
      expect(
        () => A2uiMessage.fromJson({
          'version': 'v0.9',
          'createSurface': {'surfaceId': 's1', 'catalogId': 'c1'},
          'updateComponents': {'surfaceId': 's1', 'components': <Object?>[]},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('roundtrips through toJson/fromJson', () {
      final original = CreateSurfaceMessage(
        surfaceId: 's1',
        catalogId: 'cat1',
        theme: {'color': 'red'},
        sendDataModel: true,
      );

      final roundtripped = A2uiMessage.fromJson(original.toJson());
      expect(roundtripped, isA<CreateSurfaceMessage>());
      final cs = roundtripped as CreateSurfaceMessage;
      expect(cs.surfaceId, 's1');
      expect(cs.catalogId, 'cat1');
      expect(cs.theme, {'color': 'red'});
      expect(cs.sendDataModel, true);
    });
  });
}
