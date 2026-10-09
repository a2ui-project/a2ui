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
import 'package:a2ui_core/src/core/contexts.dart';
import 'package:a2ui_core/src/rendering/binder.dart';
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;
import 'package:test/test.dart';

/// A catalog function whose behavior and metadata the test chooses.
class _Fn extends FunctionImplementation {
  _Fn(String name, this.body, {super.requiresUserActivation})
      : super(name: name, argumentSchema: Schema.object());

  final Object? Function(Map<String, dynamic> args) body;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      body(args);
}

/// One agent call the fake transport received, with its completer.
typedef _AgentCall = ({FunctionCall call, Completer<Object?> completer});

Catalog<ComponentApi, FunctionImplementation> _catalog({
  String? protocolVersion = 'v1.0',
}) =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: 'cat',
      protocolVersion: protocolVersion != null
          ? A2uiProtocolVersion.tryParseSemVer(protocolVersion)
          : null,
      components: [MinimalTextApi(), MinimalButtonApi(), MinimalTextFieldApi()],
      functions: [
        _Fn('upper', (args) => (args['value'] as String).toUpperCase()),
        _Fn('gated', (_) => 'opened', requiresUserActivation: true),
      ],
    );

Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  late List<_AgentCall> agentCalls;
  late List<A2uiClientError> clientErrors;

  Future<Object?> callAgent(FunctionCall call) {
    final completer = Completer<Object?>();
    agentCalls.add((call: call, completer: completer));
    return completer.future;
  }

  SurfaceModel<ComponentApi> makeSurface({
    String? protocolVersion = 'v1.0',
    bool withCaller = true,
  }) {
    final surface = SurfaceModel<ComponentApi>(
      'surf',
      defaultCatalog: _catalog(protocolVersion: protocolVersion),
      protocolVersion: protocolVersion,
      callAgentFunction: withCaller ? callAgent : null,
    );
    surface.onError.addListener(clientErrors.add);
    addTearDown(surface.dispose);
    return surface;
  }

  setUp(() {
    agentCalls = [];
    clientErrors = [];
  });

  group('DataContext agent fallback', () {
    test('dispatches an unknown function to the agent and updates', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      surface.dataModel.set('/sku', 'A1');
      final component = ComponentModel('root', 'Text', {});
      final DataContext context =
          ComponentContext(surface, component).dataContext;

      final ReadonlySignal<Object?> value = context.resolveListenable({
        '@call': 'queryInventory',
        'args': {
          'sku': {'@path': '/sku'},
        },
      });
      expect(value.value, isNull);
      expect(agentCalls, hasLength(1));
      expect(agentCalls.single.call.call, 'queryInventory');
      expect(agentCalls.single.call.args, {'sku': 'A1'});
      expect(
          context.isPendingAgentCall({
            '@call': 'queryInventory',
            'args': {'sku': 'A1'}
          }),
          isTrue);

      agentCalls.single.completer.complete({'inStock': 3});
      await _flush();
      expect(value.value, {'inStock': 3});
      expect(
          context.isPendingAgentCall({
            '@call': 'queryInventory',
            'args': {'sku': 'A1'}
          }),
          isFalse);
      expect(clientErrors, isEmpty);
    });

    test('reuses an in-flight call for the same arguments', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final Map<String, Object?> call = {
        '@call': 'lookup',
        'args': {'id': 1, 'tag': 'a'},
      };
      final Map<String, Object?> reorderedCall = {
        '@call': 'lookup',
        'args': {'tag': 'a', 'id': 1},
      };
      expect(context.resolveSync(call), isNull);
      expect(context.resolveSync(call), isNull);
      expect(context.resolveSync(reorderedCall), isNull);
      expect(context.isPendingAgentCall(reorderedCall), isTrue);
      expect(context.nested('/x').resolveSync(call), isNull);
      final childComp = ComponentModel('child', 'Text', {});
      surface.componentsModel.addComponent(childComp);
      expect(
        ComponentContext(surface, childComp).dataContext.resolveSync(call),
        isNull,
      );
      expect(
        ComponentContext(surface, ComponentModel('root', 'Text', {}))
            .childContext('child')
            .dataContext
            .resolveSync(call),
        isNull,
      );
      expect(agentCalls, hasLength(1));

      expect(
        context.resolveSync({
          '@call': 'lookup',
          'args': {'id': 2},
        }),
        isNull,
      );
      expect(agentCalls, hasLength(2));
      expect(agentCalls.last.call.args, {'id': 2});
    });

    test('reports an agent failure through onError with the call id', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final ReadonlySignal<Object?> value = context.resolveListenable({
        '@call': 'lookup',
        'args': <String, Object?>{},
      });
      // A computed evaluates on first read, which is what sends the call.
      expect(value.value, isNull);
      agentCalls.single.completer.completeError(
        A2uiRpcError('agent said no', RpcErrorCode.executionError,
            functionCallId: 'fc-9'),
      );
      await _flush();
      expect(value.value, isNull);
      expect(clientErrors, hasLength(1));
      expect(clientErrors.single.code, 'EXECUTION_ERROR');
      expect(clientErrors.single.surfaceId, isNull);
      expect(clientErrors.single.functionCallId, 'fc-9');
      expect(clientErrors.single.message, contains('agent said no'));
      final Map<String, dynamic> wire =
          ErrorMessage(version: 'v1.0', error: clientErrors.single).toJson();
      expect(RendererToAgentMessage.fromJson(wire), isA<ErrorMessage>());

      // A failed call is evicted so a later retry invokes the agent again.
      expect(
        context.resolveSync({'@call': 'lookup', 'args': <String, Object?>{}}),
        isNull,
      );
      expect(agentCalls, hasLength(2));
      agentCalls.last.completer.complete('recovered');
      await _flush();
      expect(
        context.resolveSync({'@call': 'lookup', 'args': <String, Object?>{}}),
        'recovered',
      );
    });

    test(
        'nested agent call failure while outer call is pending does not '
        'retry in a loop', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final ReadonlySignal<DynamicValueState> state =
          context.resolveListenableWithPending({
        '@call': 'outer',
        'args': {
          'x': {'@call': 'inner', 'args': <String, Object?>{}},
        },
      });
      expect(state.value.pending, isTrue);
      expect(agentCalls.map((c) => c.call.call).toList(), ['inner', 'outer']);
      agentCalls.first.completer.completeError(
        A2uiRpcError(
          'inner failed',
          RpcErrorCode.executionError,
          functionCallId: 'fc-inner',
        ),
      );
      await _flush();
      expect(state.value.pending, isTrue);
      expect(
        agentCalls.map((c) => c.call.call).toList(),
        ['inner', 'outer'],
        reason: 'isPendingAgentCall must not re-dispatch failed inner call',
      );
      expect(clientErrors, hasLength(1));
    });

    test('NodeResolver reports agent RPC failure with EXECUTION_ERROR and id',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final resolver = NodeResolver<ComponentApi>(surface);
      addTearDown(resolver.dispose);
      surface.componentsModel.addComponent(
        ComponentModel('root', 'Text', {
          'text': {'@call': 'lookup', 'args': <String, Object?>{}},
        }),
      );
      expect(resolver.rootNode.value, isNotNull);
      expect(agentCalls, hasLength(1));
      agentCalls.single.completer.completeError(
        A2uiRpcError(
          'node rpc fail',
          RpcErrorCode.executionError,
          functionCallId: 'fc-node',
        ),
      );
      await _flush();
      expect(clientErrors, hasLength(1));
      expect(clientErrors.single.code, 'EXECUTION_ERROR');
      expect(clientErrors.single.surfaceId, isNull);
      expect(clientErrors.single.functionCallId, 'fc-node');
      expect(clientErrors.single.message, contains('node rpc fail'));
    });

    test('a custom reporter receives the rpc error as cause', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final errors = <A2uiExpressionError>[];
      final DataContext context = ComponentContext(
        surface,
        ComponentModel('root', 'Text', {}),
        onError: errors.add,
      ).dataContext;
      context.resolveSync({'@call': 'lookup', 'args': <String, Object?>{}});
      final rpcError = A2uiRpcError('timed out', RpcErrorCode.timeout,
          functionCallId: 'fc-1');
      agentCalls.single.completer.completeError(rpcError);
      await _flush();
      expect(errors, hasLength(1));
      expect(errors.single.cause, same(rpcError));
      expect(errors.single.expression, 'lookup');
      expect(clientErrors, isEmpty);
    });

    test('a v0.9 surface still reports EXPRESSION_ERROR and never calls', () {
      final SurfaceModel<ComponentApi> surface =
          makeSurface(protocolVersion: 'v0.9');
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveSync({'call': 'lookup', 'args': <String, Object?>{}}),
        isNull,
      );
      expect(agentCalls, isEmpty);
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
    });

    test('a v1.0 surface without a caller reports EXPRESSION_ERROR', () {
      final SurfaceModel<ComponentApi> surface = makeSurface(withCaller: false);
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveSync({'@call': 'lookup', 'args': <String, Object?>{}}),
        isNull,
      );
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(clientErrors.single.message, contains('Function not found'));
    });

    test('argument and execution failures are not sent to the agent', () {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveSync({
          '@call': 'upper',
          'args': {'value': 1}
        }),
        isNull,
      );
      expect(agentCalls, isEmpty);
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
    });

    test('an unknown catalogId falls back to the agent', () {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      context.resolveSync({
        '@call': 'remote',
        'catalogId': 'elsewhere',
        'args': <String, Object?>{},
      });
      expect(agentCalls.single.call.catalogId, 'elsewhere');
    });

    test('user activation gates a local function', () {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(context.isUserActivated, isFalse);
      expect(
        context.resolveSync({'@call': 'gated', 'args': <String, Object?>{}}),
        isNull,
      );
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(
        clientErrors.single.message,
        "Function 'gated' requires user activation context to execute.",
      );
      expect(agentCalls, isEmpty);

      final DataContext activated = context.withUserActivation();
      expect(activated.isUserActivated, isTrue);
      expect(activated.path, context.path);
      expect(
        activated.resolveSync({'@call': 'gated', 'args': <String, Object?>{}}),
        'opened',
      );
    });

    test('evaluateFunctionCall runs locally or awaits the agent', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        await context.evaluateFunctionCall({
          '@call': 'upper',
          'args': {'value': 'a'},
        }),
        'A',
      );
      final Future<Object?> pending = context.evaluateFunctionCall({
        '@call': 'remote',
        'args': {'n': 1},
      });
      expect(agentCalls.single.call.args, {'n': 1});
      agentCalls.single.completer.complete('done');
      expect(await pending, 'done');

      final Future<Object?> failing = context.evaluateFunctionCall({
        '@call': 'remote',
        'args': {'n': 2},
      });
      agentCalls.last.completer.completeError(
        A2uiRpcError('no', RpcErrorCode.timeout, functionCallId: 'x'),
      );
      await expectLater(failing, throwsA(isA<A2uiRpcError>()));

      final syncThrowSurface = SurfaceModel<ComponentApi>(
        'surf-sync-throw',
        defaultCatalog: _catalog(),
        protocolVersion: 'v1.0',
        callAgentFunction: (_) =>
            throw A2uiRpcError('sync fail', RpcErrorCode.noListener),
      );
      addTearDown(syncThrowSurface.dispose);
      final DataContext syncThrowContext = ComponentContext(
        syncThrowSurface,
        ComponentModel('root', 'Text', {}),
      ).dataContext;
      await expectLater(
        syncThrowContext.evaluateFunctionCall({
          '@call': 'remote',
          'args': <String, Object?>{},
        }),
        throwsA(isA<A2uiRpcError>()),
      );
    });
  });

  group('GenericBinder with pending agent calls', () {
    late SurfaceModel<ComponentApi> surface;

    setUp(() {
      surface = makeSurface();
    });

    GenericBinder bindChecks(Map<String, dynamic> props) {
      final comp = ComponentModel('c1', 'TextField', props);
      surface.componentsModel.addComponent(comp);
      final binder = GenericBinder(
          ComponentContext(surface, comp), MinimalTextFieldApi().schema);
      addTearDown(binder.dispose);
      return binder;
    }

    test('a pending rule is omitted and marks validationPending', () async {
      surface.dataModel.set('/ok', true);
      final GenericBinder binder = bindChecks({
        'label': 'Name',
        'checks': [
          {
            'condition': {'@path': '/ok'},
            'message': 'Local rule',
          },
          {
            'condition': {
              '@call': 'remoteCheck',
              'args': {'v': 1},
            },
            'message': 'Remote rule',
          },
        ],
      });
      Map<String, dynamic> props() => binder.resolvedProps.value;
      expect(props()['validationPending'], isTrue);
      expect(props()['isValid'], isTrue);
      expect(props()['validationErrors'], isEmpty);
      expect(props()['validationResults'], isEmpty);

      agentCalls.single.completer.complete(false);
      await _flush();
      expect(props()['validationPending'], isFalse);
      expect(props()['isValid'], isFalse);
      expect(props()['validationErrors'], ['Remote rule']);

      surface.dataModel.set('/ok', false);
      expect(props()['validationErrors'], ['Local rule', 'Remote rule']);
    });

    test('a pending rule that passes clears without errors', () async {
      final GenericBinder binder = bindChecks({
        'label': 'Name',
        'checks': [
          {
            'condition': {'@call': 'remoteCheck', 'args': <String, Object?>{}},
            'message': 'Remote rule',
          },
        ],
      });
      expect(binder.resolvedProps.value['validationPending'], isTrue);
      agentCalls.single.completer.complete(true);
      await _flush();
      expect(binder.resolvedProps.value['validationPending'], isFalse);
      expect(binder.resolvedProps.value['isValid'], isTrue);
      expect(binder.resolvedProps.value['validationErrors'], isEmpty);
    });

    test('an agent error makes the rule invalid with its message', () async {
      final GenericBinder binder = bindChecks({
        'label': 'Name',
        'checks': [
          {
            'condition': {'@call': 'remoteCheck', 'args': <String, Object?>{}},
            'message': 'Remote rule',
          },
        ],
      });
      agentCalls.single.completer.completeError(
        A2uiRpcError('down', RpcErrorCode.timeout, functionCallId: 'fc-2'),
      );
      await _flush();
      expect(binder.resolvedProps.value['validationPending'], isFalse);
      expect(binder.resolvedProps.value['isValid'], isFalse);
      expect(binder.resolvedProps.value['validationErrors'], ['Remote rule']);
      expect(clientErrors.single.code, 'EXECUTION_ERROR');
      expect(clientErrors.single.functionCallId, 'fc-2');
    });

    test('a local-only check reports validationPending false', () {
      surface.dataModel.set('/ok', false);
      final GenericBinder binder = bindChecks({
        'label': 'Name',
        'checks': [
          {
            'condition': {'@path': '/ok'},
            'message': 'Local rule',
          },
        ],
      });
      expect(binder.resolvedProps.value['validationPending'], isFalse);
      expect(binder.resolvedProps.value['isValid'], isFalse);
    });

    Future<void> invokeAction(Map<String, dynamic> action) async {
      final comp = ComponentModel('b1', 'Button', {
        'child': 'c2',
        'action': action,
      });
      surface.componentsModel.addComponent(comp);
      final binder = GenericBinder(
          ComponentContext(surface, comp), MinimalButtonApi().schema);
      addTearDown(binder.dispose);
      final callback =
          binder.resolvedProps.value['action'] as Future<void> Function();
      await callback();
    }

    test('a functionCall action awaits the agent result', () async {
      final Future<void> done = invokeAction({
        'functionCall': {
          '@call': 'remoteAction',
          'args': {'k': 'v'},
        },
      });
      await _flush();
      expect(agentCalls.single.call.args, {'k': 'v'});
      var finished = false;
      unawaited(done.then((_) => finished = true));
      await _flush();
      expect(finished, isFalse);
      agentCalls.single.completer.complete(null);
      await done;
      expect(clientErrors, isEmpty);
    });

    test('an agent failure dispatches EXECUTION_ERROR with the call id',
        () async {
      final Future<void> done = invokeAction({
        'functionCall': {'@call': 'remoteAction', 'args': <String, Object?>{}},
      });
      await _flush();
      agentCalls.single.completer.completeError(
        A2uiRpcError('refused', RpcErrorCode.executionError,
            functionCallId: 'fc-7'),
      );
      await done;
      expect(clientErrors, hasLength(1));
      expect(clientErrors.single.code, 'EXECUTION_ERROR');
      expect(clientErrors.single.functionCallId, 'fc-7');
      expect(clientErrors.single.surfaceId, isNull);
      expect(clientErrors.single.message, contains('refused'));
      final Map<String, dynamic> wire =
          ErrorMessage(version: 'v1.0', error: clientErrors.single).toJson();
      expect(RendererToAgentMessage.fromJson(wire), isA<ErrorMessage>());
    });

    test('a functionCall action runs with user activation', () async {
      await invokeAction({
        'functionCall': {'@call': 'gated', 'args': <String, Object?>{}},
      });
      expect(clientErrors, isEmpty);
      expect(agentCalls, isEmpty);
    });
  });
}
