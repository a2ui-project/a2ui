// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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
  });
}
