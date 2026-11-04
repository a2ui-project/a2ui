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
  });
}
