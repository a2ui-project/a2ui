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

import 'item.dart';
import 'item_reader.dart';
import 'labels.dart';
import 'rest_json.dart';
import 'staleness.dart';
import 'triage_bot_comment.dart';

/// What the flagger and the staleness pinger read about an item, besides
/// the item itself.
final class ItemHistory {
  const ItemHistory({
    this.contributions = const [],
    this.pings = const [],
    this.waitingSince,
    this.assignedForTriageSince,
  });

  /// The comments, reviews and review comments, except triage bot comments.
  final List<Contribution> contributions;

  /// The staleness pings: triage bot comments that the staleness pinger
  /// posted.
  final List<Ping> pings;

  /// When [waitingForAuthorResponseLabel] was last added, or null when that
  /// is unknown.
  final DateTime? waitingSince;

  /// When [assignedForTriageLabel] was last added, or null when that is
  /// unknown.
  final DateTime? assignedForTriageSince;
}

/// Reads the contributions to [item], and when its timed labels were added.
///
/// The history of the item is read only when it has a label whose age
/// matters, so that the other items cost no extra call. Errors go to
/// [errorLog], and the other messages to [log].
Future<ItemHistory> fetchHistory(
  ItemReader github,
  Item item, {
  required StringSink log,
  required StringSink errorLog,
}) async {
  final List<String> timedLabels = [
    waitingForAuthorResponseLabel,
    assignedForTriageLabel,
  ].where(item.labels.contains).toList();
  final (
    ({List<Contribution> contributions, List<Ping> pings}) read,
    Map<String, DateTime> addedAt,
  ) = await (
    _contributions(github, item, errorLog),
    timedLabels.isEmpty
        ? Future.value(const <String, DateTime>{})
        : _labelsAddedAt(github, item, timedLabels, log, errorLog),
  ).wait;
  return ItemHistory(
    contributions: read.contributions,
    pings: read.pings,
    waitingSince: addedAt[waitingForAuthorResponseLabel],
    assignedForTriageSince: addedAt[assignedForTriageLabel],
  );
}

/// Every contribution to [item] that people see, except triage bot comments
/// (see [isTriageBotComment]), and the staleness pings among the comments.
///
/// For an issue, that is its comments. A pull request also has reviews and
/// review comments: an author often answers in a review thread without a
/// top-level comment, so that reading only the comments would leave
/// [waitingForAuthorResponseLabel] on a pull request that is answered.
///
/// A source that fails to load counts as empty, so that one failure does
/// not stop the whole run.
Future<({List<Contribution> contributions, List<Ping> pings})> _contributions(
  ItemReader github,
  Item item,
  StringSink errorLog,
) async {
  final int number = item.number;

  Future<List<Contribution>> read(
    String what,
    Future<List<Contribution>> Function(int number) fetch,
  ) async {
    try {
      return await fetch(number);
    } on Object catch (e) {
      errorLog.writeln('Failed to fetch $what for #$number: $e');
      return const [];
    }
  }

  // The listing has the number of comments, so an item without comments
  // needs no call for them. Reviews and review comments exist only on pull
  // requests, and the listing has no count of them.
  final (
    List<Contribution> comments,
    List<Contribution> reviews,
    List<Contribution> reviewComments,
  ) = await (
    item.commentCount > 0
        ? read('comments', github.comments)
        : Future.value(const <Contribution>[]),
    item.isPullRequest
        ? read('reviews', github.reviews)
        : Future.value(const <Contribution>[]),
    item.isPullRequest
        ? read('review comments', github.reviewComments)
        : Future.value(const <Contribution>[]),
  ).wait;

  return (
    contributions: [
      for (final contribution in [...comments, ...reviews, ...reviewComments])
        if (!isTriageBotComment(
          body: contribution.body ?? '',
          association: contribution.association,
          byBot: isBot(contribution.user),
        ))
          contribution,
    ],
    pings: [for (final comment in comments) ?pingOf(comment)],
  );
}

/// When each label in [names] was last added to [item], by label name.
///
/// A label is missing from the result when that cannot be known: the
/// history fails to load, or it has no record of the label being added.
///
/// Only the latest labeling counts. An item can be parked, answered, and
/// parked again, and each round needs its own answer; the reply to the first
/// round must not answer the second. Likewise, adding
/// [assignedForTriageLabel] again starts a new triage assignment.
Future<Map<String, DateTime>> _labelsAddedAt(
  ItemReader github,
  Item item,
  List<String> names,
  StringSink log,
  StringSink errorLog,
) async {
  final addedAt = <String, DateTime>{};
  try {
    for (final IssueEvent event in await github.events(item.number)) {
      final String? name = event.label;
      if (event.event != 'labeled' || name == null || !names.contains(name)) {
        continue;
      }
      if (addedAt[name] case final DateTime time
          when !event.createdAt.isAfter(time)) {
        continue;
      }
      addedAt[name] = event.createdAt;
    }
  } on Object catch (e) {
    errorLog.writeln('Failed to fetch label events for #${item.number}: $e');
    return const {};
  }

  for (final name in names) {
    if (!addedAt.containsKey(name)) {
      log.writeln(
        "No '$name' labeling recorded on ${item.htmlUrl}; "
        'leaving it as it is.',
      );
    }
  }
  return addedAt;
}
