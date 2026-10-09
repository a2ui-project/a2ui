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
      components: [MinimalTextApi()],
      functions: [
        _Fn('whereAmI', (_, context) => context.dataModel.get('/name')),
        _Fn('slow', (_, __) async {
          await Future<void>.delayed(const Duration(milliseconds: 5));
          return 'late';
        }),
      ],
    );

Map<String, Object?> _callRendererFunction(
  String id,
  String name, {
  String? catalogId,
}) =>
    {
      'version': 'v1.0',
      'callRendererFunction': {
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
      commonTypesSchema: const {},
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

  test('processMessages does not throw and still emits', () async {
    processor.processMessages(
      _callRendererFunction('c2', 'missing', catalogId: 'alpha'),
    );
    await Future<void>.delayed(Duration.zero);
    expect(responses().single.response.error!.code, 'INVALID_FUNCTION_CALL');
  });

  test('callRendererFunction targets the surface holding the catalog',
      () async {
    processor.processMessages([
      {
        'version': 'v1.0',
        'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
      },
      {
        'version': 'v1.0',
        'createSurface': {'surfaceId': 'two', 'catalogId': 'beta'},
      },
    ]);
    processor.groupModel.getSurface('one')!.dataModel.set('/name', 'one');
    processor.groupModel.getSurface('two')!.dataModel.set('/name', 'two');
    await processor.processMessagesAsync(
      _callRendererFunction('c3', 'whereAmI', catalogId: 'beta'),
    );
    // Surface 'two' was created with defaultCatalog 'beta', so it is chosen.
    expect(responses().single.response.value, 'two');
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
      commonTypesSchema: const {},
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
      'version': 'v1.0',
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

  test('a surface created by the processor falls back to the agent', () async {
    processor.processMessages({
      'version': 'v1.0',
      'createSurface': {'surfaceId': 'one', 'catalogId': 'alpha'},
    });
    final SurfaceModel<ComponentApi> surface =
        processor.groupModel.getSurface('one')!;
    final errors = <A2uiClientError>[];
    surface.onError.addListener(errors.add);
    final Future<Object?> result = surface.callAgentFunction!(
      FunctionCall(call: 'remote', args: {}),
    );
    final CallAgentFunctionMessage outbound =
        sent.whereType<CallAgentFunctionMessage>().single;
    expect(outbound.surfaceId, 'one');
    processor.processMessages({
      'version': 'v1.0',
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
