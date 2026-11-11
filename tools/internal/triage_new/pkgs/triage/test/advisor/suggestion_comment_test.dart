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

/// A suggestion comment like the one in advisor.blueprint.md.
String comment(String component) =>
    '''
**From triage bot:**

Triage suggestion:

<details>
<summary>For humans</summary>

The Flutter renderer crashes.

</details>

<details>
<summary>For agents</summary>

```
<a2ui>
$component
</a2ui>
```

</details>
''';

void main() {
  test('reads every property of a suggestion', () {
    final payload = SuggestionPayload.parse(
      comment('''
root = TriageSuggestion(
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
  related_issues=[1234],
  related_prs=[1300, 1301]
)'''),
    );

    final TriageSuggestion s = payload.suggestion;
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
    expect(s.relatedIssues, [1234]);
    expect(s.relatedPrs, [1300, 1301]);

    final create = payload.messages.single as CreateSurfaceMessage;
    expect(create.catalogId, triageCatalogId);
    expect(create.components!.single['id'], 'root');
  });

  test('reads omitted properties as empty', () {
    final TriageSuggestion s = SuggestionPayload.parse(
      comment('root = TriageSuggestion(summary="A", suggestion="B")'),
    ).suggestion;

    expect(s.reply, isNull);
    expect(s.closeAs, isNull);
    expect(s.duplicateOf, isNull);
    expect(s.addedLabels, isEmpty);
    expect(s.relatedPrs, isEmpty);
  });

  final Matcher rejected = throwsA(isA<FormatException>());

  test('rejects a comment without an <a2ui> block', () {
    expect(
      () => SuggestionPayload.parse('**From triage bot:**\n\nHi.'),
      rejected,
    );
  });

  test('rejects a block that does not compile', () {
    expect(
      () =>
          SuggestionPayload.parse(comment('root = TriageSuggestion(summary=')),
      rejected,
    );
  });

  test('rejects a component that is not a TriageSuggestion', () {
    expect(
      () => SuggestionPayload.parse(comment('root = Text(text="Hi")')),
      rejected,
    );
  });

  test('rejects an invalid TriageSuggestion', () {
    expect(
      () => SuggestionPayload.parse(
        comment(
          'root = TriageSuggestion(summary="A", suggestion="B", '
          'close_as="maybe")',
        ),
      ),
      rejected,
    );
  });

  test('rejects two blocks', () {
    final String one = comment(
      'root = TriageSuggestion(summary="A", suggestion="B")',
    );
    expect(() => SuggestionPayload.parse('$one\n$one'), rejected);
  });

  test('recognizes the triage bot prefix and the <a2ui> block', () {
    final String body = comment(
      'root = TriageSuggestion(summary="A", suggestion="B")',
    );
    expect(hasTriageBotPrefix(body), isTrue);
    expect(hasTriageBotPrefix('Thanks!\n$body'), isFalse);
    expect(hasA2uiBlock(body), isTrue);
    expect(hasA2uiBlock('**From triage bot:**\n\nPing.'), isFalse);
  });
}
