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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/v0_9/basic_catalog.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'adapter_harness.dart';
import 'support/basic_test_catalog.dart';
import 'support/surface_harness.dart';

const Map<String, String> knownGaps = {
  'emphasis_and_strong':
      'basic Text without A2uiMarkdown strips emphasis and strong markers '
      'without rich spans',
  'headings':
      'basic Text without A2uiMarkdown only styles single-line headings',
  'inline_code':
      'basic Text without A2uiMarkdown strips code backticks without '
      'monospace styling',
  'lists': 'basic Text without A2uiMarkdown keeps list markers as plain text',
};

const Set<String> _knownCaseKeys = {
  'name',
  'description',
  'action',
  'markdown',
  'expectVisibleText',
  'expectPresent',
  'expectAbsent',
};

final class _StyledSpanRun {
  const _StyledSpanRun(this.text, this.style, {required this.hasRecognizer});

  final String text;
  final TextStyle style;
  final bool hasRecognizer;
}

List<_StyledSpanRun> _collectSpanRuns(WidgetTester tester, Finder scope) {
  final runs = <_StyledSpanRun>[];
  void walkSpan(InlineSpan span, TextStyle inherited) {
    if (span is TextSpan) {
      final TextStyle effective = inherited.merge(span.style);
      final String segment = span.text ?? '';
      if (segment.isNotEmpty || span.recognizer != null) {
        runs.add(
          _StyledSpanRun(
            segment,
            effective,
            hasRecognizer: span.recognizer != null,
          ),
        );
      }
      for (final InlineSpan child in span.children ?? const <InlineSpan>[]) {
        walkSpan(child, effective);
      }
    }
  }

  final Finder richTexts = find.descendant(
    of: scope,
    matching: find.byType(RichText),
  );
  for (final Element element in richTexts.evaluate()) {
    final richText = element.widget as RichText;
    final TextStyle baseStyle = DefaultTextStyle.of(element).style;
    walkSpan(richText.text, baseStyle);
  }
  return runs;
}

Future<void> _verifyMarkdownCase(
  WidgetTester tester,
  Map<String, Object?> testCase,
) async {
  final name = testCase['name']! as String;
  final List<String> unknownKeys = testCase.keys
      .where((key) => !_knownCaseKeys.contains(key))
      .toList();
  expect(
    unknownKeys,
    isEmpty,
    reason: 'Unknown keys in markdown case "$name": $unknownKeys',
  );
  expect(testCase['action'], 'render_markdown');

  final markdown = testCase['markdown']! as String;
  final expectVisibleText = testCase['expectVisibleText'] as String?;
  final List<String> expectPresent =
      (testCase['expectPresent'] as List<Object?>?)?.cast<String>() ?? const [];
  final List<String> expectAbsent =
      (testCase['expectAbsent'] as List<Object?>?)?.cast<String>() ?? const [];

  await pumpComponents(tester, [
    {'id': 'root', 'component': 'Text', 'text': markdown},
  ], catalog: basicTestCatalog([BasicComponents.text]));

  final Finder surfaceFinder = find.byType(A2uiSurface);
  expect(surfaceFinder, findsOneWidget);

  final Element surfaceElement = tester.element(surfaceFinder);
  final double defaultBodyFontSize =
      Theme.of(surfaceElement).textTheme.bodyMedium?.fontSize ?? 14.0;
  final List<_StyledSpanRun> runs = _collectSpanRuns(tester, surfaceFinder);

  if (expectVisibleText != null) {
    final Finder richTexts = find.descendant(
      of: surfaceFinder,
      matching: find.byType(RichText),
    );
    final String actualVisible = tester
        .widgetList<RichText>(richTexts)
        .map((rich) => rich.text.toPlainText())
        .join(' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    final String expectedVisible = expectVisibleText
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    expect(actualVisible, expectedVisible);
  }

  for (final token in expectPresent) {
    switch (token) {
      case 'emphasis':
        expect(
          runs.any(
            (run) =>
                run.text.trim().isNotEmpty &&
                run.style.fontStyle == FontStyle.italic,
          ),
          isTrue,
          reason: 'Expected italic emphasis span for case "$name"',
        );
      case 'strong':
        expect(
          runs.any(
            (run) =>
                run.text.trim().isNotEmpty &&
                (run.style.fontWeight?.value ?? FontWeight.w400.value) >=
                    FontWeight.w600.value,
          ),
          isTrue,
          reason: 'Expected bold strong span for case "$name"',
        );
      case 'heading':
        expect(
          runs.any(
            (run) =>
                run.text.trim().isNotEmpty &&
                (run.style.fontSize ?? defaultBodyFontSize) >
                    defaultBodyFontSize,
          ),
          isTrue,
          reason: 'Expected heading font size > body size for case "$name"',
        );
      case 'list_item':
        final bool hasBulletWidget = runs.any(
          (run) => run.text.contains('\u2022'),
        );
        expect(
          hasBulletWidget,
          isTrue,
          reason: 'Expected rendered list item bullets for case "$name"',
        );
      case 'code':
        expect(
          runs.any(
            (run) =>
                run.text.trim().isNotEmpty &&
                ((run.style.fontFamily?.toLowerCase().contains('mono') ??
                        false) ||
                    run.style.backgroundColor != null),
          ),
          isTrue,
          reason: 'Expected monospace or background code span for case "$name"',
        );
      default:
        fail('Unsupported expectPresent token "$token" in case "$name"');
    }
  }

  for (final token in expectAbsent) {
    switch (token) {
      case 'image':
        expect(
          find.descendant(of: surfaceFinder, matching: find.byType(Image)),
          findsNothing,
        );
      case 'link':
        expect(
          runs.any((run) => run.hasRecognizer),
          isFalse,
          reason: 'Expected no interactive link recognizer in case "$name"',
        );
      case 'html':
        expect(
          find.descendant(
            of: surfaceFinder,
            matching: find.byType(HtmlElementView),
          ),
          findsNothing,
        );
      default:
        fail('Unsupported expectAbsent token "$token" in case "$name"');
    }
  }
}

void main() {
  final String current = Directory.current.path;
  final suitePath = current.endsWith('a2ui_flutter')
      ? '$current/../../conformance/adapter/markdown_subset.yaml'
      : '$current/conformance/adapter/markdown_subset.yaml';
  final List<Object?> tests = loadYamlTests(suitePath);
  final matchedGaps = <String>{};

  tearDownAll(() {
    final List<String> unusedGaps =
        knownGaps.keys.where((key) => !matchedGaps.contains(key)).toList()
          ..sort();
    expect(
      unusedGaps,
      isEmpty,
      reason: 'Unused knownGaps entries did not match any case: $unusedGaps',
    );
  });

  group('Markdown Subset Conformance (adapter/markdown_subset.yaml)', () {
    for (final raw in tests) {
      final testCase = raw! as Map<String, Object?>;
      final name = testCase['name']! as String;

      testWidgets(name, (tester) async {
        final String? gapReason = knownGaps[name];
        if (gapReason != null) {
          matchedGaps.add(name);
          var failedAsExpected = false;
          try {
            await _verifyMarkdownCase(tester, testCase);
          } on TestFailure {
            failedAsExpected = true;
          }
          if (!failedAsExpected) {
            final unexpectedPassMessage =
                'Known gap "$name" unexpectedly passed; '
                'remove it from knownGaps.';
            writeManifestRecord({
              'harness': 'flutter',
              'suite': 'adapter/markdown_subset.yaml',
              'case': name,
              'status': 'failed',
              'reason': unexpectedPassMessage,
            });
            fail(unexpectedPassMessage);
          }
          writeManifestRecord({
            'harness': 'flutter',
            'suite': 'adapter/markdown_subset.yaml',
            'case': name,
            'status': 'xfailed',
            'reason': gapReason,
          });
          markTestSkipped('Known gap: $gapReason');
          return;
        }

        try {
          await _verifyMarkdownCase(tester, testCase);
          writeManifestRecord({
            'harness': 'flutter',
            'suite': 'adapter/markdown_subset.yaml',
            'case': name,
            'status': 'passed',
          });
        } catch (error) {
          writeManifestRecord({
            'harness': 'flutter',
            'suite': 'adapter/markdown_subset.yaml',
            'case': name,
            'status': 'failed',
            'reason': error.toString(),
          });
          rethrow;
        }
      });
    }
  });
}
