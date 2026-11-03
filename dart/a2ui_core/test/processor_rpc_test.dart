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
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

import 'support/test_catalog.dart';

/// A catalog function that records the surface it ran against.
class _Fn extends FunctionImplementation {
  _Fn(String name, this.body)
      : super(
          name: name,
          argumentSchema: Schema.object(),
          allowedCallers: AllowedCallers.rendererOrAgent,
        );

  final Object? Function(Map<String, dynamic> args, DataContext context) body;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      body(args, context);
}

Catalog<ComponentApi, FunctionImplementation> _catalog(String id) =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: id,
      protocolVersion: A2uiProtocolVersion.v1_0,
      components: [TestTextApi()],
      functions: [
        _Fn('whereAmI', (_, context) => context.dataModel.get('/name')),
        _Fn('versionOf', (_, context) => context.protocolVersion?.name),
        _Fn('slow', (_, __) async {
          await Future<void>.delayed(const Duration(milliseconds: 5));
          return 'late';
        }),
      ],
    );

Map<String, Object?> _callRendererFunction(
  String id,
  String name, {
  String? surfaceId,
  String? catalogId,
}) =>
    {
      'version': '1.0',
      'callRendererFunction': {
        if (surfaceId != null) 'surfaceId': surfaceId,
        'functionCallId': id,
        'callFunction': {
          '@call': name,
          if (catalogId != null) 'catalogId': catalogId,
          'args': <String, Object?>{},
        },
      },
    };

void main() {
  late List<RendererToAgentMessage> sent;
  late MessageProcessor<ComponentApi> processor;

  setUp(() {
    sent = [];
    processor = MessageProcessor<ComponentApi>(
      catalogs: [_catalog('alpha'), _catalog('beta')],
      defaultVersion: A2uiProtocolVersion.v1_0,
      outboundListener: sent.add,
    );
    addTearDown(processor.dispose);
  });

  List<RendererFunctionResponseMessage> responses() =>
      sent.whereType<RendererFunctionResponseMessage>().toList();

  test('processMessagesAsync emits the response before completing', () async {
    await processor.processMessagesAsync(
      _callRendererFunction('c1', 'slow', catalogId: 'alpha'),
    );
    expect(responses(), hasLength(1));
    expect(responses().single.response.value, 'late');
    expect(responses().single.response.functionCallId, 'c1');
  });

  test('callRendererFunction resolves against an added catalog', () async {
    processor.addCatalog(_catalog('gamma'));

    await processor.processMessagesAsync(
      _callRendererFunction('c-added', 'slow', catalogId: 'gamma'),
    );

    expect(responses().single.response.value, 'late');
  });

  test('processMessages does not throw and still emits', () async {
    processor.processMessages(
      _callRendererFunction('c2', 'missing', catalogId: 'alpha'),
    );
    await Future<void>.delayed(Duration.zero);
    expect(responses().single.response.error!.code, 'INVALID_FUNCTION_CALL');
  });

  test(
      'callRendererFunction targets surfaceId when provided, runs isolated '
      'when omitted, and rejects missing surfaceId', () async {
    processor.processMessages([
      {
        'version': '1.0',
        'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
      },
      {
        'version': '1.0',
        'createSurface': {'surfaceId': 'two', 'catalogId': 'beta'},
      },
    ]);
    processor.model.getSurface('one')!.dataModel.set('/name', 'one');
    processor.model.getSurface('two')!.dataModel.set('/name', 'two');

    // Explicit surfaceId targets surface 'two'.
    await processor.processMessagesAsync(
      _callRendererFunction(
        'c3',
        'whereAmI',
        surfaceId: 'two',
        catalogId: 'beta',
      ),
    );
    expect(responses().last.response.value, 'two');

    // Omitted surfaceId runs against an isolated empty root data model.
    await processor.processMessagesAsync(
      _callRendererFunction('c4', 'whereAmI', catalogId: 'beta'),
    );
    expect(responses().last.response.value, isNull);

    // Unknown surfaceId returns INVALID_FUNCTION_CALL.
    await processor.processMessagesAsync(
      _callRendererFunction(
        'c5',
        'whereAmI',
        surfaceId: 'missing_surface',
        catalogId: 'beta',
      ),
    );
    expect(responses().last.response.error?.code, 'INVALID_FUNCTION_CALL');
  });

  test('isUserActivated reaches the handler', () async {
    final gatedCatalog = Catalog<ComponentApi, FunctionImplementation>(
      id: 'gated',
      protocolVersion: A2uiProtocolVersion.v1_0,
      components: const [],
      functions: [_Gated()],
    );
    final gated = MessageProcessor<ComponentApi>(
      catalogs: [gatedCatalog],
      defaultVersion: A2uiProtocolVersion.v1_0,
      outboundListener: sent.add,
    );
    addTearDown(gated.dispose);
    await gated.processMessagesAsync(
      _callRendererFunction('g1', 'open', catalogId: 'gated'),
    );
    expect(responses().single.response.error!.code, 'INVALID_FUNCTION_CALL');
    await gated.processMessagesAsync(
      _callRendererFunction('g2', 'open', catalogId: 'gated'),
      isUserActivated: true,
    );
    expect(responses().last.response.value, 'opened');
  });

  test('agentFunctionResponse completes a pending callAgentFunction', () async {
    final Future<Object?> pending = processor.callAgentFunction(
      'one',
      FunctionCall(call: 'remote', args: {'a': 1}),
      options: const CallOptions(functionCallId: 'r1'),
    );
    final CallAgentFunctionMessage outbound =
        sent.whereType<CallAgentFunctionMessage>().single;
    expect(outbound.surfaceId, 'one');
    expect(outbound.callFunction, {
      '@call': 'remote',
      'args': {'a': 1},
    });
    processor.processMessages({
      'version': '1.0',
      'agentFunctionResponse': {'functionCallId': 'r1', 'value': 'ok'},
    });
    expect(await pending, 'ok');
    expect(processor.rpc.pendingCallCount, 0);
  });

  test('dispose cancels pending calls', () async {
    final Future<Object?> pending =
        processor.callAgentFunction('one', FunctionCall(call: 'r', args: {}));
    processor.dispose();
    await expectLater(
      pending,
      throwsA(isA<A2uiRpcError>()
          .having((e) => e.rpcCode, 'rpcCode', RpcErrorCode.cancelled)),
    );
    expect(processor.rpc.isDisposed, isTrue);
  });

  test('deleteSurface cancels pending calls for that surface', () async {
    processor.processMessages({
      'version': '1.0',
      'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
    });
    final SurfaceModel<ComponentApi> surface =
        processor.model.getSurface('one')!;
    final errors = <A2uiRendererError>[];
    surface.onError.subscribe(errors.add);
    final DataContext context =
        ComponentContext(surface, ComponentModel('root', 'Text', {}))
            .dataContext;
    final ReadonlySignal<Object?> sig = context.resolveSignal({
      '@call': 'remote',
      'args': {'a': 1},
    });
    expect(sig.value, isNull);
    expect(processor.rpc.pendingCallCount, 1);

    processor.processMessages({
      'version': '1.0',
      'deleteSurface': {'surfaceId': 'one'},
    });
    expect(processor.rpc.pendingCallCount, 0);
    await Future<void>.delayed(Duration.zero);
    expect(errors, isEmpty);
  });

  test(
      'disposing the processor disposes its surfaces and RPC layer without '
      'reporting the cancelled calls', () async {
    processor.processMessages({
      'version': '1.0',
      'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
    });
    final SurfaceModel<ComponentApi> surface =
        processor.model.getSurface('one')!;
    final errors = <A2uiRendererError>[];
    processor.model.onError.subscribe(errors.add);
    final ReadonlySignal<Object?> binding =
        ComponentContext(surface, ComponentModel('root', 'Text', {}))
            .dataContext
            .resolveSignal({'@call': 'remote', 'args': <String, Object?>{}});
    final void Function() unsubscribe = binding.subscribe((_) {});
    addTearDown(unsubscribe);
    expect(processor.rpc.pendingCallCount, 1);

    processor.dispose();
    await Future<void>.delayed(Duration.zero);
    expect(surface.isDisposed, isTrue);
    expect(processor.rpc.isDisposed, isTrue);
    expect(processor.rpc.pendingCallCount, 0);
    expect(errors, isEmpty);
  });

  test('deleteSurface between two calls of one action sends no second call',
      () async {
    processor.processMessages({
      'version': '1.0',
      'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
    });
    final SurfaceModel<ComponentApi> surface =
        processor.model.getSurface('one')!;
    // The group-level listener outlives the surface, so it would see a
    // cancellation reported on the way out.
    final errors = <A2uiRendererError>[];
    processor.model.onError.subscribe(errors.add);
    final DataContext context =
        ComponentContext(surface, ComponentModel('root', 'Text', {}))
            .dataContext;
    final FutureOr<Map<String, dynamic>?> action =
        context.withUserActivation().resolveActionAsync({
      'event': {
        'name': 'go',
        'context': {
          'first': {'@call': 'remote', 'args': <String, Object?>{}},
          'second': {'@call': 'remoteToo', 'args': <String, Object?>{}},
        },
      },
    });
    expect(sent.whereType<CallAgentFunctionMessage>(), hasLength(1));
    processor.processMessages({
      'version': '1.0',
      'deleteSurface': {'surfaceId': 'one'},
    });
    expect(await action, isNull);

    // A local function still running when the surface goes away: the agent
    // call after it is cancelled rather than sent.
    processor.processMessages({
      'version': '1.0',
      'createSurface': {'surfaceId': 'two', 'catalogId': 'alpha'},
    });
    final DataContext second = ComponentContext(
      processor.model.getSurface('two')!,
      ComponentModel('root', 'Text', {}),
    ).dataContext;
    final FutureOr<Map<String, dynamic>?> slowAction =
        second.withUserActivation().resolveActionAsync({
      'event': {
        'name': 'go',
        'context': {
          'first': {'@call': 'slow', 'args': <String, Object?>{}},
          'second': {'@call': 'remote', 'args': <String, Object?>{}},
        },
      },
    });
    processor.processMessages({
      'version': '1.0',
      'deleteSurface': {'surfaceId': 'two'},
    });
    expect(await slowAction, isNull);
    await Future<void>.delayed(Duration.zero);
    expect(sent.whereType<CallAgentFunctionMessage>(), hasLength(1));
    expect(processor.rpc.pendingCallCount, 0);
    expect(errors, isEmpty);
  });

  test('a callRendererFunction argument never calls the agent', () async {
    processor.processMessages({
      'version': '1.0',
      'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
    });
    await processor.processMessagesAsync({
      'version': '1.0',
      'callRendererFunction': {
        'surfaceId': 'one',
        'functionCallId': 'c-arg',
        'callFunction': {
          '@call': 'whereAmI',
          'catalogId': 'alpha',
          'args': {
            'x': {'@call': 'remote', 'args': <String, Object?>{}},
          },
        },
      },
    });
    expect(sent.whereType<CallAgentFunctionMessage>(), isEmpty);
    expect(responses().single.response.error, isNotNull);
    expect(responses().single.response.error!.message, contains('remote'));
  });

  test(
      'a callRendererFunction argument fails even when the surface holds '
      'the answer', () async {
    processor.processMessages({
      'version': '1.0',
      'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
    });
    final ReadonlySignal<Object?> binding = ComponentContext(
      processor.model.getSurface('one')!,
      ComponentModel('root', 'Text', {}),
    ).dataContext.resolveSignal({
      '@call': 'remote',
      'args': <String, Object?>{},
    });
    final void Function() unsubscribe = binding.subscribe((_) {});
    addTearDown(unsubscribe);
    final CallAgentFunctionMessage outbound =
        sent.whereType<CallAgentFunctionMessage>().single;
    processor.processMessages({
      'version': '1.0',
      'agentFunctionResponse': {
        'functionCallId': outbound.functionCallId,
        'value': 'cached',
      },
    });
    await Future<void>.delayed(Duration.zero);
    expect(binding.value, 'cached');

    await processor.processMessagesAsync({
      'version': '1.0',
      'callRendererFunction': {
        'surfaceId': 'one',
        'functionCallId': 'c-cached',
        'callFunction': {
          '@call': 'whereAmI',
          'catalogId': 'alpha',
          'args': {
            'x': {'@call': 'remote', 'args': <String, Object?>{}},
          },
        },
      },
    });
    expect(sent.whereType<CallAgentFunctionMessage>(), hasLength(1));
    expect(responses().single.response.error!.code, 'EXECUTION_ERROR');
    expect(responses().single.response.error!.message, contains('remote'));
  });

  test('a disposed surface refuses agent calls itself', () async {
    final calls = <FunctionCall>[];
    final surface = SurfaceModel<ComponentApi>(
      'manual',
      protocolVersion: '1.0',
      callAgentFunction: (call) async {
        calls.add(call);
        return null;
      },
    );
    surface.dispose();
    await expectLater(
      surface.callAgentFunction!(FunctionCall(call: 'remote', args: {})),
      throwsA(isA<A2uiRpcError>()
          .having((e) => e.rpcCode, 'rpcCode', RpcErrorCode.cancelled)),
    );
    expect(calls, isEmpty);
  });

  test('a deleted surface no longer sends agent calls', () async {
    Map<String, Object?> create() => {
          'version': '1.0',
          'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
        };
    processor.processMessages(create());
    final AgentFunctionCaller caller =
        processor.model.getSurface('one')!.callAgentFunction!;
    processor.processMessages({
      'version': '1.0',
      'deleteSurface': {'surfaceId': 'one'},
    });
    // A new surface with the same id does not revive the old caller.
    processor.processMessages(create());

    await expectLater(
      caller(FunctionCall(call: 'remote', args: {})),
      throwsA(isA<A2uiRpcError>()
          .having((e) => e.rpcCode, 'rpcCode', RpcErrorCode.cancelled)),
    );
    expect(sent.whereType<CallAgentFunctionMessage>(), isEmpty);
    expect(processor.rpc.pendingCallCount, 0);
  });

  test('a surface created by the processor falls back to the agent', () async {
    processor.processMessages({
      'version': '1.0',
      'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
    });
    final SurfaceModel<ComponentApi> surface =
        processor.model.getSurface('one')!;
    final errors = <A2uiRendererError>[];
    surface.onError.subscribe(errors.add);
    final Future<Object?> result = surface.callAgentFunction!(
      FunctionCall(call: 'remote', args: {}),
    );
    final CallAgentFunctionMessage outbound =
        sent.whereType<CallAgentFunctionMessage>().single;
    expect(outbound.surfaceId, 'one');
    processor.processMessages({
      'version': '1.0',
      'agentFunctionResponse': {
        'functionCallId': outbound.functionCallId,
        'error': {'code': 'EXECUTION_ERROR', 'message': 'nope'},
      },
    });
    await expectLater(
      result,
      throwsA(isA<A2uiRpcError>().having(
        (e) => e.functionCallId,
        'functionCallId',
        outbound.functionCallId,
      )),
    );
  });

  test('a binding sends callAgentFunction naming the default catalog',
      () async {
    processor.processMessages({
      'version': '1.0',
      'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
    });
    final SurfaceModel<ComponentApi> surface =
        processor.model.getSurface('one')!;
    final DataContext context =
        ComponentContext(surface, ComponentModel('root', 'Text', {}))
            .dataContext;
    final ReadonlySignal<Object?> value = context.resolveSignal({
      '@call': 'remote',
      'args': {'a': 1},
    });
    expect(value.value, isNull);
    final CallAgentFunctionMessage outbound =
        sent.whereType<CallAgentFunctionMessage>().single;
    expect(outbound.callFunction, {
      '@call': 'remote',
      'catalogId': 'alpha',
      'args': {'a': 1},
    });
    processor.processMessages({
      'version': '1.0',
      'agentFunctionResponse': {
        'functionCallId': outbound.functionCallId,
        'value': 'ok',
      },
    });
    await Future<void>.delayed(Duration.zero);
    expect(value.value, 'ok');
  });

  test('a processor without an outbound listener installs no agent caller', () {
    final silent = MessageProcessor<ComponentApi>(
      catalogs: [_catalog('alpha')],
      defaultVersion: A2uiProtocolVersion.v1_0,
    );
    addTearDown(silent.dispose);
    silent.processMessages({
      'version': '1.0',
      'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
    });
    expect(silent.model.getSurface('one')!.callAgentFunction, isNull);
  });

  test('a pre-1.0 surface gets no agent caller', () {
    final v09 = MessageProcessor<ComponentApi>(
      catalogs: [
        Catalog<ComponentApi, FunctionImplementation>(
          id: 'old',
          protocolVersion: A2uiProtocolVersion.v0_9,
          components: [TestTextApi()],
        ),
      ],
      defaultVersion: A2uiProtocolVersion.v0_9,
      outboundListener: sent.add,
    );
    addTearDown(v09.dispose);
    v09.processMessages({
      'version': 'v0.9',
      'createSurface': {'surfaceId': 'old-surface', 'catalogId': 'old'},
    });
    expect(v09.model.getSurface('old-surface')!.callAgentFunction, isNull);
  });

  test('preserves null protocolVersion on an unversioned surface', () async {
    processor.model.addSurface(
      SurfaceModel<ComponentApi>(
        'unversioned-surface',
        defaultCatalog: _catalog('alpha'),
      ),
    );
    await processor.processMessagesAsync(
      _callRendererFunction(
        'c-unversioned',
        'versionOf',
        surfaceId: 'unversioned-surface',
        catalogId: 'alpha',
      ),
    );
    expect(responses().single.response.error, isNull);
    expect(responses().single.response.value, isNull);
  });
}

class _Gated extends FunctionImplementation {
  _Gated()
      : super(
          name: 'open',
          argumentSchema: Schema.object(),
          allowedCallers: AllowedCallers.rendererOrAgent,
          requiresUserActivation: true,
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      'opened';
}
