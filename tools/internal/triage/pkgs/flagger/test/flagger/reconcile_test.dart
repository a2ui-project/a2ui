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

import 'package:flagger/flagger.dart';
import 'package:shared/shared.dart';
import 'package:test/test.dart';

import '../support/fakes.dart';

/// Runs the flagger on [github], and returns what it logged.
Future<String> run(FakeGitHub github) async {
  final log = StringBuffer();
  await reconcile(github, now: now, log: log, errorLog: log);
  return '$log';
}

void main() {
  // Regression: PR review events checked out the PR's merge commit, whose
  // older copy of the rules kept adding labels that the current rules
  // removed.
  test('the workflow runs the flagger from main, whatever the event', () {
    final String workflow = File(
      '../../../../../.github/workflows/triage.yml',
    ).readAsStringSync();
    final RegExpMatch? checkout = RegExp(
      r'uses: actions/checkout@.*\n\s+with:\n((?:\s+\w[\w-]*:.*\n)+)',
    ).firstMatch(workflow);
    expect(checkout, isNotNull, reason: 'no checkout step with a with: block');
    expect(checkout![1], matches(RegExp(r'^\s+ref: main$', multiLine: true)));
  });

  test('adds the label when a rule matches', () async {
    final github = FakeGitHub([externalIssue(number: 7)]);
    final String log = await run(github);

    expect(github.addedFlags, [7]);
    expect(github.removedLabels, isEmpty);
    expect(
      log,
      contains(
        'Flagged https://github.com/a2ui-project/a2ui/issues/7 — this issue '
        'has no priority label.',
      ),
    );
    expect(
      log,
      contains(
        'A2UI triage-flag reconciliation completed: 1 items, +1 / -0 '
        "'status: needs-triage', -0 'status: waiting-for-author-response'",
      ),
    );
  });

  test('removes the label when an item no longer matches any rule', () async {
    // Prioritized and answered: it matches no rule.
    final github = FakeGitHub([
      issue(number: 8, labels: ['P3', needsTriageLabel]),
    ]);
    await run(github);

    expect(github.removedLabels, [(number: 8, label: needsTriageLabel)]);
    expect(github.addedFlags, isEmpty);
  });

  test('removes the label from a PR converted to a draft', () async {
    final github = FakeGitHub([
      pr(number: 10, draft: true, labels: [needsTriageLabel]),
    ]);
    await run(github);

    expect(github.removedLabels, [(number: 10, label: needsTriageLabel)]);
    expect(github.addedFlags, isEmpty);
  });

  test('does nothing when the labels are already right', () async {
    final github = FakeGitHub([
      externalIssue(number: 9, labels: [needsTriageLabel]), // Matches step 4.
      issue(number: 10, labels: ['P3']), // Matches no rule.
    ]);
    await run(github);

    expect(github.itemCalls, isEmpty); // No second read when nothing changes.
    expect(github.addedFlags, isEmpty);
    expect(github.removedLabels, isEmpty);
  });

  test('does not add the label twice when another run added it', () async {
    final github = FakeGitHub(
      [externalIssue(number: 14)],
      fresh: {
        14: externalIssue(number: 14, labels: [needsTriageLabel]),
      },
    );
    await run(github);

    expect(github.itemCalls, [14]); // It read the item again...
    expect(github.addedFlags, isEmpty); // ...and backed off.
  });

  test('does not flag an item prioritized since the listing', () async {
    // A team member answered the reporter, so the priority was the only
    // thing missing.
    final github = FakeGitHub(
      [externalIssue(number: 15, comments: 1)],
      itemComments: {
        15: [memberComment(0)],
      },
      fresh: {
        15: externalIssue(number: 15, labels: ['P3'], comments: 1),
      },
    );
    await run(github);

    expect(github.itemCalls, [15]);
    expect(github.addedFlags, isEmpty);
    expect(github.removedLabels, isEmpty);
  });

  test('does not unflag an item unflagged since the listing', () async {
    final github = FakeGitHub(
      [
        issue(number: 24, labels: ['P3', needsTriageLabel]),
      ],
      fresh: {
        24: issue(number: 24, labels: ['P3']),
      },
    );
    await run(github);

    expect(github.itemCalls, [24]);
    expect(github.removedLabels, isEmpty);
    expect(github.addedFlags, isEmpty);
  });

  test('skips an item that the listing has as open but is closed', () async {
    // GitHub's index lags: the listing matches step 4, but the item is
    // closed, and a closed item is nobody's triage work.
    final github = FakeGitHub(
      [externalIssue(number: 25)],
      fresh: {25: externalIssue(number: 25, state: 'closed')},
    );
    final String log = await run(github);

    expect(github.itemCalls, [25]);
    expect(github.addedFlags, isEmpty);
    expect(github.removedLabels, isEmpty);
    expect(log, contains('Skipped '));
  });

  test('reads the comments only of items that have them', () async {
    final github = FakeGitHub(
      [issue(number: 12, comments: 1), issue(number: 13)],
      itemComments: {
        12: [externalComment(2)],
      },
    );
    await run(github);

    expect(github.commentCalls, [12]);
  });

  test('keeps the labels of an item whose history fails to load', () async {
    // An issue with a P3 whose external comment is unanswered: without its
    // comments, the rules would see nothing to flag.
    final github = FakeGitHub(
      [
        issue(number: 14, labels: ['P3', needsTriageLabel], comments: 1),
        externalIssue(number: 15, comments: 1),
      ],
      itemComments: {
        14: [externalComment(2)],
      },
      failingComments: {14, 15},
    );
    final String log = await run(github);

    expect(github.removedLabels, isEmpty);
    expect(github.addedFlags, isEmpty);
    expect(github.itemCalls, isEmpty);
    expect(
      log,
      contains(
        'Skipped https://github.com/a2ui-project/a2ui/issues/14 — its '
        'history could not be read in full.',
      ),
    );
    expect(log, contains('Failed to fetch comments for #14: '));
  });

  test('logs an item that fails to update, and goes on', () async {
    final github = _FailingGitHub([
      externalIssue(number: 1),
      externalIssue(number: 2),
    ], failing: 1);
    final String log = await run(github);

    expect(github.addedFlags, [2]);
    expect(log, contains('Failed to update #1: '));
  });

  group('triage bot comments', () {
    final Contribution analysis = contribution(
      body: '**From triage bot, analysis:**\n\n...',
    );

    // Regression: https://github.com/a2ui-project/a2ui/issues/1888 lost its
    // staleness flag when a maintainer posted a triage analysis on it.
    test('do not reset the staleness clock', () async {
      final github = FakeGitHub(
        [
          externalIssue(
            number: 40,
            labels: ['P0', needsTriageLabel],
            assignees: 1,
            createdAt: daysAgo(60),
            comments: 3,
          ),
        ],
        itemComments: {
          40: [
            contribution(createdAt: daysAgo(40), body: 'Looking into it.'),
            pingComment(StaleCase.p0Inactive, 30),
            analysis,
          ],
        },
      );
      await run(github);

      expect(github.removedLabels, isEmpty);
    });

    // Were it an answer, step 4 would take this team issue off the queue.
    test('do not answer an out-of-team comment', () async {
      final github = FakeGitHub(
        [
          issue(
            number: 41,
            labels: [needsTriageLabel],
            createdAt: daysAgo(5),
            comments: 2,
          ),
        ],
        itemComments: {
          41: [externalComment(1), analysis],
        },
      );
      await run(github);

      expect(github.removedLabels, isEmpty);
    });
  });

  group('waiting-for-author-response', () {
    /// A parked item: the waiting label went on [labeledDaysAgo] days ago,
    /// and [comments] replies were posted [repliedDaysAgo] days ago, by the
    /// reporter unless [replyFrom] and [replyAssociation] say otherwise.
    /// Replies default to now, so that the staleness rules stay quiet.
    /// Without [labelEvent], the history has no record of the labeling, as
    /// if it could not be read.
    FakeGitHub parked(
      int number, {
      int comments = 0,
      num repliedDaysAgo = 0,
      User replyFrom = reporter,
      String replyAssociation = 'NONE',
      num labeledDaysAgo = 1,
      bool labelEvent = true,
      List<String> labels = const [waitingForAuthorResponseLabel],
      int assignees = 0,
      Item? fresh,
    }) => FakeGitHub(
      [
        externalIssue(
          number: number,
          labels: labels,
          comments: comments,
          assignees: assignees,
        ),
      ],
      itemComments: {
        number: [
          for (var i = 0; i < comments; i++)
            contribution(
              createdAt: daysAgo(repliedDaysAgo),
              association: replyAssociation,
              user: replyFrom,
            ),
        ],
      },
      itemEvents: {
        number: [
          if (labelEvent)
            labeling(waitingForAuthorResponseLabel, labeledDaysAgo),
        ],
      },
      fresh: {number: ?fresh},
    );

    test('keeps the label, and the item out of triage, until someone '
        'replies', () async {
      // With no replies, the opening post is the last human contribution,
      // and it predates the label, so it is not a response.
      final FakeGitHub github = parked(15); // Would otherwise match step 4.
      await run(github);

      expect(github.itemCalls, isEmpty); // Nothing to change.
      expect(github.removedLabels, isEmpty);
      expect(github.addedFlags, isEmpty);
    });

    test('clears the label once the reporter has replied', () async {
      // The reply is itself an unanswered out-of-team comment, so step 4
      // puts the item back on the triage queue at once.
      final FakeGitHub github = parked(
        16,
        comments: 1,
        labels: [waitingForAuthorResponseLabel, 'P3'],
      );
      final String log = await run(github);

      expect(github.eventCalls, [16]);
      expect(github.removedLabels, [
        (number: 16, label: waitingForAuthorResponseLabel),
      ]);
      expect(github.addedFlags, [16]);
      expect(
        log,
        contains(
          'Cleared status: waiting-for-author-response on '
          'https://github.com/a2ui-project/a2ui/issues/16 — an out-of-team '
          'contributor responded.',
        ),
      );
    });

    test('leaves an assigned issue off the queue when it unparks', () async {
      // The assignee answers the reply; it is not triage work.
      final FakeGitHub github = parked(
        29,
        comments: 1,
        labels: [waitingForAuthorResponseLabel, 'P3'],
        assignees: 1,
      );
      await run(github);

      expect(github.removedLabels, [
        (number: 29, label: waitingForAuthorResponseLabel),
      ]);
      expect(github.addedFlags, isEmpty);
    });

    test('clears the label when anyone outside the team replies', () async {
      final FakeGitHub github = parked(
        25,
        comments: 1,
        replyFrom: const User(login: 'passer-by', type: 'User'),
        labels: [waitingForAuthorResponseLabel, 'P3'],
      );
      await run(github);

      expect(github.removedLabels, [
        (number: 25, label: waitingForAuthorResponseLabel),
      ]);
    });

    test('keeps the label when only a maintainer has replied', () async {
      // The team asked the question; asking again does not answer it.
      final FakeGitHub github = parked(
        26,
        comments: 1,
        replyFrom: maintainer,
        replyAssociation: 'MEMBER',
      );
      await run(github);

      expect(github.removedLabels, isEmpty);
      expect(github.addedFlags, isEmpty); // Still parked.
    });

    test('keeps the label when only a bot has replied', () async {
      final FakeGitHub github = parked(
        27,
        comments: 1,
        replyFrom: const User(login: 'stale-bot[bot]', type: 'Bot'),
      );
      await run(github);

      expect(github.removedLabels, isEmpty);
      expect(github.addedFlags, isEmpty);
    });

    test('keeps the label when the reply predates it', () async {
      // The reply answered an earlier round of the conversation.
      final FakeGitHub github = parked(
        19,
        comments: 1,
        repliedDaysAgo: 2,
        labeledDaysAgo: 1,
      );
      await run(github);

      expect(github.removedLabels, isEmpty);
      expect(github.addedFlags, isEmpty); // Still parked.
    });

    test('measures from the latest labeling, not the first', () async {
      // Parked, answered, parked again: the answer to the first round must
      // not clear the second.
      final FakeGitHub github = parked(20, comments: 1, repliedDaysAgo: 3);
      github.itemEvents[20]!
        ..clear()
        ..addAll([
          labeling(waitingForAuthorResponseLabel, 5),
          labeling(waitingForAuthorResponseLabel, 1),
        ]);
      await run(github);

      expect(github.removedLabels, isEmpty);
    });

    test('ignores labelings of other labels', () async {
      final FakeGitHub github = parked(
        21,
        comments: 1,
        repliedDaysAgo: 2,
        labeledDaysAgo: 3,
      );
      github.itemEvents[21]!.add(labeling('P3', 0));
      await run(github);

      expect(github.removedLabels, [
        (number: 21, label: waitingForAuthorResponseLabel),
      ]);
    });

    test('keeps the label when the history does not record it being '
        'added', () async {
      // Nothing to measure the reply against, so leave it for a person.
      final FakeGitHub github = parked(22, comments: 1, labelEvent: false);
      final String log = await run(github);

      expect(github.removedLabels, isEmpty);
      expect(github.addedFlags, isEmpty);
      expect(
        log,
        contains(
          "No 'status: waiting-for-author-response' labeling recorded on "
          'https://github.com/a2ui-project/a2ui/issues/22; leaving it as it '
          'is.',
        ),
      );
    });

    test('does not read the history of items that are not parked', () async {
      final github = FakeGitHub([issue(number: 23)]);
      await run(github);

      expect(github.eventCalls, isEmpty);
    });

    test('flags in the same run in which it clears the label', () async {
      // Step 4 matches once the label is gone; that must not wait a run.
      final FakeGitHub github = parked(17, comments: 1);
      await run(github);

      expect(github.removedLabels, [
        (number: 17, label: waitingForAuthorResponseLabel),
      ]);
      expect(github.addedFlags, [17]);
    });

    test('does not clear the label on an item closed since', () async {
      final FakeGitHub github = parked(
        28,
        comments: 1,
        fresh: issue(
          number: 28,
          state: 'closed',
          labels: [waitingForAuthorResponseLabel],
        ),
      );
      await run(github);

      expect(github.itemCalls, [28]);
      expect(github.removedLabels, isEmpty);
      expect(github.addedFlags, isEmpty);
    });

    test('backs off when another run already changed both labels', () async {
      final FakeGitHub github = parked(
        18,
        comments: 1,
        fresh: issue(number: 18, labels: [needsTriageLabel]),
      );
      await run(github);

      expect(github.itemCalls, [18]);
      expect(github.removedLabels, isEmpty);
      expect(github.addedFlags, isEmpty);
    });
  });

  group('assigned-for-triage', () {
    const StaleCase assignment = StaleCase.assignedForTriage;
    final int overdue = assignment.days + assignment.graceDays + 1;

    /// An external P3 issue handed out for triage [labeledDaysAgo] days ago,
    /// or with no record of the labeling, and pinged [pingedDaysAgo] days
    /// ago, or never. It matches no other rule, so any flag comes from steps
    /// 2 and 3.
    FakeGitHub handedOut(
      int number, {
      num? labeledDaysAgo,
      num? pingedDaysAgo,
      List<String> labels = const ['P3', assignedForTriageLabel],
      Item? fresh,
    }) => FakeGitHub(
      [
        externalIssue(
          number: number,
          labels: labels,
          assignees: 1,
          comments: pingedDaysAgo == null ? 0 : 1,
        ),
      ],
      itemComments: {
        number: [
          if (pingedDaysAgo != null) pingComment(assignment, pingedDaysAgo),
        ],
      },
      itemEvents: {
        number: [
          if (labeledDaysAgo != null)
            labeling(assignedForTriageLabel, labeledDaysAgo),
        ],
      },
      fresh: {number: ?fresh},
    );

    test('flags an assignment once its ping expires', () async {
      final FakeGitHub github = handedOut(
        30,
        labeledDaysAgo: overdue,
        pingedDaysAgo: assignment.graceDays + 0.5,
      );
      await run(github);

      expect(github.eventCalls, [30]);
      expect(github.addedFlags, [30]);
    });

    test('leaves a stale assignment alone until it is pinged', () async {
      final FakeGitHub github = handedOut(
        31,
        labeledDaysAgo: assignment.days + 1,
      );
      await run(github);

      expect(github.eventCalls, [31]);
      expect(github.addedFlags, isEmpty);
    });

    test('flags an overdue assignment that nobody pinged', () async {
      final FakeGitHub github = handedOut(38, labeledDaysAgo: overdue);
      final String log = await run(github);

      expect(github.addedFlags, [38]);
      expect(log, contains('nobody pinged the assignees'));
    });

    test('leaves an assignment alone within the grace period of its '
        'ping', () async {
      final FakeGitHub github = handedOut(
        37,
        labeledDaysAgo: overdue,
        pingedDaysAgo: assignment.graceDays - 1,
      );
      await run(github);

      expect(github.addedFlags, isEmpty);
    });

    test('measures from the latest labeling, not the first', () async {
      // Adding the label again starts a new assignment, which the old ping
      // was not for.
      final FakeGitHub github = handedOut(
        32,
        pingedDaysAgo: assignment.graceDays + 2,
      );
      github.itemEvents[32]!.addAll([
        labeling(assignedForTriageLabel, overdue + 10),
        labeling(assignedForTriageLabel, 1),
      ]);
      await run(github);

      expect(github.addedFlags, isEmpty);
    });

    test('does not flag when the history does not record the label being '
        'added', () async {
      final FakeGitHub github = handedOut(33, pingedDaysAgo: overdue);
      await run(github);

      expect(github.addedFlags, isEmpty);
    });

    test('does not flag an item whose label was removed since the '
        'listing', () async {
      // The listing has an expired ping, but the label is gone, so the
      // assignment no longer applies.
      final FakeGitHub github = handedOut(
        34,
        labeledDaysAgo: overdue,
        pingedDaysAgo: assignment.graceDays + 0.5,
        fresh: externalIssue(number: 34, labels: ['P3'], assignees: 1),
      );
      await run(github);

      expect(github.itemCalls, [34]);
      expect(github.addedFlags, isEmpty);
    });

    test('reads the history once for an item with both timed labels', () async {
      final FakeGitHub github = handedOut(
        36,
        labels: ['P3', assignedForTriageLabel, waitingForAuthorResponseLabel],
        pingedDaysAgo: assignment.graceDays + 0.5,
      );
      github.itemEvents[36]!.addAll([
        labeling(assignedForTriageLabel, overdue),
        labeling(waitingForAuthorResponseLabel, 1),
      ]);
      await run(github);

      expect(github.eventCalls, [36]);
      expect(github.addedFlags, isEmpty); // The parking outranks it.
      expect(github.removedLabels, isEmpty); // Nobody has replied.
    });
  });
}

/// A [FakeGitHub] that fails to add a label to the item with [failing].
final class _FailingGitHub extends FakeGitHub {
  _FailingGitHub(super.items, {required this.failing});

  final int failing;

  @override
  Future<void> addLabel(int number, String label) async {
    if (number == failing) throw const GitHubException('GitHub answered 502');
    return super.addLabel(number, label);
  }
}
