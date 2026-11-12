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

import 'package:flutter_test/flutter_test.dart';
import 'package:triage/triage.dart';
import 'package:triage_ui/src/model/applier.dart';
import 'package:triage_ui/src/model/milestone_change.dart';
import 'package:triage_ui/src/model/triage_item.dart';

import '../../support/fake_github.dart';

void main() {
  late FakeGitHub github;
  setUp(() {
    github = FakeGitHub([
      itemNode(12, labels: [needsTriageLabel, 'status: needs-team-input']),
      itemNode(13, pr: true),
      itemNode(14, milestone: 'November launch'),
    ]);
  });

  TriageItem item(int number) => TriageItem.fromGraphQL(github.items[number]!);

  Future<ApplyResult> apply(
    int number,
    TriageSuggestion suggestion, {
    bool replyPosted = false,
    void Function()? onReplyPosted,
    MilestoneChange milestone = MilestoneChange.none,
  }) => applySuggestion(
    github.service(),
    item(number),
    suggestion,
    replyPosted: replyPosted,
    onReplyPosted: onReplyPosted ?? () {},
    milestone: milestone,
    milestones: github.milestones,
  );

  test('applies every change, in order', () async {
    var replied = false;
    final ApplyResult result = await apply(
      12,
      const TriageSuggestion(
        reply: 'Thanks!',
        closeAs: TriageCloseReason.duplicate,
        duplicateOf: 7,
        addedLabels: ['P1'],
        removedLabels: ['status: needs-team-input', 'not there'],
        newAssignees: ['octocat'],
        removedAssignees: ['hubot'],
      ),
      onReplyPosted: () => replied = true,
    );

    expect(result.succeeded, isTrue);
    expect(replied, isTrue);
    expect(result.steps.map((StepResult s) => s.description), [
      'Post the reply',
      'Remove labels: status: needs-team-input, not there',
      'Add labels: P1',
      'Unassign: hubot',
      'Assign: octocat',
      'Close as duplicate of #7',
    ]);
    // Only the reply step posts a text, which the item's log shows.
    expect(result.steps.map((StepResult s) => s.text), [
      'Thanks!',
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(github.calls, [
      'POST issues/12/comments {"body":"Thanks!"}',
      'DELETE issues/12/labels/status%3A%20needs-team-input',
      'DELETE issues/12/labels/not%20there',
      'POST issues/12/labels {"labels":["P1"]}',
      'DELETE issues/12/assignees {"assignees":["hubot"]}',
      'POST issues/12/assignees {"assignees":["octocat"]}',
      'close {"id":"I_12","reason":"DUPLICATE","duplicateOf":"I_7"}',
    ]);
  });

  test('posts the reply under the team note heading when it adds '
      '"status: needs-team-input"', () async {
    final ApplyResult result = await apply(
      13,
      const TriageSuggestion(
        reply: 'Is this a P0?',
        addedLabels: [needsTeamInputLabel],
      ),
    );

    const posted =
        '**Requires team input. Note for the discussion:**\n\nIs this a P0?';
    // The log shows the reply as posted.
    expect(result.steps.first.text, posted);
    expect(
      github.calls.first,
      'POST issues/13/comments ${jsonEncode({'body': posted})}',
    );
  });

  test('closes a pull request without a reason', () async {
    final ApplyResult result = await apply(
      13,
      const TriageSuggestion(closeAs: TriageCloseReason.notPlanned),
    );

    expect(result.steps.single.description, 'Close');
    expect(github.calls, ['close {"id":"PR_13"}']);
  });

  test('stops at a person GitHub does not assign, and says so', () async {
    github.unassignable.add('stranger');

    final ApplyResult result = await apply(
      12,
      const TriageSuggestion(
        newAssignees: ['octocat', 'stranger'],
        closeAs: TriageCloseReason.completed,
      ),
    );

    expect(result.succeeded, isFalse);
    expect(result.steps.map((StepResult s) => s.status), [
      StepStatus.failed,
      StepStatus.notRun,
    ]);
    expect(result.steps.first.error, contains('did not assign stranger'));
    expect(github.calls.where((c) => c.startsWith('close')), isEmpty);
  });

  test('stops at a failed request', () async {
    github.failing.add('POST issues/12/labels');

    final ApplyResult result = await apply(
      12,
      const TriageSuggestion(reply: 'Hi', addedLabels: ['P1']),
    );

    expect(result.steps.map((StepResult s) => s.status), [
      StepStatus.done,
      StepStatus.failed,
    ]);
    expect(result.steps.last.error, contains('500'));
  });

  test('does not post a reply that was posted', () async {
    final ApplyResult result = await apply(
      12,
      const TriageSuggestion(reply: 'Hi', addedLabels: ['P1']),
      replyPosted: true,
    );

    expect(result.succeeded, isTrue);
    expect(result.steps.first.status, StepStatus.skipped);
    expect(github.calls, ['POST issues/12/labels {"labels":["P1"]}']);
  });

  test('sets a milestone, which replaces the old one', () async {
    final ApplyResult result = await apply(
      14,
      const TriageSuggestion(),
      milestone: const MilestoneChange(
        set: 'December launch',
        remove: 'November launch',
      ),
    );

    expect(result.succeeded, isTrue);
    expect(result.steps.map((StepResult s) => s.description), [
      'Set milestone: December launch',
    ]);
    expect(github.calls, ['PATCH issues/14 {"milestone":11}']);
  });

  test('removes the milestone, if the item still has it', () async {
    final ApplyResult removed = await apply(
      14,
      const TriageSuggestion(),
      milestone: const MilestoneChange(remove: 'November launch'),
    );
    final ApplyResult skipped = await apply(
      12,
      const TriageSuggestion(),
      milestone: const MilestoneChange(remove: 'November launch'),
    );

    expect(removed.steps.single.status, StepStatus.done);
    expect(skipped.steps.single.status, StepStatus.skipped);
    expect(github.calls, ['PATCH issues/14 {"milestone":null}']);
  });

  test('fails to set a milestone that is not open', () async {
    final ApplyResult result = await apply(
      12,
      const TriageSuggestion(),
      milestone: const MilestoneChange(set: 'Long ago'),
    );

    expect(result.steps.single.status, StepStatus.failed);
    expect(result.steps.single.error, contains('no open milestone Long ago'));
    expect(github.calls, isEmpty);
  });
}
