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

import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';

import 'suites.dart';

/// Conformance suites executed in the default test run by the per-suite
/// `*_conformance_test.dart` files.
const Set<String> activeAgentSuites = {
  'agent/catalog_provider.yaml',
  'agent/catalog_resolution.yaml',
  'agent/catalog_transformer.yaml',
  'agent/direct_json/compiler.yaml',
  'agent/direct_json/decompiler.yaml',
  'agent/direct_json/prompt_generator.yaml',
  'agent/direct_json/response_parser.yaml',
  'agent/direct_json/response_streaming.yaml',
  'agent/express/compiler.yaml',
  'agent/express/decompiler.yaml',
  'agent/express/prompt_generator.yaml',
  'agent/express/response_parser.yaml',
  'agent/express/response_streaming.yaml',
  'agent/inbound_messages.yaml',
  'agent/multi_catalog_formats.yaml',
  'agent/renderer_capabilities.yaml',
  'agent/request_processor.yaml',
  'agent/streamed_answer.yaml',
};

/// `agent/**/*.yaml` suites not executed in the default `dart-agent` test run,
/// paired with the reason recorded in the executed-case manifest.
const Map<String, String> unsupportedAgentSuites = {
  'agent/builder/builder.yaml':
      'The fluent builder AST suite targets the Python builder API, which '
      'a2ui_agent for Dart does not implement.',
  'agent/direct_json/scaling.yaml':
      'Timing suite tagged performance; runs in the performance job with '
      'dart test -P performance.',
  'agent/express/scaling.yaml':
      'Timing suite tagged performance; runs in the performance job with '
      'dart test -P performance.',
  'agent/legacy/inference_format.yaml':
      'Pre-blueprint legacy suite retained only for backward compatibility; '
      'superseded by the current agent suites.',
  'agent/legacy/parser.yaml':
      'Pre-blueprint legacy suite retained only for backward compatibility; '
      'superseded by the current agent suites.',
  'agent/legacy/streaming_parser.yaml':
      'Pre-blueprint legacy suite retained only for backward compatibility; '
      'superseded by the current agent suites.',
  'agent/macros/macros.yaml':
      'The composite macro suite targets the Python macro API, which '
      'a2ui_agent for Dart does not implement.',
  'agent/skill.yaml':
      'a2ui_agent for Dart does not implement the skill generation API.',
};

Set<String> _discoverAgentSuites() {
  final agentDir = Directory('$conformanceRoot/agent');
  final suites = <String>{};
  for (final FileSystemEntity entity in agentDir.listSync(recursive: true)) {
    if (entity is File && entity.path.endsWith('.yaml')) {
      final String relative = entity.path
          .substring(conformanceRoot.length + 1)
          .replaceAll(r'\', '/');
      suites.add(relative);
    }
  }
  return suites;
}

void main() {
  group('agent suite coverage and unsupported suites', () {
    test('accounts for every conformance/agent/**/*.yaml file', () {
      final Set<String> onDisk = _discoverAgentSuites();
      final Set<String> unsupported = unsupportedAgentSuites.keys.toSet();
      expect(
        activeAgentSuites.intersection(unsupported),
        isEmpty,
        reason:
            'A suite cannot be in both activeAgentSuites and '
            'unsupportedAgentSuites.',
      );
      expect(
        activeAgentSuites.union(unsupported),
        equals(onDisk),
        reason:
            'Every conformance/agent/**/*.yaml file must be in '
            'activeAgentSuites or unsupportedAgentSuites.',
      );
    });

    for (final MapEntry<String, String>(:String key, :String value)
        in unsupportedAgentSuites.entries) {
      test('$key records skipped manifest entries with a reason', () {
        final String reason = value.trim();
        expect(reason, isNotEmpty);
        final List<Map<String, Object?>> cases = loadSuite(key);
        expect(cases, isNotEmpty);
        for (final testCase in cases) {
          final name = (testCase['id'] ?? testCase['name'])! as String;
          recordCase(key, name, status: 'skipped', reason: reason);
        }
      });
    }
  });

  group('recordCase', () {
    test(
      'merges outcomes across SuiteVersions and preserves v0.9 skip reasons',
      () {
        final Directory tempDir = Directory.systemTemp.createTempSync(
          'a2ui_agent_manifest_test_',
        );
        addTearDown(() => tempDir.deleteSync(recursive: true));

        recordCase(
          'agent/sample.yaml',
          'case_both_pass',
          status: 'passed',
          version: SuiteVersion.v0_9,
          manifestDir: tempDir.path,
        );
        recordCase(
          'agent/sample.yaml',
          'case_both_pass',
          status: 'passed',
          version: SuiteVersion.v1_0,
          manifestDir: tempDir.path,
        );

        recordCase(
          'agent/sample.yaml',
          'case_v09_skipped_v10_passed',
          status: 'skipped',
          reason: 'v0.9 cannot state what the case carries.',
          version: SuiteVersion.v0_9,
          manifestDir: tempDir.path,
        );
        recordCase(
          'agent/sample.yaml',
          'case_v09_skipped_v10_passed',
          status: 'passed',
          version: SuiteVersion.v1_0,
          manifestDir: tempDir.path,
        );

        recordCase(
          'agent/sample.yaml',
          'case_either_failed',
          status: 'passed',
          version: SuiteVersion.v0_9,
          manifestDir: tempDir.path,
        );
        recordCase(
          'agent/sample.yaml',
          'case_either_failed',
          status: 'failed',
          reason: 'Expected 1, got 2.',
          version: SuiteVersion.v1_0,
          manifestDir: tempDir.path,
        );

        final List<File> files = tempDir.listSync().whereType<File>().toList();
        expect(files, hasLength(1));
        final List<Map<String, Object?>> records = files.single
            .readAsLinesSync()
            .map((line) => jsonDecode(line) as Map<String, Object?>)
            .toList();
        expect(
          records,
          equals([
            {
              'harness': 'dart-agent',
              'suite': 'agent/sample.yaml',
              'case': 'case_both_pass',
              'status': 'passed',
            },
            {
              'harness': 'dart-agent',
              'suite': 'agent/sample.yaml',
              'case': 'case_v09_skipped_v10_passed',
              'status': 'passed',
              'reason': 'v0.9 cannot state what the case carries.',
            },
            {
              'harness': 'dart-agent',
              'suite': 'agent/sample.yaml',
              'case': 'case_either_failed',
              'status': 'failed',
              'reason': 'Expected 1, got 2.',
            },
          ]),
        );
      },
    );
  });
}
