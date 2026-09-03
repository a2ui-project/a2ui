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

/// A function signature for providing the current time.
typedef Clock = DateTime Function();

/// Default system clock provider returning [DateTime.now].
DateTime systemClock() => DateTime.now();

/// A controllable monotonic fake clock for deterministic testing and timing control.
class FakeClock {
  DateTime _now;

  /// Creates a [FakeClock] initialized to [initialTime] (defaults to 2026-01-01 00:00:00.000Z).
  FakeClock([DateTime? initialTime])
    : _now = initialTime ?? DateTime.utc(2026, 1, 1, 0, 0, 0);

  /// Current timestamp of this clock.
  DateTime get now => _now;

  /// Invoking the fake clock returns the current [DateTime].
  DateTime call() => _now;

  /// Explicitly sets the clock to [time].
  void set(DateTime time) {
    _now = time;
  }

  /// Advances the fake clock forward by [duration].
  void advance(Duration duration) {
    _now = _now.add(duration);
  }
}
