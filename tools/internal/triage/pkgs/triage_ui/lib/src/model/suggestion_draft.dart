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

import 'package:flutter/widgets.dart';
import 'package:triage/triage.dart';

/// A triage suggestion as the triager edits it, before applying it.
class SuggestionDraft extends ChangeNotifier {
  SuggestionDraft(TriageSuggestion suggestion)
    : summary = suggestion.summary,
      suggestion = suggestion.suggestion,
      reply = TextEditingController(text: suggestion.reply ?? ''),
      duplicateOf = TextEditingController(
        text: suggestion.duplicateOf?.toString() ?? '',
      ),
      _closeAs = suggestion.closeAs,
      _addedLabels = suggestion.addedLabels,
      _removedLabels = suggestion.removedLabels,
      _newAssignees = suggestion.newAssignees,
      _removedAssignees = suggestion.removedAssignees,
      _newMilestone = suggestion.newMilestone,
      _removedMilestone = suggestion.removedMilestone,
      relatedIssues = suggestion.relatedIssues,
      relatedPrs = suggestion.relatedPrs {
    reply.addListener(notifyListeners);
    duplicateOf.addListener(notifyListeners);
  }

  /// The advisor's summary, which the triager reads but does not apply.
  final String? summary;

  /// The advisor's suggestion, which the triager reads but does not apply.
  final String? suggestion;

  final TextEditingController reply;

  /// The number of the duplicated item, as the triager types it.
  final TextEditingController duplicateOf;

  final List<int> relatedIssues;
  final List<int> relatedPrs;

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

  /// The title of the milestone to set, or null for no change.
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

  /// Why the draft cannot be applied, or null if it can.
  String? get problem {
    if (_closeAs == TriageCloseReason.duplicate) {
      final int? number = _duplicateOf;
      if (number == null || number < 1) {
        return 'Enter the number of the issue that this one duplicates.';
      }
    }
    final TriageSuggestion s = toSuggestion();
    if (s.reply == null &&
        s.closeAs == null &&
        s.addedLabels.isEmpty &&
        s.removedLabels.isEmpty &&
        s.newAssignees.isEmpty &&
        s.removedAssignees.isEmpty &&
        s.newMilestone == null &&
        s.removedMilestone == null) {
      return 'Nothing to apply.';
    }
    return null;
  }

  /// The draft as the suggestion to apply.
  TriageSuggestion toSuggestion() {
    final String text = reply.text.trim();
    return TriageSuggestion(
      summary: summary,
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
      newMilestone: _newMilestone,
      removedMilestone: _removedMilestone,
      relatedIssues: relatedIssues,
      relatedPrs: relatedPrs,
    );
  }

  @override
  void dispose() {
    reply.dispose();
    duplicateOf.dispose();
    super.dispose();
  }
}
