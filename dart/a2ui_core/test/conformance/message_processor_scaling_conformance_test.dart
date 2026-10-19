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

/// Runs the shared `core/message_processor_scaling.yaml` suite, which times
/// [MessageProcessor.processMessages] on a payload written at two sizes and
/// compares the median times.
///
/// The tests are tagged `performance`, which `dart_test.yaml` skips unless
/// the `performance` preset is selected, as in `dart test -P performance`.
@Tags(['performance'])
library;

import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import '../support/renderer_catalog.dart';
import 'conformance_harness.dart';

void main() {
  const suite = 'core/message_processor_scaling.yaml';
  final List<ConformanceTestCase> cases = loadConformanceSuite(suite);
  group('conformance $suite', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      test(testCase['name']! as String, () => _runCase(testCase));
    }
  });
}

void _runCase(ConformanceTestCase testCase) {
  expect(testCase['action'], 'measure_growth');
  expect(testCase['operation'], 'process_messages');
  final List<Catalog<ComponentApi, FunctionImplementation>> catalogs = [
    for (final Object? path in testCase['catalogPaths']! as List<Object?>)
      rendererCatalog(
        readConformanceJson(path! as String),
        protocolVersion: testCase['protocolVersion']! as String,
      ),
  ];
  final args = testCase['args']! as Map<String, Object?>;
  final ValidationConfig? config = switch (args['validation_config']) {
    'none' => null,
    'relaxed' => ValidationConfig.relaxed,
    final Object? name => throw UnsupportedError(
        'Unknown validation config $name',
      ),
  };

  /// Processes the payload at [size] on a new processor.
  void Function() process(int size) {
    final Object? messages = jsonDecode(writePayload(testCase, size));
    return () => MessageProcessor<ComponentApi>(
          catalogs: catalogs,
          validationConfig: config,
        ).processMessages(messages);
  }

  final [int smaller, int larger] =
      (testCase['sizes']! as List<Object?>).cast<int>();
  expectTimeRatio(
    process(larger),
    process(smaller),
    testCase['max_ratio']! as num,
    what: 'processMessages at $larger against $smaller',
  );
}

/// The payload of a timing case written at [size]; see `PayloadTemplate` in
/// `conformance_schema.json`.
String writePayload(ConformanceTestCase testCase, int size) => [
      for (final Object? segment in testCase['payload']! as List<Object?>)
        switch (segment) {
          final String text => text,
          {'repeat': final String text} => [
              for (var i = 0; i < size; i++) text.replaceAll('{i}', '$i'),
            ].join((segment as Map)['separator'] as String? ?? ''),
          _ => throw ArgumentError.value(segment, 'segment'),
        },
    ].join();

/// How many times each call is timed.
const int _runs = 5;

/// Expects [measured] to take at most [maxRatio] times as long as
/// [baseline], comparing the median of [_runs] timed runs of each, made in
/// turn after one untimed run of each.
///
/// [what] names the two calls in the failure message.
void expectTimeRatio(
  void Function() measured,
  void Function() baseline,
  num maxRatio, {
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
  expect(
    measuredMedian / baselineMedian,
    lessThanOrEqualTo(maxRatio),
    reason: 'Median time of $what: $measuredMedian µs against '
        '$baselineMedian µs.',
  );
}

/// The time [body] takes, in microseconds.
int _time(void Function() body) {
  final watch = Stopwatch()..start();
  body();
  return watch.elapsedMicroseconds;
}

int _median(List<int> times) => (times.toList()..sort())[times.length ~/ 2];
