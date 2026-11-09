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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart' show Schema;
import 'package:test/test.dart';

const String _catId = 'https://example.com/finance.json';
const String _cat2Id = 'https://example.com/fx.json';

Schema _quoteSchema() => Schema.fromMap({
  'type': 'object',
  'properties': {
    'symbol': {'type': 'string', 'minLength': 1},
    'quantity': {'type': 'integer', 'minimum': 1, 'default': 1},
  },
  'required': ['symbol'],
  'additionalProperties': false,
});

Schema _anyObject() => Schema.fromMap({'type': 'object'});

Map<String, Object?> _callMsg(
  String name, [
  Map<String, Object?>? args,
  String? catalogId = _catId,
  String surfaceId = 'main',
  String callId = 'call-1',
]) => <String, Object?>{
  'version': A2uiProtocolVersion.v1_0.jsonValue,
  'callAgentFunction': <String, Object?>{
    'surfaceId': surfaceId,
    'functionCallId': callId,
    'callFunction': <String, Object?>{
      '@call': name,
      'catalogId': ?catalogId,
      'args': ?args,
    },
  },
};

CatalogApi _catalog(List<FunctionApi> functions, {String id = _catId}) =>
    Catalog(
      id: id,
      protocolVersion: A2uiProtocolVersion.v1_0,
      components: const <ComponentApi>[],
      functions: functions,
    );

AgentFunction _fn(String name, AgentFunctionHandler handler) =>
    AgentFunction(name: name, argumentSchema: _anyObject(), handler: handler);

/// The single reply of a handled `callAgentFunction`.
A2uiFunctionResponse _reply(ProcessResult result) {
  expect(result.handled, isTrue);
  expect(result.replies, hasLength(1));
  final AgentToRendererMessage reply = result.replies.single;
  expect(reply, isA<AgentFunctionResponseMessage>());
  final message = reply as AgentFunctionResponseMessage;
  expect(message.version, '1.0');
  return message.response;
}

Matcher _errorCode(RpcErrorCode code) => isA<A2uiFunctionResponse>()
    .having((r) => r.error?.code, 'error.code', code.wireValue)
    .having((r) => r.value, 'value', isNull);

final Matcher _throwsValidation = throwsA(isA<A2uiValidationError>());

Map<String, Object?> _actionMsg({String version = '1.0'}) => {
  'version': version,
  'action': {
    'name': 'submit',
    'surfaceId': 'main',
    'sourceComponentId': 'btn',
    'timestamp': '2026-01-01T00:00:00Z',
    'context': <String, Object?>{},
  },
};

Map<String, Object?> _errorMsg() => {
  'version': '1.0',
  'error': {
    'code': 'RENDER_FAILED',
    'surfaceId': 'main',
    'message': 'Bad component.',
  },
};

Map<String, Object?> _rendererResponseMsg() => {
  'version': '1.0',
  'rendererFunctionResponse': {'functionCallId': 'r-1', 'value': true},
};

/// An agent function that claims `allowedCallers: agentOnly`, which neither
/// the constructor nor `AgentFunction.fromApi` builds.
final class _AgentOnlyFunction extends AgentFunction {
  const _AgentOnlyFunction({
    required super.name,
    required super.argumentSchema,
    required super.handler,
  });

  @override
  AllowedCallers get allowedCallers => AllowedCallers.agentOnly;
}

void main() {
  group('RendererToAgentMessageProcessor callAgentFunction', () {
    test('answers calls to agent functions across catalogs', () async {
      final quote = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        returnType: A2uiReturnType.object,
        handler: (args, _) => <String, Object?>{
          'symbol': args['symbol'],
          'quantity': args['quantity'],
        },
      );
      final AgentFunction rate = _fn('fetchRate', (args, _) => 1.25);
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([quote]),
          _catalog([rate], id: _cat2Id),
        ],
      );

      final A2uiFunctionResponse r1 = _reply(
        await processor.processMessage(
          _callMsg('fetchQuote', const {'symbol': 'GOOG'}),
        ),
      );
      expect(r1.functionCallId, 'call-1');
      expect(r1.error, isNull);
      // The schema default for quantity is applied.
      expect(r1.value, {'symbol': 'GOOG', 'quantity': 1});

      final A2uiFunctionResponse r2 = _reply(
        await processor.processMessage(
          _callMsg('fetchRate', null, _cat2Id, 'main', 'call-2'),
        ),
      );
      expect(r2.functionCallId, 'call-2');
      expect(r2.value, 1.25);
    });

    test('runs sync and async handlers with the call context', () async {
      AgentFunctionContext? seen;
      final AgentFunction syncFn = _fn('syncFn', (args, ctx) {
        seen = ctx;
        return 'sync';
      });
      final AgentFunction asyncFn = _fn('asyncFn', (args, _) async {
        await Future<void>.delayed(const Duration(milliseconds: 5));
        return 42.5;
      });
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([syncFn, asyncFn]),
        ],
      );

      expect(
        _reply(
          await processor.processMessage(
            _callMsg('syncFn', null, _catId, 'surf-9', 'call-9'),
          ),
        ).value,
        'sync',
      );
      expect(seen?.catalogId, _catId);
      expect(seen?.surfaceId, 'surf-9');
      expect(seen?.functionCallId, 'call-9');

      expect(
        _reply(await processor.processMessage(_callMsg('asyncFn'))).value,
        42.5,
      );
    });

    test('accepts a typed CallAgentFunctionMessage', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([
            AgentFunction(
              name: 'echo',
              argumentSchema: Schema.fromMap({
                'type': 'object',
                'properties': {
                  'x': {'type': 'integer'},
                },
              }),
              handler: (args, _) => args['x'],
            ),
          ]),
        ],
      );
      final A2uiFunctionResponse response = _reply(
        await processor.processMessage(
          CallAgentFunctionMessage(
            version: '1.0',
            surfaceId: 'surf-2',
            functionCallId: 'call-typed',
            callFunction: const {
              '@call': 'echo',
              'catalogId': _catId,
              'args': {'x': 7},
            },
          ),
        ),
      );
      expect(response.functionCallId, 'call-typed');
      expect(response.value, 7);
    });

    test('a handler built with fromApi answers calls', () async {
      final CatalogApi base = Catalog.fromJson({
        'catalogId': _catId,
        'protocolVersion': '1.0.0',
        'components': <String, Object?>{},
        'functions': {
          'verifyProvider': {
            'type': 'object',
            'returnType': 'boolean',
            'allowedCallers': 'rendererOrAgent',
            'properties': {
              '@call': {'const': 'verifyProvider'},
              'args': {
                'type': 'object',
                'properties': {
                  'providerId': {'type': 'string'},
                },
                'required': ['providerId'],
              },
            },
            'required': ['@call', 'args'],
          },
        },
      });
      final CatalogApi catalog = base.copyWith(
        agentFunctions: [
          AgentFunction.fromApi(
            base.functions['verifyProvider']!,
            (args, _) => args['providerId'] == 'p-1',
          ),
        ],
      );
      final processor = RendererToAgentMessageProcessor(catalogs: [catalog]);
      expect(
        _reply(
          await processor.processMessage(
            _callMsg('verifyProvider', const {'providerId': 'p-1'}),
          ),
        ).value,
        isTrue,
      );
    });

    test('a missing or empty functionCallId is a validation error', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([_fn('echo', (args, _) => null)]),
        ],
      );
      await expectLater(
        processor.processMessage(_callMsg('echo', null, _catId, 'main', '')),
        _throwsValidation,
      );
      await expectLater(
        processor.processMessage({
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 'main',
            'callFunction': {'@call': 'echo', 'catalogId': _catId},
          },
        }),
        _throwsValidation,
      );
      await expectLater(
        processor.processMessage({
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 'main',
            'functionCallId': 3,
            'callFunction': {'@call': 'echo'},
          },
        }),
        _throwsValidation,
      );
      await expectLater(
        processor.processMessage(
          CallAgentFunctionMessage(
            version: '1.0',
            surfaceId: 'main',
            functionCallId: '',
            callFunction: const {'@call': 'echo'},
          ),
        ),
        _throwsValidation,
      );
      await expectLater(
        processor.processMessage({
          'version': '1.0',
          'callAgentFunction': 'not an object',
        }),
        _throwsValidation,
      );
    });

    test('an empty surfaceId gets INVALID_FUNCTION_CALL', () async {
      var runs = 0;
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([_fn('echo', (args, _) => runs++)]),
        ],
      );
      final A2uiFunctionResponse fromMap = _reply(
        await processor.processMessage(
          _callMsg('echo', null, _catId, '', 'call-bad-surf'),
        ),
      );
      expect(fromMap.functionCallId, 'call-bad-surf');
      expect(fromMap, _errorCode(RpcErrorCode.invalidFunctionCall));

      final A2uiFunctionResponse fromTyped = _reply(
        await processor.processMessage(
          CallAgentFunctionMessage(
            version: '1.0',
            surfaceId: '',
            functionCallId: 'call-typed',
            callFunction: const {'@call': 'echo'},
          ),
        ),
      );
      expect(fromTyped, _errorCode(RpcErrorCode.invalidFunctionCall));
      expect(runs, 0);
    });

    test('a malformed call that carries a functionCallId gets '
        'INVALID_FUNCTION_CALL', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([_fn('echo', (args, _) => null)]),
        ],
      );
      Future<A2uiFunctionResponse> answer(Map<String, Object?> msg) async =>
          _reply(await processor.processMessage(msg));

      final malformed = <String, Map<String, Object?>>{
        'unknown body field': {
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 'main',
            'functionCallId': 'c1',
            'callFunction': {'@call': 'echo'},
            'extra': 1,
          },
        },
        'missing callFunction': {
          'version': '1.0',
          'callAgentFunction': {'surfaceId': 'main', 'functionCallId': 'c1'},
        },
        'unknown callFunction field': {
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 'main',
            'functionCallId': 'c1',
            'callFunction': {'@call': 'echo', 'extra': 1},
          },
        },
        'empty function name': {
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 'main',
            'functionCallId': 'c1',
            'callFunction': {'@call': ''},
          },
        },
        'empty catalogId': {
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 'main',
            'functionCallId': 'c1',
            'callFunction': {'@call': 'echo', 'catalogId': ''},
          },
        },
        'args not an object': {
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 'main',
            'functionCallId': 'c1',
            'callFunction': {'@call': 'echo', 'args': 3},
          },
        },
      };
      for (final MapEntry<String, Map<String, Object?>> entry
          in malformed.entries) {
        final A2uiFunctionResponse response = await answer(entry.value);
        expect(response.functionCallId, 'c1', reason: entry.key);
        expect(
          response,
          _errorCode(RpcErrorCode.invalidFunctionCall),
          reason: entry.key,
        );
      }
    });

    test('unknown catalogs, unknown functions and renderer functions get '
        'UNKNOWN_FUNCTION', () async {
      final rendererFn = FunctionApi(
        name: 'formatString',
        argumentSchema: _anyObject(),
      );
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([rendererFn, _fn('echo', (args, _) => null)]),
        ],
      );
      for (final Map<String, Object?> msg in [
        _callMsg('echo', null, 'https://unknown'),
        _callMsg('missing'),
        _callMsg('formatString'),
      ]) {
        expect(
          _reply(await processor.processMessage(msg)),
          _errorCode(RpcErrorCode.unknownFunction),
        );
      }
    });

    test('a call without catalogId runs the only match', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([_fn('echo', (args, ctx) => ctx.catalogId)]),
          _catalog([_fn('other', (args, _) => null)], id: _cat2Id),
        ],
      );
      expect(
        _reply(
          await processor.processMessage(_callMsg('echo', null, null)),
        ).value,
        _catId,
      );
      expect(
        _reply(await processor.processMessage(_callMsg('nope', null, null))),
        _errorCode(RpcErrorCode.unknownFunction),
      );
    });

    test('a call without catalogId and several matches gets '
        'INVALID_FUNCTION_CALL', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([_fn('echo', (args, _) => 1)]),
          _catalog([_fn('echo', (args, _) => 2)], id: _cat2Id),
        ],
      );
      expect(
        _reply(await processor.processMessage(_callMsg('echo', null, null))),
        _errorCode(RpcErrorCode.invalidFunctionCall),
      );
      // Naming the catalog picks it.
      expect(
        _reply(
          await processor.processMessage(_callMsg('echo', null, _cat2Id)),
        ).value,
        2,
      );
    });

    test('invalid arguments get INVALID_FUNCTION_CALL', () async {
      var runs = 0;
      final quote = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        handler: (args, _) => runs++,
      );
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([quote]),
        ],
      );
      for (final Map<String, Object?> args in [
        const <String, Object?>{},
        const {'symbol': 'GOOG', 'extra': 1},
        const {'symbol': 5},
        const {'symbol': 'GOOG', 'quantity': 0},
      ]) {
        expect(
          _reply(await processor.processMessage(_callMsg('fetchQuote', args))),
          _errorCode(RpcErrorCode.invalidFunctionCall),
          reason: '$args',
        );
      }
      expect(runs, 0);
    });

    test(
      'arguments are checked as resolved JSON, not as expressions',
      () async {
        final processor = RendererToAgentMessageProcessor(
          catalogs: [
            _catalog([_fn('echo', (args, _) => args)]),
          ],
        );
        // DataContext unescapes `@@type` to `@type`, so a resolved value may
        // carry `@`-prefixed keys; they are data.
        const nested = <String, Object?>{
          'doc': {
            '@type': 'Person',
            '@id': 'p1',
            'tags': [
              {'@call': 'notACall'},
            ],
          },
        };
        final A2uiFunctionResponse ok = _reply(
          await processor.processMessage(_callMsg('echo', nested)),
        );
        expect(ok.error, isNull);
        expect(ok.value, nested);

        // A top-level argument name must still be an identifier.
        expect(
          _reply(
            await processor.processMessage(
              _callMsg('echo', const {'@type': 'Person'}),
            ),
          ),
          _errorCode(RpcErrorCode.invalidFunctionCall),
        );
      },
    );

    test('defaults are applied after the arguments are validated', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([
            AgentFunction(
              name: 'limited',
              argumentSchema: Schema.fromMap({
                'type': 'object',
                'properties': {
                  'symbol': {'type': 'string'},
                  'quantity': {'type': 'integer', 'default': 1},
                },
                'required': ['quantity'],
                'maxProperties': 1,
              }),
              handler: (args, _) => args,
            ),
          ]),
        ],
      );
      // A default does not satisfy `required`.
      expect(
        _reply(
          await processor.processMessage(
            _callMsg('limited', const {'symbol': 'GOOG'}),
          ),
        ),
        _errorCode(RpcErrorCode.invalidFunctionCall),
      );
      // An injected default does not count against `maxProperties`.
      final processor2 = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([
            AgentFunction(
              name: 'limited',
              argumentSchema: Schema.fromMap({
                'type': 'object',
                'properties': {
                  'symbol': {'type': 'string'},
                  'quantity': {'type': 'integer', 'default': 1},
                },
                'maxProperties': 1,
              }),
              handler: (args, _) => args,
            ),
          ]),
        ],
      );
      final A2uiFunctionResponse ok = _reply(
        await processor2.processMessage(
          _callMsg('limited', const {'symbol': 'GOOG'}),
        ),
      );
      expect(ok.error, isNull);
      expect(ok.value, {'symbol': 'GOOG', 'quantity': 1});
    });

    test('undeclared arguments follow the JSON Schema', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([
            AgentFunction(
              name: 'open',
              argumentSchema: Schema.fromMap({
                'type': 'object',
                'properties': {
                  'symbol': {'type': 'string'},
                  'meta': {
                    'type': 'object',
                    'properties': {
                      'a': {'type': 'string'},
                    },
                    'unevaluatedProperties': false,
                  },
                },
              }),
              handler: (args, _) => args,
            ),
            AgentFunction(
              name: 'patterned',
              argumentSchema: Schema.fromMap({
                'type': 'object',
                'patternProperties': {
                  '^x_': {'type': 'integer'},
                },
                'additionalProperties': false,
              }),
              handler: (args, _) => args,
            ),
          ]),
        ],
      );
      Future<A2uiFunctionResponse> call(
        String name,
        Map<String, Object?> args,
      ) async => _reply(await processor.processMessage(_callMsg(name, args)));

      // An object schema that does not close its properties accepts others.
      expect(
        (await call('open', const {'symbol': 'G', 'extra': 1})).error,
        isNull,
      );
      // A closed nested object rejects a field it does not declare.
      expect(
        await call('open', const {
          'meta': {'a': 'x', 'b': 1},
        }),
        _errorCode(RpcErrorCode.invalidFunctionCall),
      );
      // patternProperties declare the keys they match.
      expect((await call('patterned', const {'x_1': 1})).error, isNull);
      expect(
        await call('patterned', const {'y': 1}),
        _errorCode(RpcErrorCode.invalidFunctionCall),
      );
    });

    test('an agentOnly function gets INVALID_FUNCTION_CALL', () async {
      var runs = 0;
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([
            _AgentOnlyFunction(
              name: 'agentOnly',
              argumentSchema: _anyObject(),
              handler: (args, _) => runs++,
            ),
          ]),
        ],
      );
      expect(
        _reply(await processor.processMessage(_callMsg('agentOnly'))),
        _errorCode(RpcErrorCode.invalidFunctionCall),
      );
      expect(runs, 0);
    });

    test('maps handler failures and return values to the response', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([
            _fn('boom', (args, _) => throw StateError('database down')),
            _fn('asyncBoom', (args, _) async => throw StateError('later')),
            _fn(
              'customRpc',
              (args, _) =>
                  throw A2uiRpcError.custom('Market closed', 'MARKET_CLOSED'),
            ),
            _fn(
              'invalid',
              (args, _) => throw A2uiValidationError('bad symbol'),
            ),
            _fn('nonJson', (args, _) => Object()),
            _fn('nonFinite', (args, _) => double.infinity),
            _fn('nonStringKey', (args, _) => {1: 'one'}),
            _fn('nested', (args, _) => [Object()]),
            _fn('nullValue', (args, _) => null),
            _fn(
              'check',
              (args, _) => const ValidationResult(valid: false, message: 'no'),
            ),
            _fn(
              'json',
              (args, _) => {
                'list': [1, 2.5, true, 'x', null],
                'map': {'k': 'v'},
              },
            ),
          ]),
        ],
      );
      Future<A2uiFunctionResponse> call(String name) async =>
          _reply(await processor.processMessage(_callMsg(name)));

      final A2uiFunctionResponse boom = await call('boom');
      expect(boom, _errorCode(RpcErrorCode.executionError));
      expect(boom.error?.message, contains('database down'));
      expect(await call('asyncBoom'), _errorCode(RpcErrorCode.executionError));

      final A2uiFunctionResponse custom = await call('customRpc');
      expect(custom.error?.code, 'MARKET_CLOSED');
      expect(custom.error?.message, 'Market closed');

      // A validation error from the handler is still the handler's error.
      final A2uiFunctionResponse invalid = await call('invalid');
      expect(invalid, _errorCode(RpcErrorCode.executionError));
      expect(invalid.error?.message, 'bad symbol');

      for (final name in ['nonJson', 'nonFinite', 'nonStringKey', 'nested']) {
        expect(
          await call(name),
          _errorCode(RpcErrorCode.executionError),
          reason: name,
        );
      }

      final A2uiFunctionResponse nullValue = await call('nullValue');
      expect(nullValue.error, isNull);
      expect(nullValue.value, isNull);
      expect(
        _replyJson(nullValue)['agentFunctionResponse'],
        containsPair('value', null),
      );

      expect((await call('check')).value, {'valid': false, 'message': 'no'});
      expect((await call('json')).value, {
        'list': [1, 2.5, true, 'x', null],
        'map': {'k': 'v'},
      });
    });

    test('a handler slower than agentFunctionTimeout gets a timeout '
        'error', () async {
      final never = Completer<Object?>();
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([
            _fn('stuck', (args, _) => never.future),
            _fn('quick', (args, _) async => 'done'),
          ]),
        ],
        agentFunctionTimeout: const Duration(milliseconds: 20),
      );
      final A2uiFunctionResponse stuck = _reply(
        await processor.processMessage(_callMsg('stuck')),
      );
      expect(stuck, _errorCode(RpcErrorCode.executionError));
      expect(stuck.error?.message, contains('timed out after 20ms'));

      expect(
        _reply(await processor.processMessage(_callMsg('quick'))).value,
        'done',
      );
    });

    test('a TimeoutException from the handler is a handler error', () async {
      for (final Duration? timeout in [null, const Duration(seconds: 30)]) {
        final processor = RendererToAgentMessageProcessor(
          catalogs: [
            _catalog([
              _fn(
                'upstream',
                (args, _) async =>
                    throw TimeoutException('upstream call timed out'),
              ),
            ]),
          ],
          agentFunctionTimeout: timeout,
        );
        final A2uiFunctionResponse response = _reply(
          await processor.processMessage(_callMsg('upstream')),
        );
        expect(response, _errorCode(RpcErrorCode.executionError));
        expect(response.error?.message, contains('upstream call timed out'));
        expect(response.error?.message, isNot(contains('timed out after')));
      }
    });

    test('there is no timeout by default', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([
            _fn('slow', (args, _) async {
              await Future<void>.delayed(const Duration(milliseconds: 30));
              return 'late';
            }),
          ]),
        ],
      );
      expect(
        _reply(await processor.processMessage(_callMsg('slow'))).value,
        'late',
      );
    });

    test('rejects a timeout that is not positive', () {
      for (final Duration timeout in [
        Duration.zero,
        const Duration(milliseconds: -5),
      ]) {
        expect(
          () => RendererToAgentMessageProcessor(
            catalogs: const [],
            agentFunctionTimeout: timeout,
          ),
          throwsArgumentError,
        );
      }
    });
  });

  group('RendererToAgentMessageProcessor callbacks', () {
    test('passes each validated message to its callback', () async {
      final seen = <RendererToAgentMessage>[];
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: (message) {
          seen.add(message);
        },
        onError: (message) {
          seen.add(message);
        },
        onRendererFunctionResponse: (message) {
          seen.add(message);
        },
      );

      final ProcessResult action = await processor.processMessage(_actionMsg());
      expect(action.handled, isTrue);
      expect(action.replies, isEmpty);
      final ProcessResult error = await processor.processMessage(_errorMsg());
      expect(error.handled, isTrue);
      expect(error.replies, isEmpty);
      final ProcessResult response = await processor.processMessage(
        _rendererResponseMsg(),
      );
      expect(response.handled, isTrue);
      expect(response.replies, isEmpty);

      expect(seen, hasLength(3));
      expect(
        seen[0],
        isA<ActionMessage>().having((m) => m.action.name, 'name', 'submit'),
      );
      expect(
        seen[1],
        isA<ErrorMessage>().having(
          (m) => m.error.code,
          'code',
          'RENDER_FAILED',
        ),
      );
      expect(
        seen[2],
        isA<RendererFunctionResponseMessage>()
            .having((m) => m.response.functionCallId, 'functionCallId', 'r-1')
            .having((m) => m.response.value, 'value', true),
      );
    });

    test('accepts typed messages', () async {
      final seen = <RendererToAgentMessage>[];
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: (message) {
          seen.add(message);
        },
        onError: (message) {
          seen.add(message);
        },
        onRendererFunctionResponse: (message) {
          seen.add(message);
        },
      );
      final typed = [
        RendererToAgentMessage.fromJson(_actionMsg()),
        RendererToAgentMessage.fromJson(_errorMsg()),
        RendererToAgentMessage.fromJson(_rendererResponseMsg()),
      ];
      for (final message in typed) {
        expect((await processor.processMessage(message)).handled, isTrue);
      }
      expect(seen, typed);
    });

    test('awaits an async callback', () async {
      final gate = Completer<void>();
      var finished = false;
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: (message) async {
          await gate.future;
          finished = true;
        },
      );
      final Future<ProcessResult> result = processor.processMessage(
        _actionMsg(),
      );
      await Future<void>.delayed(Duration.zero);
      expect(finished, isFalse);
      gate.complete();
      expect((await result).handled, isTrue);
      expect(finished, isTrue);
    });

    test('an exception from a callback propagates', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: (message) => throw StateError('sync'),
        onError: (message) async => throw StateError('async'),
      );
      await expectLater(
        processor.processMessage(_actionMsg()),
        throwsA(isA<StateError>()),
      );
      await expectLater(
        processor.processMessage(_errorMsg()),
        throwsA(isA<StateError>()),
      );
    });

    test('a malformed message with its callback set is a validation error '
        'and the callback does not run', () async {
      var calls = 0;
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: (message) {
          calls++;
        },
        onError: (message) {
          calls++;
        },
        onRendererFunctionResponse: (message) {
          calls++;
        },
      );
      for (final Object message in [
        {'version': '1.0', 'action': <String, Object?>{}},
        {'version': '1.0', 'action': 'not an object'},
        _actionMsg(version: 'v0.9'),
        {..._actionMsg()}..remove('version'),
        {
          'version': '1.0',
          'error': {'code': 'X', 'message': 'no target'},
        },
        {
          'version': '1.0',
          'rendererFunctionResponse': {
            'functionCallId': 'r-1',
            'value': 1,
            'error': {'code': 'X', 'message': 'both'},
          },
        },
        RendererToAgentMessage.fromJson({
          'version': 'v0.9',
          'action': {
            'name': 'submit',
            'surfaceId': 'main',
            'sourceComponentId': 'btn',
            'timestamp': '2026-01-01T00:00:00Z',
            'context': <String, Object?>{},
          },
        }),
      ]) {
        await expectLater(
          processor.processMessage(message),
          _throwsValidation,
          reason: '$message',
        );
      }
      expect(calls, 0);
    });

    test('without a callback, the message is unhandled and not '
        'validated', () async {
      final processor = RendererToAgentMessageProcessor(catalogs: const []);
      for (final Object message in [
        _actionMsg(),
        _errorMsg(),
        _rendererResponseMsg(),
        RendererToAgentMessage.fromJson(_actionMsg()),
        // Malformed, but nothing reads it.
        {'version': '1.0', 'action': <String, Object?>{}},
        {'version': '1.0', 'rendererFunctionResponse': 3},
      ]) {
        final ProcessResult result = await processor.processMessage(message);
        expect(result.handled, isFalse, reason: '$message');
        expect(result.replies, isEmpty, reason: '$message');
      }
    });
  });

  group('RendererToAgentMessageProcessor other messages', () {
    test('anything that is not one renderer-to-agent message is a validation '
        'error', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: (message) {},
      );
      for (final Object? message in [
        {'version': '1.0', 'updateComponents': <String, Object?>{}},
        {'version': '1.0'},
        <String, Object?>{},
        {..._actionMsg(), ..._errorMsg()},
        {..._actionMsg(), 'extra': 1},
        'not an object',
        null,
        [_actionMsg()],
        42,
      ]) {
        await expectLater(
          processor.processMessage(message),
          _throwsValidation,
          reason: '$message',
        );
      }
    });

    test('rejects a RendererToAgentMessage type it does not know', () async {
      final processor = RendererToAgentMessageProcessor(catalogs: const []);
      await expectLater(
        processor.processMessage(_CustomMessage()),
        _throwsValidation,
      );
    });
  });

  group('RendererToAgentMessageProcessor versions', () {
    test('every message must declare version 1.0', () async {
      var calls = 0;
      final processor = RendererToAgentMessageProcessor(
        catalogs: [
          _catalog([_fn('echo', (args, _) => calls++)]),
        ],
        onAction: (message) {
          calls++;
        },
      );
      final processorWithoutCallbacks = RendererToAgentMessageProcessor(
        catalogs: const [],
      );
      final bodies = <Map<String, Object?>>[
        _callMsg('echo'),
        _actionMsg(),
        _errorMsg(),
        _rendererResponseMsg(),
      ];
      for (final body in bodies) {
        for (final Object? version in [null, 'v1.0', 'v0.9', '1.0.0', 1.0]) {
          final Map<String, Object?> message = {...body}..remove('version');
          if (version != null) message['version'] = version;
          for (final p in [processor, processorWithoutCallbacks]) {
            await expectLater(
              p.processMessage(message),
              _throwsValidation,
              reason: '$message',
            );
          }
        }
      }
      // Typed messages too: a v0.9 action parses, but isn't v1.0.
      final v09Action = RendererToAgentMessage.fromJson(
        _actionMsg(version: 'v0.9'),
      );
      for (final p in [processor, processorWithoutCallbacks]) {
        await expectLater(p.processMessage(v09Action), _throwsValidation);
        await expectLater(
          p.processMessage(
            CallAgentFunctionMessage(
              version: 'v1.0',
              surfaceId: 'main',
              functionCallId: 'c1',
              callFunction: const {'@call': 'echo'},
            ),
          ),
          _throwsValidation,
        );
      }
      expect(calls, 0);
    });
  });

  group('RendererToAgentMessageProcessor declining callbacks', () {
    test('a callback that returns false declines the message', () async {
      final seen = <String>[];
      bool onAction(ActionMessage message) {
        seen.add('action');
        return message.action.name == 'refresh';
      }

      Future<bool> onError(ErrorMessage message) async {
        seen.add('error');
        return false;
      }

      Future<bool> onResponse(RendererFunctionResponseMessage message) async {
        seen.add('response');
        return true;
      }

      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: onAction,
        onError: onError,
        onRendererFunctionResponse: onResponse,
      );

      final ProcessResult declined = await processor.processMessage(
        _actionMsg(),
      );
      expect(declined.handled, isFalse);
      expect(declined.replies, isEmpty);

      final Map<String, Object?> refresh = _actionMsg();
      (refresh['action']! as Map<String, Object?>)['name'] = 'refresh';
      expect((await processor.processMessage(refresh)).handled, isTrue);

      final ProcessResult asyncDeclined = await processor.processMessage(
        _errorMsg(),
      );
      expect(asyncDeclined.handled, isFalse);
      expect(asyncDeclined.replies, isEmpty);

      expect(
        (await processor.processMessage(_rendererResponseMsg())).handled,
        isTrue,
      );

      // A typed message is declined the same way.
      expect(
        (await processor.processMessage(
          RendererToAgentMessage.fromJson(_actionMsg()),
        )).handled,
        isFalse,
      );
      expect(seen, ['action', 'action', 'error', 'response', 'action']);
    });

    test('a void tear-off, a callback returning true, one returning false '
        'and an async one returning false', () async {
      final seen = <RendererToAgentMessage>[];
      bool keep(RendererToAgentMessage message) => true;
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: seen.add,
        onError: keep,
        onRendererFunctionResponse: (message) => false,
      );
      final asyncDeclining = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: (message) async => false,
      );
      expect((await processor.processMessage(_actionMsg())).handled, isTrue);
      expect(seen, hasLength(1));
      expect((await processor.processMessage(_errorMsg())).handled, isTrue);
      expect(
        (await processor.processMessage(_rendererResponseMsg())).handled,
        isFalse,
      );
      expect(
        (await asyncDeclining.processMessage(_actionMsg())).handled,
        isFalse,
      );
    });

    test('a callback that returns nothing handles the message', () async {
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onAction: (message) {},
        onError: (message) async {},
      );
      expect((await processor.processMessage(_actionMsg())).handled, isTrue);
      expect((await processor.processMessage(_errorMsg())).handled, isTrue);
    });
  });

  group('RendererToAgentMessageProcessor catalogs', () {
    test('two catalogs with the same id are a catalog error', () {
      expect(
        () => RendererToAgentMessageProcessor(
          catalogs: [
            _catalog([_fn('a', (args, _) => null)]),
            _catalog([_fn('b', (args, _) => null)]),
          ],
        ),
        throwsA(
          isA<A2uiCatalogError>()
              .having((e) => e.catalogId, 'catalogId', _catId)
              .having((e) => e.message, 'message', contains(_catId)),
        ),
      );
    });
  });

  group('ProcessResult', () {
    test('replies cannot be modified', () {
      final result = ProcessResult(handled: true);
      expect(result.replies, isEmpty);
      expect(
        () => result.replies.add(
          AgentFunctionResponseMessage(
            version: '1.0',
            response: const A2uiFunctionResponse.value('c', null),
          ),
        ),
        throwsUnsupportedError,
      );
      expect('$result', 'ProcessResult(handled: true, replies: 0)');
    });
  });
}

Map<String, dynamic> _replyJson(A2uiFunctionResponse response) =>
    AgentFunctionResponseMessage(version: '1.0', response: response).toJson();

final class _CustomMessage extends RendererToAgentMessage {
  _CustomMessage() : super(version: '1.0');

  @override
  Map<String, dynamic> toJson() => {'version': version, 'custom': true};
}
