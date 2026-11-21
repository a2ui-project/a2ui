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

/// The time that the tests measure against.
final DateTime now = DateTime.utc(2026, 6, 30);

/// [days] days before [now].
DateTime daysAgo(num days) => now.subtract(
  Duration(microseconds: (days * Duration.microsecondsPerDay).round()),
);

const User maintainer = User(login: 'maintainer', type: 'User');
const User reporter = User(login: 'reporter', type: 'User');
const User contributor = User(login: 'contributor', type: 'User');

/// An issue. Issues default to being opened by a team member.
Item issue({
  int number = 1,
  String state = 'open',
  List<String> labels = const [],
  int assignees = 0,
  DateTime? createdAt,
  String association = 'MEMBER',
  User? user = maintainer,
  int comments = 0,
  bool milestone = false,
  bool pullRequest = false,
  bool draft = false,
  String? htmlUrl,
}) => Item(
  number: number,
  state: state,
  htmlUrl: htmlUrl ?? 'https://github.com/a2ui-project/a2ui/issues/$number',
  createdAt: createdAt ?? daysAgo(0),
  authorAssociation: association,
  user: user,
  labels: labels,
  assigneeCount: assignees,
  hasMilestone: milestone,
  isPullRequest: pullRequest,
  isDraft: draft,
  commentCount: comments,
);

/// An issue opened by someone outside the team.
Item externalIssue({
  int number = 1,
  String state = 'open',
  List<String> labels = const [],
  int assignees = 0,
  DateTime? createdAt,
  int comments = 0,
  bool milestone = false,
}) => issue(
  number: number,
  state: state,
  labels: labels,
  assignees: assignees,
  createdAt: createdAt,
  association: 'NONE',
  user: reporter,
  comments: comments,
  milestone: milestone,
);

/// A pull request. Pull requests default to being opened by someone outside
/// the team, the case the flagger watches.
Item pr({
  int number = 1,
  List<String> labels = const [],
  int assignees = 0,
  DateTime? createdAt,
  String association = 'CONTRIBUTOR',
  User? user = contributor,
  int comments = 0,
  bool draft = false,
}) => issue(
  number: number,
  labels: labels,
  assignees: assignees,
  createdAt: createdAt,
  association: association,
  user: user,
  comments: comments,
  pullRequest: true,
  draft: draft,
);

/// A comment, review or review comment. It defaults to one from a team
/// member, now.
Contribution contribution({
  DateTime? createdAt,
  String association = 'MEMBER',
  User? user = maintainer,
  String? body,
}) => Contribution(
  createdAt: createdAt ?? daysAgo(0),
  association: association,
  user: user,
  body: body,
);

/// A comment from someone outside the team, [days] days ago.
Contribution externalComment(num days, {User user = reporter}) =>
    contribution(createdAt: daysAgo(days), association: 'NONE', user: user);

/// A comment from a team member, [days] days ago.
Contribution memberComment(num days) => contribution(createdAt: daysAgo(days));

/// A comment from a bot, [days] days ago.
Contribution botComment(num days) => contribution(
  createdAt: daysAgo(days),
  association: 'NONE',
  user: const User(login: 'ci[bot]', type: 'Bot'),
);

/// The event of [label] being added, [days] days ago.
IssueEvent labeling(String label, num days) =>
    IssueEvent(event: 'labeled', label: label, createdAt: daysAgo(days));

/// A [FlaggerGitHub] that serves the items it is given, and records the
/// calls.
class FakeGitHub implements FlaggerGitHub {
  FakeGitHub(
    List<Item> items, {
    this.itemComments = const {},
    this.itemEvents = const {},
    this.fresh = const {},
  }) : _items = {for (final item in items) item.number: item};

  final Map<int, Item> _items;

  /// The comments on each item, by number.
  final Map<int, List<Contribution>> itemComments;

  /// The history of each item, by number.
  final Map<int, List<IssueEvent>> itemEvents;

  /// What [item] returns, by number, where it differs from the listing, as
  /// when another run changed the item.
  final Map<int, Item> fresh;

  final List<int> addedFlags = [];
  final List<({int number, String label})> removedLabels = [];
  final List<int> commentCalls = [];
  final List<int> eventCalls = [];
  final List<int> itemCalls = [];

  @override
  String get repository => 'a2ui-project/a2ui';

  @override
  Future<List<Item>> openItems() async => _items.values.toList();

  @override
  Future<Item> item(int number) async {
    itemCalls.add(number);
    return fresh[number] ?? _items[number]!;
  }

  @override
  Future<List<Contribution>> comments(int number) async {
    commentCalls.add(number);
    return itemComments[number] ?? const [];
  }

  @override
  Future<List<Contribution>> reviews(int number) async => const [];

  @override
  Future<List<Contribution>> reviewComments(int number) async => const [];

  @override
  Future<List<IssueEvent>> events(int number) async {
    eventCalls.add(number);
    return itemEvents[number] ?? const [];
  }

  @override
  Future<void> addLabel(int number, String label) async {
    if (label != needsTriageLabel) {
      throw StateError('The flagger adds only $needsTriageLabel.');
    }
    addedFlags.add(number);
  }

  @override
  Future<void> removeLabel(int number, String label) async =>
      removedLabels.add((number: number, label: label));
}
