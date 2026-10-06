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
    if (_listeners.isEmpty) return;
    // Iterate over a copy to allow listeners to remove themselves.
    for (final void Function(T event) listener in List.of(_listeners)) {
      try {
        listener(event);
      } catch (e, st) {
        _logger.severe('Error in EventNotifier listener', e, st);
      }
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
