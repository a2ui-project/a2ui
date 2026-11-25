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

import 'milestone_change.dart';
import 'triage_item.dart';
import 'triage_service.dart';

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
  const StepResult(this.description, this.status, {this.error, this.text});

  final String description;
  final StepStatus status;

  /// Why the step failed.
  final String? error;

  /// The text that the step posts, such as the reply.
  final String? text;
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

/// How [item] is closed with [analysis]: "as duplicate of #1100", "as
/// completed" or "as not planned" for an issue, and empty for a pull
/// request, which has no close reason.
String closeReason(TriageItem item, TriageAnalysis analysis) {
  if (item.isPullRequest) return '';
  return switch (analysis.closeAs) {
    TriageCloseReason.duplicate => 'as duplicate of #${analysis.duplicateOf}',
    TriageCloseReason.notPlanned => 'as not planned',
    _ => 'as completed',
  };
}

/// The heading of a reply that the triager posts. See
/// `docs/contributing/triage/triage.md`.
const String replyHeading = '**From triage:**\n\n';

final RegExp _replyHeading = RegExp(
  r'^\s*\*\*(?:From triage|Requires team input\. Note for the discussion):'
  r'\*\*[ \t]*(?:\n[ \t]*)*',
);

/// [reply] without a leading [replyHeading] or [teamNoteHeading], which the
/// triage bot's replies can start with.
String withoutReplyHeading(String reply) =>
    reply.replaceFirst(_replyHeading, '');

/// The reply that applying [analysis] posts, or null if it has none: under
/// [replyHeading], or under [teamNoteHeading] if [analysis] adds
/// [needsTeamInputLabel], since the reply is then a note for the team.
String? replyToPost(TriageAnalysis analysis) {
  final String? reply = analysis.reply;
  if (reply == null) return null;
  final String heading = analysis.addedLabels.contains(needsTeamInputLabel)
      ? teamNoteHeading
      : replyHeading;
  return '$heading${withoutReplyHeading(reply)}';
}

/// Applies the suggestion of [analysis] to [item] on GitHub: posts the
/// [replyToPost], changes the labels, assignees and, with [milestone], the
/// milestone, and closes the item, in this order. [milestones] gives the
/// numbers of the open milestones by title.
///
/// Stops at the first step that fails. Skips the reply if [replyPosted],
/// so that retrying after a failure does not post it twice, and calls
/// [onReplyPosted] once it is posted.
Future<ApplyResult> applySuggestion(
  TriageService service,
  TriageItem item,
  TriageAnalysis analysis, {
  required bool replyPosted,
  required void Function() onReplyPosted,
  MilestoneChange milestone = MilestoneChange.none,
  Map<String, int> milestones = const {},
}) async {
  final ItemRef n = item.ref;
  final String? reply = replyToPost(analysis);
  final String? closeAs = analysis.closeAs;
  final String? newMilestone = milestone.set;
  final String? removedMilestone = milestone.remove;
  final steps = <_Step>[
    if (reply != null)
      replyPosted
          ? _Step('Post the reply: already posted', null, text: reply)
          : _Step('Post the reply', () async {
              await service.postComment(n, reply);
              onReplyPosted();
            }, text: reply),
    if (analysis.removedLabels.isNotEmpty)
      _Step(
        'Remove labels: ${analysis.removedLabels.join(', ')}',
        () => service.removeLabels(n, analysis.removedLabels),
      ),
    if (analysis.addedLabels.isNotEmpty)
      _Step(
        'Add labels: ${analysis.addedLabels.join(', ')}',
        () => service.addLabels(n, analysis.addedLabels),
      ),
    if (analysis.removedAssignees.isNotEmpty)
      _Step(
        'Unassign: ${analysis.removedAssignees.join(', ')}',
        () => service.removeAssignees(n, analysis.removedAssignees),
      ),
    if (analysis.newAssignees.isNotEmpty)
      _Step(
        'Assign: ${analysis.newAssignees.join(', ')}',
        () => service.addAssignees(n, analysis.newAssignees),
      ),
    if (newMilestone != null)
      _Step('Set milestone: $newMilestone', () async {
        final int? number = milestones[newMilestone];
        if (number == null) {
          throw GitHubException('There is no open milestone $newMilestone.');
        }
        await service.setMilestone(n, number);
      })
    // Setting a milestone replaces the old one, so removing it is needed
    // only without a new one.
    else if (removedMilestone != null)
      item.milestone == removedMilestone
          ? _Step(
              'Remove milestone: $removedMilestone',
              () => service.setMilestone(n, null),
            )
          : _Step('Remove milestone: $removedMilestone: not on the item', null),
    if (closeAs != null)
      _Step(
        'Close ${closeReason(item, analysis)}'.trim(),
        () => service.close(item, closeAs, duplicateOf: analysis.duplicateOf),
      ),
  ];

  final results = <StepResult>[];
  var failed = false;
  for (final step in steps) {
    StepResult result(StepStatus status, {String? error}) =>
        StepResult(step.description, status, error: error, text: step.text);
    final Future<void> Function()? run = step.run;
    if (failed) {
      results.add(result(StepStatus.notRun));
    } else if (run == null) {
      results.add(result(StepStatus.skipped));
    } else {
      try {
        await run();
        results.add(result(StepStatus.done));
      } on GitHubException catch (e) {
        failed = true;
        results.add(result(StepStatus.failed, error: e.message));
      } on Object catch (e) {
        failed = true;
        results.add(result(StepStatus.failed, error: '$e'));
      }
    }
  }
  return ApplyResult(List.unmodifiable(results));
}

/// A change that [applySuggestion] makes: what it does, how, and the text it
/// posts.
final class _Step {
  const _Step(this.description, this.run, {this.text});

  final String description;

  /// Makes the change, or null if it is not needed.
  final Future<void> Function()? run;

  final String? text;
}
