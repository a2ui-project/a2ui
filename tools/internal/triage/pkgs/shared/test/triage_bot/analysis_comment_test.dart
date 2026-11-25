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

/// An analysis comment like the one in triage_bot/analysis.blueprint.md.
String comment(String component) =>
    '''
**From triage bot, analysis:**

<details>
<summary>For humans</summary>

The Flutter renderer crashes.

</details>

<details>
<summary>For software</summary>

```
<a2ui>
$component
</a2ui>
```

</details>
''';

void main() {
  test('reads every property of an analysis', () {
    final payload = AnalysisPayload.parse(
      comment('''
root = TriageAnalysis(
  tldr="""Case: duplicate request.
Suggestion: close as a duplicate.""",
  summary="""The Flutter renderer crashes on an empty `Row`.""",
  reason="Priority is not set.",
  suggestion="""Close as a duplicate of #1100.""",
  reply="""Thanks! This duplicates #1100.""",
  close_as="duplicate",
  duplicate_of=1100,
  added_labels=["type: bug", "P1"],
  removed_labels=["status: needs-team-input"],
  new_assignees=["octocat"],
  removed_assignees=["hubot"],
  targeting_prs=[1300],
  targeted_issues=[1200],
  related_items=[1234, 1301]
)'''),
    );

    final TriageAnalysis s = payload.analysis;
    expect(
      s.tldr,
      'Case: duplicate request.\nSuggestion: close as a duplicate.',
    );
    expect(s.summary, 'The Flutter renderer crashes on an empty `Row`.');
    expect(s.reason, 'Priority is not set.');
    expect(s.suggestion, 'Close as a duplicate of #1100.');
    expect(s.reply, 'Thanks! This duplicates #1100.');
    expect(s.closeAs, TriageCloseReason.duplicate);
    expect(s.duplicateOf, 1100);
    expect(s.addedLabels, ['type: bug', 'P1']);
    expect(s.removedLabels, ['status: needs-team-input']);
    expect(s.newAssignees, ['octocat']);
    expect(s.removedAssignees, ['hubot']);
    expect(s.targetingPrs, [1300]);
    expect(s.targetedIssues, [1200]);
    expect(s.relatedItems, [1234, 1301]);

    final create = payload.messages.single as CreateSurfaceMessage;
    expect(create.catalogId, triageCatalogId);
    expect(create.components!.single['id'], 'root');
  });

  test('reads omitted properties as empty', () {
    final TriageAnalysis s = AnalysisPayload.parse(
      comment('root = TriageAnalysis(summary="A", suggestion="B")'),
    ).analysis;

    expect(s.reply, isNull);
    expect(s.closeAs, isNull);
    expect(s.duplicateOf, isNull);
    expect(s.addedLabels, isEmpty);
    expect(s.targetingPrs, isEmpty);
    expect(s.targetedIssues, isEmpty);
    expect(s.relatedItems, isEmpty);
  });

  final Matcher rejected = throwsA(isA<FormatException>());

  test('rejects a comment without an <a2ui> block', () {
    expect(
      () => AnalysisPayload.parse('**From triage bot, response:**\n\nHi.'),
      rejected,
    );
  });

  test('rejects a block that does not compile', () {
    expect(
      () => AnalysisPayload.parse(comment('root = TriageAnalysis(summary=')),
      rejected,
    );
  });

  test('rejects a component that is not a TriageAnalysis', () {
    expect(
      () => AnalysisPayload.parse(comment('root = Text(text="Hi")')),
      rejected,
    );
  });

  test('rejects an invalid TriageAnalysis', () {
    expect(
      () => AnalysisPayload.parse(
        comment(
          'root = TriageAnalysis(summary="A", suggestion="B", '
          'close_as="maybe")',
        ),
      ),
      rejected,
    );
  });

  test('rejects a TriageAnalysis that is not the root of a surface', () {
    expect(
      () => AnalysisPayload.parse(
        comment('analysis = TriageAnalysis(summary="A", suggestion="B")'),
      ),
      throwsA(
        isA<FormatException>().having(
          (e) => e.message,
          'message',
          anyOf(contains('one surface'), contains('does not render')),
        ),
      ),
    );
  });

  test('rejects close_as and duplicate_of that do not go together', () {
    for (final properties in [
      'close_as="duplicate"',
      'close_as="completed", duplicate_of=12',
      'duplicate_of=12',
    ]) {
      expect(
        () => AnalysisPayload.parse(
          comment(
            'root = TriageAnalysis(summary="A", suggestion="B", $properties)',
          ),
        ),
        throwsA(
          isA<FormatException>().having(
            (e) => e.message,
            'message',
            contains('duplicate_of exactly when close_as is duplicate'),
          ),
        ),
        reason: properties,
      );
    }
    expect(
      AnalysisPayload.parse(
        comment(
          'root = TriageAnalysis(summary="A", suggestion="B", '
          'close_as="duplicate", duplicate_of=12)',
        ),
      ).analysis.duplicateOf,
      12,
    );
  });

  test('rejects two blocks', () {
    final String one = comment(
      'root = TriageAnalysis(summary="A", suggestion="B")',
    );
    expect(() => AnalysisPayload.parse('$one\n$one'), rejected);
  });

  test('recognizes the <a2ui> block', () {
    final String body = comment(
      'root = TriageAnalysis(summary="A", suggestion="B")',
    );
    expect(hasA2uiBlock(body), isTrue);
    expect(hasA2uiBlock('**From triage bot, ping:** @a'), isFalse);
  });
}
