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
import 'package:test/test.dart';

void main() {
  group('CancellationSignal', () {
    test('notifies listeners on cancel', () {
      final signal = CancellationSignal();
      var called = false;
      signal.addListener(() => called = true);

      signal.cancel();
      expect(called, true);
      expect(signal.isCancelled, true);
    });

    test('fires listener immediately if already cancelled', () {
      final signal = CancellationSignal();
      signal.cancel();

      var called = false;
      signal.addListener(() => called = true);
      expect(called, true);
    });

    test('cancel is idempotent', () {
      final signal = CancellationSignal();
      var callCount = 0;
      signal.addListener(() => callCount++);

      signal.cancel();
      signal.cancel();
      expect(callCount, 1);
    });

    test('listener removing itself during cancel does not throw', () {
      final signal = CancellationSignal();
      late void Function() selfRemover;
      selfRemover = () {
        signal.removeListener(selfRemover);
      };
      signal.addListener(selfRemover);

      // Should not throw ConcurrentModificationError.
      signal.cancel();
    });

    test('throwIfCancelled throws after cancel', () {
      final signal = CancellationSignal();
      signal.throwIfCancelled(); // should not throw

      signal.cancel();
      expect(signal.throwIfCancelled, throwsA(isA<CancellationException>()));
    });

    test('timeout constructor cancels with injected timer', () {
      void Function()? timerCallback;
      final signal = CancellationSignal.timeout(
        const Duration(seconds: 5),
        timerFactory: (duration, callback) {
          timerCallback = callback;
          return _MockTimer();
        },
      );

      expect(signal.isCancelled, false);
      expect(timerCallback, isNotNull);

      // Trigger timer callback
      timerCallback!();
      expect(signal.isCancelled, true);
    });
  });
}

class _MockTimer implements Timer {
  bool isCancelled = false;

  @override
  void cancel() {
    isCancelled = true;
  }

  @override
  bool get isActive => !isCancelled;

  @override
  int get tick => 0;
}
