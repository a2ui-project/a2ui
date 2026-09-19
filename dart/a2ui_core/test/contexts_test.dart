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
        test('without a reporter does not normalize the original '
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
}
