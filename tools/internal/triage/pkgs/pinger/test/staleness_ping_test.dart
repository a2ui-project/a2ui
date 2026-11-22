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

/// An [ItemReader] that serves the items it is given.
final class FakeReader implements ItemReader {
  FakeReader(
    List<Item> items, {
    this.itemComments = const {},
    this.itemEvents = const {},
    this.fresh = const {},
  }) : _items = {for (final item in items) item.number: item};

  final Map<int, Item> _items;
  final Map<int, List<Contribution>> itemComments;
  final Map<int, List<IssueEvent>> itemEvents;

  /// What [item] returns, by number, where it differs from the listing.
  final Map<int, Item> fresh;

  @override
  String get repository => a2uiRepository;

  @override
  Future<List<Item>> openItems() async => _items.values.toList();

  @override
  Future<Item> item(int number) async => fresh[number] ?? _items[number]!;

  @override
  Future<List<Contribution>> comments(int number) async =>
      itemComments[number] ?? const [];

  @override
  Future<List<Contribution>> reviews(int number) async => const [];

  @override
  Future<List<Contribution>> reviewComments(int number) async => const [];

  @override
  Future<List<IssueEvent>> events(int number) async =>
      itemEvents[number] ?? const [];
}

/// An [ItemCommenter] that records the comments.
final class FakeCommenter implements ItemCommenter {
  FakeCommenter({this.association = 'MEMBER', this.failing = const {}});

  /// The author association of the comments it posts.
  final String association;

  /// The items whose comments fail.
  final Set<int> failing;

  final List<({int number, String body})> posted = [];
  final List<int> deleted = [];

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
  Future<void> deleteComment(int id) async => deleted.add(id);
}

/// A [TeamChat] that records the messages.
final class FakeChat implements TeamChat {
  FakeChat({this.fails = false});

  final bool fails;
  final List<String> messages = [];

  @override
  Future<void> send(String text) async {
    if (fails) throw Exception('Chat is down');
    messages.add(text);
  }
}

typedef Run = ({PingRun result, String log, String errors});

Future<Run> run(
  FakeReader reader,
  FakeCommenter commenter, {
  TeamChat? chat,
  Map<String, String> chatUsers = const {},
  bool dryRun = false,
}) async {
  final log = StringBuffer();
  final errors = StringBuffer();
  final PingRun result = await pingStaleItems(
    reader,
    commenter,
    now: now,
    log: log,
    errorLog: errors,
    chat: chat,
    chatUsers: chatUsers,
    dryRun: dryRun,
  );
  return (result: result, log: '$log', errors: '$errors');
}

void main() {
  group('pingStaleItems', () {
    test('pings a stale item on GitHub and in Google Chat', () async {
      final commenter = FakeCommenter();
      final chat = FakeChat();
      final Run r = await run(
        FakeReader([
          issue(number: 7, assignees: ['dev', 'lead'], title: 'A <b> & c'),
        ]),
        commenter,
        chat: chat,
        chatUsers: {'dev': '123', 'other': 'users/9'},
      );

      expect(commenter.posted.single.number, 7);
      expect(
        commenter.posted.single.body,
        '**From triage bot, ping:** @dev @lead this `P1` issue has had no '
        'update from the team for 31 days. Please post an update, or change '
        'the priority or assignee if the plan has changed. If nothing '
        'changes in 7 days, the issue gets `status: needs-triage` and goes '
        'back to the weekly triage.\n'
        '<!-- a2ui-triage-ping: p1-inactive -->\n',
      );
      expect(
        chat.messages.single,
        '*From triage bot, ping:* '
        '<https://github.com/a2ui-project/a2ui/issues/7|A &lt;b&gt; &amp; c>\n'
        '<users/123> lead this `P1` issue has had no update from the team '
        'for 31 days. Please post an update, or change the priority or '
        'assignee if the plan has changed. If nothing changes in 7 days, the '
        'issue gets `status: needs-triage` and goes back to the weekly '
        'triage.',
      );
      expect(
        r.log,
        contains(
          'Pinged https://github.com/a2ui-project/a2ui/issues/7'
          '#issuecomment-1 — p1-inactive, mentioned @dev, @lead.',
        ),
      );
      expect(r.result, (stale: 1, pinged: 1, failed: 0));
      expect(r.errors, isEmpty);
    });

    test('does not ping an item with a current ping', () async {
      final commenter = FakeCommenter();
      final Run r = await run(
        FakeReader(
          [issue(createdDaysAgo: 60, comments: 1)],
          itemComments: {
            1: [pingComment(StaleCase.p1Inactive, 20)],
          },
        ),
        commenter,
      );

      expect(commenter.posted, isEmpty);
      expect(r.result.stale, 0);
    });

    test('pings again when a team update since the last ping went stale '
        'too', () async {
      final commenter = FakeCommenter();
      await run(
        FakeReader(
          [issue(createdDaysAgo: 100, comments: 2)],
          itemComments: {
            1: [pingComment(StaleCase.p1Inactive, 60), memberComment(40)],
          },
        ),
        commenter,
      );

      expect(commenter.posted.single.body, contains('for 40 days'));
    });

    test('pings for the current case only', () async {
      // A ping for another case does not count.
      final commenter = FakeCommenter();
      await run(
        FakeReader(
          [
            issue(labels: ['P0'], createdDaysAgo: 3, comments: 1),
          ],
          itemComments: {
            1: [pingComment(StaleCase.p1Inactive, 1)],
          },
        ),
        commenter,
      );

      expect(
        commenter.posted.single.body,
        contains('<!-- a2ui-triage-ping: p0-inactive -->'),
      );
    });

    test('leaves fresh items and items that cannot go stale alone', () async {
      final commenter = FakeCommenter();
      final Run r = await run(
        FakeReader([
          issue(number: 1, createdDaysAgo: 29),
          issue(number: 2, assignees: []),
          issue(number: 3, labels: ['P2'], createdDaysAgo: 999),
          issue(number: 4, pullRequest: true, draft: true, labels: []),
          issue(
            number: 5,
            labels: ['P1', waitingForAuthorResponseLabel],
            createdDaysAgo: 999,
          ),
        ]),
        commenter,
      );

      expect(commenter.posted, isEmpty);
      expect(r.result, (stale: 0, pinged: 0, failed: 0));
    });

    test('pings a triage assignment from its latest labeling', () async {
      final commenter = FakeCommenter();
      await run(
        FakeReader(
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
        ),
        commenter,
      );

      expect(
        commenter.posted.single.body,
        startsWith(
          '**From triage bot, ping:** @dev this issue was assigned to you for '
          'triage 15 days ago.',
        ),
      );
    });

    test('pings an external PR', () async {
      final commenter = FakeCommenter();
      await run(
        FakeReader([issue(pullRequest: true, labels: [], createdDaysAgo: 15)]),
        commenter,
      );

      expect(
        commenter.posted.single.body,
        contains(
          'this PR from an out-of-team contributor has had no response from '
          'the team for 15 days. Please review it, or tell the author what is '
          'next. If nothing changes in 7 days, the PR gets',
        ),
      );
    });

    test('skips an item that changed since the listing', () async {
      final commenter = FakeCommenter();
      final Run r = await run(
        FakeReader([issue()], fresh: {1: issue(assignees: [])}),
        commenter,
      );

      expect(commenter.posted, isEmpty);
      expect(r.log, contains('Skipped'));
    });

    test('prints the comments and posts nothing in a dry run', () async {
      final commenter = FakeCommenter();
      final chat = FakeChat();
      final Run r = await run(
        FakeReader([issue()]),
        commenter,
        chat: chat,
        dryRun: true,
      );

      expect(commenter.posted, isEmpty);
      expect(chat.messages, isEmpty);
      expect(r.log, contains('Would ping'));
      expect(r.log, contains('<!-- a2ui-triage-ping: p1-inactive -->'));
      expect(r.result, (stale: 1, pinged: 1, failed: 0));
    });

    test('logs a failed ping and goes on', () async {
      final commenter = FakeCommenter(failing: {1});
      final Run r = await run(
        FakeReader([issue(number: 1), issue(number: 2)]),
        commenter,
      );

      expect(commenter.posted.single.number, 2);
      expect(r.errors, contains('Failed to ping'));
      expect(r.result, (stale: 2, pinged: 1, failed: 1));
    });

    test('logs a failed Chat message and keeps the comment', () async {
      final commenter = FakeCommenter();
      final Run r = await run(
        FakeReader([issue()]),
        commenter,
        chat: FakeChat(fails: true),
      );

      expect(commenter.posted, hasLength(1));
      expect(r.errors, contains('Failed to send the Google Chat message'));
      expect(r.result, (stale: 1, pinged: 1, failed: 1));
    });

    // A ping from outside the team is not a triage bot comment, so the next
    // run would not see it and would ping again every hour.
    test('deletes a ping posted from outside the team, and stops', () async {
      final commenter = FakeCommenter(association: 'CONTRIBUTOR');
      final Run r = await run(
        FakeReader([issue(number: 1), issue(number: 2)]),
        commenter,
      );

      expect(commenter.posted.single.number, 1);
      expect(commenter.deleted, [1]);
      expect(r.errors, contains("team member's GitHub token"));
      expect(r.result, (stale: 2, pinged: 0, failed: 1));
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

  group('parseChatUsers', () {
    test('reads a JSON object of strings', () {
      expect(parseChatUsers('{"dev": "123", "lead": "users/4"}'), {
        'dev': '123',
        'lead': 'users/4',
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

  group('WebhookTeamChat', () {
    test('posts the text as JSON', () async {
      final requests = <http.Request>[];
      final chat = WebhookTeamChat(
        Uri.parse('https://chat.googleapis.com/v1/spaces/x/messages?key=k'),
        httpClient: MockClient((request) async {
          requests.add(request);
          return http.Response('{}', 200);
        }),
      );
      await chat.send('Hello');

      expect(requests.single.method, 'POST');
      expect(jsonDecode(requests.single.body), {'text': 'Hello'});
    });

    test('throws when Google Chat refuses the message', () async {
      final chat = WebhookTeamChat(
        Uri.parse('https://chat.googleapis.com/v1/spaces/x/messages?key=k'),
        httpClient: MockClient((_) async => http.Response('Bad', 400)),
      );
      await expectLater(
        chat.send('Hello'),
        throwsA(isA<http.ClientException>()),
      );
    });
  });
}
