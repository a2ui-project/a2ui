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

import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:test/test.dart';

import 'conformance_harness.dart';
import 'suite_registry.dart';

Set<String> _discoverCoreSuites() {
  final coreDir = Directory(resolveConformancePath('core'));
  final suites = <String>{};
  for (final FileSystemEntity entity in coreDir.listSync()) {
    if (entity is File && entity.path.endsWith('.yaml')) {
      suites.add('core/${p.basename(entity.path)}');
    }
  }
  return suites;
}

Set<String> _actionsInSuite(String suite) {
  final List<ConformanceTestCase> cases = loadConformanceSuite(suite);
  return {
    for (final ConformanceTestCase testCase in cases)
      (testCase['action'] as String?) ?? 'default',
  };
}

String _resolveTestFilePath(String fileName) {
  final direct = File(p.join('test', 'conformance', fileName));
  if (direct.existsSync()) return direct.path;
  return p.join('dart', 'a2ui_core', 'test', 'conformance', fileName);
}

void main() {
  group('core suite registry', () {
    test('registers every conformance/core/*.yaml file exactly once', () {
      final Set<String> onDisk = _discoverCoreSuites();
      final Set<String> active = coreSuiteActions.keys.toSet();
      final Set<String> unsupported = unsupportedCoreSuites.keys.toSet();

      expect(
        active.intersection(unsupported),
        isEmpty,
        reason: 'A suite cannot be in both coreSuiteActions and '
            'unsupportedCoreSuites.',
      );
      expect(
        active.union(unsupported),
        equals(onDisk),
        reason: 'Every conformance/core/*.yaml file must be registered in '
            'coreSuiteActions or unsupportedCoreSuites.',
      );
    });

    for (final MapEntry<String, Map<String, String>> entry
        in coreSuiteActions.entries) {
      test('${entry.key} maps every action to an existing test file', () {
        final Set<String> actualActions = _actionsInSuite(entry.key);
        expect(
          entry.value.keys.toSet(),
          equals(actualActions),
          reason:
              'Registered actions for ${entry.key} must match actions in YAML.',
        );
        for (final String testFile in entry.value.values.toSet()) {
          expect(
            File(_resolveTestFilePath(testFile)).existsSync(),
            isTrue,
            reason: 'Test file $testFile for ${entry.key} does not exist.',
          );
        }
      });
    }

    for (final MapEntry<String, String> entry
        in unsupportedCoreSuites.entries) {
      test('${entry.key} records skipped manifest entries with a reason', () {
        final String suite = entry.key;
        final String reason = entry.value.trim();
        expect(reason, isNotEmpty);
        final List<ConformanceTestCase> cases = loadConformanceSuite(suite);
        expect(cases, isNotEmpty);
        for (final testCase in cases) {
          final name = testCase['name']! as String;
          recordManifest(suite, name, 'skipped', reason);
        }
      });
    }
  });
}
