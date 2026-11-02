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

import 'adapter_harness.dart';

void main() {
  final List<Object?> accessibilityTests = loadYamlTests(
    '../../conformance/core/accessibility.yaml',
  );
  final List<Object?> adapterTests = loadYamlTests(
    '../../conformance/core/adapter_conformance.yaml',
  );

  tearDownAll(assertAllUnsupportedMatched);

  group('Accessibility Conformance (accessibility.yaml)', () {
    for (final entry in accessibilityTests) {
      final testCase = entry! as Map<String, Object?>;
      final name = testCase['name']! as String;
      testWidgets(name, (tester) async {
        var status = 'failed';
        String? reason;
        addTearDown(() {
          writeManifestRecord({
            'harness': 'flutter',
            'suite': 'core/accessibility.yaml',
            'case': name,
            'status': status,
            'reason': ?reason,
          });
        });
        try {
          assertKnownAccessibilityCase(testCase);
          final List<Object?> steps =
              (testCase['steps'] as List<Object?>?) ??
              <Object?>[
                <String, Object?>{'assertions': testCase['assertions']},
              ];
          final String? skipReason = findUnsupportedReason(name, steps);
          if (skipReason != null) {
            status = 'skipped';
            reason = skipReason;
            markTestSkipped(skipReason);
            return;
          }
          await runAccessibilityCase(tester, testCase);
          status = 'passed';
        } catch (error) {
          status = 'failed';
          reason = error.toString();
          rethrow;
        }
      });
    }
  });

  group('Adapter Conformance (adapter_conformance.yaml)', () {
    for (final entry in adapterTests) {
      final testCase = entry! as Map<String, Object?>;
      final name = testCase['name']! as String;
      testWidgets(name, (tester) async {
        var status = 'failed';
        String? reason;
        addTearDown(() {
          writeManifestRecord({
            'harness': 'flutter',
            'suite': 'core/adapter_conformance.yaml',
            'case': name,
            'status': status,
            'reason': ?reason,
          });
        });
        try {
          assertKnownAdapterCase(testCase);
          final String? skipReason = findUnsupportedReason(
            name,
            (testCase['steps'] as List<Object?>?) ?? const [],
          );
          if (skipReason != null) {
            status = 'skipped';
            reason = skipReason;
            markTestSkipped(skipReason);
            return;
          }
          await runAdapterCase(tester, testCase);
          status = 'passed';
        } catch (error) {
          status = 'failed';
          reason = error.toString();
          rethrow;
        }
      });
    }
  });
}
