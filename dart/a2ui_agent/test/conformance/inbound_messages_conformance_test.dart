// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
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

/// Runs the shared `conformance/agent/inbound_messages.yaml` suite against
/// [parseInboundMessage], [getInboundMessageKind], and
/// [formatInboundForModel].
void main() {
  const path = 'agent/inbound_messages.yaml';
  group('conformance $path', () {
    final List<Map<String, Object?>> cases = loadSuite(path);
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      final name = testCase['name']! as String;
      test(name, () => _runCase(testCase));
    }
  });
}

const Map<String, Set<String>> _knownKeys = {
  'case:parse_inbound_message': {
    ...caseMetadataKeys,
    'args',
    'expect',
    'expect_error',
  },
  'args:parse_inbound_message': {'message', 'version'},
  'expect:parse_inbound_message': {
    'kind',
    'model_input',
    'model_input_contains',
  },
};

void _runCase(Map<String, Object?> testCase) {
  switch (testCase['action']) {
    case 'parse_inbound_message':
      assertKnownKeys(
        testCase,
        _knownKeys['case:parse_inbound_message']!,
        'case:parse_inbound_message',
      );
    default:
      throw UnsupportedError('Unknown action ${testCase['action']}');
  }
  final args = testCase['args']! as Map<String, Object?>;
  assertKnownKeys(
    args,
    _knownKeys['args:parse_inbound_message']!,
    'args:parse_inbound_message',
  );

  final versionStr = args['version']! as String;
  final A2uiProtocolVersion? version = A2uiProtocolVersion.tryParse(versionStr);
  if (version == null) {
    markTestSkipped(
      'a2ui_core for Dart does not implement protocol version $versionStr.',
    );
    return;
  }

  final Object? rawMessage = args['message'];
  RendererToAgentMessage parse() => parseInboundMessage(rawMessage, version);

  if (testCase['expect_error'] case final Object error) {
    expectThrowsCategory(parse, error);
    return;
  }

  final RendererToAgentMessage parsed = parse();
  final expected = testCase['expect']! as Map<String, Object?>;
  assertKnownKeys(
    expected,
    _knownKeys['expect:parse_inbound_message']!,
    'expect:parse_inbound_message',
  );
  expect(getInboundMessageKind(parsed), equals(expected['kind']));

  final String? formatted = formatInboundForModel(parsed);
  if (expected.containsKey('model_input')) {
    expect(formatted, equals(expected['model_input']));
  }
  if (expected['model_input_contains'] case final List<Object?> substrings) {
    expect(formatted, isNotNull);
    for (final String substring in substrings.cast<String>()) {
      expect(formatted, contains(substring));
    }
  }
}
