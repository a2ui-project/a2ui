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
/// A change of a component's type costs the processor time in proportion to
/// the surface, since the component is recreated. Recording such changes and
/// rolling them back must stay within a small factor of what the processor
/// spends on them.
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

  test('recording type changes costs about what the processor spends on '
      'them', () {
    final List<AgentToRendererMessage> setup = _messages(_surfaceSize);
    final List<AgentToRendererMessage> changes = _typeChanges(
      _surfaceSize,
      _changeCount,
    );
    _expectRatio(
      () {
        final state = RendererState([_basic]);
        for (final message in setup) {
          state.apply([message]);
        }
        final int time = _time(
          () => state.transaction(() {
            for (final message in changes) {
              state.apply([message]);
            }
          }),
        );
        state.dispose();
        return time;
      },
      () {
        final processor = MessageProcessor<ComponentApi>.forAgent(
          catalogs: [_basic],
          validationConfig: _inProgressValidation,
        );
        for (final message in setup) {
          processor.processMessages([message]);
        }
        final int time = _time(() {
          for (final message in changes) {
            processor.processMessages([message]);
          }
        });
        processor.model.dispose();
        return time;
      },
      what:
          'RendererState.apply in a transaction against MessageProcessor, '
          'for $_changeCount type changes near the end of a '
          '$_surfaceSize-component surface',
      maxRatio: _maxRecordRatio,
    );
  });

  test('rolling back type changes costs about what applying them does', () {
    final List<AgentToRendererMessage> setup = _messages(_surfaceSize);
    // One message that changes the type of the first half of the surface.
    final change = UpdateComponentsMessage(
      version: 'v0.9',
      surfaceId: 's',
      components: [
        for (var i = 0; i < _surfaceSize ~/ 2; i++)
          {'id': 't$i', 'component': 'Divider'},
      ],
    );
    int Function() run({required bool rollBack}) => () {
      final state = RendererState([_basic]);
      for (final message in setup) {
        state.apply([message]);
      }
      final int time = _time(() {
        try {
          state.transaction(() {
            state.apply([change]);
            if (rollBack) throw const _RollBack();
          });
        } on _RollBack {
          // Rolled back.
        }
      });
      state.dispose();
      return time;
    };
    _expectRatio(
      run(rollBack: true),
      run(rollBack: false),
      what:
          'applying and rolling back against applying a type change of '
          '${_surfaceSize ~/ 2} components of a $_surfaceSize-component '
          'surface',
      maxRatio: _maxRollbackRatio,
    );
  });
}

/// The size of the surface the type changes are timed on.
const int _surfaceSize = 8000;

/// How many messages change a component's type.
const int _changeCount = 500;

/// How many times as long as the processor alone the state may take to
/// apply type changes in a transaction. Finding the positions of the
/// components it may recreate walks the surface's ids, as the processor's
/// recreation does: about 1.6 here. A map of every position, built for each
/// message, gave about 3.4.
const double _maxRecordRatio = 2.5;

/// How many times as long as applying a type change, applying it and
/// rolling it back may take: about 1.1 here. Putting each component back
/// with its own pass over the surface gave about 13.
const double _maxRollbackRatio = 3;

/// The validation config `RendererState` runs its processor under.
const ValidationConfig _inProgressValidation = ValidationConfig(
  allowDanglingReferences: true,
  allowMissingRoot: true,
  allowOrphanComponents: true,
);

/// [count] messages that each change the type of one component near the end
/// of a surface of [size] components, alternating so each one recreates it.
List<AgentToRendererMessage> _typeChanges(int size, int count) => [
  for (var i = 0; i < count; i++)
    UpdateComponentsMessage(
      version: 'v0.9',
      surfaceId: 's',
      components: [
        {
          'id': 't${size - 1 - (i % 10)}',
          'component': (i ~/ 10).isEven ? 'Divider' : 'Text',
          if ((i ~/ 10).isOdd) 'text': 'x',
        },
      ],
    ),
];

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

/// Expects [measured] to take at most [maxRatio] times as long as
/// [baseline], comparing the median of [_runs] timed runs of each, made in
/// turn after one untimed run of each.
///
/// [what] names the two calls in the failure message.
void _expectTimeRatio(
  void Function() measured,
  void Function() baseline, {
  required String what,
  num maxRatio = _maxRatio,
}) => _expectRatio(
  () => _time(measured),
  () => _time(baseline),
  what: what,
  maxRatio: maxRatio,
);

/// [_expectTimeRatio] for calls that time themselves, returning the time in
/// microseconds, so that they can leave out their setup.
void _expectRatio(
  int Function() measured,
  int Function() baseline, {
  required String what,
  required num maxRatio,
}) {
  baseline();
  measured();
  final baselineTimes = <int>[];
  final measuredTimes = <int>[];
  for (var run = 0; run < _runs; run++) {
    baselineTimes.add(baseline());
    measuredTimes.add(measured());
  }
  final int measuredMedian = _median(measuredTimes);
  final int baselineMedian = _median(baselineTimes);
  final times =
      'Median time of $what: $measuredMedian µs against $baselineMedian µs '
      '(ratio ${(measuredMedian / baselineMedian).toStringAsFixed(1)}).';
  printOnFailure(times);
  expect(
    measuredMedian / baselineMedian,
    lessThanOrEqualTo(maxRatio),
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

/// Thrown to roll a transaction back.
class _RollBack implements Exception {
  const _RollBack();
}
