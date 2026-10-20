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

/// Runs the shared `scaling.yaml` suites of `conformance/agent/`, which time
/// parsing a payload written at two sizes, or streaming a payload against
/// compiling it, and compare the median times.
///
/// The tests are tagged `performance`, which `dart_test.yaml` skips unless
/// the `performance` preset is selected, as in `dart test -P performance`.
/// A case is written in the version its catalog declares, so nothing is
/// lowered.
@Tags(['performance'])
library;

import 'dart:math';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'suites.dart';

void main() {
  for (final path in const [
    'agent/direct_json/scaling.yaml',
    'agent/express/scaling.yaml',
  ]) {
    group('conformance $path', () {
      final List<Map<String, Object?>> cases = loadSuite(path);
      test('suite is not empty', () => expect(cases, isNotEmpty));
      for (final testCase in cases) {
        test(testCase['name']! as String, () => _runCase(testCase));
      }
    });
  }
}

void _runCase(Map<String, Object?> testCase) {
  final InferenceFormat format = _format(
    testCase['args']! as Map<String, Object?>,
  );
  final operation = testCase['operation']! as String;
  final chunkSize = testCase['chunk_size'] as int?;
  final maxRatio = testCase['max_ratio']! as num;
  switch (testCase['action']) {
    case 'measure_growth':
      final [int smaller, int larger] = (testCase['sizes']! as List<Object?>)
          .cast<int>();
      expectTimeRatio(
        _call(format, operation, writePayload(testCase, larger), chunkSize),
        _call(format, operation, writePayload(testCase, smaller), chunkSize),
        maxRatio,
        what: '$operation at $larger against $smaller',
      );
    case 'measure_overhead':
      final String payload = writePayload(testCase, testCase['size']! as int);
      expectTimeRatio(
        _call(format, operation, payload, chunkSize),
        _call(format, testCase['baseline']! as String, payload, chunkSize),
        maxRatio,
        what: '$operation against ${testCase['baseline']}',
      );
    default:
      throw UnsupportedError('Unknown action ${testCase['action']}');
  }
}

InferenceFormat _format(Map<String, Object?> args) {
  final List<CatalogApi> catalogs = caseCatalogs(args, lower: false);
  return switch (args['format']) {
    'direct_json' => DirectJsonFormatFactory(
      progressiveKeys: {
        ...?(args['progressive_keys'] as List<Object?>?)?.cast<String>(),
      },
    ).createFormat(catalogs),
    'express' => const ExpressFormatFactory().createFormat(catalogs),
    final Object? name => throw UnsupportedError('Unknown format $name'),
  };
}

/// The call [operation] names, made on [payload] with a new parser of
/// [format]. `parse_chunk` hands the parser the response holding [payload]
/// in chunks of [chunkSize] characters.
void Function() _call(
  InferenceFormat format,
  String operation,
  String payload,
  int? chunkSize,
) {
  switch (operation) {
    case 'parse_chunk':
      final response = '<a2ui-json>$payload</a2ui-json>';
      final int size = chunkSize!;
      final List<String> chunks = [
        for (var i = 0; i < response.length; i += size)
          response.substring(i, min(i + size, response.length)),
      ];
      return () {
        final Parser parser = format.createParser();
        for (final chunk in chunks) {
          parser.parseChunk(chunk);
        }
      };
    case 'compile':
      return () => format.createParser().compile(payload);
    default:
      throw UnsupportedError('Unknown operation $operation');
  }
}

/// The payload of a timing case written at [size]; see `PayloadTemplate` in
/// `conformance_schema.json`.
String writePayload(Map<String, Object?> testCase, int size) => [
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
    reason:
        'Median time of $what: $measuredMedian µs against '
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
