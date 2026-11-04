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
import 'package:fake_async/fake_async.dart';
import 'package:test/test.dart';

const String _catId = 'https://example.com/finance.json';

void main() {
  group('RendererFunctionCalls', () {
    test('rejects invalid constructor arguments', () {
      expect(
        () => RendererFunctionCalls(defaultTimeout: Duration.zero),
        throwsArgumentError,
      );
      expect(
        () => RendererFunctionCalls(
          defaultTimeout: const Duration(milliseconds: -10),
        ),
        throwsArgumentError,
      );
      expect(() => RendererFunctionCalls(maxPending: 0), throwsArgumentError);
    });

    test('builds CallRendererFunctionMessage and resolves value, void, and '
        'error responses', () async {
      final calls = RendererFunctionCalls();

      final (CallRendererFunctionMessage msg1, Future<Object?> fut1) = calls
          .call(
            catalogId: _catId,
            name: 'scrollIntoView',
            args: const {'elementId': 'row-42'},
            surfaceId: 'main',
            functionCallId: 'rcall-1',
          );

      expect(msg1.toJson(), {
        'version': A2uiProtocolVersion.v1_0.jsonValue,
        'callRendererFunction': {
          'surfaceId': 'main',
          'functionCallId': 'rcall-1',
          'callFunction': {
            '@call': 'scrollIntoView',
            'catalogId': _catId,
            'args': {'elementId': 'row-42'},
          },
        },
      });
      expect(calls.pendingCount, 1);

      calls.resolve({
        'version': A2uiProtocolVersion.v1_0.jsonValue,
        'rendererFunctionResponse': {
          'functionCallId': 'rcall-1',
          'value': {'scrolled': true},
        },
      });
      expect(await fut1, {'scrolled': true});
      expect(calls.pendingCount, 0);

      // Void response (neither value nor error).
      final (_, Future<Object?> futVoid) = calls.call(
        catalogId: _catId,
        name: 'clearSelection',
        functionCallId: 'rcall-void',
      );
      calls.resolve({
        'version': A2uiProtocolVersion.v1_0.jsonValue,
        'rendererFunctionResponse': {'functionCallId': 'rcall-void'},
      });
      expect(await futVoid, isNull);

      // Explicit null error alongside value resolves value.
      final (_, Future<Object?> futNullErr) = calls.call(
        catalogId: _catId,
        name: 'scrollIntoView',
        functionCallId: 'rcall-null-err',
      );
      calls.resolve({
        'version': A2uiProtocolVersion.v1_0.jsonValue,
        'rendererFunctionResponse': {
          'functionCallId': 'rcall-null-err',
          'value': {'ok': true},
          'error': null,
        },
      });
      expect(await futNullErr, {'ok': true});

      // Typed RendererFunctionResponseMessage with custom error code.
      final (_, Future<Object?> futErr) = calls.call(
        catalogId: _catId,
        name: 'scrollIntoView',
        functionCallId: 'rcall-err',
      );
      calls.resolve(
        RendererFunctionResponseMessage(
          version: A2uiProtocolVersion.v1_0.jsonValue,
          response: const A2uiFunctionResponse.error(
            'rcall-err',
            A2uiFunctionResponseError(
              code: 'ELEMENT_NOT_FOUND',
              message: 'No element row-99',
            ),
          ),
        ),
      );
      await expectLater(
        futErr,
        throwsA(
          isA<A2uiRpcError>()
              .having((e) => e.code, 'code', 'ELEMENT_NOT_FOUND')
              .having((e) => e.rpcCode, 'rpcCode', RpcErrorCode.unknownError)
              .having((e) => e.functionCallId, 'functionCallId', 'rcall-err')
              .having((e) => e.message, 'message', 'No element row-99'),
        ),
      );
    });

    test('enforces synchronous validation, duplicate IDs, maxPending, '
        'timeouts, and dispose', () {
      fakeAsync((FakeAsync async) {
        final calls = RendererFunctionCalls(
          defaultTimeout: const Duration(milliseconds: 50),
          maxPending: 2,
        );

        final (_, Future<Object?> f1) = calls.call(
          catalogId: _catId,
          name: 'fn1',
          functionCallId: 'c1',
        );
        Object? f1Err;
        f1.then<void>(
          (_) {},
          onError: (Object e) {
            f1Err = e;
          },
        );

        // Duplicate callId -> DUPLICATE.
        expect(
          () =>
              calls.call(catalogId: _catId, name: 'fn1', functionCallId: 'c1'),
          throwsA(
            isA<A2uiRpcError>().having(
              (e) => e.rpcCode,
              'rpcCode',
              RpcErrorCode.duplicate,
            ),
          ),
        );

        final (_, Future<Object?> f2) = calls.call(
          catalogId: _catId,
          name: 'fn2',
          functionCallId: 'c2',
        );
        Object? f2Err;
        f2.then<void>(
          (_) {},
          onError: (Object e) {
            f2Err = e;
          },
        );

        // Exceeds maxPending -> TOO_MANY_PENDING.
        expect(
          () =>
              calls.call(catalogId: _catId, name: 'fn3', functionCallId: 'c3'),
          throwsA(
            isA<A2uiRpcError>().having(
              (e) => e.rpcCode,
              'rpcCode',
              RpcErrorCode.tooManyPending,
            ),
          ),
        );

        // Advance past timeout -> TIMEOUT.
        async.elapse(const Duration(milliseconds: 60));
        async.flushMicrotasks();
        expect(calls.pendingCount, 0);
        expect(
          f1Err,
          isA<A2uiRpcError>().having(
            (e) => e.rpcCode,
            'rpcCode',
            RpcErrorCode.timeout,
          ),
        );
        expect(
          f2Err,
          isA<A2uiRpcError>().having(
            (e) => e.rpcCode,
            'rpcCode',
            RpcErrorCode.timeout,
          ),
        );

        // Dispose cancels remaining pending calls with CANCELLED and rejects
        // subsequent calls with DISPOSED.
        final (_, Future<Object?> f3) = calls.call(
          catalogId: _catId,
          name: 'fn3',
          functionCallId: 'c3',
        );
        Object? f3Err;
        f3.then<void>(
          (_) {},
          onError: (Object e) {
            f3Err = e;
          },
        );

        calls.dispose('session closed');
        async.flushMicrotasks();
        expect(calls.isDisposed, isTrue);
        expect(calls.disposed, isTrue);
        expect(
          f3Err,
          isA<A2uiRpcError>()
              .having((e) => e.rpcCode, 'rpcCode', RpcErrorCode.cancelled)
              .having((e) => e.message, 'message', 'session closed'),
        );

        expect(
          () => calls.call(catalogId: _catId, name: 'fn4'),
          throwsA(
            isA<A2uiRpcError>().having(
              (e) => e.rpcCode,
              'rpcCode',
              RpcErrorCode.disposed,
            ),
          ),
        );
      });
    });

    test('settling a call cancels its timer', () {
      fakeAsync((FakeAsync async) {
        final calls = RendererFunctionCalls();
        final (_, Future<Object?> future) = calls.call(
          catalogId: _catId,
          name: 'scrollIntoView',
          functionCallId: 'rcall-1',
        );
        Object? value;
        future.then((Object? v) => value = v);
        expect(async.pendingTimers, hasLength(1));

        calls.resolve(_response('rcall-1', {'value': 1}));
        async.flushMicrotasks();
        expect(value, 1);
        expect(async.pendingTimers, isEmpty);
      });
    });

    test('an empty function name is an INVALID_FUNCTION_CALL', () {
      final calls = RendererFunctionCalls();
      expect(
        () => calls.call(catalogId: _catId, name: ''),
        throwsA(
          isA<A2uiRpcError>()
              .having(
                (e) => e.rpcCode,
                'rpcCode',
                RpcErrorCode.invalidFunctionCall,
              )
              .having((e) => e.message, 'message', contains('function name')),
        ),
      );
      expect(
        () => calls.call(catalogId: '', name: 'scrollIntoView'),
        throwsA(
          isA<A2uiRpcError>().having(
            (e) => e.rpcCode,
            'rpcCode',
            RpcErrorCode.invalidFunctionCall,
          ),
        ),
      );
      for (final name in ['@reserved', 'bad-name']) {
        expect(
          () => calls.call(catalogId: _catId, name: name),
          throwsA(isA<A2uiRpcError>()),
        );
      }
      expect(calls.pendingCount, 0);
      calls.dispose();
    });

    test('an empty surfaceId counts as omitted', () {
      final calls = RendererFunctionCalls();
      final (CallRendererFunctionMessage message, _) = calls.call(
        catalogId: _catId,
        name: 'scrollIntoView',
        surfaceId: '',
        functionCallId: 'rcall-1',
      );
      final body =
          message.toJson()['callRendererFunction']! as Map<String, Object?>;
      expect(body, isNot(contains('surfaceId')));
      calls.dispose();
    });

    test('a malformed response naming a pending call fails it right away', () {
      fakeAsync((FakeAsync async) {
        final calls = RendererFunctionCalls();
        final errors = <String, Object>{};
        for (final id in ['both', 'bad-error', 'typed']) {
          final (_, Future<Object?> future) = calls.call(
            catalogId: _catId,
            name: 'scrollIntoView',
            functionCallId: id,
          );
          future.then<void>((_) {}, onError: (Object e) => errors[id] = e);
        }

        calls.resolve(
          _response('both', {
            'value': 1,
            'error': {'code': 'X', 'message': 'both'},
          }),
        );
        calls.resolve(
          _response('bad-error', {
            'error': {'code': 'X'},
          }),
        );
        calls.resolve(
          RendererFunctionResponseMessage(
            version: '1.0',
            response: const A2uiFunctionResponse.error(
              'typed',
              A2uiFunctionResponseError(code: '', message: 'no code'),
            ),
          ),
        );
        async.flushMicrotasks();

        expect(errors.keys, unorderedEquals(['both', 'bad-error', 'typed']));
        for (final Object error in errors.values) {
          expect(
            error,
            isA<A2uiRpcError>().having(
              (e) => e.rpcCode,
              'rpcCode',
              RpcErrorCode.unknownError,
            ),
          );
        }
        expect(calls.pendingCount, 0);
        expect(async.pendingTimers, isEmpty);
      });
    });

    test('a malformed response naming no pending call is ignored', () {
      final calls = RendererFunctionCalls();
      final (_, Future<Object?> future) = calls.call(
        catalogId: _catId,
        name: 'scrollIntoView',
        functionCallId: 'rcall-1',
      );
      future.ignore();
      calls.resolve(_response('other', {'value': 1, 'error': 'x'}));
      calls.resolve(const {'rendererFunctionResponse': 'not an object'});
      calls.resolve('not a message');
      expect(calls.pendingCount, 1);
      calls.dispose();
    });

    test('resolve tells whether it settled a pending call', () {
      fakeAsync((FakeAsync async) {
        final calls = RendererFunctionCalls(
          defaultTimeout: const Duration(milliseconds: 50),
        );
        for (final id in ['ok', 'err', 'bad', 'late']) {
          final (_, Future<Object?> future) = calls.call(
            catalogId: _catId,
            name: 'scrollIntoView',
            functionCallId: id,
          );
          future.ignore();
        }
        // Settled with a value, failed with an error, failed as malformed.
        expect(calls.resolve(_response('ok', {'value': 1})), isTrue);
        expect(
          calls.resolve(
            _response('err', {
              'error': {'code': 'X', 'message': 'no'},
            }),
          ),
          isTrue,
        );
        expect(
          calls.resolve(
            _response('bad', {
              'value': 1,
              'error': {'code': 'X', 'message': 'both'},
            }),
          ),
          isTrue,
        );
        // Duplicate, unknown, malformed and unknown, not a message.
        expect(calls.resolve(_response('ok', {'value': 2})), isFalse);
        expect(calls.resolve(_response('unknown', {'value': 1})), isFalse);
        expect(
          calls.resolve(_response('unknown', {'value': 1, 'error': 'x'})),
          isFalse,
        );
        expect(calls.resolve('not a message'), isFalse);
        // Late: after the timeout.
        async.elapse(const Duration(milliseconds: 60));
        expect(calls.resolve(_response('late', {'value': 1})), isFalse);
        calls.dispose();
      });
    });

    test('used as onRendererFunctionResponse, resolve declines responses it '
        'does not own', () async {
      final calls = RendererFunctionCalls();
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onRendererFunctionResponse: calls.resolve,
      );
      final ProcessResult result = await processor.processMessage(
        _response('model-call-1', {'value': 'Paris'}),
      );
      expect(result.handled, isFalse);
      expect(result.replies, isEmpty);
    });

    test('resolve plugs into RendererToAgentMessageProcessor', () async {
      final calls = RendererFunctionCalls();
      final processor = RendererToAgentMessageProcessor(
        catalogs: const [],
        onRendererFunctionResponse: calls.resolve,
      );
      final (_, Future<Object?> future) = calls.call(
        catalogId: _catId,
        name: 'scrollIntoView',
        functionCallId: 'rcall-1',
      );
      final ProcessResult result = await processor.processMessage(
        _response('rcall-1', {'value': true}),
      );
      expect(result.handled, isTrue);
      expect(result.replies, isEmpty);
      expect(await future, isTrue);
    });
  });
}

Map<String, Object?> _response(String callId, Map<String, Object?> body) => {
  'version': '1.0',
  'rendererFunctionResponse': {'functionCallId': callId, ...body},
};
