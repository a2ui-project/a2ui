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
import 'package:shared/shared.dart';
import 'package:test/test.dart';

void main() {
  final validator = PayloadValidator<ComponentApi, FunctionApi>(
    catalog: Catalog<ComponentApi, FunctionApi>(
      id: 'triage_test',
      components: [triageAnalysisApi],
      protocolVersion: A2uiProtocolVersion.v1_0,
    ),
    protocolVersion: A2uiProtocolVersion.v1_0,
  );
  final Matcher rejected = throwsA(isA<A2uiValidationError>());

  Map<String, Object?> analysis([Map<String, Object?> extra = const {}]) => {
    'id': 'analysis',
    'component': 'TriageAnalysis',
    'summary': 'The Flutter renderer crashes on an empty Row.',
    'suggestion': 'Accept as a P1 bug and assign to the Flutter owner.',
    ...extra,
  };

  test('accepts an analysis with only the required properties', () {
    expect(() => validator.validateComponent(analysis()), returnsNormally);
  });

  test('accepts an analysis with every property', () {
    expect(
      () => validator.validateComponent(
        analysis({
          'tldr': 'Case: duplicate request.\nSuggestion: close as duplicate.',
          'reason': 'Priority is not set.',
          'reply': 'Thanks for the report. This duplicates #7.',
          'close_as': 'duplicate',
          'duplicate_of': 7,
          'added_labels': ['type: bug', 'P1'],
          'removed_labels': ['status: needs-team-input'],
          'new_assignees': ['octocat'],
          'removed_assignees': ['hubot'],
          'targeting_prs': [56],
          'targeted_issues': [78],
          'related_items': [12, 34],
        }),
      ),
      returnsNormally,
    );
  });

  for (final property in ['summary', 'suggestion']) {
    test('rejects an analysis without $property', () {
      expect(
        () => validator.validateComponent(analysis()..remove(property)),
        rejected,
      );
    });

    test('rejects an empty $property', () {
      expect(
        () => validator.validateComponent(analysis({property: ''})),
        rejected,
      );
    });
  }

  test('accepts every close reason', () {
    for (final String reason in TriageCloseReason.values) {
      expect(
        () => validator.validateComponent(analysis({'close_as': reason})),
        returnsNormally,
        reason: 'close_as: $reason',
      );
    }
  });

  test('rejects an unknown close reason', () {
    expect(
      () => validator.validateComponent(analysis({'close_as': 'merged'})),
      rejected,
    );
  });

  for (final property in ['tldr', 'reason', 'reply']) {
    test('rejects an empty $property', () {
      expect(
        () => validator.validateComponent(analysis({property: ''})),
        rejected,
      );
    });
  }

  test('rejects a duplicate_of that is not a positive integer', () {
    for (final Object reference in ['#12', 0, 1.5]) {
      expect(
        () => validator.validateComponent(
          analysis({'close_as': 'duplicate', 'duplicate_of': reference}),
        ),
        rejected,
        reason: 'duplicate_of: $reference',
      );
    }
  });

  test('rejects an unknown property', () {
    expect(
      () => validator.validateComponent(analysis({'priority': 'P1'})),
      rejected,
    );
  });

  test('rejects a label that is not a string', () {
    expect(
      () => validator.validateComponent(
        analysis({
          'added_labels': [1],
        }),
      ),
      rejected,
    );
  });

  test('rejects a repeated assignee', () {
    expect(
      () => validator.validateComponent(
        analysis({
          'new_assignees': ['octocat', 'octocat'],
        }),
      ),
      rejected,
    );
  });

  test('rejects an issue reference that is not a positive integer', () {
    for (final Object reference in ['#12', 0, 1.5]) {
      expect(
        () => validator.validateComponent(
          analysis({
            'related_items': [reference],
          }),
        ),
        rejected,
        reason: 'related_items: [$reference]',
      );
    }
  });
}
