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

import 'package:logging/logging.dart';

final Logger _logger = Logger('a2ui.EventNotifier');

/// A handle for cancelling an active subscription.
abstract interface class Subscription {
  /// Unregisters the listener. Calling [unsubscribe] more than once is a no-op.
  void unsubscribe();
}

/// An interface for subscribing to events of type [T].
abstract interface class EventSource<T> {
  /// Subscribes [listener] to receive events emitted by this source.
  ///
  /// Returns a [Subscription] whose [Subscription.unsubscribe] method removes
  /// [listener].
  Subscription subscribe(void Function(T event) listener);
}

class _CallbackSubscription<T> implements Subscription {
  final EventNotifier<T> _notifier;
  void Function(T event)? _listener;

  _CallbackSubscription(this._notifier, this._listener);

  @override
  void unsubscribe() {
    final void Function(T event)? listener = _listener;
    if (listener == null) return;
    _listener = null;
    _notifier._listeners.remove(listener);
  }
}

/// A synchronous, typed event emitter for discrete events.
class EventNotifier<T> implements EventSource<T> {
  final List<void Function(T event)> _listeners = [];
  bool _isDisposed = false;

  /// Emits an event to all subscribed listeners.
  void emit(T event) {
    if (_listeners.isEmpty) return;
    // Iterate over a copy to allow listeners to unsubscribe themselves.
    for (final void Function(T event) listener in List.of(_listeners)) {
      try {
        listener(event);
      } catch (e, st) {
        _logger.severe('Error in EventNotifier listener', e, st);
      }
    }
  }

  @override
  Subscription subscribe(void Function(T event) listener) {
    if (_isDisposed) return _CallbackSubscription<T>(this, null);
    _listeners.add(listener);
    return _CallbackSubscription<T>(this, listener);
  }

  /// Removes all listeners.
  void dispose() {
    _isDisposed = true;
    _listeners.clear();
  }
}
