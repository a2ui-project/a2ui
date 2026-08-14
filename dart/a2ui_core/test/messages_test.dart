// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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
