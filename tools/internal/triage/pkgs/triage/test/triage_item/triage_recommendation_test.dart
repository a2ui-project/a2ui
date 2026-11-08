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
import 'package:triage/triage.dart';

void main() {
  final validator = PayloadValidator<ComponentApi, FunctionApi>(
    catalog: Catalog<ComponentApi, FunctionApi>(
      id: 'triage_test',
      components: [triageSuggestionApi],
      protocolVersion: A2uiProtocolVersion.v1_0,
    ),
    protocolVersion: A2uiProtocolVersion.v1_0,
  );
  final Matcher rejected = throwsA(isA<A2uiValidationError>());

  Map<String, Object?> recommendation([
    Map<String, Object?> extra = const {},
  ]) => {
    'id': 'recommendation',
    'component': 'TriageRecommendation',
    'summary': 'The Flutter renderer crashes on an empty Row.',
    'suggestion': 'Accept as a P1 bug and assign to the Flutter owner.',
    ...extra,
  };

  test('accepts a recommendation with only the required properties', () {
    expect(
      () => validator.validateComponent(recommendation()),
      returnsNormally,
    );
  });

  test('accepts a recommendation with every property', () {
    expect(
      () => validator.validateComponent(
        recommendation({
          'added_labels': ['type: bug', 'priority: p1'],
          'removed_labels': ['status: needs-triage'],
          'new_assignees': ['octocat'],
          'removed_assignees': ['hubot'],
          'related_issues': [12, 34],
          'related_prs': [56],
        }),
      ),
      returnsNormally,
    );
  });

  for (final property in ['summary', 'suggestion']) {
    test('rejects a recommendation without $property', () {
      expect(
        () => validator.validateComponent(recommendation()..remove(property)),
        rejected,
      );
    });

    test('rejects an empty $property', () {
      expect(
        () => validator.validateComponent(recommendation({property: ''})),
        rejected,
      );
    });
  }

  test('rejects an unknown property', () {
    expect(
      () => validator.validateComponent(recommendation({'priority': 'P1'})),
      rejected,
    );
  });

  test('rejects a label that is not a string', () {
    expect(
      () => validator.validateComponent(
        recommendation({
          'added_labels': [1],
        }),
      ),
      rejected,
    );
  });

  test('rejects a repeated assignee', () {
    expect(
      () => validator.validateComponent(
        recommendation({
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
          recommendation({
            'related_issues': [reference],
          }),
        ),
        rejected,
        reason: 'related_issues: [$reference]',
      );
    }
  });
}
