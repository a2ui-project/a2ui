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

import 'package:shared/shared.dart';

import 'github.dart';
import 'rules.dart';

/// An item whose labels the snapshot says to change.
typedef _Update = ({
  Item item,
  List<Contribution> contributions,
  List<Ping> pings,
  DateTime? assignedForTriageSince,
  bool clearWaiting,
});

/// Adds [needsTriageLabel] to every open item in [github] that needs triage,
/// removes it from the rest, and removes [waitingForAuthorResponseLabel]
/// from the items that someone outside the team answered.
///
/// It writes what it changes and why to [log], and errors to [errorLog].
///
/// The listing of open items can be outdated: another run can change a
/// label in the meantime, and GitHub's index can still list an item that is
/// closed. So before it changes an item, it reads the item again and
/// decides on that.
Future<void> reconcile(
  FlaggerGitHub github, {
  required DateTime now,
  required StringSink log,
  required StringSink errorLog,
}) async {
  log.writeln('A2UI triage-flag reconciliation started');

  final List<Item> openItems = await github.openItems();

  final List<_Update> updates = [
    for (final ({Item item, ItemHistory history}) entry in await inBatches(
      openItems,
      (Item item) async => (
        item: item,
        history: await fetchHistory(github, item, log: log, errorLog: errorLog),
      ),
    ))
      if (decide(entry.item, entry.history, now) case final Decision decision
          when decision.clearWaiting ||
              (decision.reason != null) !=
                  entry.item.labels.contains(needsTriageLabel))
        (
          item: entry.item,
          contributions: entry.history.contributions,
          pings: entry.history.pings,
          assignedForTriageSince: entry.history.assignedForTriageSince,
          clearWaiting: decision.clearWaiting,
        ),
  ];

  var added = 0;
  var removed = 0;
  var waitingCleared = 0;

  await inBatches(updates, (_Update update) async {
    final Item item = update.item;
    try {
      // Decide on the item as it is now, rather than on the listing.
      final Item fresh = await github.item(item.number);

      // A closed item is nobody's triage work.
      if (fresh.state != 'open') {
        log.writeln('Skipped ${item.htmlUrl} — no longer open.');
        return;
      }

      // The contributions are not read again, so whether someone outside
      // the team responded is the same as in the snapshot.
      final bool clearWaiting =
          update.clearWaiting &&
          fresh.labels.contains(waitingForAuthorResponseLabel);
      if (clearWaiting) {
        await github.removeLabel(item.number, waitingForAuthorResponseLabel);
        waitingCleared += 1;
        log.writeln(
          'Cleared $waitingForAuthorResponseLabel on ${item.htmlUrl} — an '
          'out-of-team contributor responded.',
        );
      }

      // The time of the triage assignment and the pings are not read again
      // either; the steps ignore the time if the label is gone.
      final String? reason = flagReason(
        clearWaiting ? withoutWaitingLabel(fresh) : fresh,
        update.contributions,
        now,
        assignedForTriageSince: update.assignedForTriageSince,
        pings: update.pings,
      );
      final wantsFlag = reason != null;

      // Another run already did it, or there is nothing to do.
      if (wantsFlag == fresh.labels.contains(needsTriageLabel)) return;

      if (wantsFlag) {
        await github.addLabel(item.number, needsTriageLabel);
        added += 1;
        log.writeln('Flagged ${item.htmlUrl} — $reason');
      } else {
        await github.removeLabel(item.number, needsTriageLabel);
        removed += 1;
        log.writeln(
          'Unflagged ${item.htmlUrl} — no longer matches any triage rule.',
        );
      }
    } on Object catch (e) {
      errorLog.writeln('Failed to update #${item.number}: $e');
    }
  });

  log.writeln(
    'A2UI triage-flag reconciliation completed: ${openItems.length} items, '
    "+$added / -$removed '$needsTriageLabel', "
    "-$waitingCleared '$waitingForAuthorResponseLabel'",
  );
}
