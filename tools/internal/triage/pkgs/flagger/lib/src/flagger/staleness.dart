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

/// Stale items and staleness pings, from
/// `blueprints/features/triage_bot/staleness_ping.blueprint.md`.
///
/// The staleness pinger pings the assignees of a stale item, and the flagger
/// flags the item once the ping expires, so both read staleness from here.
library;

import 'package:shared/shared.dart';

import 'item.dart';

/// A way for an item to go stale.
enum StaleCase {
  /// The assignee has not finished the triage they were assigned.
  assignedForTriage(marker: 'assigned-for-triage', days: 14, graceDays: 7),

  /// The team has not updated an assigned `P0` issue.
  p0Inactive(marker: 'p0-inactive', days: 1, graceDays: 1, priority: 'P0'),

  /// The team has not updated an assigned `P1` issue.
  p1Inactive(marker: 'p1-inactive', days: 30, graceDays: 7, priority: 'P1'),

  /// The team has not responded on an assigned PR from outside the team.
  externalPrInactive(marker: 'external-pr-inactive', days: 14, graceDays: 7);

  const StaleCase({
    required this.marker,
    required this.days,
    required this.graceDays,
    this.priority,
  });

  /// The name of the case in the marker of its pings.
  final String marker;

  /// Days after the start of the case's clock when the item goes stale.
  final int days;

  /// Days that a ping gives the assignees before the flagger flags the item.
  final int graceDays;

  /// The priority of the issues that the case covers, or null if it does not
  /// depend on the priority.
  final String? priority;

  /// Why an item in this case is stale, for the flagger's reason.
  String get reason => switch (this) {
    assignedForTriage =>
      "'$assignedForTriageLabel' was added more than $days days ago",
    p0Inactive || p1Inactive =>
      'this $priority issue has had no update from the team for more than '
          '${daysText(days)}',
    externalPrInactive =>
      'this PR from an out-of-team contributor has had no response from the '
          'team for more than ${daysText(days)}',
  };

  /// The case with [marker], or null if there is none.
  static StaleCase? byMarker(String marker) =>
      values.where((c) => c.marker == marker).firstOrNull;
}

/// [count] days, as in `1 day` or `7 days`.
String daysText(int count) => count == 1 ? '1 day' : '$count days';

/// The age of [time] at [now], in days.
double ageInDays(DateTime time, DateTime now) =>
    now.difference(time).inMicroseconds / Duration.microsecondsPerDay;

/// A staleness ping: a triage bot comment that marks the case it was posted
/// for.
final class Ping {
  const Ping(this.staleCase, this.createdAt);

  final StaleCase staleCase;

  final DateTime createdAt;
}

final RegExp _marker = RegExp(r'<!-- a2ui-triage-ping: ([a-z0-9-]+) -->');

/// The hidden marker that ends a ping for [staleCase].
String pingMarker(StaleCase staleCase) =>
    '<!-- a2ui-triage-ping: ${staleCase.marker} -->';

/// The ping that [comment] is, or null if it is not one.
///
/// Only a triage bot comment can be a ping, so that nobody outside the team
/// can hold off the flag by copying the marker.
Ping? pingOf(Contribution comment) {
  final String body = comment.body ?? '';
  if (!isTriageBotComment(
    body: body,
    association: comment.association,
    byBot: isBot(comment.user),
  )) {
    return null;
  }
  final RegExpMatch? match = _marker.firstMatch(body);
  final StaleCase? staleCase = match == null
      ? null
      : StaleCase.byMarker(match[1]!);
  return staleCase == null ? null : Ping(staleCase, comment.createdAt);
}

/// The case that [item] can go stale in, from its state, labels and
/// assignees, or null if it can go stale in none.
///
/// It does not look at time: the item is stale only once the case's clock
/// passes [StaleCase.days] (see [Staleness.isStale]).
///
/// An item without assignees has nobody to ping, and the flagger flags the
/// ones that need an assignee at once. An item that waits for its author,
/// or a draft PR, is not the assignees' move.
StaleCase? staleCaseOf(Item item) {
  if (item.state != 'open') return null;
  if (item.isPullRequest && item.isDraft) return null;
  if (item.assignees.isEmpty) return null;
  final List<String> labels = item.labels;
  if (labels.contains(waitingForAuthorResponseLabel)) return null;
  if (labels.contains(assignedForTriageLabel)) {
    return StaleCase.assignedForTriage;
  }
  if (item.isPullRequest) {
    return isTeamMember(item.authorAssociation)
        ? null
        : StaleCase.externalPrInactive;
  }
  final String? priority = priorityLabels.where(labels.contains).firstOrNull;
  return StaleCase.values
      .where((c) => c.priority != null && c.priority == priority)
      .firstOrNull;
}

/// The case of an item, and when the case's clock started.
final class Staleness {
  const Staleness(this.staleCase, this.since);

  final StaleCase staleCase;

  /// When the clock started: when [assignedForTriageLabel] was last added,
  /// for [StaleCase.assignedForTriage], and the latest contribution from a
  /// team member, or else the item's creation, for the other cases.
  final DateTime since;

  /// Whether the item is stale at [now].
  bool isStale(DateTime now) => ageInDays(since, now) > staleCase.days;

  /// The latest of [pings] that is current: posted for [staleCase] at or
  /// after the clock started. Null if there is none.
  Ping? currentPing(List<Ping> pings) {
    Ping? latest;
    for (final ping in pings) {
      if (ping.staleCase != staleCase || ping.createdAt.isBefore(since)) {
        continue;
      }
      if (latest == null || ping.createdAt.isAfter(latest.createdAt)) {
        latest = ping;
      }
    }
    return latest;
  }

  /// Whether the item is still stale at [now], and its current ping among
  /// [pings] is older than the grace period of [staleCase].
  bool hasExpiredPing(List<Ping> pings, DateTime now) {
    final Ping? ping = currentPing(pings);
    return ping != null &&
        isStale(now) &&
        ageInDays(ping.createdAt, now) > staleCase.graceDays;
  }
}

/// The case of [item] and when its clock started, or null when the item
/// cannot go stale or the start is unknown.
///
/// [contributions] are the item's comments, reviews and review comments,
/// except triage bot comments. [assignedForTriageSince] is when
/// [assignedForTriageLabel] was last added, or null when that is unknown.
Staleness? stalenessOf(
  Item item,
  List<Contribution> contributions, {
  DateTime? assignedForTriageSince,
}) {
  final StaleCase? staleCase = staleCaseOf(item);
  if (staleCase == null) return null;
  if (staleCase == StaleCase.assignedForTriage) {
    return assignedForTriageSince == null
        ? null
        : Staleness(staleCase, assignedForTriageSince);
  }
  DateTime since = item.createdAt;
  for (final contribution in contributions) {
    if (isTeamMember(contribution.association) &&
        !isBot(contribution.user) &&
        contribution.createdAt.isAfter(since)) {
      since = contribution.createdAt;
    }
  }
  return Staleness(staleCase, since);
}
