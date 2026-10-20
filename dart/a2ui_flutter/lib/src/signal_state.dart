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
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

/// Subscribes to [signal] and calls [onChange] with each value it emits
/// after the current one. Returns the unsubscribe function.
void Function() listenAfterFirst<T>(
  ReadonlySignal<T> signal,
  void Function(T value) onChange,
) {
  var primed = false;
  // subscribe calls back synchronously with the current value, which this
  // skips.
  final void Function() unsubscribe = signal.subscribe((T value) {
    if (primed) onChange(value);
  });
  primed = true;
  return unsubscribe;
}

/// A [State] that rebuilds when a signal it listens to changes.
mixin SignalState<W extends StatefulWidget> on State<W> {
  /// Marks this state for rebuild. During a frame's build or layout the
  /// rebuild is scheduled after the frame instead.
  void signalChanged() {
    if (!mounted) return;
    final SchedulerBinding scheduler = SchedulerBinding.instance;
    if (scheduler.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      scheduler.addPostFrameCallback((_) {
        if (mounted) setState(() {});
      });
    } else {
      setState(() {});
    }
  }
}
