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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:fake_async/fake_async.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

/// A catalog function whose behavior and metadata the test chooses.
class _Fn extends FunctionImplementation {
  _Fn(
    String name,
    this.body, {
    Schema? argumentSchema,
    super.allowedCallers = AllowedCallers.rendererOrAgent,
    super.requiresUserActivation,
  }) : super(name: name, argumentSchema: argumentSchema ?? Schema.object());

  final Object? Function(Map<String, dynamic> args, DataContext context) body;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      body(args, context);
}

Catalog<ComponentApi, FunctionImplementation> _catalog(
  String id,
  List<FunctionImplementation> functions, {
  String? protocolVersion = 'v1.0',
}) =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: id,
      components: const [],
      functions: functions,
      protocolVersion: protocolVersion != null
          ? A2uiProtocolVersion.tryParseSemVer(protocolVersion)
          : null,
    );

CallRendererFunctionMessage _inbound(
  String name, {
  String? catalogId,
  Map<String, Object?> args = const {},
  String id = 'call-1',
  String version = 'v1.0',
}) =>
    CallRendererFunctionMessage(
      version: version,
      functionCallId: id,
      callFunction: {
        '@call': name,
        if (catalogId != null) 'catalogId': catalogId,
        'args': args,
      },
    );

void main() {
  late List<RendererToAgentMessage> sent;
  late Catalog<ComponentApi, FunctionImplementation> catalog;

  setUp(() {
    sent = [];
    catalog = _catalog('basic', [
      _Fn('echo', (args, _) => args['value']),
      _Fn('rendererOnly', (_, __) => 'local',
          allowedCallers: AllowedCallers.rendererOnly),
      _Fn('agentOnly', (_, __) => 'agent',
          allowedCallers: AllowedCallers.agentOnly),
      _Fn('gated', (_, __) => 'opened', requiresUserActivation: true),
      _Fn('boom', (_, __) => throw StateError('kaboom')),
      _Fn('boomA2ui', (_, __) => throw A2uiDataError('data gone')),
      _Fn('boomEmpty', (_, __) => throw A2uiError('')),
      _Fn('later', (_, __) => Future<Object?>.delayed(Duration.zero, () => 42)),
      _Fn('sig', (_, __) => signal<Object?>('from-signal')),
      _Fn('nothing', (_, __) => null),
      _Fn(
        'typed',
        (args, _) => (args['amount'] as num) * 2,
        argumentSchema: Schema.fromMap({
          'type': 'object',
          'properties': {
            'amount': {'type': 'number'},
          },
          'required': ['amount'],
        }),
      ),
    ]);
  });

  RpcHandler handler({bool withListener = true, Duration? defaultTimeout}) {
    final h = RpcHandler(
      catalogs: [catalog],
      outboundListener: withListener ? sent.add : null,
      defaultTimeout: defaultTimeout ?? const Duration(seconds: 30),
    );
    addTearDown(h.dispose);
    return h;
  }

  TypeMatcher<A2uiRpcError> rpcError(
    RpcErrorCode code, {
    String? functionCallId,
  }) =>
      isA<A2uiRpcError>()
          .having((e) => e.rpcCode, 'rpcCode', code)
          .having((e) => e.code, 'code', code.wireValue)
          .having(
            (e) => e.functionCallId,
            'functionCallId',
            functionCallId ?? anything,
          );

  group('RpcErrorCode', () {
    test('round-trips through its wire value', () {
      for (final RpcErrorCode code in RpcErrorCode.values) {
        expect(RpcErrorCode.tryParse(code.wireValue), code);
      }
      expect(RpcErrorCode.timeout.wireValue, 'TIMEOUT');
      expect(
          RpcErrorCode.invalidFunctionCall.wireValue, 'INVALID_FUNCTION_CALL');
      expect(RpcErrorCode.tryParse('NOPE'), isNull);
    });

    test('A2uiRpcError carries the code and call id', () {
      final error = A2uiRpcError(
        'nope',
        RpcErrorCode.timeout,
        functionCallId: 'c1',
        details: {'x': 1},
      );
      expect(error.code, 'TIMEOUT');
      expect(error.toString(), allOf(contains('TIMEOUT'), contains('c1')));
      expect(error.details, {'x': 1});
    });
  });

  group('callAgentFunction', () {
    test('emits a callAgentFunction message and completes on response',
        () async {
      final RpcHandler h = handler();
      final call = FunctionCall(
        call: 'queryInventory',
        args: {'sku': 'X'},
        catalogId: 'store',
      );
      final Future<Object?> future = h.callAgentFunction('s1', call,
          options: const CallOptions(functionCallId: 'id-1'));
      expect(h.pendingCallCount, 1);
      expect(sent, hasLength(1));
      final message = sent.single as CallAgentFunctionMessage;
      expect(message.toJson(), {
        'version': 'v1.0',
        'callAgentFunction': {
          'surfaceId': 's1',
          'functionCallId': 'id-1',
          'callFunction': {
            '@call': 'queryInventory',
            'args': {'sku': 'X'},
            'catalogId': 'store',
          },
        },
      });
      h.handleAgentFunctionResponse(AgentFunctionResponseMessage(
        version: 'v1.0',
        response: const A2uiFunctionResponse.value('id-1', {'inStock': 2}),
      ));
      expect(await future, {'inStock': 2});
      expect(h.pendingCallCount, 0);
    });

    test('generates unique ids when none is given', () async {
      final RpcHandler h = handler();
      // Settled with CANCELLED when the handler is disposed.
      h.callAgentFunction('s', FunctionCall(call: 'a', args: {})).ignore();
      h.callAgentFunction('s', FunctionCall(call: 'a', args: {})).ignore();
      final Set<String> ids = sent
          .cast<CallAgentFunctionMessage>()
          .map((m) => m.functionCallId)
          .toSet();
      expect(ids, hasLength(2));
      expect(ids.every((id) => id.isNotEmpty), isTrue);
      expect(h.pendingCallCount, 2);
      h.dispose();
    });

    test('uses the version from CallOptions', () {
      final RpcHandler h = handler();
      h
          .callAgentFunction(
            's',
            FunctionCall(call: 'a', args: {}),
            options: const CallOptions(version: A2uiProtocolVersion.v1_0),
          )
          .ignore();
      expect(sent.single.version, 'v1.0');
    });

    test('fails with NO_LISTENER without a listener', () async {
      final RpcHandler h = handler(withListener: false);
      await expectLater(
        h.callAgentFunction('s', FunctionCall(call: 'a', args: {})),
        throwsA(rpcError(RpcErrorCode.noListener)),
      );
    });

    test('fails with INVALID_FUNCTION_CALL for an empty name', () async {
      final RpcHandler h = handler();
      await expectLater(
        h.callAgentFunction('s', FunctionCall(call: '', args: {})),
        throwsA(rpcError(RpcErrorCode.invalidFunctionCall)),
      );
      expect(sent, isEmpty);
    });

    test('fails with DUPLICATE for a pending id', () async {
      final RpcHandler h = handler();
      final Future<Object?> first = h.callAgentFunction(
        's',
        FunctionCall(call: 'a', args: {}),
        options: const CallOptions(functionCallId: 'dup'),
      );
      await expectLater(
        h.callAgentFunction(
          's',
          FunctionCall(call: 'b', args: {}),
          options: const CallOptions(functionCallId: 'dup'),
        ),
        throwsA(rpcError(RpcErrorCode.duplicate, functionCallId: 'dup')),
      );
      expect(sent, hasLength(1));
      h.handleAgentFunctionResponse(AgentFunctionResponseMessage(
        version: 'v1.0',
        response: const A2uiFunctionResponse.value('dup', 1),
      ));
      expect(await first, 1);
    });

    test('times out after the default timeout', () {
      fakeAsync((async) {
        final RpcHandler h = handler();
        Object? error;
        h
            .callAgentFunction('s', FunctionCall(call: 'slow', args: {}))
            .catchError((Object e) {
          error = e;
          return null;
        });
        async.elapse(const Duration(seconds: 29));
        expect(error, isNull);
        async.elapse(const Duration(seconds: 1));
        expect(error, rpcError(RpcErrorCode.timeout));
        expect((error! as A2uiRpcError).message, contains('slow'));
        expect(h.pendingCallCount, 0);
      });
    });

    test('times out after CallOptions.timeout', () {
      fakeAsync((async) {
        final RpcHandler h = handler();
        Object? error;
        h
            .callAgentFunction(
          's',
          FunctionCall(call: 'slow', args: {}),
          options: const CallOptions(timeout: Duration(milliseconds: 10)),
        )
            .catchError((Object e) {
          error = e;
          return null;
        });
        async.elapse(const Duration(milliseconds: 10));
        expect(error, rpcError(RpcErrorCode.timeout));
      });
    });

    test('sets no timer when the timeout is zero', () {
      fakeAsync((async) {
        final RpcHandler h = handler();
        unawaited(h.callAgentFunction(
          's',
          FunctionCall(call: 'slow', args: {}),
          options: const CallOptions(timeout: Duration.zero),
        ));
        expect(async.pendingTimers, isEmpty);
        async.elapse(const Duration(hours: 1));
        expect(h.pendingCallCount, 1);
        h.dispose();
      });
    });

    test('is cancelled through a CancellationSignal', () async {
      final RpcHandler h = handler();
      final signal = CancellationSignal();
      final Future<Object?> future = h.callAgentFunction(
        's',
        FunctionCall(call: 'a', args: {}),
        options: CallOptions(signal: signal, functionCallId: 'c'),
      );
      signal.cancel();
      await expectLater(
        future,
        throwsA(rpcError(RpcErrorCode.cancelled, functionCallId: 'c')),
      );
      expect(h.pendingCallCount, 0);
    });

    test('dispose cancels pending calls and rejects later ones', () async {
      final RpcHandler h = handler();
      final Future<Object?> future = h.callAgentFunction(
        's',
        FunctionCall(call: 'a', args: {}),
        options: const CallOptions(functionCallId: 'p1'),
      );
      h.dispose();
      h.dispose();
      expect(h.isDisposed, isTrue);
      await expectLater(
        future,
        throwsA(rpcError(RpcErrorCode.cancelled, functionCallId: 'p1')
            .having((e) => e.message, 'message', contains('p1'))),
      );
      await expectLater(
        h.callAgentFunction('s', FunctionCall(call: 'a', args: {})),
        throwsA(rpcError(RpcErrorCode.disposed)),
      );
    });

    test('a listener that throws synchronously fails the call', () async {
      final h = RpcHandler(
        catalogs: [catalog],
        outboundListener: (_) => throw StateError('transport down'),
      );
      addTearDown(h.dispose);
      await expectLater(
        h.callAgentFunction('s', FunctionCall(call: 'a', args: {})),
        throwsA(isA<StateError>()),
      );
      expect(h.pendingCallCount, 0);
    });

    test('a listener whose future fails fails the call', () async {
      final h = RpcHandler(
        catalogs: [catalog],
        outboundListener: (_) async => throw StateError('send failed'),
      );
      addTearDown(h.dispose);
      await expectLater(
        h.callAgentFunction('s', FunctionCall(call: 'a', args: {})),
        throwsA(isA<StateError>()),
      );
      expect(h.pendingCallCount, 0);
    });
  });

  group('handleAgentFunctionResponse', () {
    test('ignores an unknown id', () {
      final RpcHandler h = handler();
      h.handleAgentFunctionResponse(AgentFunctionResponseMessage(
        version: 'v1.0',
        response: const A2uiFunctionResponse.value('nope', 1),
      ));
      expect(h.pendingCallCount, 0);
    });

    test('completes with a known error code', () async {
      final RpcHandler h = handler();
      final Future<Object?> future = h.callAgentFunction(
        's',
        FunctionCall(call: 'a', args: {}),
        options: const CallOptions(functionCallId: 'e1'),
      );
      h.handleAgentFunctionResponse(AgentFunctionResponseMessage(
        version: 'v1.0',
        response: const A2uiFunctionResponse.error(
          'e1',
          A2uiFunctionResponseError(code: 'EXECUTION_ERROR', message: 'bad'),
        ),
      ));
      await expectLater(
        future,
        throwsA(rpcError(RpcErrorCode.executionError, functionCallId: 'e1')
            .having((e) => e.message, 'message', 'bad')),
      );
    });

    test('maps an unknown error code to unknownError with details', () async {
      final RpcHandler h = handler();
      final Future<Object?> future = h.callAgentFunction(
        's',
        FunctionCall(call: 'a', args: {}),
        options: const CallOptions(functionCallId: 'e2'),
      );
      h.handleAgentFunctionResponse(AgentFunctionResponseMessage(
        version: 'v1.0',
        response: const A2uiFunctionResponse.error(
          'e2',
          A2uiFunctionResponseError(code: 'CUSTOM_THING', message: 'odd'),
        ),
      ));
      await expectLater(
        future,
        throwsA(rpcError(RpcErrorCode.unknownError).having(
          (e) => e.details,
          'details',
          {'code': 'CUSTOM_THING', 'message': 'odd'},
        )),
      );
    });
  });

  group('handleCallRendererFunction', () {
    late SurfaceModel<ComponentApi> surface;

    setUp(() {
      surface = SurfaceModel<ComponentApi>(
        'surf',
        defaultCatalog: catalog,
        protocolVersion: 'v1.0',
      );
      addTearDown(surface.dispose);
    });

    Future<A2uiFunctionResponse> run(
      RpcHandler h,
      CallRendererFunctionMessage message, {
      bool withSurface = true,
      bool isUserActivated = false,
    }) async {
      final RendererFunctionResponseMessage response =
          await h.handleCallRendererFunction(
        message,
        surface: withSurface ? surface : null,
        context: ExecutionContext(isUserActivated: isUserActivated),
      );
      expect(response.version, message.version);
      expect(sent.last, same(response));
      return response.response;
    }

    void expectError(
      A2uiFunctionResponse response,
      RpcErrorCode code,
      String messagePart,
    ) {
      expect(response.error, isNotNull, reason: 'expected an error');
      expect(response.error!.code, code.wireValue);
      expect(response.error!.message, contains(messagePart));
    }

    test('runs a rendererOrAgent function and returns its value', () async {
      final A2uiFunctionResponse r =
          await run(handler(), _inbound('echo', args: {'value': 7}));
      expect(r.functionCallId, 'call-1');
      expect(r.value, 7);
      expect(r.error, isNull);
    });

    test('runs an agentOnly function', () async {
      final A2uiFunctionResponse r =
          await run(handler(), _inbound('agentOnly'));
      expect(r.value, 'agent');
    });

    test('refuses a rendererOnly function', () async {
      final A2uiFunctionResponse r =
          await run(handler(), _inbound('rendererOnly'));
      expectError(
        r,
        RpcErrorCode.invalidFunctionCall,
        "Function 'rendererOnly' cannot be called by agent "
        '(allowedCallers is rendererOnly).',
      );
    });

    test('refuses a gated function without user activation', () async {
      final A2uiFunctionResponse r = await run(handler(), _inbound('gated'));
      expectError(
        r,
        RpcErrorCode.invalidFunctionCall,
        "Function 'gated' requires user activation context to execute.",
      );
    });

    test('runs a gated function with user activation', () async {
      final A2uiFunctionResponse r =
          await run(handler(), _inbound('gated'), isUserActivated: true);
      expect(r.value, 'opened');
    });

    test('reports an unknown catalog', () async {
      final A2uiFunctionResponse r =
          await run(handler(), _inbound('echo', catalogId: 'missing'));
      expectError(
        r,
        RpcErrorCode.invalidFunctionCall,
        'Catalog not found: missing',
      );
    });

    test('resolves a catalog from the handler list when the surface lacks it',
        () async {
      final Catalog<ComponentApi, FunctionImplementation> other =
          _catalog('other', [_Fn('ping', (_, __) => 'pong')]);
      final h =
          RpcHandler(catalogs: [catalog, other], outboundListener: sent.add);
      addTearDown(h.dispose);
      final A2uiFunctionResponse r =
          await run(h, _inbound('ping', catalogId: 'other'));
      expect(r.value, 'pong');
    });

    test('reports an unknown function', () async {
      final A2uiFunctionResponse r = await run(handler(), _inbound('nope'));
      expectError(
        r,
        RpcErrorCode.invalidFunctionCall,
        'Function not found: nope',
      );
    });

    test('reports no catalog when headless and no catalogId', () async {
      final A2uiFunctionResponse r =
          await run(handler(), _inbound('echo'), withSurface: false);
      expectError(
        r,
        RpcErrorCode.invalidFunctionCall,
        'No catalog available for function resolution.',
      );
    });

    test('runs headless with an explicit catalogId', () async {
      final A2uiFunctionResponse r = await run(
        handler(),
        _inbound('echo', catalogId: 'basic', args: {'value': 'x'}),
        withSurface: false,
      );
      expect(r.value, 'x');
    });

    test('reports a protocol version mismatch', () async {
      final Catalog<ComponentApi, FunctionImplementation> legacy = _catalog(
          'legacy', [_Fn('echo', (a, _) => a['value'])],
          protocolVersion: 'v0.9');
      final Catalog<ComponentApi, FunctionImplementation> unversioned =
          _catalog('old', [_Fn('echo', (a, _) => a['value'])],
              protocolVersion: null);
      final h = RpcHandler(
        catalogs: [legacy, unversioned],
        outboundListener: sent.add,
      );
      addTearDown(h.dispose);
      for (final id in ['legacy', 'old']) {
        final A2uiFunctionResponse r =
            await run(h, _inbound('echo', catalogId: id), withSurface: false);
        expectError(
          r,
          RpcErrorCode.invalidFunctionCall,
          'does not match message protocol version',
        );
        expect(r.error!.message, contains(id));
      }
    });

    test('reports invalid arguments', () async {
      final A2uiFunctionResponse r = await run(
        handler(),
        _inbound('typed', args: {'amount': 'lots'}),
      );
      expectError(
        r,
        RpcErrorCode.invalidFunctionCall,
        "Invalid function arguments for 'typed'",
      );
    });

    test('reports a throwing implementation as EXECUTION_ERROR', () async {
      final A2uiFunctionResponse r = await run(handler(), _inbound('boom'));
      expectError(r, RpcErrorCode.executionError, 'kaboom');
      final A2uiFunctionResponse r2 =
          await run(handler(), _inbound('boomA2ui'));
      expectError(r2, RpcErrorCode.executionError, 'data gone');
      final A2uiFunctionResponse r3 =
          await run(handler(), _inbound('boomEmpty'));
      expectError(
        r3,
        RpcErrorCode.executionError,
        'An error occurred during function execution.',
      );
    });

    test('awaits an async implementation', () async {
      final A2uiFunctionResponse r = await run(handler(), _inbound('later'));
      expect(r.value, 42);
    });

    test('unwraps a signal-valued result', () async {
      final A2uiFunctionResponse r = await run(handler(), _inbound('sig'));
      expect(r.value, 'from-signal');
    });

    test('returns a null result as a value response', () async {
      final A2uiFunctionResponse r = await run(handler(), _inbound('nothing'));
      expect(r.error, isNull);
      expect(r.toJson(), {'functionCallId': 'call-1', 'value': null});
    });

    test('still returns the response when the listener throws', () async {
      final h = RpcHandler(
        catalogs: [catalog],
        outboundListener: (_) => throw StateError('nope'),
      );
      addTearDown(h.dispose);
      final RendererFunctionResponseMessage response =
          await h.handleCallRendererFunction(
        _inbound('echo', args: {'value': 1}),
        surface: surface,
      );
      expect(response.response.value, 1);
    });

    test('answers DISPOSED after dispose', () async {
      final RpcHandler h = handler();
      h.dispose();
      final RendererFunctionResponseMessage response =
          await h.handleCallRendererFunction(
        _inbound('echo'),
        surface: surface,
      );
      expect(response.response.error!.code, 'DISPOSED');
    });

    test('runs the function against the surface data model', () async {
      surface.dataModel.set('/count', 3);
      final Catalog<ComponentApi, FunctionImplementation> reading =
          _catalog('reading', [
        _Fn('read', (_, ctx) => ctx.dataModel.get('/count')),
      ]);
      final h = RpcHandler(catalogs: [reading], outboundListener: sent.add);
      addTearDown(h.dispose);
      final A2uiFunctionResponse r =
          await run(h, _inbound('read', catalogId: 'reading'));
      expect(r.value, 3);
    });
  });
}
