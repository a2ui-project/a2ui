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

/// A change of an item's milestone, which the triager makes in the triage
/// UI.
///
/// The triage bot does not suggest milestones, so the change is not part of a
/// `TriageSuggestion`.
final class MilestoneChange {
  const MilestoneChange({this.set, this.remove});

  /// No change.
  static const MilestoneChange none = MilestoneChange();

  /// The title of the milestone to set, which replaces the item's current
  /// milestone.
  final String? set;

  /// The title of the milestone to remove. It has no effect when [set] is
  /// not null, since setting a milestone replaces the old one.
  final String? remove;

  bool get isEmpty => set == null && remove == null;
}
