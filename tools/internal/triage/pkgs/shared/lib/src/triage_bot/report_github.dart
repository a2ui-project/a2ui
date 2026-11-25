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

/// Reads the triage report from GitHub, and unsubscribes from the items in
/// it. See `blueprints/features/triage_bot/report.blueprint.md`.
library;

import 'dart:math';

import '../shared/github_client.dart';
import '../shared/labels.dart';
import '../shared/repository.dart';
import 'report.dart';

/// The fields of an issue or PR that [itemActions] reads.
const String itemFragment = '''

fragment item on IssueOrPullRequest {
  __typename
  ... on Issue {
    id number title url state
    comments(last: 100) { nodes { author { login } body createdAt } }
    timelineItems(last: 100, itemTypes: [LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT, CLOSED_EVENT, REOPENED_EVENT]) {
      nodes { ...issueEvent }
    }
  }
  ... on PullRequest {
    id number title url state
    comments(last: 100) { nodes { author { login } body createdAt } }
    timelineItems(last: 100, itemTypes: [LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT, CLOSED_EVENT, REOPENED_EVENT]) {
      nodes { ...pullRequestEvent }
    }
  }
}

fragment issueEvent on IssueTimelineItems { ...event }
fragment pullRequestEvent on PullRequestTimelineItems { ...event }

fragment event on Node {
  __typename
  ... on LabeledEvent { createdAt actor { login } label { name } }
  ... on UnlabeledEvent { createdAt actor { login } label { name } }
  ... on AssignedEvent { createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }
  ... on UnassignedEvent { createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }
  ... on ClosedEvent { createdAt actor { login } stateReason closer { __typename } duplicateOf { ... on Issue { number } ... on PullRequest { number } } }
  ... on ReopenedEvent { createdAt actor { login } }
}
''';

/// Builds a query that reads the items with the given [numbers], each under
/// the alias `i<number>`.
///
/// It reads the items by number rather than through `search`, because
/// `search` can return stale timelines. The timeline is the last 100 events
/// rather than the events `since` a time, because GitHub applies `since`
/// after it takes a page of events, so a long timeline can come back empty.
String itemsQuery(List<int> numbers) {
  final [String owner, String name] = a2uiRepository.split('/');
  final String fields = numbers
      .map(
        (number) =>
            '    i$number: issueOrPullRequest(number: $number) { ...item }',
      )
      .join('\n');
  return 'query {\n  repository(owner: "$owner", name: "$name") {\n'
      '$fields\n  }\n}\n$itemFragment';
}

/// Formats [date] for GitHub search, as an ISO 8601 time in UTC without
/// milliseconds.
String searchTime(DateTime date) {
  final DateTime utc = date.toUtc();
  String two(int n) => '$n'.padLeft(2, '0');
  return '${'${utc.year}'.padLeft(4, '0')}-${two(utc.month)}-${two(utc.day)}'
      'T${two(utc.hour)}:${two(utc.minute)}:${two(utc.second)}Z';
}

/// Returns the login of the account that [github] acts as.
Future<String> viewerLogin(GitHubClient github) async {
  final Object? user = await github.rest('GET', 'user');
  return (user! as Map<String, Object?>)['login']! as String;
}

/// The path of a GitHub search for issues and PRs with [parameters].
String _searchPath(Map<String, String> parameters) =>
    'search/issues?${Uri(queryParameters: parameters).query}';

/// The `items` of the pages of a GitHub search.
Iterable<Map<String, Object?>> _searchItems(List<Object?> pages) => [
  for (final Object? page in pages)
    for (final Object? item
        in (page! as Map<String, Object?>)['items']! as List<Object?>)
      item! as Map<String, Object?>,
];

/// The `total_count` of a GitHub search result.
int _totalCount(Object? result) =>
    (result! as Map<String, Object?>)['total_count']! as int;

/// GitHub search returns at most this many results for a query.
const int _searchLimit = 1000;

const int _pageSize = 100;

/// GitHub search requires a query to name the kind of item, so each search
/// runs once per kind. Draft PRs are not triage work, whatever their labels,
/// so [_openItemQueries] leaves them out.
List<String> _openItemQueries(String query) => [
  '$query is:issue',
  '$query is:pr -draft:true',
];

/// Returns the numbers of the items updated since [period] started.
///
/// An item that was triaged in [period] and updated again after it still
/// counts, so the search runs up to [now] rather than to the end of
/// [period]. [itemActions] keeps only what happened in [period].
Future<List<int>> _updatedItems(
  GitHubClient github,
  Period period,
  DateTime now,
) async {
  final int since = _seconds(period.since);
  final int until = _seconds(period.until.isAfter(now) ? period.until : now);
  final List<List<int>> kinds = await Future.wait([
    for (final kind in ['is:issue', 'is:pr'])
      _updatedBetween(github, kind, since, until),
  ]);
  return {for (final kind in kinds) ...kind}.toList();
}

/// Seconds since the epoch, which is the precision of GitHub search.
int _seconds(DateTime time) => time.millisecondsSinceEpoch ~/ 1000;

/// Returns the numbers of the items of [kind] updated from the second
/// [since] to the second [until], both included.
Future<List<int>> _updatedBetween(
  GitHubClient github,
  String kind,
  int since,
  int until,
) async {
  String time(int seconds) => searchTime(
    DateTime.fromMillisecondsSinceEpoch(seconds * 1000, isUtc: true),
  );
  final q = 'repo:$a2uiRepository $kind updated:${time(since)}..${time(until)}';
  // Sorting by creation keeps the pages stable while items are updated, so no
  // item moves to a page that was already read.
  String page(int number) => _searchPath({
    'q': q,
    'sort': 'created',
    'order': 'asc',
    'per_page': '$_pageSize',
    'page': '$number',
  });
  final Object? first = await github.rest('GET', page(1));
  final int total = _totalCount(first);
  if (total > _searchLimit) {
    if (since >= until) {
      throw GitHubException(
        'More than $_searchLimit items were updated at ${time(since)}, '
        'more than GitHub search can list.',
      );
    }
    // Split the range in two, so that each half fits in the search limit.
    final int middle = since + (until - since) ~/ 2;
    final List<List<int>> halves = await Future.wait([
      _updatedBetween(github, kind, since, middle),
      _updatedBetween(github, kind, middle + 1, until),
    ]);
    return {for (final half in halves) ...half}.toList();
  }
  final List<Object?> pages = [
    first,
    for (var number = 2; (number - 1) * _pageSize < total; number++)
      await github.rest('GET', page(number)),
  ];
  return {
    for (final item in _searchItems(pages)) item['number']! as int,
  }.toList();
}

/// Runs [task] on each of [values], with at most [limit] tasks at a time,
/// and returns the results in the order of [values].
Future<List<R>> _inParallel<T, R>(
  List<T> values,
  int limit,
  Future<R> Function(T value) task,
) async {
  final results = List<R?>.filled(values.length, null);
  var next = 0;
  Future<void> worker() async {
    while (next < values.length) {
      final int index = next++;
      results[index] = await task(values[index]);
    }
  }

  await Future.wait([
    for (var i = 0; i < min(limit, values.length); i++) worker(),
  ]);
  return results.cast<R>();
}

const int _batch = 20;

/// Reads the items with the given [numbers].
Future<List<RawItem>> _readItems(GitHubClient github, List<int> numbers) async {
  final List<List<int>> batches = [
    for (var i = 0; i < numbers.length; i += _batch)
      numbers.sublist(i, min(i + _batch, numbers.length)),
  ];
  final List<List<RawItem>> results = await _inParallel(batches, 4, (
    batch,
  ) async {
    final Map<String, Object?> data = await github.graphql(itemsQuery(batch));
    return [
      for (final Object? item
          in (data['repository']! as Map<String, Object?>).values)
        if (item != null) RawItem.fromJson(item as Map<String, Object?>),
    ];
  });
  return [for (final batch in results) ...batch];
}

/// Returns the open items with `status: assigned-for-triage`, except draft
/// PRs.
Future<List<AssignedItem>> _assignedForTriage(GitHubClient github) async {
  final List<List<Object?>> results = await Future.wait([
    for (final q in _openItemQueries(
      'repo:$a2uiRepository is:open label:"$assignedForTriageLabel"',
    ))
      github.restPages(_searchPath({'q': q, 'per_page': '$_pageSize'})),
  ]);
  return [
    for (final item in _searchItems([for (final pages in results) ...pages]))
      AssignedItem(
        number: item['number']! as int,
        url: item['html_url']! as String,
        title: item['title']! as String,
        isPullRequest: item.containsKey('pull_request'),
        assignees: [
          for (final Object? assignee
              in item['assignees'] as List<Object?>? ?? const [])
            (assignee! as Map<String, Object?>)['login']! as String,
        ],
      ),
  ];
}

/// Returns how many open items have `status: needs-triage`, except draft
/// PRs.
Future<int> _stillNeedTriage(GitHubClient github) async {
  final List<Object?> counts = await Future.wait([
    for (final q in _openItemQueries(
      'repo:$a2uiRepository is:open label:"$needsTriageLabel"',
    ))
      github.rest('GET', _searchPath({'q': q, 'per_page': '1'})),
  ]);
  return counts.map(_totalCount).fold<int>(0, (a, b) => a + b);
}

/// Collects what [login] triaged in [period].
///
/// [now] is the current time, which tests set.
Future<Report> collectReport(
  GitHubClient github,
  String login,
  Period period, {
  DateTime? now,
}) async {
  final [
    Object? numbers,
    Object? stillNeedTriage,
    Object? assigned,
  ] = await Future.wait<Object?>([
    _updatedItems(github, period, now ?? DateTime.now()),
    _stillNeedTriage(github),
    _assignedForTriage(github),
  ]);
  final List<ItemActions> items = [
    for (final RawItem item in await _readItems(github, numbers! as List<int>))
      ?itemActions(item, login, period),
  ]..sort((a, b) => a.number - b.number);
  return Report(
    login: login,
    period: period,
    items: items,
    stillNeedTriage: stillNeedTriage! as int,
    assignedForTriage: assigned! as List<AssignedItem>,
  );
}

/// An item in `items.json`: its node ID and URL.
typedef ItemRef = ({String id, String url});

const String _unsubscribe = r'''

mutation($id: ID!) {
  updateSubscription(input: {subscribableId: $id, state: UNSUBSCRIBED}) {
    subscribable { viewerSubscription }
  }
}''';

/// Unsubscribes the account that [github] acts as from the notifications of
/// [items], as the Unsubscribe button on an item does.
///
/// Returns a line for each item it failed for, with the URL of the item and
/// the error.
Future<List<String>> unsubscribe(
  GitHubClient github,
  List<ItemRef> items,
) async {
  final List<String?> results = await _inParallel(items, 4, (item) async {
    try {
      await github.graphql(_unsubscribe, {'id': item.id});
      return null;
    } on Exception catch (e) {
      return '${item.url}: ${'$e'.trim()}';
    }
  });
  return results.nonNulls.toList();
}
