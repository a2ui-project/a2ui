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
import '../support/timing.dart';
import 'conformance_harness.dart';

const Map<String, Set<String>> _knownKeys = {
  'case:measure_growth': {
    ...caseMetadataKeys,
    'args',
    'catalogPaths',
    'generator',
    'max_ratio',
    'operation',
    'protocolVersion',
    'sizes',
  },
  'args:measure_growth': {
    'validation_config',
  },
};

void main() {
  const suite = 'core/message_processor_scaling.yaml';
  final List<ConformanceTestCase> cases = loadConformanceSuite(suite);
  group('conformance $suite', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));
    runConformanceSuite(
      cases,
      _runCase,
      suite: suite,
    );
  });
}

void _runCase(ConformanceTestCase testCase) {
  expect(testCase['action'], 'measure_growth');
  assertKnownKeys(
    testCase,
    _knownKeys['case:measure_growth']!,
    'case:measure_growth',
  );
  expect(testCase['operation'], 'process_messages');
  final List<Catalog<ComponentApi, FunctionImplementation>> catalogs = [
    for (final Object? path in testCase['catalogPaths']! as List<Object?>)
      rendererCatalog(
        readConformanceJson(path! as String),
        protocolVersion: testCase['protocolVersion']! as String,
      ),
  ];
  final args = testCase['args']! as Map<String, Object?>;
  assertKnownKeys(
      args, _knownKeys['args:measure_growth']!, 'args:measure_growth');
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
