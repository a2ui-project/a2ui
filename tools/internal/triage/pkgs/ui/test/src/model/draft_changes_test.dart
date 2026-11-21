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
import 'package:shared/shared.dart';
import 'package:ui/src/model/draft_changes.dart';
import 'package:ui/src/model/suggestion_draft.dart';
import 'package:ui/src/model/triage_item.dart';

import '../../support/fake_github.dart';

void main() {
  final issue = TriageItem.fromGraphQL(itemNode(12));
  final pr = TriageItem.fromGraphQL(itemNode(13, pr: true));

  List<DraftChange> changesOf(TriageItem item, TriageSuggestion suggestion) {
    final draft = SuggestionDraft(suggestion);
    addTearDown(draft.dispose);
    return draftChanges(item, draft);
  }

  test('lists every change in the order Apply makes them, one per label, '
      'assignee and milestone', () {
    final draft = SuggestionDraft(
      const TriageSuggestion(
        reply: 'Thanks.',
        closeAs: TriageCloseReason.notPlanned,
        addedLabels: ['P2', 'type: bug'],
        removedLabels: [needsTriageLabel],
        newAssignees: ['octocat'],
        removedAssignees: ['stranger'],
      ),
    )..newMilestone = 'November launch';
    addTearDown(draft.dispose);

    expect(draftChanges(issue, draft), [
      (kind: 'Reply', value: 'Thanks.'),
      (kind: 'Remove label', value: needsTriageLabel),
      (kind: 'Add label', value: 'P2'),
      (kind: 'Add label', value: 'type: bug'),
      (kind: 'Unassign', value: 'stranger'),
      (kind: 'Assign', value: 'octocat'),
      (kind: 'Set milestone', value: 'November launch'),
      (kind: 'Close', value: 'as not planned'),
    ]);
  });

  test('lists the reply as Apply posts it, and closes a PR without a '
      'reason', () {
    expect(
      changesOf(
        pr,
        const TriageSuggestion(
          reply: 'Which design?',
          closeAs: TriageCloseReason.notPlanned,
          addedLabels: [needsTeamInputLabel],
        ),
      ),
      [
        (kind: 'Reply', value: '${teamNoteHeading}Which design?'),
        (kind: 'Add label', value: needsTeamInputLabel),
        (kind: 'Close', value: ''),
      ],
    );
  });

  test('removes a milestone only when it sets none', () {
    final draft = SuggestionDraft(const TriageSuggestion())
      ..removedMilestone = 'October';
    addTearDown(draft.dispose);

    expect(draftChanges(issue, draft), [
      (kind: 'Remove milestone', value: 'October'),
    ]);
    draft.newMilestone = 'November launch';
    expect(draftChanges(issue, draft), [
      (kind: 'Set milestone', value: 'November launch'),
    ]);
  });

  test('shares the changes that every item has, in the order of the first', () {
    final List<DraftChange> first = changesOf(
      issue,
      const TriageSuggestion(
        reply: 'Thanks.',
        addedLabels: ['type: bug', 'P2'],
        removedLabels: [needsTriageLabel],
      ),
    );
    final List<DraftChange> second = changesOf(
      issue,
      const TriageSuggestion(
        reply: 'Thanks!',
        addedLabels: ['P2', 'type: bug'],
        removedLabels: [needsTriageLabel],
        newAssignees: ['octocat'],
      ),
    );

    expect(sharedChanges([first, second]), [
      (kind: 'Remove label', value: needsTriageLabel),
      (kind: 'Add label', value: 'type: bug'),
      (kind: 'Add label', value: 'P2'),
    ]);
    expect(sharedChanges([first, const []]), isEmpty);
    expect(sharedChanges(const []), isEmpty);
  });
}
