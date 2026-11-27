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

import 'analysis_draft.dart';
import 'applier.dart';
import 'milestone_change.dart';
import 'triage_item.dart';

/// One change that applying an item's draft makes on GitHub: its kind, such
/// as "Add label", and its value, such as "P2". The value of a reply is its
/// text.
///
/// Two changes are the same when their kinds and values are, so that the
/// details can show the changes that several items share.
typedef DraftChange = ({String kind, String value});

/// The changes that [applySuggestion] makes to [item] with [draft], in the
/// order it makes them, with one change per label, assignee, reviewer and
/// milestone.
List<DraftChange> draftChanges(TriageItem item, AnalysisDraft draft) {
  final TriageAnalysis s = draft.toAnalysis();
  final MilestoneChange milestone = draft.milestoneChange;
  return [
    if (replyToPost(s) case final String reply)
      (kind: 'Reply', value: _shownReply(reply)),
    for (final String label in s.removedLabels)
      (kind: 'Remove label', value: label),
    for (final String label in s.addedLabels) (kind: 'Add label', value: label),
    for (final String login in s.removedAssignees)
      (kind: 'Unassign', value: login),
    for (final String login in s.newAssignees) (kind: 'Assign', value: login),
    for (final String login in reviewersToRequest(item, s))
      (kind: 'Request review', value: login),
    if (milestone.set case final String title)
      (kind: 'Set milestone', value: title)
    else if (milestone.remove case final String title)
      (kind: 'Remove milestone', value: title),
    if (s.closeAs != null) (kind: 'Close', value: closeReason(item, s)),
  ];
}

/// [reply], as [replyToPost] returns it, without [replyHeading]: every
/// reply has a heading, so only [teamNoteHeading] says something.
String _shownReply(String reply) => reply.startsWith(replyHeading)
    ? reply.substring(replyHeading.length)
    : reply;

/// The changes that every list in [changes] has, in the order of the first
/// list.
List<DraftChange> sharedChanges(List<List<DraftChange>> changes) {
  if (changes.isEmpty) return const [];
  return [
    for (final DraftChange change in changes.first)
      if (changes.every((c) => c.contains(change))) change,
  ];
}
