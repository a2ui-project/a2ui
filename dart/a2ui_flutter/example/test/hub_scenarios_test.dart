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

import 'package:flutter_test/flutter_test.dart';

import 'hub_driver.dart';

/// The v1.0 scenarios of the conformance hub, relative to this package.
const String _scenarioDir = '../../../conformance/e2e';

void main() {
  final List<(String, Map<String, Object?>)> scenarios = loadHubScenarios(
    _scenarioDir,
  );
  if (scenarios.isEmpty) {
    throw StateError('Expected scenario YAML files under $_scenarioDir');
  }
  for (final (String file, Map<String, Object?> scenario) in scenarios) {
    final name = scenario['name']! as String;
    group('$file: $name', () {
      for (final format in scenario['formats']! as List<Object?>) {
        testWidgets('replays $format chunks through the chat app', (
          tester,
        ) async {
          await runHubScenario(tester, scenario, format! as String);
        });
      }
    });
  }
}
