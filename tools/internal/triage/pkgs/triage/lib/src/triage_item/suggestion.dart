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

import 'triage_suggestion.dart';

/// The values of a [triageSuggestionApi] component.
///
/// An empty list means none, as an omitted list does in the component.
final class TriageSuggestion {
  const TriageSuggestion({
    this.summary,
    this.suggestion,
    this.reply,
    this.closeAs,
    this.duplicateOf,
    this.addedLabels = const [],
    this.removedLabels = const [],
    this.newAssignees = const [],
    this.removedAssignees = const [],
    this.newMilestone,
    this.removedMilestone,
    this.relatedIssues = const [],
    this.relatedPrs = const [],
  });

  /// Reads the properties of a component that is valid against
  /// [triageSuggestionApi].
  factory TriageSuggestion.fromProperties(Map<String, Object?> properties) =>
      TriageSuggestion(
        summary: properties[TriageSuggestionProps.summary] as String?,
        suggestion: properties[TriageSuggestionProps.suggestion] as String?,
        reply: properties[TriageSuggestionProps.reply] as String?,
        closeAs: properties[TriageSuggestionProps.closeAs] as String?,
        duplicateOf: (properties[TriageSuggestionProps.duplicateOf] as num?)
            ?.toInt(),
        addedLabels: _strings(properties[TriageSuggestionProps.addedLabels]),
        removedLabels: _strings(
          properties[TriageSuggestionProps.removedLabels],
        ),
        newAssignees: _strings(properties[TriageSuggestionProps.newAssignees]),
        removedAssignees: _strings(
          properties[TriageSuggestionProps.removedAssignees],
        ),
        newMilestone: properties[TriageSuggestionProps.newMilestone] as String?,
        removedMilestone:
            properties[TriageSuggestionProps.removedMilestone] as String?,
        relatedIssues: _ints(properties[TriageSuggestionProps.relatedIssues]),
        relatedPrs: _ints(properties[TriageSuggestionProps.relatedPrs]),
      );

  /// What the item is about. Null for a suggestion that the triager writes
  /// from scratch.
  final String? summary;

  /// What the triager should do and why. Null for a suggestion that the
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

  /// The title of the milestone to set, which replaces the item's current
  /// one, or null for no change.
  final String? newMilestone;

  /// The title of the milestone to remove, or null for no change.
  final String? removedMilestone;

  final List<int> relatedIssues;
  final List<int> relatedPrs;

  static List<String> _strings(Object? value) =>
      value == null ? const [] : List.unmodifiable(value as List<Object?>);

  static List<int> _ints(Object? value) => value == null
      ? const []
      : List.unmodifiable([
          for (final Object? n in value as List<Object?>) n! as int,
        ]);
}
