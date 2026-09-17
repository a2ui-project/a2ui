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

import 'package:a2ui_flutter/src/model/data_model.dart';
import 'package:a2ui_flutter/src/primitives/logging.dart';
import 'package:flutter/src/foundation/change_notifier.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:logging/logging.dart';

void main() {
  group('DataContext', () {
    late DataModel dataModel;
    late DataContext rootContext;

    setUp(() {
      dataModel = InMemoryDataModel();
      rootContext = DataContext(dataModel, DataPath.root);
    });

    test('resolves absolute paths', () {
      final path = DataPath('/a/b');
      expect(rootContext.resolvePath(path), path);
    });

    test('resolves relative paths', () {
      final path = DataPath('a/b');
      expect(rootContext.resolvePath(path), DataPath('/a/b'));
    });

    test('nested creates a new context', () {
      final DataContext nested = rootContext.nested(DataPath('a'));
      expect(nested.path, DataPath('/a'));
    });
  });

  group('DataModel', () {
    late DataModel dataModel;

    setUp(() {
      dataModel = InMemoryDataModel();
    });

    test('update with root path replaces the model', () {
      dataModel.update(DataPath.root, {'a': 1});
      expect(dataModel.getValue<int>(DataPath('/a')), 1);
    });

    test('update with root path replaces the model', () {
      dataModel.update(DataPath.root, {'a': 1});
      expect(dataModel.getValue<int>(DataPath('/a')), 1);
    });

    test('update sets a value', () {
      dataModel.update(DataPath('/a'), 1);
      expect(dataModel.getValue<int>(DataPath('/a')), 1);
    });

    test('update sets a nested value', () {
      dataModel.update(DataPath('/a/b'), 1);
      expect(dataModel.getValue<int>(DataPath('/a/b')), 1);
    });

    test('getValue returns null for non-existent paths', () {
      expect(dataModel.getValue<Object?>(DataPath('/a')), isNull);
    });

    group('subscribe', () {
      test('notifies on direct updates', () {
        final ValueNotifier<int?> notifier = dataModel.subscribe<int>(
          DataPath('/a'),
        );
        int? value;
        notifier.addListener(() => value = notifier.value);
        dataModel.update(DataPath('/a'), 1);
        expect(value, 1);
      });

      test('notifies on child updates', () {
        final ValueNotifier<Map<Object?, Object?>?> notifier = dataModel
            .subscribe<Map<Object?, Object?>>(DataPath('/a'));
        Map<Object?, Object?>? value;
        notifier.addListener(() => value = notifier.value);
        dataModel.update(DataPath('/a/b'), 1);
        expect(value, {'b': 1});
      });

      test('notifies on parent updates', () {
        dataModel.update(DataPath('/a/b'), 1);
        final ValueNotifier<int?> notifier = dataModel.subscribe<int>(
          DataPath('/a/b'),
        );
        int? value;
        notifier.addListener(() => value = notifier.value);
        dataModel.update(DataPath('/a'), {'b': 2});
        expect(value, 2);
      });
    });

    group('dispose', () {
      test('does not forcibly dispose subscriptions', () {
        final ValueNotifier<int?> notifier = dataModel.subscribe<int>(
          DataPath('/a'),
        );

        // Trigger data model dispose
        expect(() => dataModel.dispose(), returnsNormally);

        // The UI widget would naturally call dispose later.
        // If the model had forcefully disposed it, this would now log a
        // warning.
        expect(notifier.dispose, returnsNormally);
      });

      test('multiple dispose on subscription is safe and logs warning', () {
        final ValueNotifier<int?> notifier = dataModel.subscribe<int>(
          DataPath('/a'),
        );

        notifier.dispose();

        final List<LogRecord> logRecords = [];
        final StreamSubscription<LogRecord> sub = genUiLogger.onRecord.listen(
          logRecords.add,
        );

        // Disposing again should be a no-op & log a warning
        expect(notifier.dispose, returnsNormally);

        expect(logRecords, hasLength(1));
        expect(logRecords.first.level, Level.WARNING);
        expect(logRecords.first.message, contains('Attempt to dispose'));

        sub.cancel();
      });
    });

    group('DataModel Extended', () {
      late DataModel dataModel;

      setUp(() {
        dataModel = InMemoryDataModel();
      });

      test('getValue throws DataModelTypeException on type mismatch', () {
        dataModel.update(DataPath.root, {'a': 'hello'});
        expect(
          () => dataModel.getValue<int>(DataPath('/a')),
          throwsA(isA<DataModelTypeException>()),
        );
      });

      test('bindExternalState cleanup removes listeners', () {
        final source = ValueNotifier<int>(0);

        // Act
        final void Function() cleanup = dataModel.bindExternalState(
          path: DataPath('/a'),
          source: source,
          twoWay: true,
        );

        // Verify binding active
        dataModel.update(DataPath('/a'), 1);
        expect(source.value, 1);

        // Cleanup
        cleanup();

        // Verify listeners removed
        // source has no listeners if we were the only one and we removed
        // ourselves.
        // ignore: invalid_use_of_protected_member
        expect(source.hasListeners, isFalse);
      });
    });

    group('DataModel Update Parsing', () {
      test('parses contents with simple string', () {
        dataModel.update(DataPath.root, {'a': 'hello'});
        expect(dataModel.getValue<String>(DataPath('/a')), 'hello');
      });

      test('parses contents with simple number', () {
        dataModel.update(DataPath.root, {'b': 123});
        expect(dataModel.getValue<int>(DataPath('/b')), 123);
      });

      test('parses contents with simple boolean', () {
        dataModel.update(DataPath.root, {'c': true});
        expect(dataModel.getValue<bool>(DataPath('/c')), isTrue);
      });

      test('parses contents with simple map', () {
        dataModel.update(DataPath.root, {
          'd': {'d1': 'v1', 'd2': 2},
        });
        expect(dataModel.getValue<Map<Object?, Object?>>(DataPath('/d')), {
          'd1': 'v1',
          'd2': 2,
        });
      });

      test('handles empty contents map', () {
        dataModel.update(DataPath('/a'), {'b': 1}); // Initial data
        dataModel.update(DataPath.root, {});
        // Root update merges into the root model.
        // Verify it doesn't crash.
      });
    });
  });

  group('DataModel External State Binding', () {
    late DataModel dataModel;

    setUp(() {
      dataModel = InMemoryDataModel();
    });

    test('bindExternalState initializes model from source', () {
      final source = ValueNotifier<int>(42);
      dataModel.bindExternalState(path: DataPath('/external'), source: source);
      expect(dataModel.getValue<int>(DataPath('/external')), 42);
    });

    test('bindExternalState updates model when source changes', () {
      final source = ValueNotifier<int>(0);
      dataModel.bindExternalState(path: DataPath('/external'), source: source);

      source.value = 10;
      expect(dataModel.getValue<int>(DataPath('/external')), 10);
    });

    test(
      'bindExternalState updates source when model changes (twoWay=true)',
      () {
        final source = ValueNotifier<int>(0);
        dataModel.bindExternalState(
          path: DataPath('/external'),
          source: source,
          twoWay: true,
        );

        dataModel.update(DataPath('/external'), 99);
        expect(source.value, 99);
      },
    );

    test(
      '''bindExternalState does NOT update source when model changes (twoWay=false)''',
      () {
        final source = ValueNotifier<int>(0);
        dataModel.bindExternalState(
          path: DataPath('/external'),
          source: source,
          twoWay: false,
        );

        dataModel.update(DataPath('/external'), 99);
        expect(source.value, 0);
      },
    );

    test('bindExternalState handles cleanup on dispose', () {
      final source = ValueNotifier<int>(0);
      dataModel.bindExternalState(
        path: DataPath('/external'),
        source: source,
        twoWay: true,
      );

      dataModel.dispose();
    });
  });

  group('DataModel _getValue and _updateValue consistency', () {
    late DataModel dataModel;

    setUp(() {
      dataModel = InMemoryDataModel();
    });

    test('Map: set and get', () {
      dataModel.update(DataPath('/a/b'), 1);
      expect(dataModel.getValue<int>(DataPath('/a/b')), 1);
    });

    test('List: set and get', () {
      dataModel.update(DataPath('/a/0'), 'hello');
      expect(dataModel.getValue<String>(DataPath('/a/0')), 'hello');
    });

    test('List: append and get', () {
      dataModel.update(DataPath('/a/0'), 'hello');
      dataModel.update(DataPath('/a/1'), 'world');
      expect(dataModel.getValue<String>(DataPath('/a/0')), 'hello');
      expect(dataModel.getValue<String>(DataPath('/a/1')), 'world');
    });

    test('Nested Map/List: set and get', () {
      dataModel.update(DataPath('/a/b/0/c'), 123);
      expect(dataModel.getValue<int>(DataPath('/a/b/0/c')), 123);
    });

    test('Map: non-existent key returns null', () {
      dataModel.update(DataPath('/a/b'), 1);
      expect(dataModel.getValue<int>(DataPath('/a/c')), isNull);
    });

    test('List: out of bounds index returns null', () {
      dataModel.update(DataPath('/a/0'), 'hello');
      expect(dataModel.getValue<String>(DataPath('/a/1')), isNull);
    });

    test('List: update existing index', () {
      dataModel.update(DataPath('/a/0'), 'hello');
      dataModel.update(DataPath('/a/0'), 'world');
      expect(dataModel.getValue<String>(DataPath('/a/0')), 'world');
    });

    test('Empty path on getValue returns current data', () {
      dataModel.update(DataPath('/a'), {'b': 1});
      expect(dataModel.getValue<Map<Object?, Object?>>(DataPath('/a')), {
        'b': 1,
      });
    });

    test('Nested structures are created automatically', () {
      dataModel.update(DataPath('/a/b/0/c'), 123);
      expect(
        dataModel.getValue<int>(DataPath('/a/b/0/c')),
        123,
        reason: 'Should create nested map and list',
      );

      dataModel.update(DataPath('/x/y/z'), 'hello');
      expect(
        dataModel.getValue<String>(DataPath('/x/y/z')),
        'hello',
        reason: 'Should create nested maps',
      );

      dataModel.update(DataPath('/list/0/0'), 'inner list');
      expect(
        dataModel.getValue<String>(DataPath('/list/0/0')),
        'inner list',
        reason: 'Should create nested lists',
      );
    });
  });

  group('DataContext Stream Evaluation', () {
    late DataModel dataModel;
    late DataContext context;

    setUp(() {
      dataModel = InMemoryDataModel();
      context = DataContext(dataModel, DataPath.root);
    });

    test('subscribeStream yields initial and subsequent values', () async {
      dataModel.update(DataPath('/a'), 1);
      final Stream<int?> stream = context.subscribeStream<int>(DataPath('/a'));

      final values = <int?>[];
      final StreamSubscription<int?> sub = stream.listen(values.add);

      dataModel.update(DataPath('/a'), 2);
      await Future<void>.delayed(Duration.zero);

      expect(values, [1, 2]);
      await sub.cancel();
    });

    test('evaluateConditionStream evaluates booleans from path', () async {
      dataModel.update(DataPath('/flag'), true);
      // Pass a map that resolves to /flag
      final condition = {'path': '/flag'};
      final Stream<bool> stream = context.evaluateConditionStream(condition);

      final values = <bool>[];
      final StreamSubscription<bool> sub = stream.listen(values.add);

      dataModel.update(DataPath('/flag'), false);
      await Future<void>.delayed(Duration.zero);

      expect(values, [true, false]);
      await sub.cancel();
    });

    test('evaluateConditionStream handles null condition as false', () async {
      final Stream<bool> stream = context.evaluateConditionStream(null);
      expect(await stream.first, isFalse);
    });

    test('evaluateConditionStream handles literal bool condition', () async {
      final Stream<bool> stream = context.evaluateConditionStream(true);
      expect(await stream.first, isTrue);
    });

    test(
      'evaluateConditionStream treats non-null non-bool objects as true',
      () async {
        dataModel.update(DataPath('/str'), 'hello');
        final condition = {'path': '/str'};
        final Stream<bool> stream = context.evaluateConditionStream(condition);
        expect(await stream.first, isTrue); // 'hello' != null
      },
    );
  });
}
