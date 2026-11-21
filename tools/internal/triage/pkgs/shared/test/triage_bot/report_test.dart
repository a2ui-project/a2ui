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
import 'package:shared/shared.dart';
import 'package:shared/src/triage_bot/report.dart';
import 'package:shared/src/triage_bot/report_args.dart';
import 'package:shared/src/triage_bot/report_command.dart';
import 'package:shared/src/triage_bot/report_github.dart';
import 'package:shared/src/triage_bot/report_render.dart';
import 'package:test/test.dart';

const String login = 'triager';
final Period period = Period(
  since: DateTime.parse('2026-11-04T00:00:00Z'),
  until: DateTime.parse('2026-11-10T23:59:59Z'),
);
const String inPeriod = '2026-11-05T10:00:00Z';
const String beforePeriod = '2026-11-03T10:00:00Z';

RawEvent event(
  String type, {
  String createdAt = inPeriod,
  String? actor = login,
  String? label,
  String? assignee,
  String? stateReason,
  String? closer,
  int? duplicateOf,
}) => RawEvent(
  typename: type,
  createdAt: createdAt,
  actor: actor,
  label: label,
  assignee: assignee,
  stateReason: stateReason,
  closer: closer,
  duplicateOf: duplicateOf,
);

RawEvent labeled(String name, {String createdAt = inPeriod, String? actor}) =>
    event(
      'LabeledEvent',
      label: name,
      createdAt: createdAt,
      actor: actor ?? login,
    );

RawEvent unlabeled(String name) => event('UnlabeledEvent', label: name);

RawItem rawItem({
  String typename = 'Issue',
  String state = 'OPEN',
  List<RawComment> comments = const [],
  List<RawEvent> events = const [],
}) => RawItem(
  typename: typename,
  id: 'I_1',
  number: 1,
  title: 'Crash on empty Row',
  url: 'https://github.com/a2ui-project/a2ui/issues/1',
  state: state,
  comments: comments,
  events: events,
);

RawItem withEvents(List<RawEvent> events) => rawItem(events: events);

ItemActions actions({
  String id = 'I_1',
  int number = 1,
  String url = 'https://github.com/a2ui-project/a2ui/issues/1',
  String title = 'Crash on empty Row',
  bool isPullRequest = false,
  List<String> addedLabels = const [],
  List<String> removedLabels = const [],
  List<String> assigned = const [],
  List<String> unassigned = const [],
  ItemClose? closed,
  bool reopened = false,
  bool commented = false,
}) => ItemActions(
  id: id,
  number: number,
  url: url,
  title: title,
  isPullRequest: isPullRequest,
  addedLabels: addedLabels,
  removedLabels: removedLabels,
  assigned: assigned,
  unassigned: unassigned,
  closed: closed,
  reopened: reopened,
  commented: commented,
);

AssignedItem assignedItem(
  int number,
  List<String> assignees, {
  bool isPullRequest = false,
  String? title,
}) => AssignedItem(
  number: number,
  url:
      'https://github.com/a2ui-project/a2ui/'
      '${isPullRequest ? 'pull' : 'issues'}/$number',
  title: title ?? 'Item $number',
  isPullRequest: isPullRequest,
  assignees: assignees,
);

final Report report = Report(
  login: login,
  period: Period(
    since: DateTime(2026, 11, 4),
    until: DateTime(2026, 11, 10, 23, 59, 59),
  ),
  stillNeedTriage: 4,
  assignedForTriage: [
    assignedItem(4071, ['expert'], title: 'Support <dialog> in Flutter'),
    assignedItem(4060, ['another-expert'], isPullRequest: true),
    assignedItem(4050, ['expert']),
  ],
  items: [
    actions(
      id: 'PR_65',
      number: 4065,
      url: 'https://github.com/a2ui-project/a2ui/pull/4065',
      title: 'Add a Slider to the Lit renderer',
      isPullRequest: true,
      closed: (reason: null, duplicateOf: null),
      commented: true,
    ),
    actions(
      number: 4080,
      url: 'https://github.com/a2ui-project/a2ui/issues/4080',
      title: 'Fix typo in the quickstart',
      addedLabels: ['P3'],
    ),
    actions(
      number: 4082,
      url: 'https://github.com/a2ui-project/a2ui/issues/4082',
      title: 'Stream <partial> updates',
      addedLabels: ['status: needs-team-input'],
      commented: true,
    ),
    actions(
      number: 4090,
      url: 'https://github.com/a2ui-project/a2ui/issues/4090',
      title: 'Document the Express format',
      commented: true,
    ),
  ],
);

Report reportWith({
  List<ItemActions>? items,
  int? stillNeedTriage,
  List<AssignedItem>? assignedForTriage,
}) => Report(
  login: report.login,
  period: report.period,
  items: items ?? report.items,
  stillNeedTriage: stillNeedTriage ?? report.stillNeedTriage,
  assignedForTriage: assignedForTriage ?? report.assignedForTriage,
);

void main() {
  group('parseDate', () {
    test('reads a day as its start or its end in the local time zone', () {
      expect(parseDate('2026-11-04', endOfDay: false), DateTime(2026, 11, 4));
      expect(
        parseDate('2026-11-04', endOfDay: true),
        DateTime(2026, 11, 4, 23, 59, 59, 999),
      );
    });

    test('reads an ISO time', () {
      expect(
        parseDate('2026-11-04T08:00:00Z', endOfDay: true),
        DateTime.parse('2026-11-04T08:00:00Z'),
      );
    });

    test('rejects other text', () {
      expect(
        () => parseDate('last week', endOfDay: false),
        throwsA(
          isA<FormatException>().having(
            (e) => e.message,
            'message',
            'Not a date: last week',
          ),
        ),
      );
    });
  });

  group('itemActions', () {
    test('returns null when the person did nothing', () {
      expect(itemActions(rawItem(), login, period), isNull);
    });

    test('collects net label and assignee changes', () {
      final RawItem item = withEvents([
        labeled('P1'),
        labeled('type: bug'),
        unlabeled('type: bug'),
        unlabeled('status: first-line-handled'),
        event('AssignedEvent', assignee: 'octocat'),
        event('UnassignedEvent', assignee: 'old-owner'),
      ]);
      final ItemActions? result = itemActions(item, login, period);
      expect(result?.addedLabels, ['P1']);
      expect(result?.removedLabels, ['status: first-line-handled']);
      expect(result?.assigned, ['octocat']);
      expect(result?.unassigned, ['old-owner']);
    });

    test('ignores events by other people, events outside the period, and '
        'status: needs-triage', () {
      final RawItem item = withEvents([
        labeled('P1', actor: 'someone-else'),
        labeled('P2', createdAt: beforePeriod),
        unlabeled('status: needs-triage'),
        event('ClosedEvent', actor: null),
      ]);
      expect(itemActions(item, login, period), isNull);
    });

    test('reports the close reason and the duplicate', () {
      final RawItem item = withEvents([
        event('ClosedEvent', stateReason: 'DUPLICATE', duplicateOf: 7),
      ]);
      expect(itemActions(item, login, period)?.closed, (
        reason: 'DUPLICATE',
        duplicateOf: 7,
      ));
    });

    test(
      'ignores closes by a commit or a PR, and the close of a merged PR',
      () {
        final RawItem closedByPr = withEvents([
          event('ClosedEvent', stateReason: 'COMPLETED', closer: 'PullRequest'),
        ]);
        expect(itemActions(closedByPr, login, period), isNull);
        final RawItem merged = rawItem(
          typename: 'PullRequest',
          state: 'MERGED',
          events: [event('ClosedEvent')],
        );
        expect(itemActions(merged, login, period), isNull);
      },
    );

    test('keeps the last of a close and a reopen', () {
      final ItemActions? reopened = itemActions(
        withEvents([
          event('ClosedEvent'),
          event('ReopenedEvent', createdAt: '2026-11-06T00:00:00Z'),
        ]),
        login,
        period,
      );
      expect(reopened?.closed, isNull);
      expect(reopened?.reopened, isTrue);
    });

    test('counts comments in the period, except triage bot comments', () {
      RawComment comment(String body, [String createdAt = inPeriod]) =>
          RawComment(author: login, body: body, createdAt: createdAt);
      ItemActions? triaged(List<RawComment> comments) => itemActions(
        rawItem(comments: comments, events: [labeled('P2')]),
        login,
        period,
      );
      expect(triaged([comment('Thanks for the report.')])?.commented, isTrue);
      expect(triaged([comment('Thanks.', beforePeriod)])?.commented, isFalse);
      for (final heading in [
        '**From triage bot, suggestion:**',
        '**From triage bot, response:**',
        '**From triage bot, ping:** @someone',
        '**From triage bot:**\n\nTriage suggestion:',
      ]) {
        expect(
          triaged([comment(heading)])?.commented,
          isFalse,
          reason: heading,
        );
      }
    });

    test('counts an item with comments only', () {
      final RawItem item = rawItem(
        comments: [
          const RawComment(author: login, body: 'LGTM', createdAt: inPeriod),
        ],
      );
      expect(itemActions(item, login, period)?.commented, isTrue);
    });

    test('does not count an item with triage bot comments only', () {
      final RawItem item = rawItem(
        comments: [
          const RawComment(
            author: login,
            body: '**From triage bot, suggestion:**',
            createdAt: inPeriod,
          ),
        ],
      );
      expect(itemActions(item, login, period), isNull);
    });
  });

  group('groupOf', () {
    test('puts closed items first, then by the label added', () {
      expect(
        groupOf(
          actions(
            closed: (reason: null, duplicateOf: null),
            addedLabels: ['P1'],
          ),
        ),
        'Closed',
      );
      expect(
        groupOf(actions(addedLabels: ['status: assigned-for-triage', 'P3'])),
        'Assigned P3',
      );
      expect(
        groupOf(
          actions(
            addedLabels: ['status: assigned-for-triage'],
            assigned: ['expert'],
          ),
        ),
        'Updated',
      );
      expect(
        groupOf(actions(addedLabels: ['status: needs-team-input'])),
        'Needs team input',
      );
      expect(groupOf(actions(unassigned: ['octocat'])), 'Updated');
      expect(groupOf(actions(reopened: true)), 'Updated');
      expect(groupOf(actions(commented: true)), 'Commented');
    });
  });

  group('describe', () {
    test('says what the person did, in order', () {
      expect(
        describe(
          actions(
            closed: (reason: 'NOT_PLANNED', duplicateOf: null),
            addedLabels: ['P3'],
            removedLabels: ['P2'],
            assigned: ['a'],
            unassigned: ['b'],
            commented: true,
          ),
        ),
        'closed as not planned, added P3, removed P2, assigned a, '
        'unassigned b, commented',
      );
    });

    test('names the duplicate, and gives no reason for a PR', () {
      expect(
        describe(actions(closed: (reason: 'DUPLICATE', duplicateOf: 7))),
        'closed as duplicate of #7',
      );
      expect(
        describe(
          actions(
            isPullRequest: true,
            closed: (reason: 'COMPLETED', duplicateOf: null),
          ),
        ),
        'closed',
      );
    });
  });

  group('byAssignee', () {
    test('groups by login, sorts the items by number, and puts unassigned '
        'items last', () {
      final List<ReportSection<AssignedItem>> groups = byAssignee([
        assignedItem(30, []),
        assignedItem(20, ['bob', 'Alice']),
        assignedItem(10, ['bob'], isPullRequest: true),
      ]);
      expect(
        [
          for (final group in groups)
            [
              group.heading,
              [for (final item in group.items) item.number],
            ],
        ],
        [
          [
            '@Alice: 1 issue',
            [20],
          ],
          [
            '@bob: 1 issue and 1 PR',
            [10, 20],
          ],
          [
            'Nobody: 1 issue',
            [30],
          ],
        ],
      );
    });

    test('returns no groups for no items', () {
      expect(byAssignee([]), isEmpty);
    });
  });

  group('renderText', () {
    test('renders the summary, the groups and the footer', () {
      expect(renderText(report), '''
Triage report for triager, 2026-11-04 to 2026-11-10

Triaged 4 items: 3 issues and 1 PR.
Sent 1 issue to the team.
Remaining: 4.

Assigned for triage:

@another-expert: 1 PR
  - https://github.com/a2ui-project/a2ui/pull/4060
    Item 4060

@expert: 2 issues
  - https://github.com/a2ui-project/a2ui/issues/4050
    Item 4050
  - https://github.com/a2ui-project/a2ui/issues/4071
    Support <dialog> in Flutter

Closed: 1 PR
  - https://github.com/a2ui-project/a2ui/pull/4065
    Add a Slider to the Lit renderer: closed, commented

Assigned P3: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4080
    Fix typo in the quickstart: added P3

Needs team input: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4082
    Stream <partial> updates: added status: needs-team-input, commented

Commented: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/4090
    Document the Express format: commented

Created by triage bot skill ($skillUrl)
''');
    });

    test('renders a period without triage', () {
      expect(
        renderText(
          reportWith(items: [], stillNeedTriage: 1, assignedForTriage: []),
        ),
        '''
Triage report for triager, 2026-11-04 to 2026-11-10

Triaged no items.
Remaining: 1.

Assigned for triage: none

Created by triage bot skill ($skillUrl)
''',
      );
    });
  });

  group('renderHtml', () {
    test('links the items and the skill, and escapes the text', () {
      final String html = renderHtml(report);
      expect(
        html,
        contains(
          '<a href="https://github.com/a2ui-project/a2ui/issues/4082">'
          'https://github.com/a2ui-project/a2ui/issues/4082</a><br>'
          'Stream &lt;partial&gt; updates',
        ),
      );
      expect(
        html,
        contains('<p>Created by <a href="$skillUrl">triage bot</a> skill</p>'),
      );
    });

    test('lists the items assigned for triage by assignee, after the '
        'summary', () {
      final String html = renderHtml(report);
      expect(
        html,
        contains(
          '<p>Assigned for triage:</p>\n<p>@another-expert: 1 PR</p>\n'
          '<ul><li><a href="https://github.com/a2ui-project/a2ui/pull/4060">'
          'https://github.com/a2ui-project/a2ui/pull/4060</a><br>'
          'Item 4060</li></ul>',
        ),
      );
      expect(html, contains('Support &lt;dialog&gt; in Flutter'));
      expect(
        html.indexOf('Remaining: 4.'),
        lessThan(html.indexOf('Assigned for triage:')),
      );
      expect(
        html.indexOf('Assigned for triage:'),
        lessThan(html.indexOf('Closed: 1 PR')),
      );
    });
  });

  group('renderChat', () {
    test('renders the text report, with the skill linked in the Google Chat '
        'format', () {
      final String chat = renderChat(report);
      final String text = renderText(report);
      String body(String report) =>
          report.substring(0, report.lastIndexOf('Created by'));
      expect(body(chat), body(text));
      expect(chat, endsWith('\n\nCreated by <$skillUrl|triage bot> skill\n'));
    });
  });

  group('renderLogHtml', () {
    test('ends the HTML report with a horizontal line', () {
      expect(renderLogHtml(report), '${renderHtml(report)}<hr>\n');
    });
  });

  group('itemsQuery', () {
    test('reads each item under its own alias', () {
      final String query = itemsQuery([12, 345]);
      expect(
        query,
        contains('i12: issueOrPullRequest(number: 12) { ...item }'),
      );
      expect(
        query,
        contains('i345: issueOrPullRequest(number: 345) { ...item }'),
      );
      expect(query, contains('fragment item on IssueOrPullRequest'));
    });
  });

  group('searchTime', () {
    test('drops the milliseconds', () {
      expect(
        searchTime(DateTime.parse('2026-11-04T08:00:00.123Z')),
        '2026-11-04T08:00:00Z',
      );
    });
  });

  group('parseReportArgs', () {
    test('reads options before, after and between positionals', () {
      final ReportArgs args = parseReportArgs([
        '--since',
        '2026-11-04',
        'report',
        '--out=dir',
        '--copy',
        'extra',
        '--',
        '--until',
      ]);
      expect(args.positionals, ['report', 'extra', '--until']);
      expect(args.since, '2026-11-04');
      expect(args.out, 'dir');
      expect(args.until, isNull);
      expect(args.copy, isTrue);
    });

    test('rejects unknown options, missing values and values for --copy', () {
      Matcher fails(Object message) => throwsA(
        isA<FormatException>().having((e) => e.message, 'message', message),
      );
      expect(
        () => parseReportArgs(['--foo']),
        fails(
          "Unknown option '--foo'. To specify a positional argument starting "
          "with a '-', place it at the end of the command after '--', as in "
          '\'-- "--foo"',
        ),
      );
      expect(
        () => parseReportArgs(['-copy']),
        fails(startsWith("Unknown option '-c'.")),
      );
      expect(
        () => parseReportArgs(['report', '--since']),
        fails("Option '--since <value>' argument missing"),
      );
      expect(
        () => parseReportArgs(['--since', '--out']),
        fails(
          "Option '--since' argument is ambiguous.\n"
          "Did you forget to specify the option argument for '--since'?\n"
          'To specify an option argument starting with a dash use '
          "'--since=-XYZ'.",
        ),
      );
      expect(
        () => parseReportArgs(['--copy=yes']),
        fails("Option '--copy' does not take an argument"),
      );
    });
  });

  group('runTriageReport', () {
    test('prints the usage and returns 2 for arguments it does not '
        'take', () async {
      for (final args in [
        <String>[],
        ['report', '--out', 'dir'],
        ['report', '--since', '2026-11-04'],
        ['unsubscribe'],
        ['paste', 'dir', '--to', 'mail'],
      ]) {
        final err = StringBuffer();
        expect(
          await runTriageReport(
            args,
            err: err,
            connect: () => fail('connected'),
          ),
          2,
          reason: '$args',
        );
        expect(err.toString(), '$reportUsage\n', reason: '$args');
      }
    });

    test('prints the error and returns 1 for a bad date', () async {
      final err = StringBuffer();
      expect(
        await runTriageReport(
          ['report', '--since', 'last week', '--out', 'dir'],
          err: err,
          connect: () => fail('connected'),
        ),
        1,
      );
      expect(err.toString(), 'Not a date: last week\n');
    });

    test('writes the report from GitHub', () async {
      final Directory dir = await Directory.systemTemp.createTemp('report');
      addTearDown(() => dir.delete(recursive: true));
      final github = GitHubClient(
        token: 'token',
        httpClient: MockClient((request) async {
          final Object? body = switch (request.url.path) {
            '/user' => {'login': login},
            '/graphql' => {
              'data': {
                'repository': {
                  'i5': {
                    '__typename': 'Issue',
                    'id': 'I_5',
                    'number': 5,
                    'title': 'Crash on empty Row',
                    'url': 'https://github.com/a2ui-project/a2ui/issues/5',
                    'state': 'OPEN',
                    'comments': {'nodes': <Object?>[]},
                    'timelineItems': {
                      'nodes': [
                        {
                          '__typename': 'LabeledEvent',
                          'createdAt': inPeriod,
                          'actor': {'login': login},
                          'label': {'name': 'P2'},
                        },
                      ],
                    },
                  },
                  'i6': null,
                },
              },
            },
            '/search/issues' => switch (request.url.queryParameters['q']!) {
              final String q when q.contains('updated:') => {
                'total_count': 2,
                'items': [
                  {'number': 5},
                  {'number': 6},
                ],
              },
              final String q when q.contains(needsTriageLabel) => {
                'total_count': 3,
                'items': <Object?>[],
              },
              _ => {
                'total_count': 1,
                'items': [
                  {
                    'number': 7,
                    'html_url': 'https://github.com/a2ui-project/a2ui/pull/7',
                    'title': 'Add a Slider',
                    'pull_request': <String, Object?>{},
                    'assignees': [
                      {'login': 'expert'},
                    ],
                  },
                ],
              },
            },
            _ => null,
          };
          return body == null
              ? http.Response('{"message": "Not Found"}', 404)
              : http.Response(jsonEncode(body), 200);
        }),
      );
      final out = StringBuffer();

      final int code = await runTriageReport(
        [
          'report',
          '--since',
          '2026-11-01',
          '--until',
          '2026-11-30',
          '--out',
          dir.path,
        ],
        out: out,
        connect: () async => github,
      );

      expect(code, 0);
      final String text = File('${dir.path}/report.txt').readAsStringSync();
      expect(out.toString(), text);
      expect(text, '''
Triage report for triager, 2026-11-01 to 2026-11-30

Triaged 1 issue.
Remaining: 3.

Assigned for triage:

@expert: 1 PR
  - https://github.com/a2ui-project/a2ui/pull/7
    Add a Slider

Assigned P2: 1 issue
  - https://github.com/a2ui-project/a2ui/issues/5
    Crash on empty Row: added P2

Created by triage bot skill ($skillUrl)
''');
      expect(File('${dir.path}/items.json').readAsStringSync(), '''
[
  {
    "id": "I_5",
    "url": "https://github.com/a2ui-project/a2ui/issues/5"
  }
]
''');
      for (final name in [
        'report.html',
        'report.chat.txt',
        'report.log.html',
      ]) {
        expect(File('${dir.path}/$name').existsSync(), isTrue, reason: name);
      }
    });
  });
}
