// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'package:a2ui_core/src/core/data_model.dart';
import 'package:a2ui_core/src/primitives/errors.dart';
import 'package:a2ui_core/src/primitives/reactivity.dart';
import 'package:test/test.dart';

void main() {
  group('DataModel', () {
    test('gets and sets root data', () {
      final model = DataModel({'foo': 'bar'});
      expect(model.get('/'), {'foo': 'bar'});

      model.set('/', {'baz': 'qux'});
      expect(model.get('/'), {'baz': 'qux'});
    });

    test('gets and sets nested data', () {
      final model = DataModel();
      model.set('/user/name', 'Alice');
      expect(model.get('/user/name'), 'Alice');
      expect(model.get('/user'), {'name': 'Alice'});
    });

    test('auto-vivifies maps and lists', () {
      final model = DataModel();
      model.set('/users/0/name', 'Alice');
      expect(model.get('/users'), isA<List<dynamic>>());
      expect(model.get('/users/0'), isA<Map<dynamic, dynamic>>());
      expect(model.get('/users/0/name'), 'Alice');
    });

    test('notifies exact path changes', () {
      final model = DataModel();
      final ReadonlySignal<Object?> watch = model.watch('/foo');
      var changeCount = 0;
      watch.subscribe((_) => changeCount++);
      changeCount = 0; // ignore initial subscribe callback

      model.set('/foo', 'bar');
      expect(changeCount, 1);
      expect(watch.value, 'bar');
    });

    test('notifies ancestor changes (bubble)', () {
      final model = DataModel();
      final ReadonlySignal<Object?> watch = model.watch('/user');
      var changeCount = 0;
      watch.subscribe((_) => changeCount++);
      changeCount = 0;

      model.set('/user/name', 'Alice');
      expect(changeCount, 1);
      expect(watch.value, {'name': 'Alice'});
    });

    test('notifies descendant changes (cascade)', () {
      final model = DataModel();
      model.set('/user', {'name': 'Alice'});

      final ReadonlySignal<Object?> watch = model.watch('/user/name');
      var changeCount = 0;
      watch.subscribe((_) => changeCount++);
      changeCount = 0;

      model.set('/user', {'name': 'Bob'});
      expect(changeCount, 1);
      expect(watch.value, 'Bob');
    });

    test('notifies root watch on any change', () {
      final model = DataModel();
      final ReadonlySignal<Object?> watch = model.watch('/');
      var changeCount = 0;
      watch.subscribe((_) => changeCount++);
      changeCount = 0;

      model.set('/foo', 'bar');
      expect(changeCount, 1);
    });

    test('notifies descendant watches on root changes', () {
      final model = DataModel({
        'user': {'name': 'Alice'},
        'stale': 'present',
      });
      final ReadonlySignal<Object?> nameWatch = model.watch('/user/name');
      final ReadonlySignal<Object?> staleWatch = model.watch('/stale');
      var nameChangeCount = 0;
      var staleChangeCount = 0;
      nameWatch.subscribe((_) => nameChangeCount++);
      staleWatch.subscribe((_) => staleChangeCount++);
      nameChangeCount = 0;
      staleChangeCount = 0;

      model.set('/', {
        'user': {'name': 'Bob'},
      });

      expect(nameChangeCount, 1);
      expect(nameWatch.value, 'Bob');
      expect(staleChangeCount, 1);
      expect(staleWatch.value, isNull);
    });

    test('notifies root watch on root set', () {
      final model = DataModel({'foo': 'bar'});
      final ReadonlySignal<Object?> rootWatch = model.watch('/');
      var changeCount = 0;
      rootWatch.subscribe((_) => changeCount++);
      changeCount = 0;

      model.set('/', {'baz': 'qux'});
      expect(changeCount, 1);
      expect(rootWatch.value, {'baz': 'qux'});
    });

    test('does not notify unrelated paths', () {
      final model = DataModel({'a': 1, 'b': 2});
      final ReadonlySignal<Object?> bWatch = model.watch('/b');
      var bChangeCount = 0;
      bWatch.subscribe((_) => bChangeCount++);
      bChangeCount = 0;

      model.set('/a', 99);
      expect(bChangeCount, 0);
    });

    test('does not notify a sibling whose name shares a prefix', () {
      final model = DataModel({'foo': 1, 'foobar': 2});
      final ReadonlySignal<Object?> foobarWatch = model.watch('/foobar');
      var foobarChangeCount = 0;
      foobarWatch.subscribe((_) => foobarChangeCount++);
      foobarChangeCount = 0;

      model.set('/foo', 99);
      expect(foobarChangeCount, 0);
    });

    test('removes keys when setting null', () {
      final model = DataModel({'foo': 'bar'});
      model.set('/foo', null);
      expect(model.get('/'), isEmpty);
    });

    test('rejects excessively large list indices to prevent OOM', () {
      final model = DataModel();
      expect(
        () => model.set('/items/999999999/name', 'x'),
        throwsA(isA<A2uiDataError>()),
      );
      expect(
        () => model.set('/items/999999999', 'x'),
        throwsA(isA<A2uiDataError>()),
      );
    });
  });
}
