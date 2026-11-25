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
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pinger/pinger.dart';
import 'package:shared/shared.dart';
import 'package:test/test.dart';

final DateTime now = DateTime.utc(2026, 6, 30);

DateTime daysAgo(num days) => now.subtract(
  Duration(microseconds: (days * Duration.microsecondsPerDay).round()),
);

const User member = User(login: 'member', type: 'User');

/// An open issue, opened by someone outside the team [createdDaysAgo] days
/// ago and assigned to `dev`.
Item issue({
  int number = 1,
  List<String> labels = const ['P1'],
  List<String> assignees = const ['dev'],
  num createdDaysAgo = 31,
  int comments = 0,
  bool pullRequest = false,
  bool draft = false,
  String title = 'Crash on start',
}) => Item(
  number: number,
  htmlUrl:
      'https://github.com/a2ui-project/a2ui/'
      '${pullRequest ? 'pull' : 'issues'}/$number',
  title: title,
  createdAt: daysAgo(createdDaysAgo),
  authorAssociation: 'NONE',
  labels: labels,
  assignees: assignees,
  commentCount: comments,
  isPullRequest: pullRequest,
  isDraft: draft,
);

/// A comment from a team member, [days] days ago.
Contribution memberComment(num days) =>
    Contribution(createdAt: daysAgo(days), association: 'MEMBER', user: member);

/// A ping for [staleCase] from a team member, [days] days ago.
Contribution pingComment(StaleCase staleCase, num days) => Contribution(
  createdAt: daysAgo(days),
  association: 'MEMBER',
  user: member,
  body: '**From triage bot, ping:** @dev ...\n${pingMarker(staleCase)}',
);

/// A [PingerGitHub] that serves the items it is given, and records the
/// comments it posts and deletes.
final class FakeGitHub implements PingerGitHub {
  FakeGitHub(
    List<Item> items, {
    this.itemComments = const {},
    this.itemEvents = const {},
    this.fresh = const {},
    this.association = 'MEMBER',
    this.unreadable = const {},
    this.failing = const {},
    this.deleteFails = false,
  }) : _items = {for (final item in items) item.number: item};

  final Map<int, Item> _items;
  final Map<int, List<Contribution>> itemComments;
  final Map<int, List<IssueEvent>> itemEvents;

  /// What [item] returns, by number, where it differs from the listing.
  final Map<int, Item> fresh;

  /// The author association of the comments it posts.
  final String association;

  /// The items whose comments fail to load.
  final Set<int> unreadable;

  /// The items on which posting a comment fails.
  final Set<int> failing;

  final bool deleteFails;

  final List<({int number, String body})> posted = [];
  final List<int> deleted = [];

  @override
  String get repository => a2uiRepository;

  @override
  Future<List<Item>> openItems() async => _items.values.toList();

  @override
  Future<Item> item(int number) async => fresh[number] ?? _items[number]!;

  @override
  Future<List<Contribution>> comments(int number) async {
    if (unreadable.contains(number)) {
      throw const GitHubException('GitHub answered 502');
    }
    return itemComments[number] ?? const [];
  }

  @override
  Future<List<Contribution>> reviews(int number) async => const [];

  @override
  Future<List<Contribution>> reviewComments(int number) async => const [];

  @override
  Future<List<IssueEvent>> events(int number) async =>
      itemEvents[number] ?? const [];

  @override
  Future<PostedComment> comment(int number, String body) async {
    if (failing.contains(number)) {
      throw const GitHubException('GitHub answered 502');
    }
    posted.add((number: number, body: body));
    return PostedComment(
      id: posted.length,
      association: association,
      htmlUrl:
          'https://github.com/a2ui-project/a2ui/issues/$number'
          '#issuecomment-${posted.length}',
    );
  }

  @override
  Future<void> deleteComment(int id) async {
    if (deleteFails) throw const GitHubException('GitHub answered 502');
    deleted.add(id);
  }
}

/// An [Outbox] that records the messages.
final class FakeOutbox implements Outbox {
  FakeOutbox({this.fails = false});

  final bool fails;
  final List<DirectMessage> messages = [];

  @override
  Future<void> add(DirectMessage message) async {
    if (fails) throw Exception('Disk is full');
    messages.add(message);
  }
}

typedef Run = ({PingRun result, String log, String errors});

Future<Run> run(
  FakeGitHub github, {
  Outbox? outbox,
  Map<String, String> chatUsers = const {},
  bool dryRun = false,
}) async {
  final log = StringBuffer();
  final errors = StringBuffer();
  final PingRun result = await pingStaleItems(
    github,
    now: now,
    log: log,
    errorLog: errors,
    outbox: outbox,
    chatUsers: chatUsers,
    dryRun: dryRun,
  );
  return (result: result, log: '$log', errors: '$errors');
}

void main() {
  group('pingStaleItems', () {
    test('pings a stale item on GitHub and by direct message', () async {
      final github = FakeGitHub([
        issue(number: 7, assignees: ['dev', 'lead'], title: 'A <b> & c'),
      ]);
      final outbox = FakeOutbox();
      final Run r = await run(
        github,
        outbox: outbox,
        chatUsers: {'dev': 'dev@google.com', 'other': 'other@google.com'},
      );

      expect(github.posted.single.number, 7);
      expect(
        github.posted.single.body,
        '**From triage bot, ping:** @dev @lead this `P1` issue has had no '
        'update from the team for 31 days. Please post an update, or change '
        'the priority or assignee if the plan has changed. If nothing '
        'changes in 7 days, the issue gets `status: needs-triage` and goes '
        'back to the weekly triage.\n'
        '<!-- a2ui-triage-ping: p1-inactive -->\n',
      );
      expect(outbox.messages, [
        (
          login: 'dev',
          to: 'dev@google.com',
          text:
              '*From triage bot, ping:* '
              '<https://github.com/a2ui-project/a2ui/issues/7|A &lt;b&gt; &amp; c>\n'
              'This `P1` issue has had no update from the team for 31 days. '
              'Please post an update, or change the priority or assignee if '
              'the plan has changed. If nothing changes in 7 days, the issue '
              'gets `status: needs-triage` and goes back to the weekly triage.',
        ),
      ]);
      expect(
        r.log,
        contains(
          'No direct message to @lead: TRIAGE_CHAT_USERS has no Google '
          'account for them.',
        ),
      );
      expect(
        r.log,
        contains(
          'Pinged https://github.com/a2ui-project/a2ui/issues/7'
          '#issuecomment-1 — p1-inactive, mentioned @dev, @lead.',
        ),
      );
      expect(r.result, (due: 1, pinged: 1, failed: 0));
      expect(r.errors, isEmpty);
    });

    test('does not ping an item with a current ping', () async {
      final github = FakeGitHub(
        [issue(createdDaysAgo: 60, comments: 1)],
        itemComments: {
          1: [pingComment(StaleCase.p1Inactive, 20)],
        },
      );
      final Run r = await run(github);

      expect(github.posted, isEmpty);
      expect(r.result.due, 0);
    });

    test('pings again when a team update since the last ping went stale '
        'too', () async {
      final github = FakeGitHub(
        [issue(createdDaysAgo: 100, comments: 2)],
        itemComments: {
          1: [pingComment(StaleCase.p1Inactive, 60), memberComment(40)],
        },
      );
      await run(github);

      expect(github.posted.single.body, contains('for 40 days'));
    });

    test('pings for the current case only', () async {
      // A ping for another case does not count.
      final github = FakeGitHub(
        [
          issue(labels: ['P0'], createdDaysAgo: 3, comments: 1),
        ],
        itemComments: {
          1: [pingComment(StaleCase.p1Inactive, 1)],
        },
      );
      await run(github);

      expect(
        github.posted.single.body,
        contains('<!-- a2ui-triage-ping: p0-inactive -->'),
      );
    });

    test('leaves fresh items and items that cannot go stale alone', () async {
      final github = FakeGitHub([
        issue(number: 1, createdDaysAgo: 29),
        issue(number: 2, assignees: []),
        issue(number: 3, labels: ['P2'], createdDaysAgo: 999),
        issue(number: 4, pullRequest: true, draft: true, labels: []),
        issue(
          number: 5,
          labels: ['P1', waitingForAuthorResponseLabel],
          createdDaysAgo: 999,
        ),
      ]);
      final Run r = await run(github);

      expect(github.posted, isEmpty);
      expect(r.result, (due: 0, pinged: 0, failed: 0));
    });

    test('pings a triage assignment from its latest labeling', () async {
      final github = FakeGitHub(
        [
          issue(labels: ['P3', assignedForTriageLabel], createdDaysAgo: 90),
        ],
        itemEvents: {
          1: [
            IssueEvent(
              event: 'labeled',
              label: assignedForTriageLabel,
              createdAt: daysAgo(15.5),
            ),
          ],
        },
      );
      await run(github);

      expect(
        github.posted.single.body,
        startsWith(
          '**From triage bot, ping:** @dev this issue was assigned to you for '
          'triage 15 days ago.',
        ),
      );
    });

    test('pings an external PR', () async {
      final github = FakeGitHub([
        issue(pullRequest: true, labels: [], createdDaysAgo: 15),
      ]);
      await run(github);

      expect(
        github.posted.single.body,
        contains(
          'this PR from an out-of-team contributor has had no response from '
          'the team for 15 days. Please review it, or tell the author what is '
          'next. If nothing changes in 7 days, the PR gets',
        ),
      );
    });

    test('skips an item that changed since the listing', () async {
      final github = FakeGitHub([issue()], fresh: {1: issue(assignees: [])});
      final Run r = await run(github);

      expect(github.posted, isEmpty);
      expect(r.log, contains('Skipped'));
    });

    // Without its comments, an item can look stale, or unpinged.
    test('skips an item whose comments fail to load, and counts it as '
        'failed', () async {
      final github = FakeGitHub(
        [issue(createdDaysAgo: 60, comments: 1)],
        unreadable: {1},
      );
      final Run r = await run(github);

      expect(github.posted, isEmpty);
      expect(r.errors, contains('Failed to fetch comments for #1'));
      expect(r.result, (due: 0, pinged: 0, failed: 1));
    });

    test('prints the comments and posts nothing in a dry run', () async {
      final github = FakeGitHub([issue()]);
      final outbox = FakeOutbox();
      final Run r = await run(
        github,
        outbox: outbox,
        chatUsers: {'dev': 'dev@google.com'},
        dryRun: true,
      );

      expect(github.posted, isEmpty);
      expect(outbox.messages, isEmpty);
      expect(r.log, contains('Would ping'));
      expect(r.log, contains('Would message dev@google.com:'));
      expect(r.log, contains('<!-- a2ui-triage-ping: p1-inactive -->'));
      expect(r.result, (due: 1, pinged: 1, failed: 0));
    });

    test('logs a failed ping and goes on', () async {
      final github = FakeGitHub(
        [issue(number: 1), issue(number: 2)],
        failing: {1},
      );
      final Run r = await run(github);

      expect(github.posted.single.number, 2);
      expect(r.errors, contains('Failed to ping'));
      expect(r.result, (due: 2, pinged: 1, failed: 1));
    });

    test('logs a failed direct message and keeps the comment', () async {
      final github = FakeGitHub([issue()]);
      final Run r = await run(
        github,
        outbox: FakeOutbox(fails: true),
        chatUsers: {'dev': 'dev@google.com'},
      );

      expect(github.posted, hasLength(1));
      expect(r.errors, contains('Failed to add the direct message'));
      expect(r.result, (due: 1, pinged: 1, failed: 1));
    });

    // A ping from outside the team is not a triage bot comment, so the next
    // run would not see it and would ping again every hour.
    test('deletes a ping posted from outside the team, and stops', () async {
      final github = FakeGitHub([
        issue(number: 1),
        issue(number: 2),
      ], association: 'CONTRIBUTOR');
      final Run r = await run(github);

      expect(github.posted.single.number, 1);
      expect(github.deleted, [1]);
      expect(r.errors, contains("team member's GitHub token"));
      expect(r.result, (due: 2, pinged: 0, failed: 1));
    });

    test('stops even when it cannot delete a ping posted from outside the '
        'team', () async {
      final github = FakeGitHub(
        [issue(number: 1), issue(number: 2)],
        association: 'CONTRIBUTOR',
        deleteFails: true,
      );
      final Run r = await run(github);

      expect(github.posted.single.number, 1);
      expect(r.errors, contains('Stopped'));
      expect(r.errors, contains('Failed to delete'));
      expect(r.result, (due: 2, pinged: 0, failed: 1));
    });
  });

  group('pingText', () {
    test('writes one day as a day', () {
      final PingText text = pingText(
        issue(labels: ['P0'], createdDaysAgo: 1.5),
        Staleness(StaleCase.p0Inactive, daysAgo(1.5)),
        now,
      );
      expect(
        text.comment,
        '**From triage bot, ping:** @dev this `P0` issue has had no update '
        'from the team for 1 day. Please post an update. If nothing changes '
        'in 1 day, the issue gets `status: needs-triage` and goes back to '
        'the weekly triage.\n'
        '<!-- a2ui-triage-ping: p0-inactive -->\n',
      );
    });
  });

  group('RestPingerGitHub', () {
    test('posts and deletes comments', () async {
      final requests = <http.Request>[];
      final github = RestPingerGitHub(
        GitHubClient(
          token: 'token',
          httpClient: MockClient((request) async {
            requests.add(request);
            return request.method == 'POST'
                ? http.Response(
                    jsonEncode({
                      'id': 5,
                      'author_association': 'MEMBER',
                      'html_url': 'https://github.com/x#issuecomment-5',
                    }),
                    201,
                  )
                : http.Response('', 204);
          }),
        ),
        'a2ui-project/a2ui',
      );

      final PostedComment posted = await github.comment(7, 'Hi');
      await github.deleteComment(posted.id);

      expect(posted.association, 'MEMBER');
      expect(requests.map((r) => '${r.method} ${r.url.path}'), [
        'POST /repos/a2ui-project/a2ui/issues/7/comments',
        'DELETE /repos/a2ui-project/a2ui/issues/comments/5',
      ]);
      expect(jsonDecode(requests.first.body), {'body': 'Hi'});
    });
  });

  group('parseChatUsers', () {
    test('reads a JSON object of strings', () {
      expect(parseChatUsers('{"dev": "dev@google.com"}'), {
        'dev': 'dev@google.com',
      });
    });

    test('reads nothing as an empty map', () {
      expect(parseChatUsers(null), isEmpty);
      expect(parseChatUsers('  '), isEmpty);
    });

    test('rejects anything else', () {
      for (final json in ['[]', '{"dev": 1}', 'not json']) {
        expect(() => parseChatUsers(json), throwsFormatException, reason: json);
      }
    });
  });

  group('JsonLinesOutbox', () {
    test('writes each message as a line of JSON', () async {
      final Directory dir = Directory.systemTemp.createTempSync('pinger_');
      addTearDown(() => dir.deleteSync(recursive: true));
      final file = File('${dir.path}/messages.jsonl')
        ..writeAsStringSync('old\n');
      final outbox = JsonLinesOutbox(file);
      await outbox.add((login: 'dev', to: 'dev@google.com', text: 'A\nB'));
      await outbox.add((login: 'lead', to: 'lead@google.com', text: 'C'));

      expect(file.readAsLinesSync().map(jsonDecode), [
        {'login': 'dev', 'to': 'dev@google.com', 'text': 'A\nB'},
        {'login': 'lead', 'to': 'lead@google.com', 'text': 'C'},
      ]);
    });
  });
}
