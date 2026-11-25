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

/// The staleness pinger, from
/// `blueprints/features/triage_bot/staleness_ping.blueprint.md`.
library;

import 'package:shared/shared.dart';

import 'direct_messages.dart';
import 'github.dart';

/// A staleness ping, as a GitHub comment and as the text of the direct
/// message to each assignee.
typedef PingText = ({String comment, String chat});

/// The ping on [item], which is stale as [staleness] says at [now].
///
/// The comment mentions every assignee on GitHub. The direct message has
/// the item's title and link, and asks the assignee in the same words.
PingText pingText(Item item, Staleness staleness, DateTime now) {
  final StaleCase staleCase = staleness.staleCase;
  final kind = item.isPullRequest ? 'PR' : 'issue';
  final String days = daysText(now.difference(staleness.since).inDays);
  final String ask = switch (staleCase) {
    StaleCase.assignedForTriage =>
      'this $kind was assigned to you for triage $days ago. Please finish '
          'the triage and remove `$assignedForTriageLabel`, or unassign '
          'yourself if someone else should do it.',
    StaleCase.p0Inactive =>
      'this `P0` issue has had no update from the team for $days. Please '
          'post an update.',
    StaleCase.p1Inactive =>
      'this `P1` issue has had no update from the team for $days. Please '
          'post an update, or change the priority or assignee if the plan '
          'has changed.',
    StaleCase.externalPrInactive =>
      'this PR from an out-of-team contributor has had no response from the '
          'team for $days. Please review it, or tell the author what is next.',
  };
  final message =
      '$ask If nothing changes in ${daysText(staleCase.graceDays)}, the $kind '
      'gets `$needsTriageLabel` and goes back to the weekly triage.';

  final String gitHubMentions = item.assignees.map((a) => '@$a').join(' ');
  return (
    comment:
        '**From triage bot, ping:** $gitHubMentions $message\n'
        '${pingMarker(staleCase)}\n',
    chat:
        '*From triage bot, ping:* '
        '<${item.htmlUrl}|${_escapeForChat(item.title)}>\n'
        '${message[0].toUpperCase()}${message.substring(1)}',
  );
}

/// [text] with the characters that Google Chat reads as formatting escaped.
String _escapeForChat(String text) => text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/// What a run of the staleness pinger did: how many stale items had no
/// current ping, how many it pinged, and how many failed.
typedef PingRun = ({int due, int pinged, int failed});

/// Pings the assignees of every stale item in [github] that has no current
/// ping: posts a comment on the item, and, if [outbox] is given, adds a
/// direct message to each assignee that [chatUsers] maps to a Google
/// account. The triage bot sends the messages.
///
/// With [dryRun], it writes each comment and message to [log] instead of
/// posting or adding it.
///
/// The comments must come from a team member's account, so that they are
/// triage bot comments: otherwise the flagger counts a ping as a comment
/// from outside the team, and the next run does not see it and pings
/// again. So if the first ping comes from outside the team, it deletes the
/// ping and stops.
///
/// It skips an item whose history does not load fully, and counts it as
/// failed: with comments missing, the item can look stale, or unpinged.
///
/// It writes what it does to [log], and errors to [errorLog].
Future<PingRun> pingStaleItems(
  PingerGitHub github, {
  required DateTime now,
  required StringSink log,
  required StringSink errorLog,
  Outbox? outbox,
  Map<String, String> chatUsers = const {},
  bool dryRun = false,
}) async {
  log.writeln('A2UI staleness pinger started${dryRun ? ' (dry run)' : ''}');

  final List<Item> candidates = [
    for (final Item item in await github.openItems())
      if (staleCaseOf(item) != null) item,
  ];

  var pinged = 0;
  var failed = 0;
  final due = <({Item item, Staleness staleness})>[];
  for (final (:Item item, :ItemHistory history) in await inBatches(
    candidates,
    (Item item) async => (
      item: item,
      history: await fetchHistory(github, item, log: log, errorLog: errorLog),
    ),
  )) {
    // fetchHistory has logged the error.
    if (!history.complete) {
      failed += 1;
      continue;
    }
    if (stalenessOf(
          item,
          history.contributions,
          assignedForTriageSince: history.assignedForTriageSince,
        )
        case final Staleness staleness
        when staleness.isStale(now) &&
            staleness.currentPing(history.pings) == null) {
      due.add((item: item, staleness: staleness));
    }
  }
  due.sort((a, b) => a.item.number.compareTo(b.item.number));

  for (final (:Item item, :Staleness staleness) in due) {
    final StaleCase staleCase = staleness.staleCase;
    final String url = item.htmlUrl;
    try {
      // Ping the item as it is now, rather than as the listing has it.
      final Item fresh = await github.item(item.number);
      if (staleCaseOf(fresh) != staleCase) {
        log.writeln('Skipped $url — it changed since the listing.');
        continue;
      }
      final PingText text = pingText(fresh, staleness, now);
      final String mentioned = fresh.assignees.map((a) => '@$a').join(', ');

      if (dryRun) {
        pinged += 1;
        log.writeln(
          'Would ping $url — ${staleCase.marker}, mentioning $mentioned:\n'
          '${text.comment}',
        );
        for (final String login in fresh.assignees) {
          if (chatUsers[login] case final String to) {
            log.writeln('Would message $to:\n${text.chat}');
          }
        }
        continue;
      }

      final PostedComment posted = await github.comment(
        item.number,
        text.comment,
      );
      if (!isTeamMember(posted.association)) {
        failed += 1;
        errorLog.writeln(
          'Stopped: the ping on $url was posted from an account outside the '
          'team (author association ${posted.association}), so it would not '
          "count as a triage bot comment. Run the pinger with a team member's "
          'GitHub token.',
        );
        try {
          await github.deleteComment(posted.id);
          errorLog.writeln('Deleted ${posted.htmlUrl}.');
        } on Object catch (e) {
          errorLog.writeln('Failed to delete ${posted.htmlUrl}: $e');
        }
        break;
      }
      pinged += 1;
      log.writeln(
        'Pinged ${posted.htmlUrl} — ${staleCase.marker}, mentioned '
        '$mentioned.',
      );

      if (outbox == null) continue;
      for (final String login in fresh.assignees) {
        final String? to = chatUsers[login];
        if (to == null) {
          log.writeln(
            'No direct message to @$login: TRIAGE_CHAT_USERS has no Google '
            'account for them.',
          );
          continue;
        }
        try {
          await outbox.add((login: login, to: to, text: text.chat));
        } on Object catch (e) {
          failed += 1;
          errorLog.writeln('Failed to add the direct message to $to: $e');
        }
      }
    } on Object catch (e) {
      failed += 1;
      errorLog.writeln('Failed to ping $url: $e');
    }
  }

  log.writeln(
    'A2UI staleness pinger completed: ${due.length} stale items without a '
    'current ping, $pinged ${dryRun ? 'would be pinged' : 'pinged'}, '
    '$failed failed',
  );
  return (due: due.length, pinged: pinged, failed: failed);
}
