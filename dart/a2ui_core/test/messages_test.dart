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

    test('parses createSurface with generic Map theme', () {
      final msg = AgentToRendererMessage.fromJson({
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 's1',
          'catalogId': 'cat1',
          'theme': <dynamic, dynamic>{'primaryColor': '#FF0000'},
        },
      });

      final cs = msg as CreateSurfaceMessage;
      expect(cs.theme, {'primaryColor': '#FF0000'});
    });

    test('rejects createSurface with non-string keys in theme', () {
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': 's1',
            'catalogId': 'cat1',
            'theme': <dynamic, dynamic>{123: '#FF0000'},
          },
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("Field 'createSurface.theme' must have string keys."),
          ),
        ),
      );
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

    test('roundtrips through toJson/fromJson', () {
      final original = CreateSurfaceMessage(
        version: 'v0.9',
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
        DeleteSurfaceMessage(version: 'v0.9', surfaceId: 's1'),
      );

      expect(payload.messages.single, isA<DeleteSurfaceMessage>());
    });

    test('holds its messages unmodifiably', () {
      // The list a caller passed cannot change under a processor part-way
      // through applying it.
      final messages = [DeleteSurfaceMessage(version: 'v0.9', surfaceId: 's1')];
      final payload = AgentToRendererMessagePayload(messages);

      messages.add(DeleteSurfaceMessage(version: 'v0.9', surfaceId: 's2'));
      expect(payload.messages, hasLength(1));
      expect(
        () => payload.messages
            .add(DeleteSurfaceMessage(version: 'v0.9', surfaceId: 's3')),
        throwsUnsupportedError,
      );
    });

    test('serializes to both the wrapper and the bare list', () {
      final payload = AgentToRendererMessagePayload.of(
        DeleteSurfaceMessage(version: 'v0.9', surfaceId: 's1'),
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
        CreateSurfaceMessage(
            version: 'v0.9', surfaceId: 's1', catalogId: 'cat1'),
        DeleteSurfaceMessage(version: 'v0.9', surfaceId: 's1'),
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

    test('parses an action with userMessage', () {
      final msg = RendererToAgentMessage.fromJson({
        'version': 'v0.9',
        'action': {
          'name': 'submit',
          'surfaceId': 's1',
          'sourceComponentId': 'button',
          'timestamp': '2026-09-16T10:30:00.000Z',
          'context': {'email': 'a@b.c'},
          'userMessage': 'Submitting feedback',
        },
      });

      expect(msg, isA<ActionMessage>());
      final A2uiClientAction action = (msg as ActionMessage).action;
      expect(action.userMessage, 'Submitting feedback');
      expect(action.toJson()['userMessage'], 'Submitting feedback');
    });

    test('rejects an action with non-string userMessage', () {
      expect(
        () => RendererToAgentMessage.fromJson({
          'version': 'v0.9',
          'action': {
            'name': 'submit',
            'surfaceId': 's1',
            'sourceComponentId': 'button',
            'timestamp': '2026-09-16T10:30:00.000Z',
            'context': <String, Object?>{},
            'userMessage': 12345,
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
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
        version: 'v0.9',
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

    test('throws when an object field contains non-string keys', () {
      expect(
        () => RendererToAgentMessage.fromJson({
          'version': 'v0.9',
          'action': {
            'name': 'submit',
            'surfaceId': 's1',
            'sourceComponentId': 'button',
            'timestamp': '2026-09-16T10:30:00.000Z',
            'context': <dynamic, dynamic>{123: 'val'},
          },
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("Field 'action.context' must have string keys."),
          ),
        ),
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
        version: 'v0.9',
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
          version: 'v0.9',
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
            version: 'v0.9',
            error: A2uiClientError(code: 'B', surfaceId: 's1', message: 'boom'),
          ),
        ),
        throwsUnsupportedError,
      );
    });
  });

  group('v1.0 agent-to-renderer envelopes', () {
    Map<String, Object?> roundTrip(Map<String, Object?> json) =>
        AgentToRendererMessage.fromJson(json).toJson();

    test('round-trips every v1.0 message', () {
      final envelopes = <Map<String, Object?>>[
        {
          'version': 'v1.0',
          'createSurface': {
            'surfaceId': 's1',
            'catalogId': 'cat1',
            'sendDataModel': true,
            'components': [
              {'id': 'root', 'component': 'Text', 'text': 'hi'},
            ],
            'dataModel': {'name': 'Ada'},
            'metadata': {
              'extensions': {'tracing': true},
            },
          },
        },
        {
          'version': 'v1.0',
          'createSurface': {'surfaceId': 's1', 'sendDataModel': false},
        },
        {
          'version': 'v1.0',
          'updateComponents': {
            'surfaceId': 's1',
            'components': [
              {'id': 'root', 'component': 'Text'},
            ],
          },
        },
        {
          'version': 'v1.0',
          'updateDataModel': {'surfaceId': 's1', 'path': '/a', 'value': 3},
        },
        {
          'version': 'v1.0',
          'updateDataModel': {'surfaceId': 's1', 'path': '/a', 'value': null},
        },
        {
          'version': 'v1.0',
          'deleteSurface': {'surfaceId': 's1'},
        },
        {
          'version': 'v1.0',
          'callRendererFunction': {
            'functionCallId': 'call-1',
            'callFunction': {
              '@call': 'playMedia',
              'catalogId': 'media',
              'args': {'mediaId': 'v1'},
            },
          },
        },
        {
          'version': 'v1.0',
          'agentFunctionResponse': {'functionCallId': 'call-2', 'value': 42},
        },
        {
          'version': 'v1.0',
          'agentFunctionResponse': {'functionCallId': 'call-3', 'value': null},
        },
        {
          'version': 'v1.0',
          'agentFunctionResponse': {
            'functionCallId': 'call-4',
            'error': {'code': 'FAILED', 'message': 'nope'},
          },
        },
      ];
      for (final envelope in envelopes) {
        expect(roundTrip(envelope), envelope);
      }
    });

    test('parses v1.0 createSurface fields', () {
      final msg = AgentToRendererMessage.fromJson({
        'version': 'v1.0',
        'createSurface': {
          'surfaceId': 's1',
          'components': [
            {'id': 'root', 'component': 'Text'},
          ],
          'dataModel': {'a': 1},
          'metadata': {'extensions': <String, Object?>{}},
        },
      }) as CreateSurfaceMessage;
      expect(msg.catalogId, isNull);
      expect(msg.components, [
        {'id': 'root', 'component': 'Text'},
      ]);
      expect(msg.dataModel, {'a': 1});
      expect(msg.metadata, {'extensions': <String, Object?>{}});
    });

    test('parses callRendererFunction and agentFunctionResponse', () {
      final call = AgentToRendererMessage.fromJson({
        'version': 'v1.0',
        'callRendererFunction': {
          'functionCallId': 'call-1',
          'callFunction': {'@call': 'playMedia', 'catalogId': 'media'},
        },
      }) as CallRendererFunctionMessage;
      expect(call.functionCallId, 'call-1');
      expect(call.callFunction, {'@call': 'playMedia', 'catalogId': 'media'});

      final response = AgentToRendererMessage.fromJson({
        'version': 'v1.0',
        'agentFunctionResponse': {
          'functionCallId': 'call-1',
          'error': {'code': 'FAILED', 'message': 'nope'},
        },
      }) as AgentFunctionResponseMessage;
      expect(response.response.functionCallId, 'call-1');
      expect(response.response.error?.code, 'FAILED');
      expect(response.response.error?.message, 'nope');
    });

    final invalid = <String, Map<String, Object?>>{
      'v1.0 createSurface with theme': {
        'version': 'v1.0',
        'createSurface': {
          'surfaceId': 's1',
          'catalogId': 'c',
          'theme': {'primaryColor': '#fff'},
        },
      },
      'v0.9 createSurface with components': {
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 's1',
          'catalogId': 'c',
          'components': [
            {'id': 'root', 'component': 'Text'},
          ],
        },
      },
      'v0.9 createSurface with dataModel': {
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 's1',
          'catalogId': 'c',
          'dataModel': <String, Object?>{},
        },
      },
      'v0.9.1 createSurface with metadata': {
        'version': 'v0.9.1',
        'createSurface': {
          'surfaceId': 's1',
          'catalogId': 'c',
          'metadata': <String, Object?>{},
        },
      },
      'v0.9 createSurface without catalogId': {
        'version': 'v0.9',
        'createSurface': {'surfaceId': 's1'},
      },
      'v0.9 callRendererFunction': {
        'version': 'v0.9',
        'callRendererFunction': {
          'functionCallId': 'call-1',
          'callFunction': {'@call': 'f', 'catalogId': 'c'},
        },
      },
      'v0.9.1 agentFunctionResponse': {
        'version': 'v0.9.1',
        'agentFunctionResponse': {'functionCallId': 'call-1', 'value': 1},
      },
      'unknown envelope key': {
        'version': 'v1.0',
        'deleteSurface': {'surfaceId': 's1'},
        'extra': true,
      },
      'unknown v0.9 envelope key': {
        'version': 'v0.9',
        'deleteSurface': {'surfaceId': 's1'},
        'extra': true,
      },
      'unknown body key': {
        'version': 'v1.0',
        'deleteSurface': {'surfaceId': 's1', 'extra': true},
      },
      'v1.0 updateDataModel without value': {
        'version': 'v1.0',
        'updateDataModel': {'surfaceId': 's1', 'path': '/a'},
      },
      'empty components list': {
        'version': 'v1.0',
        'updateComponents': {'surfaceId': 's1', 'components': <Object?>[]},
      },
      'metadata with an unknown key': {
        'version': 'v1.0',
        'createSurface': {
          'surfaceId': 's1',
          'metadata': {'other': 1},
        },
      },
      'callRendererFunction without catalogId': {
        'version': 'v1.0',
        'callRendererFunction': {
          'functionCallId': 'call-1',
          'callFunction': {'@call': 'f'},
        },
      },
      'callRendererFunction with a non-string id': {
        'version': 'v1.0',
        'callRendererFunction': {
          'functionCallId': 7,
          'callFunction': {'@call': 'f', 'catalogId': 'c'},
        },
      },
      'function response with value and error': {
        'version': 'v1.0',
        'agentFunctionResponse': {
          'functionCallId': 'call-1',
          'value': 1,
          'error': {'code': 'X', 'message': 'y'},
        },
      },
      'function response with neither value nor error': {
        'version': 'v1.0',
        'agentFunctionResponse': {'functionCallId': 'call-1'},
      },
      'function response error with an extra key': {
        'version': 'v1.0',
        'agentFunctionResponse': {
          'functionCallId': 'call-1',
          'error': {'code': 'X', 'message': 'y', 'details': 1},
        },
      },
    };
    invalid.forEach((String name, Map<String, Object?> envelope) {
      test('rejects $name', () {
        expect(
          () => AgentToRendererMessage.fromJson(envelope),
          throwsA(isA<A2uiValidationError>()),
        );
      });
    });

    test('names the version a v1.0-only message needs', () {
      expect(
        () => AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'callRendererFunction': {
            'functionCallId': 'call-1',
            'callFunction': {'@call': 'f', 'catalogId': 'c'},
          },
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('v1.0'),
          ),
        ),
      );
    });

    test('a v0.9 payload parser accepts v0.9.1 envelopes', () {
      final payload = AgentToRendererMessagePayload.fromJson(
        {
          'version': 'v0.9.1',
          'deleteSurface': {'surfaceId': 's1'},
        },
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      expect(payload.messages.single.version, 'v0.9.1');
    });

    test('a v1.0 payload parser rejects v0.9 envelopes', () {
      expect(
        () => AgentToRendererMessagePayload.fromJson(
          {
            'version': 'v0.9',
            'deleteSurface': {'surfaceId': 's1'},
          },
          protocolVersion: A2uiProtocolVersion.v1_0,
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('v1.0 renderer-to-agent envelopes', () {
    final String timestamp =
        DateTime.utc(2026, 1, 2, 3, 4, 5).toIso8601String();
    Map<String, Object?> action([Map<String, Object?> extra = const {}]) => {
          'name': 'submit',
          'surfaceId': 's1',
          'sourceComponentId': 'btn',
          'timestamp': timestamp,
          'context': {'a': 1},
          ...extra,
        };

    test('round-trips every v1.0 message', () {
      final envelopes = <Map<String, Object?>>[
        {
          'version': 'v1.0',
          'action': action({
            'catalogId': 'cat1',
            'metadata': {
              'extensions': {'trace': 'x'},
            },
          }),
        },
        {
          'version': 'v1.0',
          'callAgentFunction': {
            'surfaceId': 's1',
            'functionCallId': 'call-1',
            'callFunction': {
              '@call': 'lookup',
              'args': {'q': 'x'}
            },
          },
        },
        {
          'version': 'v1.0',
          'rendererFunctionResponse': {'functionCallId': 'call-1', 'value': 1},
        },
        {
          'version': 'v1.0',
          'error': {
            'code': 'UNALLOWED_CHILD',
            'surfaceId': 's1',
            'path': '/components/0',
            'message': 'bad child',
          },
        },
        {
          'version': 'v1.0',
          'error': {
            'code': 'EXECUTION_ERROR',
            'functionCallId': 'call-1',
            'message': 'boom',
            'details': {'line': 3},
            'retryable': false,
          },
        },
      ];
      for (final envelope in envelopes) {
        expect(
          RendererToAgentMessage.fromJson(envelope).toJson(),
          envelope,
        );
      }
    });

    test('an action carries catalogId and metadata', () {
      final msg = RendererToAgentMessage.fromJson({
        'version': 'v1.0',
        'action': action({
          'catalogId': 'cat1',
          'metadata': {'extensions': <String, Object?>{}},
        }),
      }) as ActionMessage;
      expect(msg.action.catalogId, 'cat1');
      expect(msg.action.metadata, {'extensions': <String, Object?>{}});
    });

    test('a v0.9 unallowed-parent error is a generic error', () {
      final msg = RendererToAgentMessage.fromJson({
        'version': 'v0.9',
        'error': {
          'code': 'UNALLOWED_PARENT',
          'surfaceId': 's1',
          'message': 'm',
          'hint': 'x',
        },
      }) as ErrorMessage;
      expect(msg.error.path, isNull);
      expect(msg.error.additionalProperties, {'hint': 'x'});
    });

    test('a generic error keeps its additional properties', () {
      final msg = RendererToAgentMessage.fromJson({
        'version': 'v1.0',
        'error': {
          'code': 'EXECUTION_ERROR',
          'surfaceId': 's1',
          'message': 'boom',
          'retryable': true,
        },
      }) as ErrorMessage;
      expect(msg.error.additionalProperties, {'retryable': true});
      expect(msg.error.functionCallId, isNull);
    });

    test('parses callAgentFunction and rendererFunctionResponse', () {
      final call = RendererToAgentMessage.fromJson({
        'version': 'v1.0',
        'callAgentFunction': {
          'surfaceId': 's1',
          'functionCallId': 'call-1',
          'callFunction': {'@call': 'lookup'},
        },
      }) as CallAgentFunctionMessage;
      expect(call.surfaceId, 's1');
      expect(call.functionCallId, 'call-1');
      expect(call.callFunction, {'@call': 'lookup'});

      final response = RendererToAgentMessage.fromJson({
        'version': 'v1.0',
        'rendererFunctionResponse': {'functionCallId': 'call-1', 'value': 'x'},
      }) as RendererFunctionResponseMessage;
      expect(response.response.value, 'x');
      expect(response.response.error, isNull);
    });

    final invalid = <String, Map<String, Object?>>{
      'v1.0 validation error with an extra property': {
        'version': 'v1.0',
        'error': {
          'code': 'VALIDATION_FAILED',
          'surfaceId': 's1',
          'path': '/a',
          'message': 'm',
          'details': 1,
        },
      },
      'v1.0 unallowed-parent error without a path': {
        'version': 'v1.0',
        'error': {
          'code': 'UNALLOWED_PARENT',
          'surfaceId': 's1',
          'message': 'm',
        },
      },
      'v1.0 unallowed-child error without a surfaceId': {
        'version': 'v1.0',
        'error': {'code': 'UNALLOWED_CHILD', 'path': '/a', 'message': 'm'},
      },
      'v0.9 validation error with an extra property': {
        'version': 'v0.9',
        'error': {
          'code': 'VALIDATION_FAILED',
          'surfaceId': 's1',
          'path': '/a',
          'message': 'm',
          'details': 1,
        },
      },
      'v1.0 generic error with both surfaceId and functionCallId': {
        'version': 'v1.0',
        'error': {
          'code': 'X',
          'surfaceId': 's1',
          'functionCallId': 'call-1',
          'message': 'm',
        },
      },
      'v1.0 generic error with neither surfaceId nor functionCallId': {
        'version': 'v1.0',
        'error': {'code': 'X', 'message': 'm'},
      },
      'v0.9 generic error without a surfaceId': {
        'version': 'v0.9',
        'error': {'code': 'X', 'functionCallId': 'call-1', 'message': 'm'},
      },
      'v0.9 callAgentFunction': {
        'version': 'v0.9',
        'callAgentFunction': {
          'surfaceId': 's1',
          'functionCallId': 'call-1',
          'callFunction': {'@call': 'lookup'},
        },
      },
      'v0.9 rendererFunctionResponse': {
        'version': 'v0.9',
        'rendererFunctionResponse': {'functionCallId': 'call-1', 'value': 1},
      },
      'callAgentFunction with an unknown key': {
        'version': 'v1.0',
        'callAgentFunction': {
          'surfaceId': 's1',
          'functionCallId': 'call-1',
          'callFunction': {'@call': 'lookup'},
          'extra': 1,
        },
      },
      'action metadata with an unknown key': {
        'version': 'v1.0',
        'action': action({
          'metadata': {'other': 1},
        }),
      },
      'unknown envelope key': {
        'version': 'v1.0',
        'action': action(),
        'extra': 1,
      },
    };
    invalid.forEach((String name, Map<String, Object?> envelope) {
      test('rejects $name', () {
        expect(
          () => RendererToAgentMessage.fromJson(envelope),
          throwsA(isA<A2uiValidationError>()),
        );
      });
    });
  });
}
