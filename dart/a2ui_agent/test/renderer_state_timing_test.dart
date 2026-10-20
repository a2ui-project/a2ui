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

/// Timing tests for `RendererState`.
///
/// `apply` and `transaction` must cost what they change, not the size of the
/// surfaces they touch, so applying n messages to one surface takes time in
/// proportion to n. Copying the surface on each `apply` makes it grow with
/// the square of n.
///
/// The tests are tagged `performance`, which `dart_test.yaml` skips unless
/// the `performance` preset is selected, as in `dart test -P performance`.
@Tags(['performance'])
library;

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

final CatalogApi _basic = BasicCatalog.v0_9();

const int _smaller = 100;
const int _larger = 400;

/// Linear growth gives a ratio near 4, quadratic growth near 16.
const int _maxRatio = 8;

/// How many times each call is timed.
const int _runs = 5;

void main() {
  for (final inTransaction in [false, true]) {
    test('applying messages one by one takes linear time'
        '${inTransaction ? ' in a transaction' : ''}', () {
      _expectTimeRatio(
        _applyEach(_larger, inTransaction: inTransaction),
        _applyEach(_smaller, inTransaction: inTransaction),
        what: 'RendererState.apply at $_larger against $_smaller messages',
      );
    });
  }
}

/// A surface, then one message for each of [size] components.
List<AgentToRendererMessage> _messages(int size) => [
  CreateSurfaceMessage(
    version: 'v0.9',
    surfaceId: 's',
    catalogId: BasicCatalog.v0_9Id,
  ),
  for (var i = 0; i < size; i++)
    UpdateComponentsMessage(
      version: 'v0.9',
      surfaceId: 's',
      components: [
        {'id': 't$i', 'component': 'Text', 'text': 'x'},
      ],
    ),
];

void Function() _applyEach(int size, {required bool inTransaction}) {
  final List<AgentToRendererMessage> messages = _messages(size);
  return () {
    final state = RendererState([_basic]);
    void applyAll() {
      for (final message in messages) {
        state.apply([message]);
      }
    }

    if (inTransaction) {
      state.transaction(applyAll);
    } else {
      applyAll();
    }
    state.dispose();
  };
}

/// Expects [measured] to take at most [_maxRatio] times as long as
/// [baseline], comparing the median of [_runs] timed runs of each, made in
/// turn after one untimed run of each.
///
/// [what] names the two calls in the failure message.
void _expectTimeRatio(
  void Function() measured,
  void Function() baseline, {
  required String what,
}) {
  baseline();
  measured();
  final baselineTimes = <int>[];
  final measuredTimes = <int>[];
  for (var run = 0; run < _runs; run++) {
    baselineTimes.add(_time(baseline));
    measuredTimes.add(_time(measured));
  }
  final int measuredMedian = _median(measuredTimes);
  final int baselineMedian = _median(baselineTimes);
  final times =
      'Median time of $what: $measuredMedian µs against $baselineMedian µs '
      '(ratio ${(measuredMedian / baselineMedian).toStringAsFixed(1)}).';
  printOnFailure(times);
  expect(
    measuredMedian / baselineMedian,
    lessThanOrEqualTo(_maxRatio),
    reason: times,
  );
}

/// The time [body] takes, in microseconds.
int _time(void Function() body) {
  final watch = Stopwatch()..start();
  body();
  return watch.elapsedMicroseconds;
}

int _median(List<int> times) => (times.toList()..sort())[times.length ~/ 2];
