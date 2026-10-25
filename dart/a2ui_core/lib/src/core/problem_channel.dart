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
import 'dart:collection';

/// A FIFO queue of error and warning deliveries that runs them only during a
/// drain.
///
/// A drain runs at the end of the outermost [runMessage], or in a microtask
/// scheduled by a delivery that arrives while no message scope is open.
/// While [guardResolution] is on the stack, the end of a message scope
/// schedules the microtask instead. Deliveries that arrive during a drain are
/// run by that drain.
class ProblemChannel {
  final Queue<void Function()> _deliveries = Queue();
  int _messageDepth = 0;
  bool _draining = false;
  bool _drainScheduled = false;

  static int _resolutionDepth = 0;

  /// Runs [body] with every channel's message-end drain deferred to a
  /// microtask.
  static R guardResolution<R>(R Function() body) {
    _resolutionDepth++;
    try {
      return body();
    } finally {
      _resolutionDepth--;
    }
  }

  /// Runs [body] as one message, draining when it returns or throws, unless
  /// another message scope, a drain or [guardResolution] is open.
  R runMessage<R>(R Function() body) {
    _messageDepth++;
    try {
      return body();
    } finally {
      _messageDepth--;
      if (_messageDepth == 0 && _deliveries.isNotEmpty) {
        if (_resolutionDepth > 0) {
          _scheduleDrain();
        } else {
          _drain();
        }
      }
    }
  }

  /// Queues [deliver], which emits one error or warning to its listeners.
  void enqueue(void Function() deliver) {
    _deliveries.add(deliver);
    _scheduleDrain();
  }

  void _scheduleDrain() {
    if (_messageDepth > 0 || _draining || _drainScheduled) return;
    _drainScheduled = true;
    scheduleMicrotask(() {
      _drainScheduled = false;
      _drain();
    });
  }

  void _drain() {
    if (_draining) return;
    _draining = true;
    try {
      while (_deliveries.isNotEmpty) {
        _deliveries.removeFirst()();
      }
    } finally {
      _draining = false;
    }
  }
}
