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

/// What a person triaged in a period, worked out from the timelines and
/// comments of the items. See
/// `blueprints/features/triage_bot/report.blueprint.md`.
library;

import '../shared/labels.dart';
import '../shared/triage_bot_comment.dart';

/// A timeline event of an issue or PR, as `itemFragment` returns it.
final class RawEvent {
  const RawEvent({
    required this.typename,
    required this.createdAt,
    this.actor,
    this.label,
    this.assignee,
    this.stateReason,
    this.closer,
    this.duplicateOf,
  });

  /// Reads an event from the GraphQL response.
  factory RawEvent.fromJson(Map<String, Object?> json) => RawEvent(
    typename: json['__typename']! as String,
    createdAt: json['createdAt']! as String,
    actor: _field(json['actor'], 'login'),
    label: _field(json['label'], 'name'),
    assignee: _field(json['assignee'], 'login'),
    stateReason: json['stateReason'] as String?,
    closer: _field(json['closer'], '__typename'),
    duplicateOf: _field(json['duplicateOf'], 'number'),
  );

  /// The GraphQL type of the event, as `LabeledEvent`.
  final String typename;

  /// When the event happened, as an ISO 8601 time.
  final String createdAt;

  /// The login of the person who caused the event, or null if their account
  /// is gone.
  final String? actor;

  /// The name of the label that a `LabeledEvent` or an `UnlabeledEvent`
  /// added or removed.
  final String? label;

  /// The login of the user or bot that an `AssignedEvent` or an
  /// `UnassignedEvent` assigned or unassigned.
  final String? assignee;

  /// Why a `ClosedEvent` closed the item, as `NOT_PLANNED`.
  final String? stateReason;

  /// The GraphQL type of what closed the item in a `ClosedEvent`, a commit or
  /// a PR, or null if a person closed it.
  final String? closer;

  /// The number of the item that a `ClosedEvent` closed the item as a
  /// duplicate of.
  final int? duplicateOf;
}

/// A comment on an issue or PR, as `itemFragment` returns it.
final class RawComment {
  const RawComment({required this.body, required this.createdAt, this.author});

  /// Reads a comment from the GraphQL response.
  factory RawComment.fromJson(Map<String, Object?> json) => RawComment(
    author: _field(json['author'], 'login'),
    body: json['body']! as String,
    createdAt: json['createdAt']! as String,
  );

  /// The login of the author, or null if their account is gone.
  final String? author;

  final String body;

  /// When the comment was posted, as an ISO 8601 time.
  final String createdAt;
}

/// An issue or PR, as `itemFragment` returns it.
final class RawItem {
  const RawItem({
    required this.typename,
    required this.id,
    required this.number,
    required this.title,
    required this.url,
    required this.state,
    this.comments = const [],
    this.events = const [],
  });

  /// Reads an item from the GraphQL response.
  factory RawItem.fromJson(Map<String, Object?> json) => RawItem(
    typename: json['__typename']! as String,
    id: json['id']! as String,
    number: json['number']! as int,
    title: json['title']! as String,
    url: json['url']! as String,
    state: json['state']! as String,
    comments: [
      for (final Object? node in _nodes(json['comments']))
        RawComment.fromJson(node! as Map<String, Object?>),
    ],
    events: [
      for (final Object? node in _nodes(json['timelineItems']))
        RawEvent.fromJson(node! as Map<String, Object?>),
    ],
  );

  /// The GraphQL type of the item, `Issue` or `PullRequest`.
  final String typename;

  /// The node ID of the item.
  final String id;

  final int number;
  final String title;
  final String url;

  /// The state of the item, as `OPEN`, `CLOSED` or, for a PR, `MERGED`.
  final String state;

  /// The last 100 comments.
  final List<RawComment> comments;

  /// The last 100 timeline events of the types that `itemActions` reads.
  final List<RawEvent> events;
}

/// A value in a nested JSON object, as `actor.login`, or null if the object
/// or the value is missing.
T? _field<T>(Object? object, String key) =>
    object is Map<String, Object?> ? object[key] as T? : null;

/// The `nodes` of a GraphQL connection.
List<Object?> _nodes(Object? connection) =>
    (connection! as Map<String, Object?>)['nodes']! as List<Object?>;

/// A period of time, with both ends included.
final class Period {
  const Period({required this.since, required this.until});

  final DateTime since;
  final DateTime until;
}

/// How a person closed an item: the reason, and the number of the item it
/// duplicates, if they closed it as a duplicate.
typedef ItemClose = ({String? reason, int? duplicateOf});

/// What a person did to an item in a period.
final class ItemActions {
  const ItemActions({
    required this.id,
    required this.number,
    required this.url,
    required this.title,
    required this.isPullRequest,
    required this.addedLabels,
    required this.removedLabels,
    required this.assigned,
    required this.unassigned,
    required this.closed,
    required this.reopened,
    required this.commented,
  });

  /// The node ID of the item.
  final String id;

  final int number;
  final String url;
  final String title;
  final bool isPullRequest;
  final List<String> addedLabels;
  final List<String> removedLabels;

  /// The logins that the person assigned.
  final List<String> assigned;

  /// The logins that the person unassigned.
  final List<String> unassigned;

  /// How the person closed the item, or null if they did not close it, or
  /// reopened it after.
  final ItemClose? closed;

  /// Whether the person reopened the item, and did not close it after.
  final bool reopened;

  /// Whether the person commented, other than with triage bot comments.
  final bool commented;
}

/// An open item with `status: assigned-for-triage`.
final class AssignedItem {
  const AssignedItem({
    required this.number,
    required this.url,
    required this.title,
    required this.isPullRequest,
    required this.assignees,
  });

  final int number;
  final String url;
  final String title;
  final bool isPullRequest;

  /// The logins of the assignees.
  final List<String> assignees;
}

/// The report, before it is rendered.
final class Report {
  const Report({
    required this.login,
    required this.period,
    required this.items,
    required this.stillNeedTriage,
    required this.assignedForTriage,
  });

  /// The login of the person whose triage the report is about.
  final String login;

  final Period period;

  /// What the person did, by item, sorted by number.
  final List<ItemActions> items;

  /// How many open items have `status: needs-triage` now, except draft PRs.
  final int stillNeedTriage;

  /// The open items with `status: assigned-for-triage` now, except draft PRs.
  final List<AssignedItem> assignedForTriage;
}

/// Parses a date argument, a YYYY-MM-DD date or an ISO 8601 time.
///
/// A YYYY-MM-DD date is a day in the local time zone, and stands for its
/// start, or for its end when [endOfDay] is true. Throws a [FormatException]
/// for other text.
DateTime parseDate(String arg, {required bool endOfDay}) {
  final RegExpMatch? day = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(arg);
  if (day != null) {
    final int year = int.parse(day[1]!);
    final int month = int.parse(day[2]!);
    final int date = int.parse(day[3]!);
    return endOfDay
        ? DateTime(year, month, date, 23, 59, 59, 999)
        : DateTime(year, month, date);
  }
  final DateTime? date = DateTime.tryParse(arg);
  if (date == null) throw FormatException('Not a date: $arg');
  return date;
}

/// Whether [time], an ISO 8601 time, is in [period], to the millisecond.
bool _inPeriod(String time, Period period) {
  final int? t = DateTime.tryParse(time)?.millisecondsSinceEpoch;
  return t != null &&
      t >= period.since.millisecondsSinceEpoch &&
      t <= period.until.millisecondsSinceEpoch;
}

/// Names added and removed. See [_netChange].
typedef _NetChange = ({List<String> added, List<String> removed});

/// The names that [events] add more often than they remove, and the names
/// they remove more often than they add, so that adding a name and removing
/// it cancel out.
///
/// Events of the type [plus] add the name that [name] returns, and events of
/// the type [minus] remove it. Events without a name do not count.
_NetChange _netChange(
  List<RawEvent> events,
  String plus,
  String minus,
  String? Function(RawEvent event) name,
) {
  final counts = <String, int>{};
  for (final event in events) {
    final String? key = name(event);
    if (key == null) continue;
    if (event.typename == plus) counts[key] = (counts[key] ?? 0) + 1;
    if (event.typename == minus) counts[key] = (counts[key] ?? 0) - 1;
  }
  return (
    added: [
      for (final MapEntry(:key, :value) in counts.entries)
        if (value > 0) key,
    ],
    removed: [
      for (final MapEntry(:key, :value) in counts.entries)
        if (value < 0) key,
    ],
  );
}

/// Returns what [login] did to [item] in [period], or null if they did not
/// change its labels, assignees or state, or comment on it.
///
/// These do not count:
///
/// 1. Triage bot comments.
/// 2. Adding or removing `status: needs-triage`, which the flagger manages.
/// 3. Closes by a commit or a merged PR, and the close that merges a PR.
ItemActions? itemActions(RawItem item, String login, Period period) {
  final List<RawEvent> events = [
    for (final event in item.events)
      if (event.actor == login &&
          _inPeriod(event.createdAt, period) &&
          event.label != needsTriageLabel)
        event,
  ];
  final _NetChange labels = _netChange(
    events,
    'LabeledEvent',
    'UnlabeledEvent',
    (e) => e.label,
  );
  final _NetChange assignees = _netChange(
    events,
    'AssignedEvent',
    'UnassignedEvent',
    (e) => e.assignee,
  );
  final RawEvent? state = events
      .where(
        (event) =>
            event.typename == 'ReopenedEvent' ||
            (event.typename == 'ClosedEvent' &&
                event.closer == null &&
                item.state != 'MERGED'),
      )
      .lastOrNull;
  final ItemClose? closed = state?.typename == 'ClosedEvent'
      ? (reason: state!.stateReason, duplicateOf: state.duplicateOf)
      : null;
  final reopened = state?.typename == 'ReopenedEvent';
  final int changes =
      labels.added.length +
      labels.removed.length +
      assignees.added.length +
      assignees.removed.length;
  final bool commented = item.comments.any(
    (comment) =>
        comment.author == login &&
        _inPeriod(comment.createdAt, period) &&
        !hasTriageBotPrefix(comment.body),
  );
  if (changes == 0 && closed == null && !reopened && !commented) return null;
  return ItemActions(
    id: item.id,
    number: item.number,
    url: item.url,
    title: item.title,
    isPullRequest: item.typename == 'PullRequest',
    addedLabels: labels.added,
    removedLabels: labels.removed,
    assigned: assignees.added,
    unassigned: assignees.removed,
    closed: closed,
    reopened: reopened,
    commented: commented,
  );
}

/// The groups of the report, in order.
final List<String> reportGroups = [
  'Closed',
  for (final String priority in priorityLabels) 'Assigned $priority',
  'Needs team input',
  'Updated',
  'Commented',
];

/// Returns the group of [reportGroups] that [item] belongs to.
///
/// An item that the person only assigned for triage is in **Updated**: the
/// report lists every item assigned for triage in its own section.
String groupOf(ItemActions item) {
  if (item.closed != null) return 'Closed';
  final String? priority = priorityLabels
      .where(item.addedLabels.contains)
      .firstOrNull;
  if (priority != null) return 'Assigned $priority';
  if (item.addedLabels.contains(needsTeamInputLabel)) {
    return 'Needs team input';
  }
  final bool changed =
      item.reopened ||
      item.addedLabels.length +
              item.removedLabels.length +
              item.assigned.length +
              item.unassigned.length >
          0;
  return changed ? 'Updated' : 'Commented';
}

/// Says what the person did to [item], as in "added P3, commented".
String describe(ItemActions item) {
  final parts = <String>[];
  if (item.closed case final ItemClose closed) {
    if (closed.duplicateOf != null) {
      parts.add('closed as duplicate of #${closed.duplicateOf}');
    } else if (item.isPullRequest ||
        closed.reason == null ||
        closed.reason!.isEmpty) {
      parts.add('closed');
    } else {
      parts.add(
        'closed as ${closed.reason!.toLowerCase().replaceFirst('_', ' ')}',
      );
    }
  }
  if (item.reopened) parts.add('reopened');
  if (item.addedLabels.isNotEmpty) {
    parts.add('added ${item.addedLabels.join(', ')}');
  }
  if (item.removedLabels.isNotEmpty) {
    parts.add('removed ${item.removedLabels.join(', ')}');
  }
  if (item.assigned.isNotEmpty) {
    parts.add('assigned ${item.assigned.join(', ')}');
  }
  if (item.unassigned.isNotEmpty) {
    parts.add('unassigned ${item.unassigned.join(', ')}');
  }
  if (item.commented) parts.add('commented');
  return parts.join(', ');
}
