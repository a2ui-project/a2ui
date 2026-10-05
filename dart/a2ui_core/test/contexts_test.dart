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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_core/src/core/contexts.dart' show ComponentContext;
import 'package:preact_signals/preact_signals.dart' show SignalEffectException;
import 'package:test/test.dart';

void main() {
  late DataModel dataModel;
  late DataContext context;
  late List<A2uiExpressionError> errors;

  setUp(() {
    dataModel = DataModel();
    errors = [];
    context = DataContext(
      dataModel,
      (name, args, context) {
        expect(name, 'join');
        return (args['values'] as List).join('');
      },
      '/',
      onError: errors.add,
    );
    addTearDown(dataModel.dispose);
  });

  group('DataContext dynamic-value resolution', () {
    test('resolves path or call maps nested inside literal map values', () {
      dataModel.set('/x', 'resolved');
      final Map<String, Object?> payload = {
        'meta': {'path': '/x'},
        'static': 'value',
      };
      final Object? result = context.resolveSync(payload);
      expect(result, isNot(same(payload)));
      expect((result as Map)['meta'], 'resolved');
      expect(result['static'], 'value');

      final ReadonlySignal<Object?> listenable = context.resolveListenable(
        payload,
      );
      expect((listenable.value as Map)['meta'], 'resolved');

      dataModel.set('/x', 'updated');
      expect((listenable.value as Map)['meta'], 'updated');
    });

    test('resolves array elements as dynamic values', () {
      dataModel.set('/a', 'A');
      expect(
        context.resolveSync([
          {'path': '/a'},
          'literal',
        ]),
        ['A', 'literal'],
      );
    });

    test('returns a fully static array unchanged', () {
      final list = ['x', 'y'];
      expect(identical(context.resolveSync(list), list), isTrue);
    });

    test('re-evaluates array elements reactively', () {
      dataModel.set('/a', 'A');
      final ReadonlySignal<Object?> listenable = context.resolveListenable([
        {'path': '/a'},
        'static',
      ]);
      expect(listenable.value, ['A', 'static']);

      dataModel.set('/a', 'B');
      expect(listenable.value, ['B', 'static']);
    });

    test('resolves a list-of-dynamic-values function argument', () {
      dataModel.set('/a', 'A');
      dataModel.set('/b', 'B');
      final ReadonlySignal<Object?> listenable = context.resolveListenable({
        'call': 'join',
        'args': {
          'values': [
            {'path': '/a'},
            '-',
            {'path': '/b'},
          ],
        },
      });
      expect(listenable.value, 'A-B');

      dataModel.set('/b', 'C');
      expect(listenable.value, 'A-C');
    });

    test('nested scopes retain the data model, invoker and reporter', () {
      final failure = A2uiExpressionError('failed', expression: 'fail');
      final invocationPaths = <String>[];
      context = DataContext(
        dataModel,
        (name, args, currentContext) {
          invocationPaths.add(currentContext.path);
          if (name == 'fail') throw failure;
          return currentContext.resolveSync(args['value']);
        },
        '/users',
        onError: errors.add,
      );
      final DataContext nested = context.nested('0');
      nested.set('name', 'Ada');

      expect(nested.dataModel, same(dataModel));
      expect(nested.path, '/users/0');
      expect(dataModel.get('/users/0/name'), 'Ada');
      expect(
        nested.resolveSync({
          'call': 'read',
          'args': {
            'value': {'path': 'name'},
          },
        }),
        'Ada',
      );
      expect(nested.resolveSync({'call': 'fail'}), isNull);
      expect(invocationPaths, ['/users/0', '/users/0']);
      expect(errors, [same(failure)]);
    });
  });

  for (final reactive in [false, true]) {
    group('DataContext ${reactive ? 'reactive' : 'sync'} error reporting', () {
      Object? evaluate(DataContext context) {
        final Map<String, Object?> call = {
          'call': 'fail',
          'args': <String, Object?>{},
        };
        return reactive
            ? context.resolveListenable(call).value
            : context.resolveSync(call);
      }

      for (final original in <Exception>[
        Exception('failed'),
        A2uiExpressionError('failed', expression: 'inner'),
      ]) {
        test(
            'without a reporter does not normalize the original '
            '${original.runtimeType}', () {
          context = DataContext(
            dataModel,
            (name, args, context) => throw original,
            '/',
          );

          expect(
            () => evaluate(context),
            throwsA(
              reactive
                  ? isA<SignalEffectException>().having(
                      (error) => error.error,
                      'error',
                      same(original),
                    )
                  : same(original),
            ),
          );
          expect(errors, isEmpty);
        });
      }

      test('reports the existing expression error unchanged', () {
        final original = A2uiExpressionError(
          'failed',
          expression: 'inner',
          details: {'reason': 'invalid argument'},
        );
        context = DataContext(
          dataModel,
          (name, args, context) => throw original,
          '/',
          onError: errors.add,
        );

        expect(evaluate(context), isNull);
        expect(errors, [same(original)]);
      });

      test('normalizes other failures only when reporting', () {
        final original = StateError('failed');
        context = DataContext(
          dataModel,
          (name, args, context) => throw original,
          '/',
          onError: errors.add,
        );

        expect(evaluate(context), isNull);
        expect(errors, hasLength(1));
        expect(errors.single.message, original.toString());
        expect(errors.single.expression, 'fail');
      });
    });
  }

  group('ComponentContext error reporting', () {
    late SurfaceModel<ComponentApi> surface;
    late ComponentModel component;
    late List<A2uiClientError> clientErrors;

    setUp(() {
      surface = SurfaceModel('surf-1', catalog: MinimalCatalog());
      component = ComponentModel('root', 'Text', {});
      clientErrors = [];
      surface.onError.addListener(clientErrors.add);
      addTearDown(surface.dispose);
    });

    test('dispatches an expression error immediately by default', () {
      final componentContext = ComponentContext(surface, component);

      expect(
        componentContext.dataContext.resolveSync({'call': 'missing'}),
        isNull,
      );
      expect(clientErrors, hasLength(1));
      expect(clientErrors.single.code, 'EXPRESSION_ERROR');
      expect(clientErrors.single.surfaceId, 'surf-1');
      expect(clientErrors.single.message, contains('Function not found'));
    });

    test(
      'an override replaces surface dispatch and follows child contexts',
      () {
        final componentContext = ComponentContext(
          surface,
          component,
          basePath: '/users/0',
          onError: errors.add,
        );
        surface.componentsModel.addComponent(
          ComponentModel('child', 'Text', {}),
        );
        final ComponentContext child = componentContext.childContext('child');

        expect(
          componentContext.dataContext.resolveSync({'call': 'missing'}),
          isNull,
        );
        expect(child.dataContext.resolveSync({'call': 'missing'}), isNull);
        expect(child.dataContext.path, '/users/0');
        expect(errors, hasLength(2));
        expect(errors.map((error) => error.expression), ['missing', 'missing']);
        expect(clientErrors, isEmpty);
      },
    );
  });

  group('DataContext v1.0 protocol version gating', () {
    late DataModel dataModel;

    setUp(() {
      dataModel = DataModel();
      dataModel.set('/user/name', 'Alice');
      dataModel.set('/items/0', 'Widget');
    });

    Object? mockInvoker(
      String name,
      Map<String, dynamic> args,
      DataContext context,
    ) {
      if (name == 'uppercase') {
        return (args['value'] as String).toUpperCase();
      }
      return null;
    }

    test('v1.0 resolves @path and treats plain path as literal', () {
      final context = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v1.0',
      );

      expect(context.resolveSync({'@path': '/user/name'}), 'Alice');

      final plainMap = <String, dynamic>{'path': '/user/name'};
      expect(context.resolveSync(plainMap), {'path': '/user/name'});
    });

    test('v1.0 resolves @call and treats plain call as literal', () {
      final context = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v1.0',
      );

      final dynamicCall = <String, dynamic>{
        '@call': 'uppercase',
        'args': {'value': 'hello'},
      };
      expect(context.resolveSync(dynamicCall), 'HELLO');

      final plainCall = <String, dynamic>{
        'call': 'uppercase',
        'args': {'value': 'hello'},
      };
      expect(context.resolveSync(plainCall), {
        'call': 'uppercase',
        'args': {'value': 'hello'},
      });
    });

    test('v1.0 unescapes doubled @@ keys in plain objects', () {
      final context = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v1.0',
      );

      final escaped = <String, dynamic>{
        '@@path': '/static/file',
        '@@type': 'custom',
      };
      expect(context.resolveSync(escaped), {
        '@path': '/static/file',
        '@type': 'custom',
      });
    });

    test('v1.0 throws A2uiValidationError on unknown single-@ keys', () {
      final context = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v1.0',
      );

      expect(
        () => context.resolveSync({'@invalidDirective': true}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('pre-v1.0 resolves plain path and call without unescaping @@', () {
      final context = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v0.9',
      );

      expect(context.resolveSync({'path': '/user/name'}), 'Alice');
      expect(context.resolveSync({'@path': '/user/name'}), {
        '@path': '/user/name',
      });

      final plainCall = <String, dynamic>{
        'call': 'uppercase',
        'args': {'value': 'hello'},
      };
      expect(context.resolveSync(plainCall), 'HELLO');

      final escaped = <String, dynamic>{'@@path': '/static/file'};
      expect(context.resolveSync(escaped), {'@@path': '/static/file'});

      // Unknown @ keys should not throw in v0.9
      expect(context.resolveSync({'@foo': 'bar'}), {'@foo': 'bar'});
    });

    test('v1.0 resolveListenable unescapes @@ keys and validates directives',
        () {
      final context = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v1.0',
      );

      final escaped = <String, dynamic>{'@@path': '/static/file'};
      final ReadonlySignal<Object?> signal = context.resolveListenable(escaped);
      expect(signal.value, {'@path': '/static/file'});

      expect(
        () => context.resolveListenable({'@invalid': true}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('isV10 matches versions >= 1.0 semantically', () {
      final ctx1 = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v1.1',
      );
      expect(ctx1.isV10, isTrue);

      final ctx2 = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: '2.0.0',
      );
      expect(ctx2.isV10, isTrue);

      final ctx3 = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v0.9.1',
      );
      expect(ctx3.isV10, isFalse);
    });

    test('bindingFor returns version-appropriate binding map', () {
      final v09Ctx = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v0.9',
      );
      expect(v09Ctx.bindingFor('/user/name'), {'path': '/user/name'});

      final v10Ctx = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v1.0',
      );
      expect(v10Ctx.bindingFor('/user/name'), {'@path': '/user/name'});
    });

    test('isDataBinding and isFunctionCall follow the protocol version', () {
      final v09Ctx = DataContext(dataModel, mockInvoker, '/');
      final v10Ctx = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v1.0',
      );

      expect(v09Ctx.isDataBinding({'path': '/x'}), isTrue);
      expect(
          v09Ctx.isDataBinding({'path': '/x', 'componentId': 'row'}), isFalse);
      expect(v09Ctx.isDataBinding({'@path': '/x'}), isFalse);
      expect(v09Ctx.isDataBinding({'path': 123}), isFalse);
      expect(v09Ctx.isDataBinding('not a map'), isFalse);

      expect(v10Ctx.isDataBinding({'@path': '/x'}), isTrue);
      expect(v10Ctx.isDataBinding({'path': '/x'}), isFalse);
      expect(v10Ctx.isDataBinding({'@path': 123}), isFalse);

      expect(v09Ctx.isFunctionCall({'call': 'fn'}), isTrue);
      expect(v09Ctx.isFunctionCall({'@call': 'fn'}), isFalse);
      expect(v09Ctx.isFunctionCall({'call': 123}), isFalse);

      expect(v10Ctx.isFunctionCall({'@call': 'fn'}), isTrue);
      expect(v10Ctx.isFunctionCall({'call': 'fn'}), isFalse);
      expect(v10Ctx.isFunctionCall({'@call': 123}), isFalse);
    });

    test('preserves identity of static maps in both v0.9 and v1.0', () {
      final v09Ctx = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v0.9',
      );
      final v09LiteralWithAt = <String, Object?>{
        'meta': {'@path': '/user/name'},
        'template': {'path': '/items', 'componentId': 'item-row'},
      };
      expect(
        identical(v09Ctx.resolveSync(v09LiteralWithAt), v09LiteralWithAt),
        isTrue,
      );

      final v10Ctx = DataContext(
        dataModel,
        mockInvoker,
        '/',
        protocolVersion: 'v1.0',
      );
      final v10LiteralWithLegacyKeys = <String, Object?>{
        'path': '/user/name',
        'call': 'uppercase',
        'nested': [
          {'path': '/items/0'},
        ],
      };
      expect(
        identical(
          v10Ctx.resolveSync(v10LiteralWithLegacyKeys),
          v10LiteralWithLegacyKeys,
        ),
        isTrue,
      );
      final ReadonlySignal<Object?> sig = v10Ctx.resolveListenable(
        v10LiteralWithLegacyKeys,
      );
      expect(identical(sig.value, v10LiteralWithLegacyKeys), isTrue);
    });

    test(
      'resolveListenable pre-builds argument signals outside computed (#82)',
      () {
        final countingModel = _WatchCountingDataModel();
        addTearDown(countingModel.dispose);

        for (final version in ['v0.9', 'v1.0']) {
          countingModel.set('/a', 'hello');
          countingModel.set('/b', 'world');
          countingModel.watchCounts.clear();
          final ctx = DataContext(
            countingModel,
            (name, args, _) => '${args['first']}-${args['second']}',
            '/',
            protocolVersion: version,
          );
          final isV1 = version == 'v1.0';
          final ReadonlySignal<Object?> sig = ctx.resolveListenable({
            if (isV1) '@call': 'concat' else 'call': 'concat',
            'args': {
              'first': isV1 ? {'@path': '/a'} : {'path': '/a'},
              'second': isV1 ? {'@path': '/b'} : {'path': '/b'},
            },
          });

          expect(sig.value, 'hello-world');
          expect(countingModel.watchCounts['/a'], 1);
          expect(countingModel.watchCounts['/b'], 1);

          countingModel.set('/a', 'hi');
          expect(sig.value, 'hi-world');
          countingModel.set('/b', 'there');
          expect(sig.value, 'hi-there');

          // Re-evaluating the computed signal must not call watch() again.
          expect(countingModel.watchCounts['/a'], 1);
          expect(countingModel.watchCounts['/b'], 1);
        }
      },
    );

    test('resolveAction rejects empty or non-string event names', () {
      expect(context.resolveAction(''), isNull);
      expect(context.resolveAction({'name': ''}), isNull);
      expect(context.resolveAction({'name': 42}), isNull);
      expect(
        context.resolveAction({
          'event': {'name': ''},
        }),
        isNull,
      );
      expect(
        context.resolveAction({
          'event': {'name': 42},
        }),
        isNull,
      );
    });
  });
}

class _WatchCountingDataModel extends DataModel {
  final Map<String, int> watchCounts = {};

  @override
  ReadonlySignal<T?> watch<T>(String path) {
    watchCounts[path] = (watchCounts[path] ?? 0) + 1;
    return super.watch<T>(path);
  }
}
