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
  group('AgentToRendererMessage.fromJson', () {
    test('parses createSurface', () {
      final msg = AgentToRendererMessage.fromJson({
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
      final msg = AgentToRendererMessage.fromJson({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 's1', 'catalogId': 'cat1'},
      });

      final cs = msg as CreateSurfaceMessage;
      expect(cs.theme, isNull);
      expect(cs.sendDataModel, false);
    });

    test('parses updateComponents', () {
      final msg = AgentToRendererMessage.fromJson({
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
      final msg = AgentToRendererMessage.fromJson({
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
      final msg = AgentToRendererMessage.fromJson({
        'version': 'v0.9',
        'updateDataModel': {'surfaceId': 's1'},
      });

      final ud = msg as UpdateDataModelMessage;
      expect(ud.path, isNull);
      expect(ud.value, isNull);
    });

    test('parses deleteSurface', () {
      final msg = AgentToRendererMessage.fromJson({
        'version': 'v0.9',
        'deleteSurface': {'surfaceId': 's1'},
      });

      expect(msg, isA<DeleteSurfaceMessage>());
      final ds = msg as DeleteSurfaceMessage;
      expect(ds.surfaceId, 's1');
    });

    test('throws on unknown message type', () {
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'unknownType': {'surfaceId': 's1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when version field is missing', () {
      expect(
        () => AgentToRendererMessage.fromJson({
          'createSurface': {'surfaceId': 's1', 'catalogId': 'c1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when version is not v0.9', () {
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.8',
          'createSurface': {'surfaceId': 's1', 'catalogId': 'c1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when version is not a string', () {
      expect(
        () => AgentToRendererMessage.fromJson({
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
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'createSurface': {'surfaceId': 's1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'updateComponents': {'surfaceId': 's1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when a body field has the wrong type', () {
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'createSurface': {'surfaceId': 123, 'catalogId': 'c1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'updateComponents': {'surfaceId': 's1', 'components': 'nope'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 's1',
            'components': ['nope'],
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'updateDataModel': {'surfaceId': 's1', 'path': 7},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when the message body is not an object', () {
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'deleteSurface': 's1',
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when more than one message type is present', () {
      expect(
        () => AgentToRendererMessage.fromJson({
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

      final roundtripped = AgentToRendererMessage.fromJson(original.toJson());
      expect(roundtripped, isA<CreateSurfaceMessage>());
      final cs = roundtripped as CreateSurfaceMessage;
      expect(cs.surfaceId, 's1');
      expect(cs.catalogId, 'cat1');
      expect(cs.theme, {'color': 'red'});
      expect(cs.sendDataModel, true);
    });
  });

  group('AgentToRendererMessagePayload', () {
    Map<String, Object?> createSurface(String surfaceId) => {
      'version': 'v0.9',
      'createSurface': {'surfaceId': surfaceId, 'catalogId': 'cat1'},
    };

    AgentToRendererMessagePayload parse(Object? payload) =>
        AgentToRendererMessagePayload.fromJson(
          payload,
          protocolVersion: A2uiProtocolVersion.v0_9,
        );

    test('accepts a lone envelope', () {
      final AgentToRendererMessagePayload payload = parse(createSurface('s1'));

      expect(payload.messages, hasLength(1));
      expect(payload.messages.single, isA<CreateSurfaceMessage>());
    });

    test('accepts a list of envelopes', () {
      final AgentToRendererMessagePayload payload = parse([
        createSurface('s1'),
        createSurface('s2'),
      ]);

      expect(
        payload.messages.map((m) => (m as CreateSurfaceMessage).surfaceId),
        ['s1', 's2'],
      );
    });

    test('accepts the messages wrapper', () {
      // The shape the specification defines for transports that require a
      // top-level object rather than a bare array.
      final AgentToRendererMessagePayload payload = parse({
        'messages': [createSurface('s1'), createSurface('s2')],
      });

      expect(payload.messages, hasLength(2));
    });

    test('accepts a wrapper nested in a list', () {
      // Unwrapping recurses, so a transport that batches wrappers is read the
      // same as one that batches envelopes.
      final AgentToRendererMessagePayload payload = parse([
        {
          'messages': [createSurface('s1')],
        },
        createSurface('s2'),
      ]);

      expect(payload.messages, hasLength(2));
    });

    test('reads an absent or empty payload as an empty batch', () {
      // An empty batch is not a failure: a transport with nothing to deliver
      // has not sent a malformed payload.
      expect(parse(null).messages, isEmpty);
      expect(parse(<Object?>[]).messages, isEmpty);
      expect(parse({'messages': <Object?>[]}).messages, isEmpty);
    });

    test('rejects a payload that is neither a message nor a list', () {
      expect(() => parse('createSurface'), throwsA(isA<A2uiValidationError>()));
    });

    test('rejects an object with non-string keys', () {
      // `cast` is lazy, so this used to escape as a TypeError from whatever
      // later copied the map rather than as a payload defect.
      expect(
        () => parse({1: 'createSurface'}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => parse([
          {
            'messages': [
              {2: 'nope'},
            ],
          },
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test("rejects a wrapper whose 'messages' is not a list", () {
      expect(
        () => parse({'messages': createSurface('s1')}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects an envelope declaring another protocol version', () {
      expect(
        () => parse({
          'version': 'v1.0',
          'createSurface': {'surfaceId': 's1', 'catalogId': 'cat1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('carries a single parsed message', () {
      final payload = AgentToRendererMessagePayload.of(
        DeleteSurfaceMessage(surfaceId: 's1'),
      );

      expect(payload.messages.single, isA<DeleteSurfaceMessage>());
    });

    test('holds its messages unmodifiably', () {
      // The list a caller passed cannot change under a processor part-way
      // through applying it.
      final messages = [DeleteSurfaceMessage(surfaceId: 's1')];
      final payload = AgentToRendererMessagePayload(messages);

      messages.add(DeleteSurfaceMessage(surfaceId: 's2'));
      expect(payload.messages, hasLength(1));
      expect(
        () => payload.messages.add(DeleteSurfaceMessage(surfaceId: 's3')),
        throwsUnsupportedError,
      );
    });

    test('serializes to both the wrapper and the bare list', () {
      final payload = AgentToRendererMessagePayload.of(
        DeleteSurfaceMessage(surfaceId: 's1'),
      );

      expect(payload.toJsonList(), [
        {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's1'},
        },
      ]);
      expect(payload.toJson(), {'messages': payload.toJsonList()});
    });

    test('roundtrips through toJson/fromJson', () {
      final original = AgentToRendererMessagePayload([
        CreateSurfaceMessage(surfaceId: 's1', catalogId: 'cat1'),
        DeleteSurfaceMessage(surfaceId: 's1'),
      ]);

      final AgentToRendererMessagePayload roundtripped = parse(
        original.toJson(),
      );

      expect(roundtripped.toJsonList(), original.toJsonList());
    });
  });

  group('RendererToAgentMessage.fromJson', () {
    test('parses an action', () {
      final msg = RendererToAgentMessage.fromJson({
        'version': 'v0.9',
        'action': {
          'name': 'submit',
          'surfaceId': 's1',
          'sourceComponentId': 'button',
          'timestamp': '2026-09-16T10:30:00.000Z',
          'context': {'email': 'a@b.c'},
        },
      });

      expect(msg, isA<ActionMessage>());
      final A2uiClientAction action = (msg as ActionMessage).action;
      expect(action.name, 'submit');
      expect(action.surfaceId, 's1');
      expect(action.sourceComponentId, 'button');
      expect(action.timestamp, DateTime.utc(2026, 9, 16, 10, 30));
      expect(action.context, {'email': 'a@b.c'});
    });

    test('parses an error', () {
      final msg = RendererToAgentMessage.fromJson({
        'version': 'v0.9',
        'error': {
          'code': 'VALIDATION_FAILED',
          'surfaceId': 's1',
          'message': 'no such component',
          'path': '/components/0/text',
        },
      });

      expect(msg, isA<ErrorMessage>());
      final A2uiClientError error = (msg as ErrorMessage).error;
      expect(error.code, 'VALIDATION_FAILED');
      expect(error.surfaceId, 's1');
      expect(error.message, 'no such component');
      expect(error.path, '/components/0/text');
      expect(error.details, isNull);
    });

    test('rejects a validation failure that names no path', () {
      // The VALIDATION_FAILED variant requires 'path', and no other field says
      // what failed, so a body without it is rejected rather than parsed into
      // an error an agent cannot act on.
      expect(
        () => RendererToAgentMessage.fromJson({
          'version': 'v0.9',
          'error': {
            'code': 'VALIDATION_FAILED',
            'surfaceId': 's1',
            'message': 'no such component',
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('parses a generic error that names no path', () {
      // Only the VALIDATION_FAILED variant requires it.
      final msg = RendererToAgentMessage.fromJson({
        'version': 'v0.9',
        'error': {'code': 'RENDER_FAILED', 'surfaceId': 's1', 'message': 'x'},
      });

      expect((msg as ErrorMessage).error.path, isNull);
    });

    test('roundtrips a validation failure with its path', () {
      // The path the VALIDATION_FAILED variant requires survives the round
      // trip; nothing else in the body names the field that failed.
      final original = ErrorMessage(
        error: A2uiClientError(
          code: 'VALIDATION_FAILED',
          surfaceId: 's1',
          message: 'no such component',
          path: '/components/0/text',
        ),
      );

      final roundtripped = RendererToAgentMessage.fromJson(original.toJson());

      expect(roundtripped.toJson(), original.toJson());
      expect((roundtripped as ErrorMessage).error.path, '/components/0/text');
    });

    test('throws when both an action and an error are present', () {
      expect(
        () => RendererToAgentMessage.fromJson({
          'version': 'v0.9',
          'action': {
            'name': 'submit',
            'surfaceId': 's1',
            'sourceComponentId': 'button',
            'timestamp': '2026-09-16T10:30:00.000Z',
            'context': <String, Object?>{},
          },
          'error': {'code': 'X', 'surfaceId': 's1', 'message': 'boom'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws on an unknown message type', () {
      expect(
        () => RendererToAgentMessage.fromJson({
          'version': 'v0.9',
          'functionCall': <String, Object?>{},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when version is missing or unsupported', () {
      expect(
        () => RendererToAgentMessage.fromJson({
          'error': {'code': 'X', 'surfaceId': 's1', 'message': 'boom'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => RendererToAgentMessage.fromJson({
          'version': 'v0.8',
          'error': {'code': 'X', 'surfaceId': 's1', 'message': 'boom'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws when a required body field is missing', () {
      expect(
        () => RendererToAgentMessage.fromJson({
          'version': 'v0.9',
          'error': {'code': 'X', 'surfaceId': 's1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => RendererToAgentMessage.fromJson({
          'version': 'v0.9',
          'action': {
            'name': 'submit',
            'surfaceId': 's1',
            'sourceComponentId': 'button',
            'timestamp': '2026-09-16T10:30:00.000Z',
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('throws on a timestamp that is not an ISO 8601 instant', () {
      // Reported as a validation error rather than left to escape as the
      // platform's FormatException, which sits outside the A2uiError hierarchy.
      expect(
        () => RendererToAgentMessage.fromJson({
          'version': 'v0.9',
          'action': {
            'name': 'submit',
            'surfaceId': 's1',
            'sourceComponentId': 'button',
            'timestamp': 'yesterday',
            'context': <String, Object?>{},
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('roundtrips through toJson/fromJson', () {
      final original = ActionMessage(
        action: A2uiClientAction(
          name: 'submit',
          surfaceId: 's1',
          sourceComponentId: 'button',
          timestamp: DateTime.utc(2026, 9, 16, 10, 30),
          context: {'email': 'a@b.c'},
        ),
      );

      final roundtripped = RendererToAgentMessage.fromJson(original.toJson());

      expect(roundtripped.toJson(), original.toJson());
    });
  });

  group('RendererToAgentMessagePayload', () {
    Map<String, Object?> error(String code) => {
      'version': 'v0.9',
      'error': {'code': code, 'surfaceId': 's1', 'message': 'boom'},
    };

    RendererToAgentMessagePayload parse(Object? payload) =>
        RendererToAgentMessagePayload.fromJson(
          payload,
          protocolVersion: A2uiProtocolVersion.v0_9,
        );

    test('accepts a lone envelope, a list and the wrapper', () {
      expect(parse(error('A')).messages, hasLength(1));
      expect(parse([error('A'), error('B')]).messages, hasLength(2));
      expect(
        parse({
          'messages': [error('A'), error('B')],
        }).messages,
        hasLength(2),
      );
    });

    test('reads an absent or empty payload as an empty batch', () {
      expect(parse(null).messages, isEmpty);
      expect(parse(<Object?>[]).messages, isEmpty);
    });

    test('rejects an envelope declaring another protocol version', () {
      expect(
        () => parse({
          'version': 'v1.0',
          'error': {'code': 'A', 'surfaceId': 's1', 'message': 'boom'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('serializes to both the wrapper and the bare list', () {
      final payload = RendererToAgentMessagePayload.of(
        ErrorMessage(
          error: A2uiClientError(code: 'A', surfaceId: 's1', message: 'boom'),
        ),
      );

      expect(payload.toJsonList(), [error('A')]);
      expect(payload.toJson(), {
        'messages': [error('A')],
      });
    });

    test('holds its messages unmodifiably', () {
      final RendererToAgentMessagePayload payload = parse([error('A')]);

      expect(
        () => payload.messages.add(
          ErrorMessage(
            error: A2uiClientError(code: 'B', surfaceId: 's1', message: 'boom'),
          ),
        ),
        throwsUnsupportedError,
      );
    });
  });
}
