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
import 'package:test/test.dart';

import 'conformance_harness.dart';

/// Runs the shared `conformance/core/agent_to_renderer.yaml` suite against
/// [AgentToRendererMessage.schemaFor].
void main() {
  final List<ConformanceTestCase> cases = loadConformanceSuite(
    'core/agent_to_renderer.yaml',
  );

  group('conformance core/agent_to_renderer.yaml', () {
    test('suite has cases', () => expect(cases, isNotEmpty));

    runConformanceSuite(
      cases,
      _runCase,
      suite: 'core/agent_to_renderer.yaml',
      skipReason: (testCase) => testCase['protocolVersion'] == 'v0.8'
          ? 'Targets protocol v0.8, which a2ui_core does not implement.'
          : null,
    );
  });
}

void _runCase(ConformanceTestCase testCase) {
  final action = testCase['action'] as String?;
  if (action != 'agent_to_renderer_schema') {
    throw StateError(
      'Unsupported agent_to_renderer conformance action: $action',
    );
  }
  expectSchemaMatchesFile(
    testCase,
    AgentToRendererMessage.schemaFor(
      A2uiProtocolVersion.fromJson(testCase['protocolVersion']),
    ),
  );
}
