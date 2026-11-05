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
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;
import 'package:test/test.dart';

import 'support/test_catalog.dart';

/// A catalog function whose behavior and metadata the test chooses.
class _Fn extends FunctionImplementation {
  _Fn(
    String name,
    this.body, {
    super.requiresUserActivation,
    super.allowedCallers,
    Schema? argumentSchema,
  }) : super(name: name, argumentSchema: argumentSchema ?? Schema.object());

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

/// Read by the `live` catalog function, which returns it.
final Signal<Object?> _live = signal<Object?>('a');

/// How many times the `count` catalog function ran.
int _countRuns = 0;

Catalog<ComponentApi, FunctionImplementation> _catalog({
  String? protocolVersion = '1.0',
}) =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: 'cat',
      protocolVersion: protocolVersion != null
          ? A2uiProtocolVersion.tryParseSemVer(protocolVersion)
          : null,
      components: [TestTextApi(), TestButtonApi(), TestTextFieldApi()],
      functions: [
        _Fn('upper', (args) => (args['value'] as String).toUpperCase()),
        _Fn('gated', (_) => 'opened', requiresUserActivation: true),
        _Fn('nan', (_) => double.nan),
        _Fn('count', (args) => ++_countRuns),
        _Fn('boom', (_) => throw StateError('boom failed')),
        _Fn(
          'typed',
          (args) => args['n'],
          argumentSchema: Schema.object(
            properties: {'n': Schema.integer()},
            required: ['n'],
          ),
        ),
        _Fn('live', (_) => _live),
        _Fn(
          'agentSide',
          (_) => 'ran',
          allowedCallers: AllowedCallers.agentOnly,
        ),
      ],
    );

Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  late List<_AgentCall> agentCalls;
  late List<A2uiRendererError> clientErrors;

  Future<Object?> callAgent(FunctionCall call) {
    final completer = Completer<Object?>();
    agentCalls.add((call: call, completer: completer));
    return completer.future;
  }

  SurfaceModel<ComponentApi> makeSurface({
    String? protocolVersion = '1.0',
    bool withCaller = true,
  }) {
    final surface = SurfaceModel<ComponentApi>(
      'surf',
      defaultCatalog: _catalog(protocolVersion: protocolVersion),
      protocolVersion: protocolVersion,
      callAgentFunction: withCaller ? callAgent : null,
    );
    surface.onError.subscribe(clientErrors.add);
    addTearDown(surface.dispose);
    return surface;
  }

  /// Mounts a binding of [value] on [context], as a rendered component
  /// does, and returns its current value.
  Object? mount(DataContext context, Object? value) {
    final ReadonlySignal<Object?> binding = context.resolveSignal(value);
    addTearDown(binding.subscribe((_) {}));
    return binding.value;
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

      final ReadonlySignal<Object?> value = context.resolveSignal({
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
      expect(mount(context, call), isNull);
      expect(mount(context, call), isNull);
      expect(mount(context, reorderedCall), isNull);
      expect(context.isPendingAgentCall(reorderedCall), isTrue);
      expect(mount(context.nested('/x'), call), isNull);
      final childComp = ComponentModel('child', 'Text', {});
      surface.componentsModel.addComponent(childComp);
      expect(
        mount(ComponentContext(surface, childComp).dataContext, call),
        isNull,
      );
      expect(
        mount(
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .childContext('child')
              .dataContext,
          call,
        ),
        isNull,
      );
      expect(agentCalls, hasLength(1));

      expect(
        mount(context, {
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
      final ReadonlySignal<Object?> value = context.resolveSignal({
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
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(clientErrors.single.surfaceId, isNull);
      expect(clientErrors.single.functionCallId, 'fc-9');
      expect(clientErrors.single.message, contains('agent said no'));
      final Map<String, dynamic> wire =
          ErrorMessage(version: '1.0', error: clientErrors.single).toJson();
      expect(RendererToAgentMessage.fromJson(wire), isA<ErrorMessage>());

      // A failed call is evicted so a later retry invokes the agent again.
      expect(
        mount(
          context,
          {'@call': 'lookup', 'args': <String, Object?>{}},
        ),
        isNull,
      );
      expect(agentCalls, hasLength(2));
      agentCalls.last.completer.complete('recovered');
      await _flush();
      expect(
        context.resolveDynamicValue(
          {'@call': 'lookup', 'args': <String, Object?>{}},
        ),
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
          context.resolveSignalWithPending({
        '@call': 'outer',
        'args': {
          'x': {'@call': 'inner', 'args': <String, Object?>{}},
        },
      });
      expect(state.value.pending, isTrue);
      expect(
        agentCalls.map((c) => c.call.call).toList(),
        ['inner'],
        reason: 'the outer call waits for its pending argument',
      );
      agentCalls.first.completer.completeError(
        A2uiRpcError(
          'inner failed',
          RpcErrorCode.executionError,
          functionCallId: 'fc-inner',
        ),
      );
      await _flush();
      expect(state.value.pending, isFalse);
      expect(state.value.value, isNull);
      expect(
        agentCalls.map((c) => c.call.call).toList(),
        ['inner'],
        reason: 'neither the failed inner call nor the outer call is sent',
      );
      expect(clientErrors, hasLength(1));
    });

    test(
        'synchronous failure of a nested argument stops the enclosing call '
        'from running or calling the agent', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final errors = <A2uiExpressionError>[];
      final DataContext context = ComponentContext(
        surface,
        ComponentModel('root', 'Text', {}),
        onError: errors.add,
      ).dataContext;
      expect(
        context.resolveDynamicValue({
          '@call': 'outer',
          'args': {
            'x': {
              '@call': 'upper',
              'args': {'value': 1},
            },
          },
        }),
        isNull,
      );
      final ReadonlySignal<Object?> sig = context.resolveSignal({
        '@call': 'upper',
        'args': {
          'value': {'@call': 'gated', 'args': <String, Object?>{}},
        },
      });
      expect(sig.value, isNull);
      expect(
        await context.evaluateFunctionCall({
          '@call': 'outer',
          'args': {
            'x': {
              '@call': 'upper',
              'args': {'value': 1},
            },
          },
        }),
        isNull,
      );
      expect(agentCalls, isEmpty);
      await _flush();
      expect(errors, hasLength(3));
      expect(errors.map((e) => e.expression).toList(), [
        'upper',
        'gated',
        'upper',
      ]);
    });

    test('a local function waits for a pending agent argument', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final ReadonlySignal<Object?> value = context.resolveSignal({
        '@call': 'upper',
        'args': {
          'value': {'@call': 'fetchGreeting', 'args': <String, Object?>{}},
        },
      });
      expect(value.value, isNull);
      expect(agentCalls.single.call.call, 'fetchGreeting');
      await _flush();
      expect(clientErrors, isEmpty,
          reason: 'upper does not run with a null argument');

      agentCalls.single.completer.complete('hello');
      await _flush();
      expect(value.value, 'HELLO');
      expect(clientErrors, isEmpty);
    });

    test('an outer agent call is sent once its agent argument settles',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final ReadonlySignal<Object?> value = context.resolveSignal({
        '@call': 'convert',
        'args': {
          'rate': {
            '@call': 'fetchFxRate',
            'args': {'base': 'EUR'},
          },
        },
      });
      expect(value.value, isNull);
      expect(agentCalls.map((c) => c.call.call).toList(), ['fetchFxRate']);

      agentCalls.first.completer.complete(1.08);
      await _flush();
      expect(value.value, isNull);
      expect(agentCalls.map((c) => c.call.call).toList(),
          ['fetchFxRate', 'convert']);
      expect(agentCalls.last.call.args, {'rate': 1.08});

      agentCalls.last.completer.complete('converted');
      await _flush();
      expect(value.value, 'converted');
      expect(clientErrors, isEmpty);
    });

    test('NodeResolver reports agent RPC failure with EXPRESSION_ERROR and id',
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
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(clientErrors.single.surfaceId, isNull);
      expect(clientErrors.single.functionCallId, 'fc-node');
      expect(clientErrors.single.message, contains('node rpc fail'));
    });

    test(
        'a failing agent call does not re-send itself when another agent call '
        'exists on the surface', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final ReadonlySignal<Object?> other = context.resolveSignal({
        '@call': 'otherRemote',
        'args': <String, Object?>{},
      });
      final void Function() unsubOther = other.subscribe((_) {});
      addTearDown(unsubOther);

      final ReadonlySignal<Object?> sig = context.resolveSignal({
        '@call': 'flaky',
        'args': <String, Object?>{},
      });
      final void Function() unsub = sig.subscribe((_) {});
      addTearDown(unsub);

      final _AgentCall firstFlaky =
          agentCalls.lastWhere((c) => c.call.call == 'flaky');
      firstFlaky.completer.completeError(
        A2uiRpcError('boom', RpcErrorCode.executionError,
            functionCallId: 'fc1'),
      );
      await _flush();
      expect(
        agentCalls.where((c) => c.call.call == 'flaky'),
        hasLength(1),
        reason: 'a failure must not trigger an automatic resend loop',
      );
      expect(clientErrors, hasLength(1));
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');

      // Completing the other pending call on the surface must not cause the
      // still-mounted failed signal to re-send flaky().
      final _AgentCall firstOther =
          agentCalls.lastWhere((c) => c.call.call == 'otherRemote');
      firstOther.completer.complete('ok');
      await _flush();
      expect(
        agentCalls.where((c) => c.call.call == 'flaky'),
        hasLength(1),
        reason: 'settling another call on the surface must not re-send flaky',
      );
    });

    test('an action whose argument is an agent call awaits it and runs',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final Future<Object?> result = context.evaluateFunctionCall({
        '@call': 'upper',
        'args': {
          'value': {'@call': 'fetchGreeting', 'args': <String, Object?>{}},
        },
      });
      expect(agentCalls.map((c) => c.call.call).toList(), ['fetchGreeting']);
      agentCalls.single.completer.complete('hello');
      expect(await result, 'HELLO');
      expect(clientErrors, isEmpty);

      // If a nested agent argument fails, the outer action call does not run
      // and reports the inner failure once.
      final Future<Object?> failedResult = context.evaluateFunctionCall({
        '@call': 'upper',
        'args': {
          'value': {'@call': 'fetchGreeting', 'args': <String, Object?>{}},
        },
      });
      expect(agentCalls, hasLength(2));
      agentCalls.last.completer.completeError(
        A2uiRpcError('inner boom', RpcErrorCode.executionError,
            functionCallId: 'fc-act'),
      );
      expect(await failedResult, isNull);
      await _flush();
      expect(clientErrors, hasLength(1));
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(clientErrors.single.functionCallId, 'fc-act');
    });

    test('a custom reporter receives the rpc error as cause', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final errors = <A2uiExpressionError>[];
      final DataContext context = ComponentContext(
        surface,
        ComponentModel('root', 'Text', {}),
        onError: errors.add,
      ).dataContext;
      mount(
        context,
        {'@call': 'lookup', 'args': <String, Object?>{}},
      );
      final rpcError = A2uiRpcError('timed out', RpcErrorCode.timeout,
          functionCallId: 'fc-1');
      agentCalls.single.completer.completeError(rpcError);
      await _flush();
      expect(errors, hasLength(1));
      expect(errors.single.cause, same(rpcError));
      expect(errors.single.expression, 'lookup');
      expect(clientErrors, isEmpty);
    });

    test('a v0.9 surface still reports EXPRESSION_ERROR and never calls',
        () async {
      final SurfaceModel<ComponentApi> surface =
          makeSurface(protocolVersion: 'v0.9');
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveDynamicValue(
          {'call': 'lookup', 'args': <String, Object?>{}},
        ),
        isNull,
      );
      expect(agentCalls, isEmpty);
      await _flush();
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
    });

    test('a v1.0 surface without a caller reports EXPRESSION_ERROR', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface(withCaller: false);
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveDynamicValue(
          {'@call': 'lookup', 'args': <String, Object?>{}},
        ),
        isNull,
      );
      await _flush();
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(clientErrors.single.message, contains('Function not found'));
    });

    test('argument and execution failures are not sent to the agent', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveDynamicValue({
          '@call': 'upper',
          'args': {'value': 1}
        }),
        isNull,
      );
      expect(agentCalls, isEmpty);
      await _flush();
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
    });

    test('an unknown catalogId is a CATALOG_ERROR and is not sent', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveDynamicValue({
          '@call': 'remote',
          'catalogId': 'elsewhere',
          'args': <String, Object?>{},
        }),
        isNull,
      );
      expect(agentCalls, isEmpty);
      await _flush();
      expect(clientErrors.single.code, 'CATALOG_ERROR');
    });

    test(
        'a catalogId on a DataContext without invokerForCatalog is a '
        'CATALOG_ERROR and is not sent', () {
      final errors = <A2uiExpressionError>[];
      final context = DataContext(
        DataModel(),
        _catalog().invoke,
        '/',
        onError: errors.add,
        protocolVersion: A2uiProtocolVersion.v1_0,
        callAgentFunction: callAgent,
      );
      expect(
        context.resolveDynamicValue({
          '@call': 'remote',
          'catalogId': 'elsewhere',
          'args': <String, Object?>{},
        }),
        isNull,
      );
      expect(agentCalls, isEmpty);
      expect(errors.single.code, 'CATALOG_ERROR');
    });

    test('a surface without a default catalog does not send the call',
        () async {
      final surface = SurfaceModel<ComponentApi>(
        'no-default',
        protocolVersion: '1.0',
        availableCatalogs: [_catalog()],
        callAgentFunction: callAgent,
      );
      surface.onError.subscribe(clientErrors.add);
      addTearDown(surface.dispose);
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveDynamicValue(
          {'@call': 'remote', 'args': <String, Object?>{}},
        ),
        isNull,
      );
      expect(agentCalls, isEmpty);
      await _flush();
      expect(clientErrors.single.code, 'CATALOG_ERROR');

      await expectLater(
        context.evaluateFunctionCall(
          {'@call': 'remote', 'args': <String, Object?>{}},
        ),
        completion(isNull),
      );
      expect(agentCalls, isEmpty);
    });

    test('a call missing from a named catalog is sent naming it', () {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      mount(context, {
        '@call': 'remote',
        'catalogId': 'cat',
        'args': <String, Object?>{},
      });
      expect(agentCalls.single.call.catalogId, 'cat');
    });

    test('a call relying on the default catalog is sent naming it', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      mount(
        context,
        {'@call': 'remote', 'args': <String, Object?>{}},
      );
      expect(agentCalls.single.call.catalogId, 'cat');
      expect(agentCalls.single.call.toJson(), {
        '@call': 'remote',
        'catalogId': 'cat',
        'args': <String, Object?>{},
      });

      final Future<Object?> action = context.evaluateFunctionCall(
        {'@call': 'remoteAction', 'args': <String, Object?>{}},
      );
      expect(agentCalls.last.call.catalogId, 'cat');
      agentCalls.last.completer.complete('done');
      expect(await action, 'done');
    });

    test('calls with and without the default catalogId share one request',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final Map<String, Object?> implicit = {
        '@call': 'lookup',
        'args': {'id': 1},
      };
      final Map<String, Object?> explicit = {
        '@call': 'lookup',
        'catalogId': 'cat',
        'args': {'id': 1},
      };
      expect(mount(context, implicit), isNull);
      expect(mount(context, explicit), isNull);
      expect(agentCalls, hasLength(1));
      expect(context.isPendingAgentCall(implicit), isTrue);
      expect(context.isPendingAgentCall(explicit), isTrue);

      agentCalls.single.completer.complete('hit');
      await _flush();
      expect(context.resolveDynamicValue(implicit), 'hit');
      expect(context.resolveDynamicValue(explicit), 'hit');
      expect(context.isPendingAgentCall(implicit), isFalse);
      expect(agentCalls, hasLength(1));
    });

    test('a pending call stays shared when settled calls fill the cache',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final Map<String, Object?> pending = {
        '@call': 'lookup',
        'args': {'id': 'pending'},
      };
      expect(mount(context, pending), isNull);

      // Fill the cache past its limit with calls that are answered.
      for (var i = 0; i < 300; i++) {
        mount(context, {
          '@call': 'lookup',
          'args': {'id': i},
        });
        agentCalls.last.completer.complete(i);
        await _flush();
      }

      expect(context.isPendingAgentCall(pending), isTrue);
      agentCalls.first.completer.complete('done');
      await _flush();
      expect(context.isPendingAgentCall(pending), isFalse);
      expect(context.resolveDynamicValue(pending), 'done');
    });

    test('a reserved system function is never sent', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveDynamicValue(
          {'@call': '@unknownSystem', 'args': <String, Object?>{}},
        ),
        isNull,
      );
      expect(agentCalls, isEmpty);
      await _flush();
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
    });

    test('user activation gates a local function', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(context.isUserActivated, isFalse);
      expect(
        context.resolveDynamicValue(
          {'@call': 'gated', 'args': <String, Object?>{}},
        ),
        isNull,
      );
      await _flush();
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
        activated.resolveDynamicValue(
          {'@call': 'gated', 'args': <String, Object?>{}},
        ),
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
        protocolVersion: '1.0',
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

    test('a listener that re-reads a failed call as it settles re-sends it',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final Map<String, Object?> call = {
        '@call': 'flaky',
        'args': <String, Object?>{},
      };
      final void Function() unsub =
          context.resolveSignalWithPending(call).subscribe((state) {
        if (!state.pending && agentCalls.length == 1) {
          mount(context, call);
        }
      });
      addTearDown(unsub);
      expect(agentCalls, hasLength(1));

      agentCalls.single.completer.completeError(
        A2uiRpcError('boom', RpcErrorCode.executionError),
      );
      await _flush();
      expect(agentCalls, hasLength(2));
    });

    test('a cancelled agent call is not reported', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final errors = <A2uiExpressionError>[];
      final DataContext context = ComponentContext(
        surface,
        ComponentModel('root', 'Text', {}),
        onError: errors.add,
      ).dataContext;
      mount(
        context,
        {'@call': 'lookup', 'args': <String, Object?>{}},
      );
      final action = context.withUserActivation().resolveActionAsync({
        'event': {
          'name': 'go',
          'context': {
            'v': {'@call': 'mint', 'args': <String, Object?>{}},
          },
        },
      }) as Future<Object?>;
      expect(agentCalls, hasLength(2));
      for (final agentCall in agentCalls) {
        agentCall.completer.completeError(
          A2uiRpcError('gone', RpcErrorCode.cancelled),
        );
      }
      expect(await action, isNull);
      await _flush();
      expect(errors, isEmpty);
      expect(clientErrors, isEmpty);
    });

    test('a failed pre-1.0 action argument resolves to null', () async {
      final SurfaceModel<ComponentApi> surface =
          makeSurface(protocolVersion: 'v0.9');
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final FutureOr<Map<String, dynamic>?> pending =
          context.resolveActionAsync({
        'event': {
          'name': 'go',
          'context': {
            'bad': {
              'call': 'upper',
              'args': {'value': 1},
            },
            'nested': {
              'value': {
                'call': 'upper',
                'args': {
                  'value': {
                    'call': 'upper',
                    'args': {'value': 1},
                  },
                },
              },
            },
          },
        },
      });
      final Map<String, dynamic>? resolved = await pending;
      expect(resolved, isNotNull);
      final Object? ctx = (resolved!['event'] as Map)['context'];
      expect(ctx, {
        'bad': null,
        'nested': {'value': null},
      });
      expect(() => jsonEncode(resolved), returnsNormally);
      expect(agentCalls, isEmpty);
    });

    test('action context values resolve in order and stop at a failure',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      var failures = 0;
      final FutureOr<Map<String, dynamic>?> pending =
          context.resolveActionAsync(
        {
          'event': {
            'name': 'go',
            'context': {
              'first': {'@call': 'one', 'args': <String, Object?>{}},
              'second': {'@call': 'two', 'args': <String, Object?>{}},
            },
            'userMessage': {'@call': 'three', 'args': <String, Object?>{}},
          },
        },
        onExpressionFailed: () => failures++,
      );
      expect(pending, isA<Future<Object?>>());
      expect(agentCalls.map((c) => c.call.call), ['one']);

      agentCalls.single.completer.completeError(
        A2uiRpcError('no', RpcErrorCode.executionError),
      );
      expect(await pending, isNull);
      expect(failures, 1);
      expect(agentCalls.map((c) => c.call.call), ['one']);
      await _flush();
      expect(clientErrors, hasLength(1));
    });

    test(
        'an invalid userMessage after an agent context value surfaces the '
        'agent error instead of leaving it unhandled', () async {
      final context = DataContext(
        DataModel(),
        _catalog().invoke,
        '/',
        protocolVersion: A2uiProtocolVersion.v1_0,
        callAgentFunction: callAgent,
      );
      final Object? pending = context.resolveActionAsync({
        'event': {
          'name': 'go',
          'context': {
            'v': {'@call': 'remote', 'args': <String, Object?>{}},
          },
          'userMessage': 5,
        },
      });
      expect(pending, isA<Future<Object?>>());
      agentCalls.single.completer.completeError(
        A2uiRpcError('down', RpcErrorCode.timeout),
      );
      await expectLater(pending, throwsA(isA<A2uiRpcError>()));
    });

    test('a call whose arguments are not valid JSON fails without sending',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final Map<String, Object?> call = {
        '@call': 'remote',
        'args': {
          'v': {'@call': 'nan', 'args': <String, Object?>{}},
        },
      };
      final ReadonlySignal<Object?> value = context.resolveSignal(call);
      final void Function() unsub = value.subscribe((_) {});
      addTearDown(unsub);
      expect(value.value, isNull);
      await expectLater(context.evaluateFunctionCall(call), completion(isNull));
      expect(context.isPendingAgentCall(call), isFalse);
      expect(agentCalls, isEmpty);
      await _flush();
      expect(clientErrors, hasLength(2));
      expect(clientErrors.map((e) => e.code), everyElement('EXPRESSION_ERROR'));
      expect(
        clientErrors.map((e) => e.message),
        everyElement(contains("Arguments to 'remote' are not valid JSON")),
      );

      // A null argument, such as a binding to a missing path, is valid JSON.
      mount(context, {
        '@call': 'remote',
        'args': {
          'v': {'@path': '/missing'},
        },
      });
      expect(agentCalls.single.call.args, {'v': null});
    });

    test('a shared answer cannot be changed by a reader', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final Map<String, Object?> call = {
        '@call': 'remote',
        'args': <String, Object?>{},
      };
      mount(context, call);
      agentCalls.single.completer.complete({
        'items': [1],
      });
      await _flush();
      final answer = context.resolveDynamicValue(call)! as Map<String, dynamic>;
      expect(() => answer['items'] = <Object?>[], throwsUnsupportedError);
      expect(
        () => (answer['items'] as List<Object?>).add(2),
        throwsUnsupportedError,
      );
      expect(context.resolveDynamicValue(call), {
        'items': [1],
      });
      expect(agentCalls, hasLength(1));
    });

    test('a disposed surface sends no agent call and reports nothing',
        () async {
      final surface = SurfaceModel<ComponentApi>(
        'disposed',
        defaultCatalog: _catalog(),
        protocolVersion: '1.0',
        callAgentFunction: callAgent,
      );
      final errors = <A2uiExpressionError>[];
      final DataContext context = ComponentContext(
        surface,
        ComponentModel('root', 'Text', {}),
        onError: errors.add,
      ).dataContext;
      surface.dispose();
      expect(surface.isDisposed, isTrue);

      expect(
        mount(
          context,
          {'@call': 'remote', 'args': <String, Object?>{}},
        ),
        isNull,
      );
      await expectLater(
        context.evaluateFunctionCall(
          {'@call': 'remoteAction', 'args': <String, Object?>{}},
        ),
        throwsA(isA<A2uiRpcError>()
            .having((e) => e.rpcCode, 'rpcCode', RpcErrorCode.cancelled)),
      );
      await _flush();
      expect(agentCalls, isEmpty);
      expect(errors, isEmpty);
    });

    test('an agentOnly function is refused and not sent', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveDynamicValue(
          {'@call': 'agentSide', 'args': <String, Object?>{}},
        ),
        isNull,
      );
      await expectLater(
        context.evaluateFunctionCall(
          {'@call': 'agentSide', 'args': <String, Object?>{}},
        ),
        completion(isNull),
      );
      await _flush();
      expect(agentCalls, isEmpty);
      expect(clientErrors, hasLength(2));
      expect(clientErrors.map((e) => e.code), everyElement('EXPRESSION_ERROR'));
      expect(clientErrors.first.message, contains('agentOnly'));
    });

    test('a signal a local function returns streams once its args settle',
        () async {
      _live.value = 'a';
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final ReadonlySignal<Object?> value = context.resolveSignal({
        '@call': 'live',
        'args': {
          'seed': {'@call': 'remote', 'args': <String, Object?>{}},
        },
      });
      final seen = <Object?>[];
      final void Function() unsub = value.subscribe(seen.add);
      addTearDown(unsub);
      expect(value.value, isNull);

      agentCalls.single.completer.complete(1);
      await _flush();
      expect(value.value, 'a');
      _live.value = 'b';
      expect(value.value, 'b');
      expect(seen, [null, 'a', 'b']);
    });

    test('a settled call re-evaluates only the bindings that read it',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      _countRuns = 0;
      mount(context, {'@call': 'remote', 'args': <String, Object?>{}});
      mount(context, {
        '@call': 'count',
        'args': {
          'v': {'@path': '/v'},
        },
      });
      expect(_countRuns, 1);
      agentCalls.single.completer.complete('done');
      await _flush();
      expect(_countRuns, 1, reason: 'an unrelated settle must not re-run it');
    });

    test('more mounted calls than the cache holds are each sent once',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final bindings = <ReadonlySignal<Object?>>[
        for (var i = 0; i < 300; i++)
          context.resolveSignal({
            '@call': 'lookup',
            'args': {'id': i},
          }),
      ];
      for (final binding in bindings) {
        addTearDown(binding.subscribe((_) {}));
      }
      expect(agentCalls, hasLength(300));
      for (var i = 0; i < 300; i++) {
        agentCalls[i].completer.complete(i);
      }
      await _flush();
      mount(context, {'@call': 'other', 'args': <String, Object?>{}});
      agentCalls.last.completer.complete('x');
      await _flush();
      expect(agentCalls, hasLength(301), reason: 'no evicted call is re-sent');
      expect([for (final b in bindings) b.value],
          [for (var i = 0; i < 300; i++) i]);
    });

    test('a cancelled call is sent again when its binding evaluates again',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      surface.dataModel.set('/obj', {'x': 1});
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      mount(context, {
        '@call': 'remote',
        'args': {
          'obj': {'@path': '/obj'},
        },
      });
      agentCalls.single.completer.completeError(
        A2uiRpcError('cancelled', RpcErrorCode.cancelled),
      );
      await _flush();
      expect(agentCalls, hasLength(1), reason: 'cancellation is not retried');

      // Equal arguments: a failure would be remembered, a cancellation not.
      surface.dataModel.set('/obj', {'x': 1});
      expect(agentCalls, hasLength(2));
      expect(agentCalls.last.call.args, {
        'obj': {'x': 1},
      });
      await _flush();
      expect(clientErrors, isEmpty);
    });

    test('a failed call is not sent again for equal arguments', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      surface.dataModel.set('/obj', {'x': 1});
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      mount(context, {
        '@call': 'remote',
        'args': {
          'obj': {'@path': '/obj'},
        },
      });
      agentCalls.single.completer.completeError(
        A2uiRpcError('down', RpcErrorCode.timeout),
      );
      await _flush();
      surface.dataModel.set('/obj', {'x': 1});
      expect(agentCalls, hasLength(1));
      surface.dataModel.set('/obj', {'x': 2});
      expect(agentCalls, hasLength(2));
    });

    test('a one-shot read never sends a call to the agent', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      expect(
        context.resolveDynamicValue(
          {'@call': 'remote', 'args': <String, Object?>{}},
        ),
        isNull,
      );
      expect(agentCalls, isEmpty);
      await _flush();
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
    });

    test('a formatString part naming an agent function is not sent', () async {
      final surface = SurfaceModel<ComponentApi>(
        'format',
        defaultCatalog: BasicCatalog.v1_0(),
        protocolVersion: '1.0',
        callAgentFunction: callAgent,
      );
      surface.onError.subscribe(clientErrors.add);
      addTearDown(surface.dispose);
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final Object? text = mount(context, {
        '@call': 'formatString',
        'args': {r'value': r'Hello ${remote()}!'},
      });
      expect(text, 'Hello !');
      expect(agentCalls, isEmpty);
      await _flush();
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
    });

    test('a formatString part is refused even when the answer is held',
        () async {
      final surface = SurfaceModel<ComponentApi>(
        'format-cached',
        defaultCatalog: BasicCatalog.v1_0(),
        protocolVersion: '1.0',
        callAgentFunction: callAgent,
      );
      surface.onError.subscribe(clientErrors.add);
      addTearDown(surface.dispose);
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      mount(context, {'@call': 'remote', 'args': <String, Object?>{}});
      agentCalls.single.completer.complete('cached');
      await _flush();
      expect(
        context.resolveDynamicValue(
          {'@call': 'remote', 'args': <String, Object?>{}},
        ),
        'cached',
        reason: 'a one-shot read may read the held answer',
      );

      final Object? text = mount(context, {
        '@call': 'formatString',
        'args': {r'value': r'Hello ${remote()}!'},
      });
      expect(text, 'Hello !');
      expect(agentCalls, hasLength(1));
      await _flush();
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(clientErrors.single.message, contains('remote'));
    });

    test('sibling arguments in an action are sent together', () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final Future<Object?> result = context.evaluateFunctionCall({
        '@call': 'outer',
        'args': {
          'a': {'@call': 'one', 'args': <String, Object?>{}},
          'b': {'@call': 'two', 'args': <String, Object?>{}},
        },
      });
      await _flush();
      expect(agentCalls.map((c) => c.call.call), ['one', 'two']);
      agentCalls[1].completer.complete(2);
      agentCalls[0].completer.complete(1);
      await _flush();
      expect(agentCalls.last.call.call, 'outer');
      expect(agentCalls.last.call.args, {'a': 1, 'b': 2});
      agentCalls.last.completer.complete('done');
      expect(await result, 'done');
    });

    test('a failed sibling stops the others and later failures are silent',
        () async {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      _countRuns = 0;
      final Future<Object?> result = context.evaluateFunctionCall({
        '@call': 'outer',
        'args': {
          'a': {'@call': 'one', 'args': <String, Object?>{}},
          'b': {
            '@call': 'count',
            'args': {
              'v': {'@call': 'three', 'args': <String, Object?>{}},
            },
          },
          'c': {'@call': 'four', 'args': <String, Object?>{}},
        },
      });
      await _flush();
      expect(agentCalls.map((c) => c.call.call), ['one', 'three', 'four']);
      agentCalls[0].completer.completeError(
            A2uiRpcError('one failed', RpcErrorCode.executionError),
          );
      await _flush();
      agentCalls[1].completer.complete('late');
      agentCalls[2].completer.completeError(
            A2uiRpcError('four failed', RpcErrorCode.executionError),
          );
      expect(await result, isNull);
      await _flush();
      expect(_countRuns, 0, reason: 'count waits on an aborted group');
      expect(agentCalls, hasLength(3), reason: 'outer is never sent');
      expect(clientErrors, hasLength(1));
      expect(clientErrors.single.message, contains('one failed'));
    });

    test('nested bindings in an action resolve synchronously', () {
      final SurfaceModel<ComponentApi> surface = makeSurface();
      surface.dataModel.set('/x', 'v');
      final DataContext context =
          ComponentContext(surface, ComponentModel('root', 'Text', {}))
              .dataContext;
      final FutureOr<Map<String, dynamic>?> resolved =
          context.resolveActionAsync({
        'event': {
          'name': 'go',
          'context': {
            'map': {
              'a': {'@path': '/x'},
            },
            'list': [
              {'@path': '/x'},
              'literal',
            ],
          },
        },
      });
      expect(resolved, isA<Map<String, dynamic>>());
      expect((resolved! as Map<String, dynamic>)['event'], {
        'name': 'go',
        'context': {
          'map': {'a': 'v'},
          'list': ['v', 'literal'],
        },
      });
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
          ComponentContext(surface, comp), TestTextFieldApi().schema);
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
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
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

    var buttons = 0;

    Future<void> invokeAction(Map<String, dynamic> action) async {
      final comp = ComponentModel('b${++buttons}', 'Button', {
        'child': 'c2',
        'action': action,
      });
      surface.componentsModel.addComponent(comp);
      final binder = GenericBinder(
          ComponentContext(surface, comp), TestButtonApi().schema);
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

    test('an agent failure dispatches EXPRESSION_ERROR with the call id',
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
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(clientErrors.single.functionCallId, 'fc-7');
      expect(clientErrors.single.surfaceId, isNull);
      expect(clientErrors.single.message, contains('refused'));
      final Map<String, dynamic> wire =
          ErrorMessage(version: '1.0', error: clientErrors.single).toJson();
      expect(RendererToAgentMessage.fromJson(wire), isA<ErrorMessage>());
    });

    test('a cancelled functionCall action dispatches no error', () async {
      final Future<void> done = invokeAction({
        'functionCall': {'@call': 'remoteAction', 'args': <String, Object?>{}},
      });
      await _flush();
      agentCalls.single.completer.completeError(
        A2uiRpcError('gone', RpcErrorCode.cancelled, functionCallId: 'fc-c'),
      );
      await done;
      await _flush();
      expect(clientErrors, isEmpty);
    });

    test('an event action resolves its context with user activation', () async {
      final actions = <A2uiRendererAction>[];
      surface.onAction.subscribe(actions.add);
      await invokeAction({
        'event': {
          'name': 'open',
          'context': {
            'result': {'@call': 'gated', 'args': <String, Object?>{}},
          },
        },
      });
      expect(clientErrors, isEmpty);
      expect(actions.single.context, {'result': 'opened'});

      // Resolved without a user activation, the same action is refused.
      final DataContext passive = ComponentContext(
        surface,
        ComponentModel('root', 'Text', {}),
      ).dataContext;
      var failed = false;
      final Object? resolved = await passive.resolveActionAsync(
        {
          'event': {
            'name': 'open',
            'context': {
              'result': {'@call': 'gated', 'args': <String, Object?>{}},
            },
          },
        },
        onExpressionFailed: () => failed = true,
      );
      expect(resolved, isNull);
      expect(failed, isTrue);
      await _flush();
      expect(clientErrors.single.message, contains('requires user activation'));
      expect(agentCalls, isEmpty);
    });

    test('a local function that throws in an action is an EXECUTION_ERROR',
        () async {
      final actions = <A2uiRendererAction>[];
      surface.onAction.subscribe(actions.add);
      await invokeAction({
        'functionCall': {'@call': 'boom', 'args': <String, Object?>{}},
      });
      await invokeAction({
        'event': {
          'name': 'go',
          'context': {
            'v': {'@call': 'boom', 'args': <String, Object?>{}},
          },
        },
      });
      // A function refused before it runs is still a failed expression.
      await invokeAction({
        'functionCall': {'@call': 'agentSide', 'args': <String, Object?>{}},
      });
      await _flush();
      expect(actions, isEmpty);
      expect(clientErrors.map((e) => e.code), [
        'EXECUTION_ERROR',
        'EXECUTION_ERROR',
        'EXPRESSION_ERROR',
      ]);
      expect(clientErrors.first.message, contains('boom failed'));
      expect(clientErrors.first.surfaceId, 'surf');
    });

    test('a malformed context value is reported the same way after a wait',
        () async {
      final actions = <A2uiRendererAction>[];
      surface.onAction.subscribe(actions.add);
      await invokeAction({
        'event': {
          'name': 'go',
          'context': {
            'bad': {'@bad': 1},
          },
        },
      });
      final Future<void> later = invokeAction({
        'event': {
          'name': 'go',
          'context': {
            'first': {'@call': 'remote', 'args': <String, Object?>{}},
            'bad': {'@bad': 1},
          },
        },
      });
      await _flush();
      agentCalls.single.completer.complete('ok');
      await later;
      await _flush();
      await invokeAction({
        'event': {
          'name': 'go',
          'context': {
            'nested': {
              'inner': {'@bad': 1},
            },
          },
          'userMessage': {'@bad': 1},
        },
      });
      await invokeAction({
        'event': {
          'name': 'go',
          'context': <String, Object?>{},
          'userMessage': {'@bad': 1},
        },
      });
      await _flush();
      expect(actions, isEmpty);
      expect(clientErrors, hasLength(4));
      expect(clientErrors.map((e) => e.code), everyElement('EXPRESSION_ERROR'));
      expect(clientErrors.map((e) => e.surfaceId), everyElement('surf'));
      expect(clientErrors[0].message, clientErrors[1].message);
      expect(
        clientErrors[0].message,
        startsWith("Action event context entry 'bad' is invalid: "),
      );
      expect(
        clientErrors[2].message,
        startsWith("Action event context entry 'nested' is invalid: "),
      );
      expect(
        clientErrors[3].message,
        startsWith('Action event userMessage is invalid: '),
      );
    });

    test('a call refused before it runs in an action is an EXPRESSION_ERROR',
        () async {
      final actions = <A2uiRendererAction>[];
      surface.onAction.subscribe(actions.add);
      await invokeAction({
        'event': {
          'name': 'go',
          'context': {
            'v': {'@call': 'agentSide', 'args': <String, Object?>{}},
          },
        },
      });
      await invokeAction({
        'functionCall': {
          '@call': 'typed',
          'args': {'n': 'not a number'},
        },
      });
      await invokeAction({
        'event': {
          'name': 'go',
          'userMessage': {
            '@call': 'typed',
            'args': {'n': 'not a number'},
          },
        },
      });
      // A passive resolution refuses a function that needs user activation.
      final DataContext passive = ComponentContext(
        surface,
        ComponentModel('root', 'Text', {}),
      ).dataContext;
      expect(
        await passive.resolveActionAsync({
          'event': {
            'name': 'go',
            'context': {
              'v': {'@call': 'gated', 'args': <String, Object?>{}},
            },
          },
        }),
        isNull,
      );
      await _flush();
      expect(actions, isEmpty);
      expect(clientErrors, hasLength(4));
      expect(clientErrors.map((e) => e.code), everyElement('EXPRESSION_ERROR'));
      expect(agentCalls, isEmpty);
    });

    test('a functionCall action runs with user activation', () async {
      await invokeAction({
        'functionCall': {'@call': 'gated', 'args': <String, Object?>{}},
      });
      expect(clientErrors, isEmpty);
      expect(agentCalls, isEmpty);
    });

    test(
        'an event action whose context expression fails reports '
        'EXPRESSION_ERROR without a second INVALID_ACTION error', () async {
      final Future<void> done = invokeAction({
        'event': {
          'name': 'submit',
          'context': {
            'token': {'@call': 'mintToken', 'args': <String, Object?>{}},
          },
        },
      });
      await _flush();
      agentCalls.single.completer.completeError(
        A2uiRpcError('mint failed', RpcErrorCode.executionError,
            functionCallId: 'fc-mint'),
      );
      await done;
      await _flush();
      expect(clientErrors, hasLength(1));
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(clientErrors.single.functionCallId, 'fc-mint');
    });
  });
}
