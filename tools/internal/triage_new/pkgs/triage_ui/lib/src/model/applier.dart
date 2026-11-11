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

import 'package:triage/triage.dart';

import '../github/github_client.dart';
import '../github/triage_service.dart';
import 'milestone_change.dart';
import 'triage_item.dart';

enum StepStatus {
  done,

  /// Not needed, because an earlier apply did it.
  skipped,
  failed,

  /// Not tried, because an earlier step failed.
  notRun,
}

/// One change that applying a suggestion makes, and how it went.
final class StepResult {
  const StepResult(this.description, this.status, {this.error});

  final String description;
  final StepStatus status;

  /// Why the step failed.
  final String? error;
}

/// How applying a suggestion to an item went, step by step.
final class ApplyResult {
  const ApplyResult(this.steps);

  final List<StepResult> steps;

  bool get succeeded => steps.every(
    (StepResult s) =>
        s.status == StepStatus.done || s.status == StepStatus.skipped,
  );
}

/// How [item] is closed with [suggestion]: "as duplicate of #1100", "as
/// completed" or "as not planned" for an issue, and empty for a pull
/// request, which has no close reason.
String closeReason(TriageItem item, TriageSuggestion suggestion) {
  if (item.isPullRequest) return '';
  return switch (suggestion.closeAs) {
    TriageCloseReason.duplicate => 'as duplicate of #${suggestion.duplicateOf}',
    TriageCloseReason.notPlanned => 'as not planned',
    _ => 'as completed',
  };
}

/// Applies [suggestion] to [item] on GitHub: posts the reply, changes the
/// labels, assignees and, with [milestone], the milestone, and closes the
/// item, in this order. [milestones] gives the numbers of the open
/// milestones by title.
///
/// Stops at the first step that fails. Skips the reply if [replyPosted],
/// so that retrying after a failure does not post it twice, and calls
/// [onReplyPosted] once it is posted.
Future<ApplyResult> applySuggestion(
  TriageService service,
  TriageItem item,
  TriageSuggestion suggestion, {
  required bool replyPosted,
  required void Function() onReplyPosted,
  MilestoneChange milestone = MilestoneChange.none,
  Map<String, int> milestones = const {},
}) async {
  final ItemRef n = item.ref;
  final String? reply = suggestion.reply;
  final String? closeAs = suggestion.closeAs;
  final String? newMilestone = milestone.set;
  final String? removedMilestone = milestone.remove;
  final steps = <(String, Future<void> Function()?)>[
    if (reply != null)
      replyPosted
          ? ('Post the reply: already posted', null)
          : (
              'Post the reply',
              () async {
                await service.postComment(n, reply);
                onReplyPosted();
              },
            ),
    if (suggestion.removedLabels.isNotEmpty)
      (
        'Remove labels: ${suggestion.removedLabels.join(', ')}',
        () => service.removeLabels(n, suggestion.removedLabels),
      ),
    if (suggestion.addedLabels.isNotEmpty)
      (
        'Add labels: ${suggestion.addedLabels.join(', ')}',
        () => service.addLabels(n, suggestion.addedLabels),
      ),
    if (suggestion.removedAssignees.isNotEmpty)
      (
        'Unassign: ${suggestion.removedAssignees.join(', ')}',
        () => service.removeAssignees(n, suggestion.removedAssignees),
      ),
    if (suggestion.newAssignees.isNotEmpty)
      (
        'Assign: ${suggestion.newAssignees.join(', ')}',
        () => service.addAssignees(n, suggestion.newAssignees),
      ),
    if (newMilestone != null)
      (
        'Set milestone: $newMilestone',
        () async {
          final int? number = milestones[newMilestone];
          if (number == null) {
            throw GitHubException('There is no open milestone $newMilestone.');
          }
          await service.setMilestone(n, number);
        },
      )
    // Setting a milestone replaces the old one, so removing it is needed
    // only without a new one.
    else if (removedMilestone != null)
      item.milestone == removedMilestone
          ? (
              'Remove milestone: $removedMilestone',
              () => service.setMilestone(n, null),
            )
          : ('Remove milestone: $removedMilestone: not on the item', null),
    if (closeAs != null)
      (
        'Close ${closeReason(item, suggestion)}'.trim(),
        () => service.close(item, closeAs, duplicateOf: suggestion.duplicateOf),
      ),
  ];

  final results = <StepResult>[];
  var failed = false;
  for (final (String description, Future<void> Function()? run) in steps) {
    if (failed) {
      results.add(StepResult(description, StepStatus.notRun));
    } else if (run == null) {
      results.add(StepResult(description, StepStatus.skipped));
    } else {
      try {
        await run();
        results.add(StepResult(description, StepStatus.done));
      } on GitHubException catch (e) {
        failed = true;
        results.add(
          StepResult(description, StepStatus.failed, error: e.message),
        );
      }
    }
  }
  return ApplyResult(List.unmodifiable(results));
}
