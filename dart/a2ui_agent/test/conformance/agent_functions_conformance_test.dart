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

import 'package:test/test.dart';

import 'suites.dart';

/// Registers the shared `conformance/agent/agent_functions.yaml` suite.
///
/// The suite covers agent functions and the agent's calls to renderer
/// functions, which this SDK does not implement yet, so every case is
/// skipped with the reason [_unimplementedActions] gives. A case whose action
/// has no reason fails instead of passing without running.
void main() {
  const path = 'agent/agent_functions.yaml';
  group('conformance $path', () {
    final List<Map<String, Object?>> cases = loadSuite(path);
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      final action = testCase['action']! as String;
      test(
        '$action · ${testCase['name']}',
        () => fail('Unhandled conformance action: $action'),
        skip: _unimplementedActions[action],
      );
    }
  });
}

/// The suite's actions this SDK has no implementation for, with the reason.
const Map<String, String> _unimplementedActions = {
  'declare_agent_functions': _notImplemented,
  'handle_agent_function': _notImplemented,
  'validate_payload': _notImplemented,
  'call_renderer_function': _notImplemented,
};

const String _notImplemented =
    'this SDK does not implement agent functions or calls to renderer '
    'functions yet';
