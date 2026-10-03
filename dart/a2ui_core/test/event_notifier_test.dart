// Copyright 2026 Google LLC
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

import 'package:a2ui_core/src/primitives/event_notifier.dart';
import 'package:logging/logging.dart';
import 'package:test/test.dart';

void main() {
  group('EventNotifier', () {
    test('notifies all registered listeners in order', () {
      final notifier = EventNotifier<int>();
      final received = <int>[];

      notifier.addListener((e) => received.add(e * 10));
      notifier.addListener((e) => received.add(e * 100));

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

      notifier.addListener((e) => received.add('first:$e'));
      notifier.addListener((_) => throw StateError('listener boom'));
      notifier.addListener((e) => received.add('third:$e'));

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

      late void Function(int) selfRemoving;
      selfRemoving = (event) {
        received.add('selfRemoving:$event');
        notifier.removeListener(selfRemoving);
        notifier.addListener((e) => received.add('addedDuringEmit:$e'));
      };

      notifier.addListener(selfRemoving);
      notifier.addListener((e) => received.add('second:$e'));

      notifier.emit(1);
      expect(received, ['selfRemoving:1', 'second:1']);

      received.clear();
      notifier.emit(2);
      expect(received, ['second:2', 'addedDuringEmit:2']);
    });

    test('dispose clears all listeners', () {
      final notifier = EventNotifier<int>();
      var count = 0;
      notifier.addListener((_) => count++);

      notifier.dispose();
      notifier.emit(1);

      expect(count, 0);
    });
  });
}
