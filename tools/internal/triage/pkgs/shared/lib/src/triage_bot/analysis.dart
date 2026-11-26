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

import 'triage_analysis.dart';

/// The values of a [triageAnalysisApi] component.
///
/// An empty list means none, as an omitted list does in the component.
final class TriageAnalysis {
  const TriageAnalysis({
    this.tldr,
    this.summary,
    this.reason,
    this.suggestion,
    this.reply,
    this.closeAs,
    this.duplicateOf,
    this.addedLabels = const [],
    this.removedLabels = const [],
    this.newAssignees = const [],
    this.removedAssignees = const [],
    this.targetingPrs = const [],
    this.targetedIssues = const [],
    this.relatedItems = const [],
  });

  /// Reads the properties of a component that is valid against
  /// [triageAnalysisApi].
  factory TriageAnalysis.fromProperties(Map<String, Object?> properties) =>
      TriageAnalysis(
        tldr: properties[TriageAnalysisProps.tldr] as String?,
        summary: properties[TriageAnalysisProps.summary] as String?,
        reason: properties[TriageAnalysisProps.reason] as String?,
        suggestion: properties[TriageAnalysisProps.suggestion] as String?,
        reply: properties[TriageAnalysisProps.reply] as String?,
        closeAs: properties[TriageAnalysisProps.closeAs] as String?,
        duplicateOf: (properties[TriageAnalysisProps.duplicateOf] as num?)
            ?.toInt(),
        addedLabels: _strings(properties[TriageAnalysisProps.addedLabels]),
        removedLabels: _strings(properties[TriageAnalysisProps.removedLabels]),
        newAssignees: _strings(properties[TriageAnalysisProps.newAssignees]),
        removedAssignees: _strings(
          properties[TriageAnalysisProps.removedAssignees],
        ),
        targetingPrs: _ints(properties[TriageAnalysisProps.targetingPrs]),
        targetedIssues: _ints(properties[TriageAnalysisProps.targetedIssues]),
        relatedItems: _ints(properties[TriageAnalysisProps.relatedItems]),
      );

  /// The case and the suggestion in a few words each, as two lines:
  /// "Case: ..." and "Suggestion: ...". Null when the triage bot did not
  /// write it, or for an analysis that the triager writes from scratch.
  final String? tldr;

  /// What the item is about. Null for an analysis that the triager writes
  /// from scratch.
  final String? summary;

  /// Why the item is flagged for triage, or null when it is not flagged.
  final String? reason;

  /// What the triager should do and why. Null for an analysis that the
  /// triager writes from scratch.
  final String? suggestion;

  /// The comment to post on the item, or null for none.
  final String? reply;

  /// One of [TriageCloseReason.values], or null to keep the item open.
  final String? closeAs;

  /// The number of the item that this item duplicates.
  final int? duplicateOf;

  final List<String> addedLabels;
  final List<String> removedLabels;
  final List<String> newAssignees;
  final List<String> removedAssignees;

  /// Open pull requests that target the item, such as ones that fix it.
  final List<int> targetingPrs;

  /// Issues that the item targets, such as ones that a pull request fixes.
  final List<int> targetedIssues;

  /// Other issues and pull requests that relate to the item.
  final List<int> relatedItems;

  static List<String> _strings(Object? value) =>
      value == null ? const [] : List.unmodifiable(value as List<Object?>);

  static List<int> _ints(Object? value) => value == null
      ? const []
      : List.unmodifiable([
          for (final Object? n in value as List<Object?>) n! as int,
        ]);
}
