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

import 'package:flagger/flagger.dart';
import 'package:shared/shared.dart';
import 'package:test/test.dart';

import '../support/fakes.dart';

/// Matches a reason that flags the item, and that has [pattern] in it.
Matcher flaggedFor(Pattern pattern) => allOf(isNotNull, contains(pattern));

/// The priorities of the issues that go stale.
final Set<String> stalePriorities = {
  for (final StaleCase staleCase in StaleCase.values) ?staleCase.priority,
};

/// A ping for [staleCase], [days] days ago.
Ping ping(StaleCase staleCase, num days) => Ping(staleCase, daysAgo(days));

void main() {
  group('lastHumanContribution', () {
    test('falls back to the opening post when there are no comments', () {
      final Item item = issue(createdAt: daysAgo(5), association: 'NONE');
      final Contribution latest = lastHumanContribution(item, []);
      expect(latest.createdAt, item.createdAt);
      expect(latest.association, 'NONE');
    });

    test('returns the newest non-bot comment', () {
      final Item item = issue(createdAt: daysAgo(10));
      final List<Contribution> comments = [
        contribution(
          createdAt: daysAgo(8),
          user: const User(login: 'a', type: 'User'),
        ),
        contribution(
          createdAt: daysAgo(2),
          user: const User(login: 'b', type: 'User'),
        ),
      ];
      expect(lastHumanContribution(item, comments).createdAt, daysAgo(2));
    });

    test('ignores bot comments so they do not reset the clock', () {
      final Item item = issue(createdAt: daysAgo(10));
      final List<Contribution> comments = [memberComment(7), botComment(1)];
      expect(lastHumanContribution(item, comments).createdAt, daysAgo(7));
    });
  });

  group('externalHasResponded', () {
    // The label went on 3 days ago, so only contributions since then answer
    // it.
    final DateTime labeledAt = daysAgo(3);

    // Regression: the opening post is not a contribution and always predates
    // the label. An item with no replies is the one still waiting.
    test('does not count the opening post as a response', () {
      expect(externalHasResponded([], labeledAt), isFalse);
    });

    test('is true when an external contributor replied after the label', () {
      expect(externalHasResponded([externalComment(1)], labeledAt), isTrue);
    });

    test('is false when the only external reply predates the label', () {
      expect(externalHasResponded([externalComment(5)], labeledAt), isFalse);
    });

    // Ties resolve toward clearing: an item is better off back on the triage
    // queue than parked and invisible because of a same-second timestamp.
    test('counts a reply stamped at the moment of labeling', () {
      expect(externalHasResponded([externalComment(3)], labeledAt), isTrue);
    });

    // The label waits for a word from outside the team, whoever it is from.
    test('counts any external contributor, not just the item author', () {
      final Contribution reply = externalComment(
        1,
        user: const User(login: 'passer-by', type: 'User'),
      );
      expect(externalHasResponded([reply], labeledAt), isTrue);
    });

    test('ignores maintainer replies, whatever their association', () {
      for (final association in ['OWNER', 'MEMBER', 'COLLABORATOR']) {
        final Contribution reply = contribution(
          createdAt: daysAgo(1),
          association: association,
        );
        expect(
          externalHasResponded([reply], labeledAt),
          isFalse,
          reason: association,
        );
      }
    });

    // Bots count as external everywhere else, but cannot answer a question.
    test('ignores bot replies', () {
      expect(externalHasResponded([botComment(1)], labeledAt), isFalse);
    });

    test('still counts an external reply when a maintainer replied after', () {
      expect(
        externalHasResponded([externalComment(1), memberComment(0)], labeledAt),
        isTrue,
      );
    });

    test('is false when the labeling time is unknown, so the label stays', () {
      expect(externalHasResponded([externalComment(1)], null), isFalse);
    });
  });

  group('flagReason, issues', () {
    test('flags an external issue with no priority label', () {
      expect(
        flagReason(externalIssue(), [], now),
        flaggedFor('no priority label'),
      );
    });

    // The team manages its own issues.
    test("does not flag a team member's issue with no priority label", () {
      expect(flagReason(issue(), [], now), isNull);
    });

    test('does not flag issues parked on the user response', () {
      final Item item = externalIssue(labels: [waitingForAuthorResponseLabel]);
      expect(flagReason(item, [], now), isNull);
    });

    // Only P0 and P1 issues go stale, and a priority settles the
    // missing-priority check, so nothing else can flag an assigned P2 or P3.
    test('does not flag an assigned issue below P1, whatever else is wrong '
        'with it', () {
      for (final priority in ['P2', 'P3']) {
        final Item item = externalIssue(
          labels: [priority],
          assignees: 1,
          createdAt: daysAgo(9999),
        );
        expect(flagReason(item, [], now), isNull, reason: priority);
      }
    });

    // The same check applies whether or not someone is assigned.
    for (final (String name, int assignees) in [
      ('assigned', 1),
      ('unassigned', 0),
    ]) {
      group('$name with no priority', () {
        test('flags an issue opened by an external contributor', () {
          expect(
            flagReason(externalIssue(assignees: assignees), [], now),
            flaggedFor('no priority label'),
          );
        });

        test("flags a team member's issue with an external comment", () {
          final Item item = issue(assignees: assignees, comments: 1);
          expect(
            flagReason(item, [externalComment(0)], now),
            flaggedFor('no priority label'),
          );
        });

        // The flag is about the missing priority, not an unanswered comment,
        // so a team reply does not clear it on an issue from outside the
        // team.
        test('keeps flagging an external issue once a team member replied', () {
          final Item item = externalIssue(assignees: assignees, comments: 1);
          expect(
            flagReason(item, [memberComment(0)], now),
            flaggedFor('no priority label'),
          );
        });

        // On a team member's issue, though, the reply settles step 4.
        test("does not flag a team member's issue once the external comment "
            'is answered', () {
          final Item item = issue(assignees: assignees, comments: 2);
          expect(
            flagReason(item, [externalComment(0), memberComment(0)], now),
            isNull,
          );
        });

        test("does not flag a team member's issue with only team comments", () {
          final Item item = issue(assignees: assignees, comments: 1);
          expect(flagReason(item, [memberComment(0)], now), isNull);
        });

        // Regression: #3595, filed by the e2e workflow, never stayed flagged.
        test('flags an issue opened by a bot', () {
          final Item item = issue(
            assignees: assignees,
            association: 'CONTRIBUTOR',
            user: const User(login: 'github-actions[bot]', type: 'Bot'),
          );
          expect(flagReason(item, [], now), flaggedFor('no priority label'));
        });

        // A bot comment is not a human contribution, so it leaves nothing
        // unanswered.
        test("does not flag a team member's issue with only a bot comment", () {
          final Item item = issue(assignees: assignees, comments: 1);
          expect(flagReason(item, [botComment(0)], now), isNull);
        });
      });
    }

    test('flags every assignee-required priority with no assignee', () {
      for (final String priority in assigneeRequiredPriorities) {
        expect(
          flagReason(externalIssue(labels: [priority]), [], now),
          flaggedFor('no assignee'),
          reason: priority,
        );
      }
    });

    test('does not let a milestone stand in for the assignee', () {
      for (final String priority in assigneeRequiredPriorities) {
        final Item item = externalIssue(labels: [priority], milestone: true);
        expect(
          flagReason(item, [], now),
          flaggedFor('no assignee'),
          reason: priority,
        );
      }
    });

    for (final StaleCase staleCase in StaleCase.values) {
      final String? priority = staleCase.priority;
      if (priority == null) continue;
      final int threshold = staleCase.days;
      final int grace = staleCase.graceDays;

      // Staleness alone does not flag at first: the pinger asks the
      // assignees first.
      test('does not flag an assigned $priority that went stale without a '
          'ping, for as long as a ping and its grace period would take', () {
        final Item item = externalIssue(
          labels: [priority],
          assignees: 1,
          createdAt: daysAgo(threshold + grace),
        );
        expect(flagReason(item, [], now), isNull);
      });

      // Nobody ran the pinger, so the item goes back to triage on its own.
      test('flags an assigned $priority that nobody pinged once it is '
          'overdue', () {
        final Item item = externalIssue(
          labels: [priority],
          assignees: 1,
          createdAt: daysAgo(threshold + grace + 1),
        );
        final String? reason = flagReason(item, [], now);
        expect(reason, flaggedFor('no update from the team'));
        expect(reason, flaggedFor('nobody pinged the assignees'));
        // A ping for another case does not hold off the flag.
        expect(
          flagReason(
            item,
            [],
            now,
            pings: [ping(StaleCase.assignedForTriage, 0)],
          ),
          flaggedFor('nobody pinged the assignees'),
        );
      });

      test('does not flag an assigned $priority within the grace period of '
          'its ping', () {
        final Item item = externalIssue(
          labels: [priority],
          assignees: 1,
          createdAt: daysAgo(threshold + grace),
        );
        expect(
          flagReason(item, [], now, pings: [ping(staleCase, grace)]),
          isNull,
        );
      });

      test('flags an assigned $priority once its ping expires', () {
        final Item item = externalIssue(
          labels: [priority],
          assignees: 1,
          createdAt: daysAgo(threshold + grace + 1),
        );
        final String? reason = flagReason(
          item,
          [],
          now,
          pings: [ping(staleCase, grace + 0.5)],
        );
        expect(reason, flaggedFor('no update from the team'));
        expect(reason, flaggedFor('did not act on the staleness ping'));
      });

      // The flag also applies to a team member's issue: the ping promised
      // it.
      test("flags a team member's assigned $priority once its ping "
          'expires', () {
        final Item item = issue(
          labels: [priority],
          assignees: 1,
          createdAt: daysAgo(threshold + grace + 1),
        );
        expect(
          flagReason(item, [], now, pings: [ping(staleCase, grace + 0.5)]),
          flaggedFor('did not act on the staleness ping'),
        );
      });

      // A team update after the ping starts a new clock, so the old ping is
      // no longer current.
      test('does not flag an assigned $priority updated by the team since '
          'its ping', () {
        final Item item = externalIssue(
          labels: [priority],
          assignees: 1,
          comments: 1,
          createdAt: daysAgo(threshold + grace + 10),
        );
        expect(
          flagReason(
            item,
            [memberComment(grace)],
            now,
            pings: [ping(staleCase, grace + 1)],
          ),
          isNull,
        );
      });

      // The assignee answers out-of-team comments, so they do not stop the
      // clock.
      test('flags an assigned $priority with only out-of-team comments since '
          'its ping', () {
        final Item item = externalIssue(
          labels: [priority],
          assignees: 1,
          comments: 1,
          createdAt: daysAgo(threshold + grace + 10),
        );
        expect(
          flagReason(
            item,
            [externalComment(0)],
            now,
            pings: [ping(staleCase, grace + 1)],
          ),
          flaggedFor('did not act on the staleness ping'),
        );
      });

      test('ignores a ping for another case on an assigned $priority', () {
        final Item item = externalIssue(
          labels: [priority],
          assignees: 1,
          createdAt: daysAgo(threshold + grace),
        );
        expect(
          flagReason(
            item,
            [],
            now,
            pings: [ping(StaleCase.assignedForTriage, grace - 0.5)],
          ),
          isNull,
        );
      });

      // An unassigned issue is reported for the missing assignee instead.
      test('reports a stale unassigned $priority as having no assignee', () {
        final Item item = externalIssue(
          labels: [priority],
          createdAt: daysAgo(threshold + 1),
        );
        expect(flagReason(item, [], now), flaggedFor('no assignee'));
      });
    }

    for (final String priority in assigneeOrMilestonePriorities) {
      test('flags an unassigned $priority with no milestone', () {
        expect(
          flagReason(externalIssue(labels: [priority]), [], now),
          flaggedFor('no assignee or milestone'),
        );
      });

      test('does not flag an unassigned $priority with a milestone', () {
        final Item item = externalIssue(labels: [priority], milestone: true);
        expect(flagReason(item, [], now), isNull);
      });

      // A milestone settles the planning, not the conversation.
      test('flags an unassigned $priority with a milestone for an unanswered '
          'out-of-team comment', () {
        final Item item = externalIssue(
          labels: [priority],
          milestone: true,
          comments: 1,
        );
        expect(
          flagReason(item, [externalComment(0)], now),
          flaggedFor('latest comment'),
        );
      });

      test('does not flag a fresh assigned $priority with no milestone', () {
        final Item item = externalIssue(labels: [priority], assignees: 1);
        expect(flagReason(item, [], now), isNull);
      });
    }

    // Only assigned issues go stale, so every priority that goes stale must
    // flag an unassigned issue that nobody has planned.
    test('requires an assignee or milestone for every priority that goes '
        'stale', () {
      for (final String priority in stalePriorities) {
        expect(
          assigneeRequiredPriorities.contains(priority) ||
              assigneeOrMilestonePriorities.contains(priority),
          isTrue,
          reason: priority,
        );
      }
    });

    // The staleness rules cover P0 and P1 only; P2 used to be flagged after
    // 90 days and deliberately no longer is.
    test('watches staleness for P0 and P1 only', () {
      expect(stalePriorities, ['P0', 'P1']);
    });

    test(
      'requires an assignee for P0, and an assignee or milestone for P1',
      () {
        expect(assigneeRequiredPriorities, ['P0']);
        expect(assigneeOrMilestonePriorities, ['P1']);
      },
    );

    test('never flags a P2 for staleness, however old, assigned or not', () {
      for (final assignees in [0, 1]) {
        final Item item = externalIssue(
          labels: ['P2'],
          assignees: assignees,
          createdAt: daysAgo(9999),
        );
        expect(
          flagReason(item, [], now),
          isNull,
          reason: '$assignees assignee(s)',
        );
      }
    });
  });

  group('flagReason, assigned for triage', () {
    const StaleCase assignment = StaleCase.assignedForTriage;
    final DateTime overdue = daysAgo(
      assignment.days + assignment.graceDays + 1,
    );
    final List<Ping> expired = [ping(assignment, assignment.graceDays + 0.5)];

    // An external P3 issue matches no other rule, so any flag comes from
    // steps 2 and 3.
    Item handedOut({
      List<String> labels = const ['P3', assignedForTriageLabel],
      int assignees = 1,
      String association = 'NONE',
      DateTime? createdAt,
    }) => issue(
      labels: labels,
      assignees: assignees,
      association: association,
      user: association == 'NONE' ? reporter : maintainer,
      createdAt: createdAt,
    );

    test('does not flag a stale assignment without a ping until it is '
        'overdue', () {
      expect(
        flagReason(
          handedOut(),
          [],
          now,
          assignedForTriageSince: daysAgo(
            assignment.days + assignment.graceDays,
          ),
        ),
        isNull,
      );
    });

    test('flags an overdue assignment that nobody pinged', () {
      final String? reason = flagReason(
        handedOut(),
        [],
        now,
        assignedForTriageSince: overdue,
      );
      expect(reason, flaggedFor('assigned-for-triage'));
      expect(reason, flaggedFor('nobody pinged the assignees'));
    });

    test('does not flag an assignment within the grace period of its '
        'ping', () {
      expect(
        flagReason(
          handedOut(),
          [],
          now,
          assignedForTriageSince: overdue,
          pings: [ping(assignment, assignment.graceDays)],
        ),
        isNull,
      );
    });

    test('flags an assignment once its ping expires', () {
      final String? reason = flagReason(
        handedOut(),
        [],
        now,
        assignedForTriageSince: overdue,
        pings: expired,
      );
      expect(reason, flaggedFor('assigned-for-triage'));
      expect(reason, flaggedFor('more than ${assignment.days} days'));
      expect(reason, flaggedFor('did not act on the staleness ping'));
    });

    // Adding the label again starts a new assignment, so a ping on the
    // previous one is not current.
    test('ignores a ping from before the latest labeling', () {
      expect(
        flagReason(
          handedOut(),
          [],
          now,
          assignedForTriageSince: daysAgo(assignment.days + 1),
          pings: [ping(assignment, assignment.days + 2)],
        ),
        isNull,
      );
    });

    test('flags the label when nobody is assigned, however fresh', () {
      expect(
        flagReason(
          handedOut(assignees: 0),
          [],
          now,
          assignedForTriageSince: daysAgo(0),
        ),
        flaggedFor('nobody is assigned'),
      );
    });

    // Step 3 decides alone: a fresh assignment holds back every later step.
    // The item below would be flagged without the label.
    test(
      'does not flag a fresh assignment, whatever else is wrong with it',
      () {
        final Item staleP0 = handedOut(
          labels: ['P0', assignedForTriageLabel],
          createdAt: daysAgo(9999),
        );
        expect(
          flagReason(staleP0, [], now, assignedForTriageSince: daysAgo(1)),
          isNull,
        );
      },
    );

    // Step 1 outranks the others: a parked item waits on the author, not the
    // assignee.
    test('does not flag a parked item, even with an expired ping', () {
      const List<String> labels = [
        'P3',
        assignedForTriageLabel,
        waitingForAuthorResponseLabel,
      ];
      expect(
        flagReason(
          handedOut(labels: labels),
          [],
          now,
          assignedForTriageSince: overdue,
          pings: expired,
        ),
        isNull,
      );
      expect(
        flagReason(
          handedOut(labels: labels, assignees: 0),
          [],
          now,
          assignedForTriageSince: overdue,
        ),
        isNull,
      );
    });

    test('flags an expired assignment on an external PR', () {
      final Item item = pr(labels: [assignedForTriageLabel], assignees: 1);
      expect(
        flagReason(
          item,
          [],
          now,
          assignedForTriageSince: overdue,
          pings: expired,
        ),
        flaggedFor('assigned-for-triage'),
      );
    });

    // Steps 2 and 3 run before step 4, so an assignment is checked whoever
    // opened the item, even with no out-of-team input.
    test('checks an assignment on a team item with no out-of-team input', () {
      final Item item = handedOut(association: 'MEMBER');
      expect(
        flagReason(
          item,
          [],
          now,
          assignedForTriageSince: overdue,
          pings: expired,
        ),
        flaggedFor('more than'),
      );
      expect(
        flagReason(
          handedOut(association: 'MEMBER', assignees: 0),
          [],
          now,
          assignedForTriageSince: daysAgo(0),
        ),
        flaggedFor('nobody is assigned'),
      );
      expect(
        flagReason(item, [], now, assignedForTriageSince: daysAgo(1)),
        isNull,
      );
    });

    test('does not flag when the labeling time is unknown', () {
      expect(flagReason(handedOut(), [], now, pings: expired), isNull);
    });

    // The labeling time comes from the snapshot; if the label has since been
    // removed, the time must not count.
    test('ignores the labeling time once the label is gone', () {
      expect(
        flagReason(
          handedOut(labels: ['P3']),
          [],
          now,
          assignedForTriageSince: overdue,
          pings: expired,
        ),
        isNull,
      );
    });
  });

  // priorityLabels is the single source of truth for which labels count as a
  // priority. These tests pin that contract, so that a rename or reorder
  // cannot silently break triage.
  group('flagReason, priorityLabels contract', () {
    test('treats every priorityLabels entry as a real priority', () {
      for (final String priority in priorityLabels) {
        // Fresh, so only the priority rules can flag it.
        final String? reason = flagReason(
          externalIssue(labels: [priority]),
          [],
          now,
        );
        expect(reason ?? '', isNot(contains('no priority label')));
      }
    });

    test('flags an issue whose label is not a priority as unprioritized', () {
      const notAPriority = 'area: rendering';
      expect(priorityLabels, isNot(contains(notAPriority)));
      expect(
        flagReason(externalIssue(labels: [notAPriority]), [], now),
        flaggedFor('no priority label'),
      );
    });

    test('never flags a priority that does not go stale', () {
      final List<String> unthresholded = [
        for (final String priority in priorityLabels)
          if (!stalePriorities.contains(priority) &&
              !assigneeRequiredPriorities.contains(priority) &&
              !assigneeOrMilestonePriorities.contains(priority))
            priority,
      ];
      expect(unthresholded, isNotEmpty);
      for (final priority in unthresholded) {
        final Item item = externalIssue(
          labels: [priority],
          createdAt: daysAgo(9999),
        );
        expect(flagReason(item, [], now), isNull, reason: priority);
      }
    });

    test('keeps the rules consistent with priorityLabels', () {
      expect(priorityLabels, containsAll(stalePriorities));
      expect(priorityLabels, containsAll(assigneeRequiredPriorities));
      expect(priorityLabels, containsAll(assigneeOrMilestonePriorities));
    });
  });

  group('flagReason, PRs', () {
    Contribution prComment(num days) => contribution(
      createdAt: daysAgo(days),
      association: 'CONTRIBUTOR',
      user: contributor,
    );

    test('flags an unassigned external PR', () {
      final Item item = pr(createdAt: daysAgo(5), comments: 1);
      expect(flagReason(item, [prComment(2)], now), flaggedFor('no assignee'));
    });

    // There is no grace period: a PR is triage work from the moment it is
    // opened.
    test('flags an external PR opened moments ago', () {
      expect(
        flagReason(pr(createdAt: daysAgo(0)), [], now),
        flaggedFor('no assignee'),
      );
    });

    // A team comment is not a decision on the PR: only an assignee takes it
    // off the queue.
    test('keeps flagging an unassigned external PR after a team member '
        'replied', () {
      final Item item = pr(createdAt: daysAgo(5), comments: 2);
      expect(
        flagReason(item, [prComment(3), memberComment(2)], now),
        flaggedFor('no assignee'),
      );
    });

    test('does not flag a fresh assigned external PR, whoever spoke last', () {
      final Item item = pr(
        createdAt: daysAgo(prStaleDays),
        assignees: 1,
        comments: 1,
      );
      expect(flagReason(item, [], now), isNull);
      expect(flagReason(item, [prComment(0)], now), isNull);
      expect(flagReason(item, [memberComment(0)], now), isNull);
    });

    test('does not flag a stale assigned external PR without a ping until '
        'it is overdue', () {
      const StaleCase staleCase = StaleCase.externalPrInactive;
      final Item item = pr(
        createdAt: daysAgo(staleCase.days + staleCase.graceDays),
        assignees: 1,
      );
      expect(flagReason(item, [], now), isNull);
    });

    test('flags an overdue assigned external PR that nobody pinged', () {
      final Item item = pr(createdAt: daysAgo(9999), assignees: 1);
      expect(
        flagReason(item, [], now),
        flaggedFor('nobody pinged the assignees'),
      );
    });

    test('flags an assigned external PR once its ping expires', () {
      const StaleCase staleCase = StaleCase.externalPrInactive;
      final Item item = pr(
        createdAt: daysAgo(staleCase.days + staleCase.graceDays + 1),
        assignees: 1,
      );
      expect(
        flagReason(
          item,
          [],
          now,
          pings: [ping(staleCase, staleCase.graceDays + 0.5)],
        ),
        flaggedFor('no response from the team'),
      );
      // The author's own comments do not stop the clock.
      expect(
        flagReason(
          item,
          [prComment(0)],
          now,
          pings: [ping(staleCase, staleCase.graceDays + 0.5)],
        ),
        flaggedFor('did not act on the staleness ping'),
      );
    });

    // Step 4 keeps a team member's PR off the queue until someone outside
    // the team is left waiting on it.
    test("flags a team member's assigned PR only while an out-of-team "
        'comment is unanswered', () {
      final Item item = pr(
        createdAt: daysAgo(prStaleDays + 10),
        assignees: 1,
        association: 'MEMBER',
        comments: 1,
      );
      expect(flagReason(item, [], now), isNull);
      expect(flagReason(item, [memberComment(prStaleDays + 1)], now), isNull);
      expect(
        flagReason(item, [prComment(prStaleDays + 1)], now),
        flaggedFor('no human activity'),
      );
    });

    // Reviews and review comments arrive as contributions too.
    test("measures a team member's assigned PR from its latest human "
        'contribution', () {
      final Item item = pr(
        createdAt: daysAgo(prStaleDays + 10),
        assignees: 1,
        association: 'MEMBER',
        comments: 1,
      );
      expect(flagReason(item, [prComment(prStaleDays)], now), isNull);
      expect(
        flagReason(item, [prComment(prStaleDays + 1)], now),
        flaggedFor('no human activity'),
      );
    });

    test("does not let a bot comment reset the clock on a team member's "
        'assigned PR', () {
      final Item item = pr(
        createdAt: daysAgo(prStaleDays + 10),
        assignees: 1,
        association: 'MEMBER',
        comments: 2,
      );
      expect(
        flagReason(item, [prComment(prStaleDays + 1), botComment(0)], now),
        flaggedFor('no human activity'),
      );
    });

    test('does not flag an external PR waiting for its author', () {
      final Item item = pr(
        createdAt: daysAgo(30),
        labels: [waitingForAuthorResponseLabel],
      );
      expect(flagReason(item, [], now), isNull);
    });

    test('flags a bot PR until it is assigned', () {
      const dependabot = User(login: 'dependabot[bot]', type: 'Bot');
      expect(
        flagReason(pr(createdAt: daysAgo(2), user: dependabot), [], now),
        flaggedFor('no assignee'),
      );
      expect(
        flagReason(pr(createdAt: daysAgo(2), user: dependabot, comments: 1), [
          memberComment(1),
        ], now),
        flaggedFor('no assignee'),
      );
      expect(
        flagReason(
          pr(createdAt: daysAgo(2), user: dependabot, assignees: 1),
          [],
          now,
        ),
        isNull,
      );
    });

    test('never flags a draft PR, whatever else would flag it', () {
      final List<Item> drafts = [
        pr(draft: true),
        pr(draft: true, labels: [assignedForTriageLabel]),
        pr(
          draft: true,
          association: 'MEMBER',
          labels: [assignedForTriageLabel],
        ),
      ];
      for (final item in drafts) {
        expect(flagReason(item, [prComment(0)], now), isNull);
      }
      // Marked ready for review, the same PR is flagged again.
      expect(flagReason(pr(), [], now), flaggedFor('no assignee'));
    });

    test('does not flag an unassigned maintainer-authored PR with no '
        'out-of-team input', () {
      for (final association in ['OWNER', 'MEMBER', 'COLLABORATOR']) {
        final Item item = pr(createdAt: daysAgo(30), association: association);
        expect(flagReason(item, [], now), isNull, reason: association);
      }
    });

    test('flags an unassigned maintainer-authored PR with an unanswered '
        'out-of-team comment', () {
      final Item item = pr(
        createdAt: daysAgo(5),
        association: 'MEMBER',
        comments: 1,
      );
      expect(flagReason(item, [prComment(1)], now), flaggedFor('no assignee'));
    });
  });

  // Step 4: a team member's item is triage work only while a comment from
  // outside the team is unanswered.
  group('flagReason, team items', () {
    test('does not flag a team issue with no out-of-team input, whatever '
        'else is wrong with it, until it goes stale', () {
      for (final labels in [
        <String>[],
        ['P0'],
        ['P1'],
      ]) {
        for (final assignees in [0, 1]) {
          final Item item = issue(
            labels: labels,
            assignees: assignees,
            createdAt: daysAgo(StaleCase.p0Inactive.days),
          );
          expect(
            flagReason(item, [], now),
            isNull,
            reason: '$labels $assignees',
          );
        }
      }
    });

    test('applies the issue rules while an out-of-team comment is '
        'unanswered', () {
      final Item item = issue(
        labels: ['P0'],
        comments: 1,
        createdAt: daysAgo(5),
      );
      expect(
        flagReason(item, [externalComment(0)], now),
        flaggedFor('no assignee'),
      );
    });

    test('stops applying them once a team member replies', () {
      final Item item = issue(
        labels: ['P0'],
        comments: 2,
        createdAt: daysAgo(5),
      );
      expect(
        flagReason(item, [externalComment(3), memberComment(2)], now),
        isNull,
      );
    });

    // An unassigned issue whose latest comment is from outside the team
    // waits for an answer.
    group('unassigned, with the latest comment from outside the team', () {
      test('flags a P2 or P3 issue, whoever opened it', () {
        for (final priority in ['P2', 'P3']) {
          for (final Item item in [
            issue(labels: [priority], createdAt: daysAgo(5), comments: 1),
            externalIssue(
              labels: [priority],
              createdAt: daysAgo(5),
              comments: 1,
            ),
          ]) {
            expect(
              flagReason(item, [externalComment(0)], now),
              flaggedFor('latest comment'),
              reason: priority,
            );
          }
        }
      });

      test('stops flagging once a team member replies', () {
        final Item item = externalIssue(
          labels: ['P2'],
          createdAt: daysAgo(5),
          comments: 2,
        );
        expect(
          flagReason(item, [externalComment(3), memberComment(2)], now),
          isNull,
        );
      });

      // The opening post is not a comment, so nothing waits for an answer.
      test('does not flag an issue from outside the team that nobody has '
          'commented on', () {
        final Item item = externalIssue(labels: ['P2'], createdAt: daysAgo(5));
        expect(flagReason(item, [], now), isNull);
      });

      test('does not count a bot comment', () {
        final Item item = externalIssue(
          labels: ['P2'],
          createdAt: daysAgo(5),
          comments: 1,
        );
        expect(flagReason(item, [botComment(0)], now), isNull);
      });
    });

    // The assignee answers comments on an assigned issue.
    test('does not flag an assigned issue for a comment from outside the '
        'team', () {
      for (final String priority in priorityLabels) {
        for (final Item item in [
          issue(labels: [priority], assignees: 1, comments: 1),
          externalIssue(labels: [priority], assignees: 1, comments: 1),
        ]) {
          expect(
            flagReason(item, [externalComment(0)], now),
            isNull,
            reason: priority,
          );
        }
      }
    });

    // Step 4 only looks at who opened the item and who spoke last.
    test('judges an item opened outside the team whoever spoke last', () {
      expect(
        flagReason(externalIssue(comments: 1), [memberComment(0)], now),
        flaggedFor('no priority label'),
      );
    });
  });
}
