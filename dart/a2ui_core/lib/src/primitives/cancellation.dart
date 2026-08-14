// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/// A signal that can be used to cancel an operation.
class CancellationSignal {
  bool _isCancelled = false;

  final _listeners = <void Function()>[];

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
