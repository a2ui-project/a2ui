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
  });

  group('DataModel owns what it holds', () {
    test('a const seed does not make later writes throw', () {
      const seed = <String, Object?>{
        'form': <String, Object?>{'email': ''},
      };
      final model = DataModel(seed);

      model.set('/form/email', 'a@b.com');

      expect(model.get('/form/email'), 'a@b.com');
    });

    test('a const value set at the root behaves the same', () {
      const seed = <String, Object?>{
        'form': <String, Object?>{'email': ''},
      };
      final model = DataModel();
      model.set('', seed);

      model.set('/form/email', 'a@b.com');

      expect(model.get('/form/email'), 'a@b.com');
    });

    test('a const value set at a path behaves the same', () {
      const branch = <String, Object?>{'email': ''};
      final model = DataModel();
      model.set('/form', branch);

      model.set('/form/email', 'a@b.com');

      expect(model.get('/form/email'), 'a@b.com');
    });

    test('a const list set at a path behaves the same', () {
      const rows = <Object?>[
        <String, Object?>{'label': 'one'},
      ];
      final model = DataModel();
      model.set('/rows', rows);

      model.set('/rows/0/label', 'two');

      expect(model.get('/rows/0/label'), 'two');
    });

    test('mutating the seed afterwards does not reach inside the model', () {
      final seed = <String, Object?>{
        'form': <String, Object?>{'email': 'first'},
      };
      final model = DataModel(seed);

      (seed['form']! as Map<String, Object?>)['email'] = 'second';

      expect(model.get('/form/email'), 'first');
    });

    test('writing does not reach back out into the caller\'s value', () {
      final value = <String, Object?>{'email': 'first'};
      final model = DataModel();
      model.set('/form', value);

      model.set('/form/email', 'second');

      expect(value['email'], 'first');
      expect(model.get('/form/email'), 'second');
    });

    test('a map with dynamic keys reads back, rather than as absent', () {
      // Some JSON decoders hand back Map<dynamic, dynamic>, and the reader
      // tests for Map<String, Object?>.
      final decoded = <dynamic, dynamic>{
        'form': <dynamic, dynamic>{'email': 'a@b.com'},
      };
      final model = DataModel(decoded);

      expect(model.get('/form/email'), 'a@b.com');
    });

    test('a map with non-string keys is a value and is left alone', () {
      final model = DataModel();
      model.set('/byIndex', {1: 'one', 2: 'two'});

      expect(model.get('/byIndex'), {1: 'one', 2: 'two'});
    });

    test('scalars are not copied', () {
      final model = DataModel();
      model.set('/n', 3);
      model.set('/s', 'text');
      model.set('/b', true);

      expect(model.get('/n'), 3);
      expect(model.get('/s'), 'text');
      expect(model.get('/b'), true);
    });
  });
}
