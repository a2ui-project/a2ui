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

/// The rules in `blueprints/features/flagger.blueprint.md`, which decide
/// whether an item needs triage.
library;

import 'package:shared/shared.dart';

/// Priorities urgent enough that an unassigned issue is flagged at once
/// (step 5). Every entry is one of [priorityLabels].
const Set<String> assigneeRequiredPriorities = {'P0'};

/// Priorities whose unassigned issues are flagged until they have a
/// milestone (step 5): a milestone plans the work as well as an assignee
/// does. Every entry is one of [priorityLabels].
const Set<String> assigneeOrMilestonePriorities = {'P1'};

/// Days of inactivity before an assigned pull request that a team member
/// opened is stale (step 6). An assigned pull request from outside the team
/// goes stale as [StaleCase.externalPrInactive] instead.
const int prStaleDays = 7;

/// What the flagger decides for an item.
final class Decision {
  const Decision({required this.clearWaiting, required this.reason});

  /// Whether to remove [waitingForAuthorResponseLabel].
  final bool clearWaiting;

  /// Why the item needs [needsTriageLabel], or null if it does not.
  final String? reason;
}

/// Whether someone with [association] is outside the team. Bots are outside
/// the team too: an issue that a workflow files, or a pull request that
/// dependabot opens, needs triage as much as one from a person outside the
/// team.
bool _isExternal(String association) => !isTeamMember(association);

/// The latest human contribution to [item]: its newest comment or review
/// that is not from a bot, or else the opening post.
///
/// It measures staleness, and tells whether someone outside the team waits
/// for an answer. The order of [contributions] does not matter.
Contribution lastHumanContribution(
  Item item,
  List<Contribution> contributions,
) {
  var latest = Contribution(
    createdAt: item.createdAt,
    association: item.authorAssociation,
    user: item.user,
  );
  for (final contribution in contributions) {
    if (isBot(contribution.user)) continue;
    if (!contribution.createdAt.isBefore(latest.createdAt)) {
      latest = contribution;
    }
  }
  return latest;
}

/// Why an item in [staleCase] is stale.
String _staleReason(StaleCase staleCase) {
  final String days = daysText(staleCase.days);
  return switch (staleCase) {
    StaleCase.assignedForTriage =>
      "'$assignedForTriageLabel' was added more than $days ago",
    StaleCase.p0Inactive || StaleCase.p1Inactive =>
      'this ${staleCase.priority} issue has had no update from the team for '
          'more than $days',
    StaleCase.externalPrInactive =>
      'this PR from an out-of-team contributor has had no response from the '
          'team for more than $days',
  };
}

/// Whether the request that [waitingForAuthorResponseLabel] tracks is
/// answered: a person outside the team, the author or anyone else,
/// contributed at or after [waitingSince], when the label was added.
///
/// Anyone outside the team counts, not only the author: an author sometimes
/// goes quiet while others continue the discussion, and their replies need
/// the team's attention too. Team members' contributions don't count, since
/// the team asked the question. Bots' contributions don't count either,
/// since a bot cannot answer it. Neither do contributions from before the
/// label went on: the opening post predates it, so an item with no replies
/// is the one still waiting.
///
/// [waitingSince] is null when the labeling cannot be read. The label then
/// stays for a person to remove.
bool externalHasResponded(
  List<Contribution> contributions,
  DateTime? waitingSince,
) {
  if (waitingSince == null) return false;
  return contributions.any(
    (contribution) =>
        !contribution.createdAt.isBefore(waitingSince) &&
        _isExternal(contribution.association) &&
        !isBot(contribution.user),
  );
}

/// Why [item] needs [needsTriageLabel], or null if it does not. The flagger
/// logs the reason, and the triage bot copies it into its analyses.
///
/// [assignedForTriageSince] is when [assignedForTriageLabel] was last added,
/// or null when that cannot be read. [pings] are the staleness pings on the
/// item.
String? flagReason(
  Item item,
  List<Contribution> contributions,
  DateTime now, {
  DateTime? assignedForTriageSince,
  List<Ping> pings = const [],
}) {
  final List<String> labels = item.labels;
  final bool openedByExternal = _isExternal(item.authorAssociation);
  final Contribution latest = lastHumanContribution(item, contributions);

  // Step 0: a draft PR is still in its author's hands, so it is nobody's
  // triage work until the author marks it ready for review.
  if (item.isPullRequest && item.isDraft) return null;

  // Step 1: a parked item is off the triage queue. The flagger removes its
  // label once someone outside the team responds, which puts it back.
  if (labels.contains(waitingForAuthorResponseLabel)) return null;

  // Step 2: a stale item goes back to triage once the staleness pinger has
  // asked its assignees to act and the grace period has passed. This
  // applies whoever opened the item, since the ping promised it. An item
  // that nobody pinged, because nobody ran the pinger, goes back once it
  // has been stale for as long as a ping and its grace period would take.
  // Until then, the steps below do not flag the item for its staleness.
  if (stalenessOf(
        item,
        contributions,
        assignedForTriageSince: assignedForTriageSince,
      )
      case final Staleness staleness) {
    final StaleCase staleCase = staleness.staleCase;
    if (staleness.hasExpiredPing(pings, now)) {
      return '${_staleReason(staleCase)}, and the assignees did not act on '
          'the staleness ping within ${daysText(staleCase.graceDays)}.';
    }
    if (staleness.currentPing(pings) == null && staleness.isOverdue(now)) {
      return '${_staleReason(staleCase)}, and nobody pinged the assignees '
          'within ${daysText(staleCase.graceDays)} after that.';
    }
  }

  // Step 3: an item handed to a team member for triage is judged on that
  // assignment alone, whoever opened it; the steps below would flag it for
  // the very things the assignee is there to sort out. An assignment that
  // runs late is flagged by step 2.
  if (labels.contains(assignedForTriageLabel)) {
    return item.assignees.isEmpty
        ? "'$assignedForTriageLabel' is set, but nobody is assigned."
        : null;
  }

  // Step 4: the team manages its own items. One that a team member opened
  // stays off the queue unless the last human word on it is from outside
  // the team, which a team reply settles.
  if (!openedByExternal && !_isExternal(latest.association)) return null;

  // Step 6: a PR needs triage until a team member takes it on by being
  // assigned; a team comment alone does not take it off the queue. Once
  // assigned, a PR from outside the team is flagged by step 2 when it goes
  // stale. A team member's PR gets here only while an out-of-team
  // contribution is the latest, and is flagged when it goes quiet for more
  // than [prStaleDays].
  if (item.isPullRequest) {
    if (item.assignees.isEmpty) return 'this PR has no assignee.';
    if (_isExternal(item.authorAssociation)) return null;
    return now.difference(latest.createdAt) > const Duration(days: prStaleDays)
        ? 'this assigned PR has had no human activity for more than '
              '$prStaleDays days.'
        : null;
  }

  // Step 5: issues.
  final String? priority = priorityLabels.where(labels.contains).firstOrNull;
  const noPriorityReason = 'this issue has no priority label.';

  // An assigned issue has a team member on it, so it is flagged only when
  // it has no priority, or by step 2 when it goes stale. A comment from
  // outside the team is the assignee's to answer.
  if (item.assignees.isNotEmpty) {
    return priority == null ? noPriorityReason : null;
  }

  // Urgent or planned work with nobody on it.
  if (assigneeRequiredPriorities.contains(priority)) {
    return 'this $priority issue has no assignee.';
  }
  if (assigneeOrMilestonePriorities.contains(priority) && !item.hasMilestone) {
    return 'this $priority issue has no assignee or milestone.';
  }

  if (priority == null) return noPriorityReason;

  // An unassigned issue whose latest comment is from outside the team waits
  // for an answer. The opening post is not a comment, so an issue that
  // nobody has commented on does not.
  final bool hasComment = contributions.any((c) => !isBot(c.user));
  return hasComment && _isExternal(latest.association)
      ? 'the latest comment is from an out-of-team contributor and has gone '
            'unanswered.'
      : null;
}

/// Decides whether to remove [waitingForAuthorResponseLabel] from [item],
/// and why it needs [needsTriageLabel].
Decision decide(Item item, ItemHistory history, DateTime now) {
  final bool clearWaiting =
      item.labels.contains(waitingForAuthorResponseLabel) &&
      externalHasResponded(history.contributions, history.waitingSince);

  // Judge the item as it will look once the waiting label is gone: a label
  // that this run removes must not hold back the flag until the next run.
  final Item judged = clearWaiting ? _withoutWaitingLabel(item) : item;

  return Decision(
    clearWaiting: clearWaiting,
    reason: flagReason(
      judged,
      history.contributions,
      now,
      assignedForTriageSince: history.assignedForTriageSince,
      pings: history.pings,
    ),
  );
}

/// [item] without [waitingForAuthorResponseLabel].
Item _withoutWaitingLabel(Item item) => item.withLabels([
  for (final label in item.labels)
    if (label != waitingForAuthorResponseLabel) label,
]);
