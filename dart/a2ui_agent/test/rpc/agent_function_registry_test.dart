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
import 'package:json_schema_builder/json_schema_builder.dart';
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
});

Map<String, Object?> _callMsg(
  String name, [
  Map<String, Object?>? args,
  String catalogId = _catId,
  String surfaceId = 'main',
  String callId = 'call-1',
]) => <String, Object?>{
  'version': A2uiProtocolVersion.v1_0.jsonValue,
  'callAgentFunction': <String, Object?>{
    'surfaceId': surfaceId,
    'functionCallId': callId,
    'callFunction': <String, Object?>{
      '@call': name,
      'catalogId': catalogId,
      'args': ?args,
    },
  },
};

void main() {
  group('AgentFunctionRegistry', () {
    test('indexes functions across multiple catalogs and rejects invalid '
        'constructor args', () {
      final quote = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        returnType: A2uiReturnType.object,
        handler: (args, ctx) => <String, Object?>{
          'symbol': args['symbol'],
          'quantity': args['quantity'],
        },
      );
      final rate = AgentFunction(
        name: 'fetchRate',
        argumentSchema: Schema.fromMap({
          'type': 'object',
          'properties': {
            'pair': {'type': 'string'},
          },
          'required': ['pair'],
        }),
        returnType: A2uiReturnType.number,
        handler: (args, ctx) => 1.25,
      );
      final CatalogApi cat1 = Catalog(
        id: _catId,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [quote],
      );
      final CatalogApi cat2 = Catalog(
        id: _cat2Id,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [rate],
      );

      final reg = AgentFunctionRegistry([cat1, cat2]);
      expect(reg.get(_catId, 'fetchQuote'), same(quote));
      expect(reg.get(_cat2Id, 'fetchRate'), same(rate));
      expect(reg.get(_catId, 'missing'), isNull);
      expect(reg.functions.length, 2);

      expect(
        () => AgentFunctionRegistry([cat1], maxConcurrency: 0),
        throwsArgumentError,
      );
      expect(
        () => AgentFunctionRegistry([cat1], timeout: Duration.zero),
        throwsArgumentError,
      );
      expect(
        () => AgentFunctionRegistry([
          cat1,
        ], timeout: const Duration(milliseconds: -5)),
        throwsArgumentError,
      );
    });

    test('executes sync and async handlers and populates defaults', () async {
      AgentFunctionContext? seenCtx;
      final syncFn = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: _quoteSchema(),
        returnType: A2uiReturnType.object,
        handler: (args, ctx) {
          seenCtx = ctx;
          return <String, Object?>{
            'symbol': args['symbol'],
            'quantity': args['quantity'],
          };
        },
      );
      final asyncFn = AgentFunction(
        name: 'asyncRate',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        returnType: A2uiReturnType.number,
        handler: (args, ctx) async {
          await Future<void>.delayed(const Duration(milliseconds: 5));
          return 42.5;
        },
      );
      final CatalogApi cat = Catalog(
        id: _catId,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [syncFn, asyncFn],
      );
      final reg = AgentFunctionRegistry([cat]);

      final AgentFunctionResponseMessage r1 = await reg.handle(
        _callMsg('fetchQuote', const {'symbol': 'GOOG'}),
      );
      expect(r1.response.functionCallId, 'call-1');
      expect(r1.response.error, isNull);
      expect(r1.response.value, {'symbol': 'GOOG', 'quantity': 1});
      expect(seenCtx?.catalogId, _catId);
      expect(seenCtx?.surfaceId, 'main');
      expect(seenCtx?.functionCallId, 'call-1');

      // Also accepts a typed CallAgentFunctionMessage.
      final typedCall = CallAgentFunctionMessage(
        version: A2uiProtocolVersion.v1_0.jsonValue,
        surfaceId: 'surf-2',
        functionCallId: 'call-typed',
        callFunction: const {'@call': 'asyncRate', 'catalogId': _catId},
      );
      final AgentFunctionResponseMessage r2 = await reg.handle(typedCall);
      expect(r2.response.functionCallId, 'call-typed');
      expect(r2.response.value, 42.5);
    });

    test(
      'maps validation, lookup, and handler failures to wire error codes',
      () async {
        final quote = AgentFunction(
          name: 'fetchQuote',
          argumentSchema: _quoteSchema(),
          handler: (args, ctx) => args,
        );
        final boom = AgentFunction(
          name: 'boom',
          argumentSchema: Schema.fromMap({'type': 'object'}),
          handler: (args, ctx) => throw StateError('database down'),
        );
        final customRpc = AgentFunction(
          name: 'customRpc',
          argumentSchema: Schema.fromMap({'type': 'object'}),
          handler: (args, ctx) =>
              throw A2uiRpcError.custom('Market closed', 'MARKET_CLOSED'),
        );
        final nonJson = AgentFunction(
          name: 'nonJson',
          argumentSchema: Schema.fromMap({'type': 'object'}),
          handler: (args, ctx) => Object(),
        );
        final CatalogApi cat = Catalog(
          id: _catId,
          protocolVersion: A2uiProtocolVersion.v1_0,
          components: const <ComponentApi>[],
          agentFunctions: [quote, boom, customRpc, nonJson],
        );
        final reg = AgentFunctionRegistry([cat]);

        // Unknown catalog / function -> UNKNOWN_FUNCTION.
        final AgentFunctionResponseMessage rUnknownCat = await reg.handle(
          _callMsg('fetchQuote', const {'symbol': 'GOOG'}, 'https://unknown'),
        );
        expect(
          rUnknownCat.response.error?.code,
          RpcErrorCode.unknownFunction.wireValue,
        );

        final AgentFunctionResponseMessage rUnknownFn = await reg.handle(
          _callMsg('unknownFn', const {'symbol': 'GOOG'}),
        );
        expect(
          rUnknownFn.response.error?.code,
          RpcErrorCode.unknownFunction.wireValue,
        );

        // Invalid args -> INVALID_FUNCTION_CALL.
        final AgentFunctionResponseMessage rMissingReq = await reg.handle(
          _callMsg('fetchQuote', const <String, Object?>{}),
        );
        expect(
          rMissingReq.response.error?.code,
          RpcErrorCode.invalidFunctionCall.wireValue,
        );

        final AgentFunctionResponseMessage rExtra = await reg.handle(
          _callMsg('fetchQuote', const {'symbol': 'GOOG', 'extra': 1}),
        );
        expect(
          rExtra.response.error?.code,
          RpcErrorCode.invalidFunctionCall.wireValue,
        );

        // Handler exception -> EXECUTION_ERROR.
        final AgentFunctionResponseMessage rBoom = await reg.handle(
          _callMsg('boom'),
        );
        expect(
          rBoom.response.error?.code,
          RpcErrorCode.executionError.wireValue,
        );
        expect(rBoom.response.error?.message, contains('database down'));

        // Custom A2uiRpcError -> preserves custom code.
        final AgentFunctionResponseMessage rCustom = await reg.handle(
          _callMsg('customRpc'),
        );
        expect(rCustom.response.error?.code, 'MARKET_CLOSED');
        expect(rCustom.response.error?.message, 'Market closed');

        // Non-JSON return value -> EXECUTION_ERROR.
        final AgentFunctionResponseMessage rNonJson = await reg.handle(
          _callMsg('nonJson'),
        );
        expect(
          rNonJson.response.error?.code,
          RpcErrorCode.executionError.wireValue,
        );

        // Malformed envelope with recoverable functionCallId ->
        // INVALID_FUNCTION_CALL.
        final AgentFunctionResponseMessage rEmptySurface = await reg.handle({
          'version': A2uiProtocolVersion.v1_0.jsonValue,
          'callAgentFunction': {
            'surfaceId': '',
            'functionCallId': 'call-bad-surf',
            'callFunction': {'@call': 'fetchQuote', 'catalogId': _catId},
          },
        });
        expect(rEmptySurface.response.functionCallId, 'call-bad-surf');
        expect(
          rEmptySurface.response.error?.code,
          RpcErrorCode.invalidFunctionCall.wireValue,
        );

        // Missing functionCallId or non-callAgentFunction -> throws
        // A2uiValidationError.
        await expectLater(
          () => reg.handle({'version': '1.0', 'action': <String, Object?>{}}),
          throwsA(isA<A2uiValidationError>()),
        );
        await expectLater(
          () => reg.handle({
            'version': '1.0',
            'callAgentFunction': {'surfaceId': 's'},
          }),
          throwsA(isA<A2uiValidationError>()),
        );
      },
    );

    test('enforces maxConcurrency semaphore and dispose()', () async {
      var active = 0;
      var maxSeen = 0;
      final gate = Completer<void>();

      final slow = AgentFunction(
        name: 'slow',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: (args, ctx) async {
          active++;
          if (active > maxSeen) maxSeen = active;
          try {
            await gate.future;
            return ctx.functionCallId;
          } finally {
            active--;
          }
        },
      );
      final CatalogApi cat = Catalog(
        id: _catId,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [slow],
      );
      final reg = AgentFunctionRegistry([cat], maxConcurrency: 2);

      final List<Future<AgentFunctionResponseMessage>> futures = [
        for (var i = 0; i < 4; i++)
          reg.handle(_callMsg('slow', null, _catId, 'main', 'c-$i')),
      ];

      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(maxSeen, 2);
      expect(active, 2);

      gate.complete();
      final List<AgentFunctionResponseMessage> results = await Future.wait(
        futures,
      );
      expect(maxSeen, 2);
      expect(results.map((r) => r.response.value).toList(), [
        'c-0',
        'c-1',
        'c-2',
        'c-3',
      ]);

      // Now test dispose() while a call is in-flight.
      final never = Completer<Object?>();
      final stuckFn = AgentFunction(
        name: 'stuck',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: (args, ctx) => never.future,
      );
      final CatalogApi catStuck = Catalog(
        id: _catId,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [stuckFn],
      );
      final reg2 = AgentFunctionRegistry([catStuck]);
      final Future<AgentFunctionResponseMessage> inFlight = reg2.handle(
        _callMsg('stuck', null, _catId, 'main', 'call-stuck'),
      );
      reg2.dispose();
      expect(reg2.isDisposed, isTrue);
      expect(reg2.disposed, isTrue);

      await expectLater(
        inFlight,
        throwsA(
          isA<A2uiRpcError>().having(
            (e) => e.rpcCode,
            'rpcCode',
            RpcErrorCode.disposed,
          ),
        ),
      );
      await expectLater(
        () => reg2.handle(_callMsg('stuck')),
        throwsA(
          isA<A2uiRpcError>().having(
            (e) => e.rpcCode,
            'rpcCode',
            RpcErrorCode.disposed,
          ),
        ),
      );
    });

    test('completes queued semaphore waiters on dispose and timeout without '
        'hanging', () async {
      final gate = Completer<void>();
      final calls = <String>[];
      final gatedFn = AgentFunction(
        name: 'gated',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: (args, ctx) async {
          calls.add(ctx.functionCallId);
          await gate.future;
          return ctx.functionCallId;
        },
      );
      final CatalogApi cat = Catalog(
        id: _catId,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [gatedFn],
      );

      // 1) Timeout while queued behind maxConcurrency: 1.
      final reg = AgentFunctionRegistry([cat], maxConcurrency: 1);
      final Future<AgentFunctionResponseMessage> first = reg.handle(
        _callMsg('gated', null, _catId, 'main', 'c-active'),
      );
      final Future<AgentFunctionResponseMessage> queuedTimedOut = reg.handle(
        _callMsg('gated', null, _catId, 'main', 'c-queued-timeout'),
        timeout: const Duration(milliseconds: 20),
      );

      final AgentFunctionResponseMessage timedOutResp = await queuedTimedOut;
      expect(
        timedOutResp.response.error?.code,
        RpcErrorCode.executionError.wireValue,
      );
      expect(calls, ['c-active']);

      gate.complete();
      final AgentFunctionResponseMessage firstResp = await first;
      expect(firstResp.response.value, 'c-active');

      // 2) Dispose while a call is queued behind maxConcurrency: 1.
      final gate2 = Completer<void>();
      final gatedFn2 = AgentFunction(
        name: 'gated2',
        argumentSchema: Schema.fromMap({'type': 'object'}),
        handler: (args, ctx) async {
          await gate2.future;
          return ctx.functionCallId;
        },
      );
      final CatalogApi cat2 = Catalog(
        id: _catId,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [gatedFn2],
      );
      final regDispose = AgentFunctionRegistry([cat2], maxConcurrency: 1);
      final Future<AgentFunctionResponseMessage> activeCall = regDispose.handle(
        _callMsg('gated2', null, _catId, 'main', 'd-active'),
      );
      final Future<AgentFunctionResponseMessage> queuedCall = regDispose.handle(
        _callMsg('gated2', null, _catId, 'main', 'd-queued'),
      );

      regDispose.dispose();

      await expectLater(
        activeCall,
        throwsA(
          isA<A2uiRpcError>().having(
            (e) => e.rpcCode,
            'rpcCode',
            RpcErrorCode.disposed,
          ),
        ),
      );
      await expectLater(
        queuedCall,
        throwsA(
          isA<A2uiRpcError>().having(
            (e) => e.rpcCode,
            'rpcCode',
            RpcErrorCode.disposed,
          ),
        ),
      );
      gate2.complete();
    });
  });
}
