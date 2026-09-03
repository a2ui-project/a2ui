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

class CancellationSignal {
  bool _isCancelled = false;

  final _listeners = <void Function()>[];

  CancellationSignal();

  /// Creates a [CancellationSignal] that automatically cancels after [duration].
  ///
  /// An optional [timerFactory] can be injected for deterministic testing.
  factory CancellationSignal.timeout(
    Duration duration, {
    Timer Function(Duration duration, void Function() callback)? timerFactory,
  }) {
    final signal = CancellationSignal();
    final createTimer = timerFactory ?? Timer.new;
    final timer = createTimer(duration, signal.cancel);
    signal.addListener(timer.cancel);
    return signal;
  }

  /// Whether the operation has been cancelled.
  bool get isCancelled => _isCancelled;

  /// Cancels the operation.
  void cancel() {
    if (_isCancelled) return;
    _isCancelled = true;
    final List<void Function()> listeners = List.of(_listeners);
    _listeners.clear();
    for (final listener in listeners) {
      listener();
    }
  }

  /// Adds a listener to be notified when the operation is cancelled.
  void addListener(void Function() listener) {
    if (_isCancelled) {
      listener();
    } else {
      _listeners.add(listener);
    }
  }

  /// Removes a listener.
  void removeListener(void Function() listener) {
    _listeners.remove(listener);
  }

  /// Throws a [CancellationException] if the operation has been cancelled.
  void throwIfCancelled() {
    if (_isCancelled) {
      throw const CancellationException();
    }
  }
}

/// An exception thrown when an operation is cancelled.
class CancellationException implements Exception {
  /// Creates a [CancellationException].
  const CancellationException([this.message]);

  /// A message describing the cancellation.
  final String? message;

  @override
  String toString() => message == null
      ? 'CancellationException'
      : 'CancellationException: $message';
}
