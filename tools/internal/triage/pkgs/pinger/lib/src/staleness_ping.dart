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

import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared/shared.dart';

import 'commenter.dart';

/// The team's Google Chat space.
abstract interface class TeamChat {
  /// Sends a message with [text], in the Google Chat format.
  Future<void> send(String text);
}

/// A [TeamChat] that sends messages through an incoming webhook.
final class WebhookTeamChat implements TeamChat {
  WebhookTeamChat(this._url, {http.Client? httpClient})
    : _http = httpClient ?? http.Client();

  final Uri _url;
  final http.Client _http;

  @override
  Future<void> send(String text) async {
    final http.Response response = await _http.post(
      _url,
      headers: {'Content-Type': 'application/json; charset=UTF-8'},
      body: jsonEncode({'text': text}),
    );
    if (response.statusCode >= 300) {
      throw http.ClientException(
        'Google Chat answered ${response.statusCode}: ${response.body}',
        _url,
      );
    }
  }

  void close() => _http.close();
}

/// Reads the map from GitHub logins to Google Chat user IDs, as JSON. An
/// empty or missing [json] is an empty map.
///
/// Throws a [FormatException] if [json] is not a JSON object of strings.
Map<String, String> parseChatUsers(String? json) {
  if (json == null || json.trim().isEmpty) return const {};
  final Object? decoded = jsonDecode(json);
  if (decoded is! Map<String, Object?> ||
      decoded.values.any((Object? id) => id is! String)) {
    throw const FormatException(
      'Expected a JSON object that maps GitHub logins to Google Chat user '
      'IDs.',
    );
  }
  return decoded.cast<String, String>();
}

/// A staleness ping, as a GitHub comment and as a Google Chat message.
typedef PingText = ({String comment, String chat});

/// The ping on [item], which is stale as [staleness] says at [now].
///
/// The comment mentions every assignee on GitHub. The Chat message mentions
/// each assignee that [chatUsers] maps to a Google Chat user ID, and names
/// the others by their GitHub login.
PingText pingText(
  Item item,
  Staleness staleness,
  DateTime now, {
  Map<String, String> chatUsers = const {},
}) {
  final StaleCase staleCase = staleness.staleCase;
  final kind = item.isPullRequest ? 'PR' : 'issue';
  final String days = daysText(ageInDays(staleness.since, now).floor());
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
  final String chatMentions = item.assignees
      .map((login) {
        final String? id = chatUsers[login];
        if (id == null) return login;
        return id.startsWith('users/') ? '<$id>' : '<users/$id>';
      })
      .join(' ');
  final String url =
      item.htmlUrl ??
      'https://github.com/$a2uiRepository/issues/${item.number}';

  return (
    comment:
        '**From triage bot, ping:** $gitHubMentions $message\n'
        '${pingMarker(staleCase)}\n',
    chat:
        '*From triage bot, ping:* <$url|${_escapeForChat(item.title)}>\n'
        '$chatMentions $message',
  );
}

/// [text] with the characters that Google Chat reads as formatting escaped.
String _escapeForChat(String text) => text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/// What a run of the staleness pinger did.
typedef PingRun = ({int stale, int pinged, int failed});

/// Pings the assignees of every stale item in [github] that has no current
/// ping: posts a comment on the item with [commenter], and sends a message
/// to [chat] if it is given.
///
/// With [dryRun], it writes each comment to [log] instead of posting it,
/// and sends no messages.
///
/// The comments must come from a team member's account, so that they are
/// triage bot comments: otherwise the flagger counts a ping as a comment
/// from outside the team, and the next run does not see it and pings
/// again. So if the first ping comes from outside the team, it deletes the
/// ping and stops.
///
/// It writes what it does to [log], and errors to [errorLog].
Future<PingRun> pingStaleItems(
  ItemReader github,
  ItemCommenter commenter, {
  required DateTime now,
  required StringSink log,
  required StringSink errorLog,
  TeamChat? chat,
  Map<String, String> chatUsers = const {},
  bool dryRun = false,
}) async {
  log.writeln('A2UI staleness pinger started${dryRun ? ' (dry run)' : ''}');

  final List<Item> candidates = [
    for (final Item item in await github.openItems())
      if (staleCaseOf(item) != null) item,
  ];

  final List<({Item item, Staleness staleness})> due = [
    for (final ({Item item, ItemHistory history}) entry in await inBatches(
      candidates,
      (Item item) async => (
        item: item,
        history: await fetchHistory(github, item, log: log, errorLog: errorLog),
      ),
    ))
      if (stalenessOf(
            entry.item,
            entry.history.contributions,
            assignedForTriageSince: entry.history.assignedForTriageSince,
          )
          case final Staleness staleness
          when staleness.isStale(now) &&
              staleness.currentPing(entry.history.pings) == null)
        (item: entry.item, staleness: staleness),
  ]..sort((a, b) => a.item.number.compareTo(b.item.number));

  var pinged = 0;
  var failed = 0;
  for (final (:Item item, :Staleness staleness) in due) {
    final StaleCase staleCase = staleness.staleCase;
    final String url = item.htmlUrl ?? '#${item.number}';
    try {
      // Ping the item as it is now, rather than as the listing has it.
      final Item fresh = await github.item(item.number);
      if (staleCaseOf(fresh) != staleCase) {
        log.writeln('Skipped $url — it changed since the listing.');
        continue;
      }
      final PingText text = pingText(
        fresh,
        staleness,
        now,
        chatUsers: chatUsers,
      );
      final String mentioned = fresh.assignees.map((a) => '@$a').join(', ');

      if (dryRun) {
        pinged += 1;
        log.writeln(
          'Would ping $url — ${staleCase.marker}, mentioning $mentioned:\n'
          '${text.comment}',
        );
        continue;
      }

      final PostedComment posted = await commenter.comment(
        item.number,
        text.comment,
      );
      if (!isTeamMember(posted.association)) {
        failed += 1;
        await commenter.deleteComment(posted.id);
        errorLog.writeln(
          'Stopped: the ping on $url was posted from an account outside the '
          'team (author association ${posted.association}), so it would not '
          'count as a triage bot comment. Deleted it. Run the pinger with '
          "a team member's GitHub token.",
        );
        break;
      }
      pinged += 1;
      log.writeln(
        'Pinged ${posted.htmlUrl ?? url} — ${staleCase.marker}, mentioned '
        '$mentioned.',
      );

      if (chat == null) continue;
      try {
        await chat.send(text.chat);
      } on Object catch (e) {
        failed += 1;
        errorLog.writeln('Failed to send the Google Chat message for $url: $e');
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
  return (stale: due.length, pinged: pinged, failed: failed);
}
