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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'suites.dart';

/// Runs the shared `conformance/agent/multi_catalog_formats.yaml` suite
/// against both inference formats.
///
/// The suite is about a surface drawing on several catalogs, which only v1.0
/// can state: a component or function call names its own `catalogId`. So it
/// runs as written in v1.0 only.
void main() {
  const path = 'agent/multi_catalog_formats.yaml';
  const SuiteVersion version = SuiteVersion.v1_0;
  group('conformance $path ${version.label}', () {
    final List<Map<String, Object?>> cases = loadSuite(path);
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      test(
        testCase['name']! as String,
        () => version.run(() => _runCase(testCase, version)),
      );
    }
  });
}

void _runCase(Map<String, Object?> testCase, SuiteVersion version) {
  final Object? error = testCase['expect_error'];
  if (error != null) {
    expectThrowsCategory(() => _perform(testCase, version), error);
    return;
  }
  final Object? result = _perform(testCase, version);
  switch (testCase['action']) {
    case 'decompile':
      _checkDecompiled(testCase, version, result! as String);
    default:
      expect(result, testCase['expect']);
  }
}

InferenceFormat _format(Map<String, Object?> testCase, SuiteVersion version) {
  final args = testCase['args']! as Map<String, Object?>;
  final InferenceFormatFactory factory = switch (args['format']) {
    'direct_json' => const DirectJsonFormatFactory(),
    'express' => const ExpressFormatFactory(),
    final Object? name => throw ArgumentError.value(name, 'format'),
  };
  return factory.createFormat(version.catalogs(args));
}

/// Performs the call a case names, with its result in the suite's
/// vocabulary.
Object? _perform(Map<String, Object?> testCase, SuiteVersion version) {
  final InferenceFormat format = _format(testCase, version);
  final input = testCase['input'] as String?;
  switch (testCase['action']) {
    case 'create_format':
      return null;
    case 'compile':
      return version.messagesJson(format.createParser().compile(input!));
    case 'decompile':
      return format.createParser().decompile(
        version.messages(testCase['messages']! as List<Object?>),
      );
    case 'parse_response':
      return version.partsJson(format.createParser().parseResponse(input!));
    default:
      throw UnsupportedError('Unknown action ${testCase['action']}');
  }
}

/// Checks the output of a `decompile` case, and that compiling it returns the
/// messages the case started from when the case asks.
void _checkDecompiled(
  Map<String, Object?> testCase,
  SuiteVersion version,
  String output,
) {
  for (final Object? text
      in (testCase['expect_contains'] as List<Object?>?) ?? const []) {
    expect(output, contains(text));
  }
  for (final Object? text
      in (testCase['expect_absent'] as List<Object?>?) ?? const []) {
    expect(output, isNot(contains(text)));
  }
  if (testCase['expect_round_trip'] == true) {
    final List<AgentToRendererMessage> recompiled = _format(
      testCase,
      version,
    ).createParser().compile(output);
    expect(
      version.messagesJson(recompiled),
      testCase['messages'],
      reason: 'Written:\n$output',
    );
  }
}
