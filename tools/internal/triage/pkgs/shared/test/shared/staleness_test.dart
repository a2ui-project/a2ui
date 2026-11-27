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

import 'package:shared/shared.dart';
import 'package:test/test.dart';

final DateTime now = DateTime.utc(2026, 6, 30);

DateTime daysAgo(num days) => now.subtract(
  Duration(microseconds: (days * Duration.microsecondsPerDay).round()),
);

const User member = User(login: 'member', type: 'User');

Item item({
  List<String> labels = const [],
  List<String> assignees = const ['dev'],
  String association = 'NONE',
  bool pullRequest = false,
  bool draft = false,
  String state = 'open',
  num createdDaysAgo = 100,
}) => Item(
  number: 1,
  htmlUrl: 'https://github.com/a2ui-project/a2ui/issues/1',
  state: state,
  createdAt: daysAgo(createdDaysAgo),
  authorAssociation: association,
  labels: labels,
  assignees: assignees,
  isPullRequest: pullRequest,
  isDraft: draft,
);

Contribution comment(
  num days, {
  String association = 'MEMBER',
  User? user = member,
  String? body,
}) => Contribution(
  createdAt: daysAgo(days),
  association: association,
  user: user,
  body: body,
);

void main() {
  group('staleCaseOf', () {
    test('finds the case of each kind of assigned item', () {
      expect(
        staleCaseOf(item(labels: [assignedForTriageLabel, 'P0'])),
        StaleCase.assignedForTriage,
      );
      expect(staleCaseOf(item(labels: ['P0'])), StaleCase.p0Inactive);
      expect(staleCaseOf(item(labels: ['P1'])), StaleCase.p1Inactive);
      expect(
        staleCaseOf(item(pullRequest: true)),
        StaleCase.externalPrInactive,
      );
    });

    test('uses the most urgent priority', () {
      expect(staleCaseOf(item(labels: ['P1', 'P0'])), StaleCase.p0Inactive);
    });

    test('finds no case for items that cannot go stale', () {
      for (final (String why, Item it) in [
        ('no assignee', item(labels: ['P0'], assignees: [])),
        ('closed', item(labels: ['P0'], state: 'closed')),
        (
          'waiting for the author',
          item(labels: ['P0', waitingForAuthorResponseLabel]),
        ),
        (
          'waiting for the author, assigned for triage',
          item(labels: [assignedForTriageLabel, waitingForAuthorResponseLabel]),
        ),
        ('draft PR', item(pullRequest: true, draft: true)),
        ("team member's PR", item(pullRequest: true, association: 'MEMBER')),
        ('P2 issue', item(labels: ['P2'])),
        ('issue without priority', item()),
      ]) {
        expect(staleCaseOf(it), isNull, reason: why);
      }
    });
  });

  group('stalenessOf', () {
    test('starts the triage assignment clock at the latest labeling', () {
      final Staleness? staleness = stalenessOf(
        item(labels: [assignedForTriageLabel]),
        [comment(1)],
        assignedForTriageSince: daysAgo(20),
      );
      expect(staleness?.staleCase, StaleCase.assignedForTriage);
      expect(staleness?.since, daysAgo(20));
      expect(staleness?.isStale(now), isTrue);
    });

    test('has no clock for a triage assignment with an unknown labeling', () {
      expect(stalenessOf(item(labels: [assignedForTriageLabel]), []), isNull);
    });

    test('starts the other clocks at the latest team contribution', () {
      final Staleness? staleness = stalenessOf(item(labels: ['P1']), [
        comment(40),
        comment(10),
        comment(
          5,
          association: 'NONE',
          user: const User(login: 'reporter'),
        ),
        comment(
          1,
          user: const User(login: 'ci[bot]', type: 'Bot'),
        ),
      ]);
      expect(staleness?.since, daysAgo(10));
      expect(staleness?.isStale(now), isFalse);
    });

    test('starts them at the creation when the team has not contributed', () {
      final Staleness? staleness = stalenessOf(
        item(pullRequest: true, createdDaysAgo: 15),
        [comment(1, association: 'CONTRIBUTOR', user: null)],
      );
      expect(staleness?.since, daysAgo(15));
      expect(staleness?.isStale(now), isTrue);
    });

    test('is stale only past the days of its case', () {
      expect(
        stalenessOf(item(labels: ['P0'], createdDaysAgo: 1), [])?.isStale(now),
        isFalse,
      );
      expect(
        stalenessOf(
          item(labels: ['P0'], createdDaysAgo: 1.1),
          [],
        )?.isStale(now),
        isTrue,
      );
    });
  });

  group('pings', () {
    final staleness = Staleness(StaleCase.p1Inactive, daysAgo(40));

    test('a ping is current when posted for the case after the clock '
        'started', () {
      final current = Ping(StaleCase.p1Inactive, daysAgo(5));
      expect(
        staleness.currentPing([
          Ping(StaleCase.p1Inactive, daysAgo(50)),
          Ping(StaleCase.p0Inactive, daysAgo(3)),
          current,
          Ping(StaleCase.p1Inactive, daysAgo(9)),
        ]),
        current,
      );
      expect(
        staleness.currentPing([Ping(StaleCase.p1Inactive, daysAgo(41))]),
        isNull,
      );
    });

    test('a current ping expires after the grace period', () {
      expect(
        staleness.hasExpiredPing([Ping(StaleCase.p1Inactive, daysAgo(7))], now),
        isFalse,
      );
      expect(
        staleness.hasExpiredPing([
          Ping(StaleCase.p1Inactive, daysAgo(7.1)),
        ], now),
        isTrue,
      );
    });

    test('a ping does not expire on an item that is not stale', () {
      final fresh = Staleness(StaleCase.p1Inactive, daysAgo(20));
      expect(
        fresh.hasExpiredPing([Ping(StaleCase.p1Inactive, daysAgo(10))], now),
        isFalse,
      );
    });

    test('pingOf reads the case from the marker of a triage bot comment', () {
      for (final StaleCase staleCase in StaleCase.values) {
        final Ping? ping = pingOf(
          comment(
            2,
            body:
                '**From triage bot, ping:** @dev ...\n${pingMarker(staleCase)}',
          ),
        );
        expect(ping?.staleCase, staleCase);
        expect(ping?.createdAt, daysAgo(2));
      }
    });

    test('pingOf ignores other comments', () {
      final String marker = pingMarker(StaleCase.p0Inactive);
      for (final (String why, Contribution c) in [
        ('no marker', comment(1, body: '**From triage bot, ping:** @dev')),
        ('not a triage bot comment', comment(1, body: 'Hi\n$marker')),
        (
          'from outside the team',
          comment(
            1,
            association: 'NONE',
            body: '**From triage bot, ping:** @dev\n$marker',
          ),
        ),
        (
          'unknown case',
          comment(
            1,
            body:
                '**From triage bot, ping:** @dev\n'
                '<!-- a2ui-triage-ping: p9-inactive -->',
          ),
        ),
        ('no body', comment(1)),
      ]) {
        expect(pingOf(c), isNull, reason: why);
      }
    });
  });

  test('the cases match the blueprint', () {
    expect(
      {
        for (final StaleCase c in StaleCase.values)
          c.marker: (c.days, c.graceDays),
      },
      {
        'assigned-for-triage': (14, 7),
        'p0-inactive': (1, 1),
        'p1-inactive': (30, 7),
        'external-pr-inactive': (14, 7),
      },
    );
  });
}
