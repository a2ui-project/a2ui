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
import 'package:logging/logging.dart';
import 'package:test/test.dart';

void main() {
  group('EventNotifier', () {
    test('notifies all registered listeners in order', () {
      final notifier = EventNotifier<int>();
      final received = <int>[];

      notifier.subscribe((e) => received.add(e * 10));
      notifier.subscribe((e) => received.add(e * 100));

      notifier.emit(3);

      expect(received, [30, 300]);
    });

    test(
        'isolates throwing listener, logs severe error, and notifies '
        'remaining listeners', () {
      final notifier = EventNotifier<String>();
      final received = <String>[];
      final records = <LogRecord>[];

      final Level previousLevel = Logger.root.level;
      Logger.root.level = Level.ALL;
      final StreamSubscription<LogRecord> sub =
          Logger.root.onRecord.listen(records.add);
      addTearDown(() async {
        await sub.cancel();
        Logger.root.level = previousLevel;
      });

      notifier.subscribe((e) => received.add('first:$e'));
      notifier.subscribe((_) => throw StateError('listener boom'));
      notifier.subscribe((e) => received.add('third:$e'));

      expect(() => notifier.emit('ping'), returnsNormally);
      expect(received, ['first:ping', 'third:ping']);

      final Iterable<LogRecord> notifierRecords = records.where(
        (r) => r.loggerName == 'a2ui.EventNotifier' && r.level == Level.SEVERE,
      );
      expect(notifierRecords, hasLength(1));
      expect(notifierRecords.single.error, isA<StateError>());
      expect(notifierRecords.single.stackTrace, isNotNull);
    });

    test(
        'allows listeners to be added or removed during emit without '
        'concurrent modification error', () {
      final notifier = EventNotifier<int>();
      final received = <String>[];

      late Subscription selfSub;
      selfSub = notifier.subscribe((event) {
        received.add('selfRemoving:$event');
        selfSub.unsubscribe();
        notifier.subscribe((e) => received.add('addedDuringEmit:$e'));
      });
      notifier.subscribe((e) => received.add('second:$e'));

      notifier.emit(1);
      expect(received, ['selfRemoving:1', 'second:1']);

      received.clear();
      notifier.emit(2);
      expect(received, ['second:2', 'addedDuringEmit:2']);
    });

    test(
        'skips a subsequent listener that was unsubscribed by an earlier '
        'listener during emit', () {
      final notifier = EventNotifier<int>();
      final received = <String>[];

      late Subscription secondSub;
      notifier.subscribe((event) {
        received.add('first:$event');
        secondSub.unsubscribe();
      });
      secondSub = notifier.subscribe((event) {
        received.add('second:$event');
      });
      notifier.subscribe((event) {
        received.add('third:$event');
      });

      notifier.emit(1);
      expect(received, ['first:1', 'third:1']);
    });

    test('Subscription.unsubscribe stops notifications and is idempotent', () {
      final notifier = EventNotifier<int>();
      final received = <int>[];
      final Subscription sub = notifier.subscribe(received.add);

      notifier.emit(1);
      expect(received, [1]);

      sub.unsubscribe();
      sub.unsubscribe();
      notifier.emit(2);
      expect(received, [1]);
    });

    test('supports duplicate subscriptions of the same function independently',
        () {
      final notifier = EventNotifier<int>();
      final received = <int>[];
      void handler(int value) => received.add(value);

      final Subscription sub1 = notifier.subscribe(handler);
      final Subscription sub2 = notifier.subscribe(handler);

      notifier.emit(1);
      expect(received, [1, 1]);

      sub1.unsubscribe();
      received.clear();

      notifier.emit(2);
      expect(received, [2]);

      sub2.unsubscribe();
      received.clear();

      notifier.emit(3);
      expect(received, isEmpty);
    });

    test('dispose clears all listeners and makes subsequent subscribe a no-op',
        () {
      final notifier = EventNotifier<int>();
      var count = 0;
      notifier.subscribe((_) => count++);

      notifier.dispose();
      final Subscription postDispose = notifier.subscribe((_) => count++);
      postDispose.unsubscribe();
      notifier.emit(1);

      expect(count, 0);
    });
  });
}
