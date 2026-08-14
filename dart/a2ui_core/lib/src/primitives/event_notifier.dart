// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/// Read-only interface for subscribing to discrete events.
abstract interface class EventListenable<T> {
  /// Registers [listener] to be called whenever an event is emitted.
  void addListener(void Function(T event) listener);

  /// Removes a previously registered [listener].
  void removeListener(void Function(T event) listener);
}

/// A synchronous, typed event emitter for discrete events.
class EventNotifier<T> implements EventListenable<T> {
  final List<void Function(T event)> _listeners = [];

  /// Emits an event to all registered listeners.
  void emit(T event) {
    // Iterate over a copy to allow listeners to remove themselves.
    for (final void Function(T event) listener in List.of(_listeners)) {
      listener(event);
    }
  }

  @override
  void addListener(void Function(T event) listener) {
    _listeners.add(listener);
  }

  @override
  void removeListener(void Function(T event) listener) {
    _listeners.remove(listener);
  }

  /// Removes all listeners.
  void dispose() {
    _listeners.clear();
  }
}
