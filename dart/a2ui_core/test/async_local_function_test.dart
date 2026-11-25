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
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;
import 'package:test/test.dart';

class _DeferredCall {
  _DeferredCall(this.args);

  final Map<String, dynamic> args;
  final Completer<Object?> completer = Completer<Object?>();
}

class _AsyncFunction extends FunctionImplementation {
  _AsyncFunction(String name)
    : super(
        name: name,
        argumentSchema: Schema.object(
          properties: {'value': Schema.any()},
          additionalProperties: true,
        ),
      );

  final List<_DeferredCall> calls = [];

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    final call = _DeferredCall(Map<String, dynamic>.from(args));
    calls.add(call);
    return call.completer.future;
  }
}

class _SyncPrefixFunction extends FunctionImplementation {
  _SyncPrefixFunction(String name)
    : super(
        name: name,
        argumentSchema: Schema.object(
          properties: {'value': Schema.string()},
          required: ['value'],
        ),
      );

  final List<Map<String, dynamic>> calls = [];

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    calls.add(Map<String, dynamic>.from(args));
    return 'prefix:${args['value']}';
  }
}

Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  group('Async local catalog functions in reactive bindings', () {
    late Catalog<ComponentApi, FunctionImplementation> basic;
    late _AsyncFunction lookup;
    late _AsyncFunction isFree;
    late _SyncPrefixFunction prefix;
    late Catalog<ComponentApi, FunctionImplementation> catalog;

    setUp(() {
      basic = BasicCatalog.v1_0();
      lookup = _AsyncFunction('lookup');
      isFree = _AsyncFunction('isFree');
      prefix = _SyncPrefixFunction('prefix');
      catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'test',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: [basic.components['TextField']!],
        functions: [lookup, isFree, prefix],
      );
    });

    test('GenericBinder tracks pending and resolved states for property '
        'and checks', () async {
      final surface = SurfaceModel<ComponentApi>(
        'main',
        defaultCatalog: catalog,
        protocolVersion: '1.0',
      );
      addTearDown(surface.dispose);

      final field = ComponentModel('field', 'TextField', {
        'label': {
          '@call': 'lookup',
          'args': {'value': 'x'},
        },
        'checks': [
          {
            'condition': {
              '@call': 'isFree',
              'args': {'value': 'x'},
            },
            'message': 'Taken',
          },
        ],
      });
      surface.componentsModel.addComponent(field);
      final binder = GenericBinder(
        ComponentContext(surface, field),
        basic.components['TextField']!.schema,
      );
      addTearDown(binder.dispose);

      final Map<String, dynamic> before = binder.resolvedProps.value;
      expect((before['label']! as ResolvedBinding).value, isNull);
      expect(before['validationPending'], isTrue);
      expect(before['isValid'], isTrue);
      expect(before['validationErrors'], isEmpty);

      lookup.calls.single.completer.complete('Username');
      isFree.calls.single.completer.complete(true);
      await _flush();

      final Map<String, dynamic> after = binder.resolvedProps.value;
      expect((after['label']! as ResolvedBinding).value, 'Username');
      expect(after['validationPending'], isFalse);
      expect(after['isValid'], isTrue);
      expect(after['validationErrors'], isEmpty);
      expect(lookup.calls, hasLength(1));
      expect(isFree.calls, hasLength(1));
    });

    test('check rule fails when async local function errors', () async {
      final errors = <A2uiRendererError>[];
      final surface = SurfaceModel<ComponentApi>(
        'main',
        defaultCatalog: catalog,
        protocolVersion: '1.0',
      );
      addTearDown(surface.dispose);
      final Subscription sub = surface.onError.subscribe(errors.add);
      addTearDown(sub.unsubscribe);

      final field = ComponentModel('field', 'TextField', {
        'label': 'User',
        'checks': [
          {
            'condition': {
              '@call': 'isFree',
              'args': {'value': 'taken'},
            },
            'message': 'Taken',
          },
        ],
      });
      surface.componentsModel.addComponent(field);
      final binder = GenericBinder(
        ComponentContext(surface, field),
        basic.components['TextField']!.schema,
      );
      addTearDown(binder.dispose);

      expect(binder.resolvedProps.value['validationPending'], isTrue);

      isFree.calls.single.completer.completeError(StateError('boom'));
      await _flush();

      expect(binder.resolvedProps.value['validationPending'], isFalse);
      expect(binder.resolvedProps.value['isValid'], isFalse);
      expect(binder.resolvedProps.value['validationErrors'], ['Taken']);
      expect(errors, hasLength(1));
      expect(errors.single.code, 'EXPRESSION_ERROR');
      // Must not re-invoke in a loop after failure.
      expect(isFree.calls, hasLength(1));
    });

    test(
      'resolveSignalWithPending tracks pending -> null without re-invoking',
      () async {
        final dataModel = DataModel();
        final ctx = DataContext(
          dataModel,
          catalog.invoke,
          '/',
          protocolVersion: A2uiProtocolVersion.v1_0,
        );

        final ReadonlySignal<DynamicValueState> sig = ctx
            .resolveSignalWithPending({
              '@call': 'lookup',
              'args': {'value': 'empty'},
            });
        expect(sig.value, (value: null, pending: true));

        lookup.calls.single.completer.complete(null);
        await _flush();

        expect(sig.value, (value: null, pending: false));
        expect(lookup.calls, hasLength(1));
      },
    );

    test(
      'nested call waits for inner async local function to settle',
      () async {
        final errors = <A2uiExpressionError>[];
        final dataModel = DataModel();
        final ctx = DataContext(
          dataModel,
          catalog.invoke,
          '/',
          onError: errors.add,
          protocolVersion: A2uiProtocolVersion.v1_0,
        );

        final ReadonlySignal<DynamicValueState> sig = ctx
            .resolveSignalWithPending({
              '@call': 'prefix',
              'args': {
                'value': {
                  '@call': 'lookup',
                  'args': {'value': 'k'},
                },
              },
            });

        expect(sig.value, (value: null, pending: true));
        expect(prefix.calls, isEmpty);

        lookup.calls.single.completer.complete('world');
        await _flush();

        expect(sig.value, (value: 'prefix:world', pending: false));
        expect(prefix.calls, hasLength(1));
        expect(errors, isEmpty);
      },
    );

    test('inner async error prevents outer function from running', () async {
      final errors = <A2uiExpressionError>[];
      final dataModel = DataModel();
      final ctx = DataContext(
        dataModel,
        catalog.invoke,
        '/',
        onError: errors.add,
        protocolVersion: A2uiProtocolVersion.v1_0,
      );

      final ReadonlySignal<DynamicValueState> sig = ctx
          .resolveSignalWithPending({
            '@call': 'prefix',
            'args': {
              'value': {
                '@call': 'lookup',
                'args': {'value': 'k'},
              },
            },
          });

      expect(sig.value, (value: null, pending: true));

      lookup.calls.single.completer.completeError(Exception('inner fail'));
      await _flush();

      expect(sig.value, (value: null, pending: false));
      expect(prefix.calls, isEmpty);
      expect(errors, hasLength(1));
      expect(errors.single.code, 'EXPRESSION_ERROR');
    });

    test(
      'stale completion and stale error are ignored after arguments change',
      () async {
        final errors = <A2uiExpressionError>[];
        final dataModel = DataModel({'query': 'first'});
        final ctx = DataContext(
          dataModel,
          catalog.invoke,
          '/',
          onError: errors.add,
          protocolVersion: A2uiProtocolVersion.v1_0,
        );

        final ReadonlySignal<DynamicValueState> sig = ctx
            .resolveSignalWithPending({
              '@call': 'lookup',
              'args': {
                'value': {'@path': '/query'},
              },
            });

        expect(sig.value, (value: null, pending: true));
        expect(lookup.calls, hasLength(1));
        final _DeferredCall firstCall = lookup.calls[0];

        // Change argument before first call settles.
        dataModel.set('/query', 'second');
        expect(sig.value, (value: null, pending: true));
        expect(lookup.calls, hasLength(2));
        final _DeferredCall secondCall = lookup.calls[1];

        // First call settles late with a value; must be ignored.
        firstCall.completer.complete('stale-value');
        await _flush();
        expect(sig.value, (value: null, pending: true));

        // Second call settles with the current value.
        secondCall.completer.complete('fresh-value');
        await _flush();
        expect(sig.value, (value: 'fresh-value', pending: false));

        // Change argument again, then reject the previous call late.
        dataModel.set('/query', 'third');
        expect(sig.value, (value: null, pending: true));
        final _DeferredCall thirdCall = lookup.calls[2];

        dataModel.set('/query', 'fourth');
        expect(sig.value, (value: null, pending: true));
        final _DeferredCall fourthCall = lookup.calls[3];

        thirdCall.completer.completeError(StateError('stale-error'));
        await _flush();
        expect(errors, isEmpty);
        expect(sig.value, (value: null, pending: true));

        fourthCall.completer.complete('final-value');
        await _flush();
        expect(sig.value, (value: 'final-value', pending: false));
        expect(errors, isEmpty);
      },
    );

    test('NaN argument does not re-invoke async function in a loop', () async {
      final dataModel = DataModel({'n': double.nan});
      final ctx = DataContext(
        dataModel,
        catalog.invoke,
        '/',
        protocolVersion: A2uiProtocolVersion.v1_0,
      );

      final ReadonlySignal<Object?> sig = ctx.resolveSignal({
        '@call': 'lookup',
        'args': {
          'value': {'@path': '/n'},
        },
      });
      expect(sig.value, isNull);
      expect(lookup.calls, hasLength(1));

      lookup.calls.single.completer.complete('nan-handled');
      await _flush();

      expect(sig.value, 'nan-handled');
      expect(lookup.calls, hasLength(1));
    });

    test(
      'Future resolving to ReadonlySignal unwraps and tracks updates',
      () async {
        final dataModel = DataModel();
        final ctx = DataContext(
          dataModel,
          catalog.invoke,
          '/',
          protocolVersion: A2uiProtocolVersion.v1_0,
        );

        final ReadonlySignal<Object?> sig = ctx.resolveSignal({
          '@call': 'lookup',
          'args': {'value': 'reactive'},
        });
        expect(sig.value, isNull);

        final Signal<Object?> inner = signal<Object?>('v1');
        lookup.calls.single.completer.complete(inner);
        await _flush();

        expect(sig.value, 'v1');
        expect(lookup.calls, hasLength(1));

        inner.value = 'v2';
        expect(sig.value, 'v2');
        expect(lookup.calls, hasLength(1));
      },
    );

    test('pre-1.0 reactive binding tracks async local function', () async {
      final v09Catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'test-v09',
        protocolVersion: A2uiProtocolVersion.v0_9,
        components: const [],
        functions: [lookup, prefix],
      );
      final dataModel = DataModel();
      final ctx = DataContext(
        dataModel,
        v09Catalog.invoke,
        '/',
        protocolVersion: A2uiProtocolVersion.v0_9,
      );

      final ReadonlySignal<DynamicValueState> sig = ctx
          .resolveSignalWithPending({
            'call': 'prefix',
            'args': {
              'value': {
                'call': 'lookup',
                'args': {'value': 'k'},
              },
            },
          });
      expect(sig.value, (value: null, pending: true));
      expect(prefix.calls, isEmpty);

      lookup.calls.single.completer.complete('v09');
      await _flush();

      expect(sig.value, (value: 'prefix:v09', pending: false));
      expect(prefix.calls, hasLength(1));
    });

    test('check rule fails when async local function settles false', () async {
      final surface = SurfaceModel<ComponentApi>(
        'main',
        defaultCatalog: catalog,
        protocolVersion: '1.0',
      );
      addTearDown(surface.dispose);

      final field = ComponentModel('field', 'TextField', {
        'label': 'User',
        'checks': [
          {
            'condition': {
              '@call': 'isFree',
              'args': {'value': 'taken'},
            },
            'message': 'Taken',
          },
        ],
      });
      surface.componentsModel.addComponent(field);
      final binder = GenericBinder(
        ComponentContext(surface, field),
        basic.components['TextField']!.schema,
      );
      addTearDown(binder.dispose);

      expect(binder.resolvedProps.value['validationPending'], isTrue);
      expect(binder.resolvedProps.value['isValid'], isTrue);

      isFree.calls.single.completer.complete(false);
      await _flush();

      expect(binder.resolvedProps.value['validationPending'], isFalse);
      expect(binder.resolvedProps.value['isValid'], isFalse);
      expect(binder.resolvedProps.value['validationErrors'], ['Taken']);
      expect(isFree.calls, hasLength(1));
    });

    test(
      'Map and List containing async local functions propagate pending state',
      () async {
        final dataModel = DataModel();
        final ctx = DataContext(
          dataModel,
          catalog.invoke,
          '/',
          protocolVersion: A2uiProtocolVersion.v1_0,
        );

        final ReadonlySignal<DynamicValueState> mapSig = ctx
            .resolveSignalWithPending({
              'item': {
                '@call': 'lookup',
                'args': {'value': 'm'},
              },
            });
        expect(mapSig.value, (value: null, pending: true));

        final ReadonlySignal<DynamicValueState> listSig = ctx
            .resolveSignalWithPending([
              {
                '@call': 'isFree',
                'args': {'value': 'l'},
              },
            ]);
        expect(listSig.value, (value: null, pending: true));

        lookup.calls.single.completer.complete('resolved-map');
        isFree.calls.single.completer.complete(true);
        await _flush();

        expect(mapSig.value.pending, isFalse);
        expect(mapSig.value.value, {'item': 'resolved-map'});
        expect(listSig.value.pending, isFalse);
        expect(listSig.value.value, [true]);
      },
    );

    test(
      'async function mutating args map does not re-invoke in a loop',
      () async {
        final mutating = _MutatingAsyncFunction('mutate');
        final mutatingCatalog = Catalog<ComponentApi, FunctionImplementation>(
          id: 'mut',
          protocolVersion: A2uiProtocolVersion.v1_0,
          components: const [],
          functions: [mutating],
        );
        final ctx = DataContext(
          DataModel(),
          mutatingCatalog.invoke,
          '/',
          protocolVersion: A2uiProtocolVersion.v1_0,
        );

        final ReadonlySignal<Object?> sig = ctx.resolveSignal({
          '@call': 'mutate',
          'args': {'value': 'orig'},
        });
        expect(sig.value, isNull);
        expect(mutating.calls, hasLength(1));

        mutating.calls.single.completer.complete('done');
        await _flush();

        expect(sig.value, 'done');
        expect(mutating.calls, hasLength(1));
      },
    );

    test('formatString with an async local part calls it once', () async {
      final Catalog<ComponentApi, FunctionImplementation> basic =
          BasicCatalog.v1_0();
      final withFormat = Catalog<ComponentApi, FunctionImplementation>(
        id: 'fmt',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const [],
        functions: [...basic.functions.values, lookup],
      );
      final ctx = DataContext(
        DataModel(),
        withFormat.invoke,
        '/',
        protocolVersion: A2uiProtocolVersion.v1_0,
      );

      final ReadonlySignal<Object?> sig = ctx.resolveSignal({
        '@call': 'formatString',
        'args': {'value': r"Hi ${lookup(value: 'x')}!"},
      });

      expect(sig.value, 'Hi !');
      expect(lookup.calls, hasLength(1));

      lookup.calls.single.completer.complete('Bob');
      await _flush();

      expect(sig.value, 'Hi Bob!');
      expect(lookup.calls, hasLength(1));
    });
  });
}

class _MutatingAsyncFunction extends _AsyncFunction {
  _MutatingAsyncFunction(super.name);

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    args['value'] = 'mutated';
    return super.execute(args, context, cancellationSignal);
  }
}
