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

import 'triage_item.dart';

/// What the triager did since the triage UI started.
class TriageSession {
  TriageSession({DateTime? started}) : started = started ?? DateTime.now();

  /// When the triage UI started.
  final DateTime started;

  /// The applied items, and whether each was sent to the team.
  final Map<ItemRef, bool> _sentToTeam = {};
  final Set<ItemRef> _replied = {};

  /// Whether the triager applied a suggestion to [item] that did not send
  /// it to the team.
  bool isApplied(ItemRef item) => _sentToTeam[item] == false;

  bool isSentToTeam(ItemRef item) => _sentToTeam[item] ?? false;

  /// Whether the triager applied a suggestion to [item] or sent it to the
  /// team.
  bool isHandled(ItemRef item) => _sentToTeam.containsKey(item);

  /// Records that the triager applied [suggestion] to [item]. A suggestion
  /// that adds `status: needs-team-input` sends the item to the team. A
  /// later apply to the same item replaces the earlier one.
  void recordApplied(TriageItem item, TriageSuggestion suggestion) =>
      _sentToTeam[item.ref] = suggestion.addedLabels.contains(
        needsTeamInputLabel,
      );

  bool hasReplied(ItemRef item) => _replied.contains(item);

  void recordReplied(ItemRef item) => _replied.add(item);
}
