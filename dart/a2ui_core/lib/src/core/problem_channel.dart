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

import 'package:logging/logging.dart';

import '../primitives/event_notifier.dart';
import 'messages.dart';
import 'surface_model.dart' show A2uiWarning;

final Logger _listenerLog = Logger('a2ui.EventNotifier');
final Logger _log = Logger('a2ui_core.problems');

/// One surface's end of a [ProblemChannel]: the listeners its errors and
/// warnings go to, and the channel it currently enqueues into.
///
/// Until [attach] is called, the first report creates a channel of its own,
/// which delivers to these listeners only.
class SurfaceProblems {
  final onError = EventNotifier<A2uiRendererError>();
  final onWarning = EventNotifier<A2uiWarning>();

  /// Fires after a drain has handed out at least one of this surface's items.
  final onReportsDelivered = EventNotifier<void>();

  ProblemChannel? _channel;
  bool _disposed = false;

  /// Enqueues [error], or drops it once this end is disposed.
  void dispatchError(A2uiRendererError error) =>
      _enqueue(_Item(this, error: error));

  /// Enqueues [warning], or drops it once this end is disposed.
  void dispatchWarning(A2uiWarning warning) =>
      _enqueue(_Item(this, warning: warning));

  void _enqueue(_Item item) {
    if (_disposed) return;
    (_channel ??= ProblemChannel())._enqueue(item);
  }

  /// Makes [channel] the one this end enqueues into, moving its undelivered
  /// items there in order.
  void attach(ProblemChannel channel) {
    if (_disposed) return;
    final ProblemChannel? previous = _channel;
    _channel = channel;
    if (previous != null && !identical(previous, channel)) {
      previous._moveTo(this, channel);
    }
  }

  /// Drops this end's undelivered items and every later report, and removes
  /// its listeners.
  void dispose() {
    _disposed = true;
    _channel?._drop(this);
    onError.dispose();
    onWarning.dispose();
    onReportsDelivered.dispose();
  }
}

class _Item {
  final SurfaceProblems source;
  final A2uiRendererError? error;
  final A2uiWarning? warning;

  _Item(this.source, {this.error, this.warning});
}

/// A FIFO queue of errors and warnings that hands them to listeners only
/// during a drain.
///
/// A drain runs at the end of the outermost [runMessage], or in a microtask
/// scheduled by an item that arrives while no message scope is open. While
/// [guardResolution] is on the stack, the end of a message scope schedules
/// the microtask instead. Items that arrive during a drain are delivered by
/// that drain.
///
/// Each item goes to its surface's listeners, then to the channel's
/// [onError] or [onWarning] listeners. An error nobody receives is printed.
/// A warning nobody receives is logged at [Level.FINE]. A listener that
/// throws is logged at [Level.SEVERE], and its error goes to the current
/// zone's uncaught-error handler, or is printed in the root zone. Delivery
/// continues either way.
class ProblemChannel {
  /// The listeners every item goes to after its surface's, or null for none.
  final EventNotifier<A2uiRendererError>? onError;

  /// The listeners every warning goes to after its surface's, or null for
  /// none.
  final EventNotifier<A2uiWarning>? onWarning;

  final bool _holding;
  final Queue<_Item> _items = Queue();
  int _messageDepth = 0;
  bool _draining = false;
  bool _drainScheduled = false;

  ProblemChannel({this.onError, this.onWarning}) : _holding = false;

  /// A channel that keeps its items and never delivers them.
  ProblemChannel.holding()
      : onError = null,
        onWarning = null,
        _holding = true;

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
      if (_messageDepth == 0 && _items.isNotEmpty) {
        if (_resolutionDepth > 0) {
          _scheduleDrain();
        } else {
          _drain();
        }
      }
    }
  }

  void _enqueue(_Item item) {
    _items.add(item);
    _scheduleDrain();
  }

  void _moveTo(SurfaceProblems source, ProblemChannel target) {
    for (final _Item item in _items) {
      if (identical(item.source, source)) target._items.add(item);
    }
    _drop(source);
    if (target._items.isNotEmpty) target._scheduleDrain();
  }

  void _drop(SurfaceProblems source) {
    _items.removeWhere((item) => identical(item.source, source));
  }

  void _scheduleDrain() {
    if (_holding || _messageDepth > 0 || _draining || _drainScheduled) return;
    _drainScheduled = true;
    scheduleMicrotask(() {
      _drainScheduled = false;
      _drain();
    });
  }

  void _drain() {
    if (_holding || _draining) return;
    _draining = true;
    try {
      while (_items.isNotEmpty) {
        final delivered = LinkedHashSet<SurfaceProblems>.identity();
        while (_items.isNotEmpty) {
          final _Item item = _items.removeFirst();
          delivered.add(item.source);
          _deliver(item);
        }
        for (final source in delivered) {
          for (final void Function(void) listener
              in listenersOf(source.onReportsDelivered)) {
            _call(listener, null);
          }
        }
      }
    } finally {
      _draining = false;
    }
  }

  void _deliver(_Item item) {
    final A2uiRendererError? error = item.error;
    if (error != null) {
      final List<void Function(A2uiRendererError)> listeners = [
        ...listenersOf(item.source.onError),
        if (onError case final group?) ...listenersOf(group),
      ];
      if (listeners.isEmpty) {
        Zone.current.print(
          'A2UI error with no listener: ${error.code} on surface '
          "'${error.surfaceId}': ${error.message}",
        );
      }
      for (final listener in listeners) {
        _call(listener, error);
      }
      return;
    }
    final A2uiWarning warning = item.warning!;
    final List<void Function(A2uiWarning)> listeners = [
      ...listenersOf(item.source.onWarning),
      if (onWarning case final group?) ...listenersOf(group),
    ];
    if (listeners.isEmpty) {
      _log.fine('A2UI warning with no listener: $warning');
    }
    for (final listener in listeners) {
      _call(listener, warning);
    }
  }

  static void _call<E>(void Function(E) listener, E event) {
    try {
      listener(event);
    } catch (error, stackTrace) {
      _listenerLog.severe('Error in EventNotifier listener', error, stackTrace);
      if (identical(Zone.current, Zone.root)) {
        Zone.current.print('A2UI listener threw: $error\n$stackTrace');
      } else {
        Zone.current.handleUncaughtError(error, stackTrace);
      }
    }
  }
}
