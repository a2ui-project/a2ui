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
import 'package:test/test.dart';

void main() {
  group('DataModel (Dart-specific signal caching)', () {
    test('returns identical cached ReadonlySignal for equivalent paths', () {
      final model = DataModel({'foo': 'bar'});
      addTearDown(model.dispose);

      final ReadonlySignal<Object?> s1 = model.watch('/foo');
      final ReadonlySignal<Object?> s2 = model.watch('/foo/');
      final ReadonlySignal<Object?> s3 = model.watch('//foo//');

      expect(identical(s1, s2), isTrue);
      expect(identical(s1, s3), isTrue);
    });

    test(
        'returns identical cached ReadonlySignal for relative and '
        'absolute equivalents', () {
      final model = DataModel({'foo': 'bar'});
      addTearDown(model.dispose);

      final ReadonlySignal<Object?> s1 = model.watch('/foo');
      final ReadonlySignal<Object?> s2 = model.watch('foo');

      expect(identical(s1, s2), isTrue);
    });
  });

  group('DataModel deep-copy ownership and Map normalization', () {
    test('a const seed does not make later writes throw', () {
      const seed = <String, Object?>{
        'form': <String, Object?>{'email': ''},
      };
      final model = DataModel(seed);
      addTearDown(model.dispose);

      model.set('/form/email', 'a@b.com');

      expect(model.get('/form/email'), 'a@b.com');
    });

    test('a const value set at the root behaves the same', () {
      const seed = <String, Object?>{
        'form': <String, Object?>{'email': ''},
      };
      final model = DataModel();
      addTearDown(model.dispose);
      model.set('', seed);

      model.set('/form/email', 'a@b.com');

      expect(model.get('/form/email'), 'a@b.com');
    });

    test('a const value set at a path behaves the same', () {
      const branch = <String, Object?>{'email': ''};
      final model = DataModel();
      addTearDown(model.dispose);
      model.set('/form', branch);

      model.set('/form/email', 'a@b.com');

      expect(model.get('/form/email'), 'a@b.com');
    });

    test('a const list set at a path behaves the same', () {
      const rows = <Object?>[
        <String, Object?>{'label': 'one'},
      ];
      final model = DataModel();
      addTearDown(model.dispose);
      model.set('/rows', rows);

      model.set('/rows/0/label', 'two');

      expect(model.get('/rows/0/label'), 'two');
    });

    test('mutating the seed afterwards does not reach inside the model', () {
      final seed = <String, Object?>{
        'form': <String, Object?>{'email': 'first'},
      };
      final model = DataModel(seed);
      addTearDown(model.dispose);

      (seed['form']! as Map<String, Object?>)['email'] = 'second';

      expect(model.get('/form/email'), 'first');
    });

    test('writing does not reach back out into the caller value', () {
      final value = <String, Object?>{'email': 'first'};
      final model = DataModel();
      addTearDown(model.dispose);
      model.set('/form', value);

      model.set('/form/email', 'second');

      expect(value['email'], 'first');
      expect(model.get('/form/email'), 'second');
    });

    test(
        'normalizes untyped Map<dynamic, dynamic> on init and set for '
        'traversal', () {
      final decoded = <dynamic, dynamic>{
        'form': <dynamic, dynamic>{'email': 'a@b.com'},
      };
      final model = DataModel(decoded);
      addTearDown(model.dispose);

      expect(model.get('/form/email'), 'a@b.com');
      expect(model.hasPath('/form/email'), isTrue);

      model.set('/nested', <dynamic, dynamic>{});
      expect(model.hasPath('/nested'), isTrue);
      model.set('/nested/name', 'Alice');
      expect(model.get('/nested/name'), 'Alice');
      expect(model.hasPath('/nested/name'), isTrue);
    });

    test('a map with non-string keys is preserved as a value', () {
      final model = DataModel();
      addTearDown(model.dispose);
      model.set('/byIndex', {1: 'one', 2: 'two'});

      expect(model.get('/byIndex'), {1: 'one', 2: 'two'});
    });
  });

  group('DataModel root writes and primitive root guard', () {
    test('set at root with primitive stores primitive and rejects child writes',
        () {
      final model = DataModel();
      addTearDown(model.dispose);

      model.set('/', 42);
      expect(model.get('/'), 42);
      expect(
        () => model.set('/a', 1),
        throwsA(isA<A2uiDataError>()),
      );
      expect(model.get('/'), 42);

      model.set('/', null);
      expect(model.get('/'), <String, Object?>{});
      model.set('/a', 1);
      expect(model.get('/a'), 1);
    });
  });

  group('DataModel delete, hasPath, and resolvePath', () {
    test('delete removes map key and notifies watchers', () {
      final model = DataModel({
        'a': {'b': 1, 'c': 2},
      });
      addTearDown(model.dispose);

      final ReadonlySignal<Object?> parentSignal = model.watch('/a');
      final ReadonlySignal<Object?> childSignal = model.watch('/a/b');
      expect(parentSignal.value, {'b': 1, 'c': 2});
      expect(childSignal.value, 1);

      model.delete('/a/b');

      expect(model.hasPath('/a/b'), isFalse);
      expect(model.get('/a/b'), isNull);
      expect(parentSignal.value, {'c': 2});
      expect(childSignal.value, isNull);
    });

    test('delete accepts DataPath and nulls list slot in bounds', () {
      final model = DataModel({
        'items': ['x', 'y'],
      });
      addTearDown(model.dispose);

      model.delete(DataPath.parse('/items/0'));
      expect(model.get('/items'), [null, 'y']);

      model.delete(DataPath.parse('/items/99'));
      expect(model.get('/items'), [null, 'y']);
    });

    test('hasPath distinguishes explicit null from absent key', () {
      final model = DataModel({
        'explicitNull': null,
        'items': ['a', null],
      });
      addTearDown(model.dispose);

      expect(model.hasPath('/'), isTrue);
      expect(model.hasPath('/explicitNull'), isTrue);
      expect(model.hasPath(DataPath.parse('/explicitNull')), isTrue);
      expect(model.hasPath('/missingKey'), isFalse);
      expect(model.hasPath('/explicitNull/child'), isFalse);
      expect(model.hasPath('/items/0'), isTrue);
      expect(model.hasPath('/items/1'), isTrue);
      expect(model.hasPath('/items/2'), isFalse);
      expect(model.hasPath('/items/nonNumeric'), isFalse);
    });

    test('static resolvePath resolves relative, absolute, empty, and dot paths',
        () {
      expect(DataModel.resolvePath('/abs/path', '/base'), '/abs/path');
      expect(DataModel.resolvePath('rel', '/base'), '/base/rel');
      expect(DataModel.resolvePath('rel/sub', '/base/'), '/base/rel/sub');
      expect(DataModel.resolvePath('rel/sub', '/base///'), '/base/rel/sub');
      expect(DataModel.resolvePath('standalone'), '/standalone');
      expect(DataModel.resolvePath('standalone', '/'), '/standalone');
      expect(DataModel.resolvePath('', '/user'), '/user');
      expect(DataModel.resolvePath('', '/user/'), '/user');
      expect(DataModel.resolvePath('.', '/user'), '/user');
      expect(DataModel.resolvePath('', '/'), '/');
      expect(DataModel.resolvePath('.', '/'), '/');
      expect(DataModel.resolvePath(''), '/');
      expect(DataModel.resolvePath('.'), '/');
    });

    test('get and set reject malformed tilde escapes directly on DataModel',
        () {
      final model = DataModel({'a': 1});
      addTearDown(model.dispose);

      expect(() => model.get('/a~2b'), throwsA(isA<A2uiDataError>()));
      expect(() => model.set('/a~', 1), throwsA(isA<A2uiDataError>()));
      expect(() => model.hasPath('/a~2b'), throwsA(isA<A2uiDataError>()));
      expect(() => model.delete('/a~'), throwsA(isA<A2uiDataError>()));
    });
  });
}
