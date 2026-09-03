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
  group('Clock Primitives', () {
    test('systemClock returns current time', () {
      final before = DateTime.now();
      final current = systemClock();
      final after = DateTime.now();

      expect(
        current.isAfter(before.subtract(const Duration(seconds: 1))) ||
            current.isAtSameMomentAs(before),
        isTrue,
      );
      expect(
        current.isBefore(after.add(const Duration(seconds: 1))) ||
            current.isAtSameMomentAs(after),
        isTrue,
      );
    });

    test(
      'FakeClock default constructor initializes to 2026-01-01T00:00:00Z',
      () {
        final clock = FakeClock();
        expect(clock.now, equals(DateTime.utc(2026, 1, 1, 0, 0, 0)));
        expect(clock(), equals(DateTime.utc(2026, 1, 1, 0, 0, 0)));
      },
    );

    test('FakeClock accepts custom initial time', () {
      final customTime = DateTime.utc(2026, 8, 14, 13, 15, 30);
      final clock = FakeClock(customTime);
      expect(clock.now, equals(customTime));
      expect(clock(), equals(customTime));
    });

    test('FakeClock.advance moves time forward', () {
      final start = DateTime.utc(2026, 6, 15, 10, 0, 0);
      final clock = FakeClock(start);

      clock.advance(const Duration(minutes: 5, seconds: 30));
      expect(clock.now, equals(DateTime.utc(2026, 6, 15, 10, 5, 30)));
      expect(clock(), equals(DateTime.utc(2026, 6, 15, 10, 5, 30)));
    });

    test('FakeClock.set explicitly sets time', () {
      final clock = FakeClock();
      final newTime = DateTime.utc(2030, 12, 31, 23, 59, 59);

      clock.set(newTime);
      expect(clock.now, equals(newTime));
      expect(clock(), equals(newTime));
    });

    test('FakeClock behaves as a Clock callable typedef', () {
      final fixed = DateTime.utc(2026, 1, 1, 12, 0, 0);
      final fake = FakeClock(fixed);

      DateTime getTime(Clock clk) => clk();

      expect(getTime(fake), equals(fixed));
      fake.advance(const Duration(seconds: 10));
      expect(getTime(fake), equals(DateTime.utc(2026, 1, 1, 12, 0, 10)));
    });
  });
}
