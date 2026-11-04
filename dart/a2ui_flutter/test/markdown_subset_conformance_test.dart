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

import 'package:a2ui_flutter/v0_9/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'adapter_harness.dart';
import 'support/basic_test_catalog.dart';
import 'support/surface_harness.dart';

const Map<String, String> knownGaps = {
  'lists': 'basic Text without A2uiMarkdown keeps list bullets as text',
};

void main() {
  final String current = Directory.current.path;
  final suitePath = current.endsWith('a2ui_flutter')
      ? '$current/../../conformance/adapter/markdown_subset.yaml'
      : '$current/conformance/adapter/markdown_subset.yaml';
  final List<Object?> tests = loadYamlTests(suitePath);

  group('Markdown Subset Conformance (adapter/markdown_subset.yaml)', () {
    for (final raw in tests) {
      final testCase = raw! as Map<String, Object?>;
      final name = testCase['name']! as String;
      final markdown = testCase['markdown']! as String;
      final expectVisibleText = testCase['expectVisibleText'] as String?;
      final List<String> expectAbsent =
          (testCase['expectAbsent'] as List<Object?>?)?.cast<String>() ?? [];

      testWidgets(name, (tester) async {
        if (knownGaps[name] case final String reason) {
          writeManifestRecord({
            'harness': 'flutter',
            'suite': 'adapter/markdown_subset.yaml',
            'case': name,
            'status': 'xfailed',
            'reason': reason,
          });
          return;
        }
        try {
          await pumpComponents(tester, [
            {'id': 'root', 'component': 'Text', 'text': markdown},
          ], catalog: basicTestCatalog([BasicComponents.text]));

          if (expectVisibleText != null) {
            final Iterable<Text> textWidgets = tester.widgetList<Text>(
              find.byType(Text),
            );
            final String actualVisible = textWidgets
                .map((t) => t.data ?? '')
                .join(' ')
                .replaceAll(RegExp(r'\s+'), ' ')
                .trim();
            final String expectedVisible = expectVisibleText
                .replaceAll(RegExp(r'\s+'), ' ')
                .trim();
            expect(actualVisible, expectedVisible);
          }

          if (expectAbsent.contains('image')) {
            expect(find.byType(Image), findsNothing);
          }

          writeManifestRecord({
            'harness': 'flutter',
            'suite': 'adapter/markdown_subset.yaml',
            'case': name,
            'status': 'passed',
          });
        } catch (e) {
          writeManifestRecord({
            'harness': 'flutter',
            'suite': 'adapter/markdown_subset.yaml',
            'case': name,
            'status': 'failed',
            'reason': e.toString(),
          });
          rethrow;
        }
      });
    }
  });
}
