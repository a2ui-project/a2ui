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

/// Runs the shared `conformance/agent/renderer_capabilities.yaml` suite against
/// [readRendererCapabilities].
void main() {
  const path = 'agent/renderer_capabilities.yaml';
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
  'case:read_renderer_capabilities': {
    ...caseMetadataKeys,
    'args',
    'expect',
    'expect_error',
  },
  'args:read_renderer_capabilities': {'metadata', 'version'},
};

void _runCase(Map<String, Object?> testCase) {
  switch (testCase['action']) {
    case 'read_renderer_capabilities':
      assertKnownKeys(
        testCase,
        _knownKeys['case:read_renderer_capabilities']!,
        'case:read_renderer_capabilities',
      );
    default:
      throw UnsupportedError('Unknown action ${testCase['action']}');
  }
  final args = testCase['args']! as Map<String, Object?>;
  assertKnownKeys(
    args,
    _knownKeys['args:read_renderer_capabilities']!,
    'args:read_renderer_capabilities',
  );

  final versionStr = args['version']! as String;
  final A2uiProtocolVersion? version = A2uiProtocolVersion.tryParse(versionStr);
  if (version == null) {
    markTestSkipped(
      'a2ui_core for Dart does not implement protocol version $versionStr.',
    );
    return;
  }

  final Object? rawMetadata = args['metadata'];
  Map<String, Object?>? read() {
    if (rawMetadata == null) {
      return readRendererCapabilities(null, version);
    }
    if (rawMetadata is! Map<String, Object?>) {
      throw A2uiCatalogError('Transport metadata must be a JSON object.');
    }
    return readRendererCapabilities(rawMetadata, version);
  }

  if (testCase['expect_error'] case final Object error) {
    expectThrowsCategory(read, error);
    return;
  }

  expect(read(), equals(testCase['expect']));
}
