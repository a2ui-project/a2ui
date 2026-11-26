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

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:shared/shared.dart';

import 'milestone_change.dart';

/// A triage analysis as the triager edits it, before applying it.
class AnalysisDraft extends ChangeNotifier {
  AnalysisDraft(TriageAnalysis analysis)
    : _initial = analysis,
      tldr = analysis.tldr,
      summary = analysis.summary,
      reason = analysis.reason,
      suggestion = analysis.suggestion,
      reply = TextEditingController(text: analysis.reply ?? ''),
      duplicateOf = TextEditingController(
        text: analysis.duplicateOf?.toString() ?? '',
      ),
      _closeAs = analysis.closeAs,
      _addedLabels = analysis.addedLabels,
      _removedLabels = analysis.removedLabels,
      _newAssignees = analysis.newAssignees,
      _removedAssignees = analysis.removedAssignees,
      targetingPrs = analysis.targetingPrs,
      targetedIssues = analysis.targetedIssues,
      relatedItems = analysis.relatedItems {
    reply.addListener(notifyListeners);
    duplicateOf.addListener(notifyListeners);
  }

  /// The analysis that the draft started from.
  final TriageAnalysis _initial;

  /// The triage bot's TL;DR, which the triager reads but does not apply.
  final String? tldr;

  /// The triage bot's summary, which the triager reads but does not apply.
  final String? summary;

  /// The triage bot's reason why the item is flagged for triage, which the
  /// triager reads but does not apply.
  final String? reason;

  /// The triage bot's suggestion, which the triager reads but does not apply.
  final String? suggestion;

  final TextEditingController reply;

  /// The number of the duplicated item, as the triager types it.
  final TextEditingController duplicateOf;

  final List<int> targetingPrs;
  final List<int> targetedIssues;
  final List<int> relatedItems;

  String? _closeAs;
  List<String> _addedLabels;
  List<String> _removedLabels;
  List<String> _newAssignees;
  List<String> _removedAssignees;
  String? _newMilestone;
  String? _removedMilestone;

  /// One of [TriageCloseReason.values], or null to keep the item open.
  String? get closeAs => _closeAs;
  set closeAs(String? value) => _set(() => _closeAs = value);

  List<String> get addedLabels => _addedLabels;
  set addedLabels(List<String> value) => _set(() => _addedLabels = value);

  List<String> get removedLabels => _removedLabels;
  set removedLabels(List<String> value) => _set(() => _removedLabels = value);

  List<String> get newAssignees => _newAssignees;
  set newAssignees(List<String> value) => _set(() => _newAssignees = value);

  List<String> get removedAssignees => _removedAssignees;
  set removedAssignees(List<String> value) =>
      _set(() => _removedAssignees = value);

  /// The title of the milestone to set, or null for no change. The
  /// triager sets it, since the triage bot does not suggest milestones.
  String? get newMilestone => _newMilestone;
  set newMilestone(String? value) => _set(() => _newMilestone = value);

  /// The title of the milestone to remove, or null for no change.
  String? get removedMilestone => _removedMilestone;
  set removedMilestone(String? value) => _set(() => _removedMilestone = value);

  void _set(void Function() change) {
    change();
    notifyListeners();
  }

  int? get _duplicateOf => int.tryParse(duplicateOf.text.trim());

  /// Whether the triager changed the draft since it started, or since the
  /// last [revert].
  bool get isEdited {
    final TriageAnalysis s = _initial;
    return reply.text != (s.reply ?? '') ||
        duplicateOf.text != (s.duplicateOf?.toString() ?? '') ||
        _closeAs != s.closeAs ||
        !listEquals(_addedLabels, s.addedLabels) ||
        !listEquals(_removedLabels, s.removedLabels) ||
        !listEquals(_newAssignees, s.newAssignees) ||
        !listEquals(_removedAssignees, s.removedAssignees) ||
        !milestoneChange.isEmpty;
  }

  /// Undoes the triager's changes, back to the analysis the draft started
  /// from.
  void revert() {
    final TriageAnalysis s = _initial;
    reply.text = s.reply ?? '';
    duplicateOf.text = s.duplicateOf?.toString() ?? '';
    _set(() {
      _closeAs = s.closeAs;
      _addedLabels = s.addedLabels;
      _removedLabels = s.removedLabels;
      _newAssignees = s.newAssignees;
      _removedAssignees = s.removedAssignees;
      _newMilestone = null;
      _removedMilestone = null;
    });
  }

  /// Whether the draft changes anything on GitHub.
  bool get hasChanges {
    final TriageAnalysis s = toAnalysis();
    return s.reply != null ||
        s.closeAs != null ||
        s.addedLabels.isNotEmpty ||
        s.removedLabels.isNotEmpty ||
        s.newAssignees.isNotEmpty ||
        s.removedAssignees.isNotEmpty ||
        !milestoneChange.isEmpty;
  }

  /// Why the draft cannot be applied, or null if it can.
  String? get problem {
    if (_closeAs == TriageCloseReason.duplicate) {
      final int? number = _duplicateOf;
      if (number == null || number < 1) {
        return 'Enter the number of the issue that this one duplicates.';
      }
    }
    return null;
  }

  /// The milestone change to apply with [toAnalysis].
  MilestoneChange get milestoneChange =>
      MilestoneChange(set: _newMilestone, remove: _removedMilestone);

  /// The draft as the analysis to apply, without the milestone change.
  TriageAnalysis toAnalysis() {
    final String text = reply.text.trim();
    return TriageAnalysis(
      tldr: tldr,
      summary: summary,
      reason: reason,
      suggestion: suggestion,
      reply: text.isEmpty ? null : text,
      closeAs: _closeAs,
      duplicateOf: _closeAs == TriageCloseReason.duplicate
          ? _duplicateOf
          : null,
      addedLabels: _addedLabels,
      removedLabels: _removedLabels,
      newAssignees: _newAssignees,
      removedAssignees: _removedAssignees,
      targetingPrs: targetingPrs,
      targetedIssues: targetedIssues,
      relatedItems: relatedItems,
    );
  }

  @override
  void dispose() {
    reply.dispose();
    duplicateOf.dispose();
    super.dispose();
  }
}
