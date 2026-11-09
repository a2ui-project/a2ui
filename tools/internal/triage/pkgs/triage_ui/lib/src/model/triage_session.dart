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

import 'applier.dart';
import 'triage_item.dart';

/// An item that the triager applied a suggestion to, and the suggestion.
final class AppliedItem {
  const AppliedItem(this.item, this.suggestion);

  final TriageItem item;
  final TriageSuggestion suggestion;
}

/// What the triager did since the triage UI started.
class TriageSession {
  final Map<int, AppliedItem> _applied = {};
  final Set<int> _replied = {};
  var _version = 0;
  var _copiedVersion = 0;

  /// The applied items, in the order the triager applied them.
  Iterable<AppliedItem> get applied => _applied.values;

  bool isApplied(int number) => _applied.containsKey(number);

  /// Records that the triager applied [suggestion] to [item]. A later apply
  /// to the same item replaces the earlier one in the report.
  void recordApplied(TriageItem item, TriageSuggestion suggestion) {
    _applied
      ..remove(item.number)
      ..[item.number] = AppliedItem(item, suggestion);
    _version++;
  }

  bool hasReplied(int number) => _replied.contains(number);

  void recordReplied(int number) => _replied.add(number);

  /// Whether the triager applied items that the last copied report, if any,
  /// does not include.
  bool get needsReport => _applied.isNotEmpty && _copiedVersion != _version;

  void recordCopied() => _copiedVersion = _version;

  /// The session report, as `ui.blueprint.md` describes it.
  String report({required int stillNeedTriage}) {
    final List<AppliedItem> applied = _applied.values.toList();
    final lines = <String>[
      if (applied.isEmpty)
        'Nothing triaged yet.'
      else
        'Triaged ${_plural(applied.length, 'item')}: '
            '${_countByType(applied)}.',
      '${_plural(stillNeedTriage, 'item')} still '
          '${stillNeedTriage == 1 ? 'needs' : 'need'} triage.',
    ];

    final groups = <String, List<AppliedItem>>{};
    for (final a in applied) {
      (groups[_group(a.suggestion)] ??= []).add(a);
    }
    final List<String> order = [..._groupOrder]
      ..retainWhere(groups.containsKey);
    for (final group in order) {
      final List<AppliedItem> items = groups[group]!;
      lines
        ..add('')
        ..add('- $group: ${_countByType(items)}');
      for (final item in items) {
        lines
          ..add('  - ${item.item.url}')
          ..add('    ${item.item.title}: ${_describe(item)}');
      }
    }
    return lines.join('\n');
  }

  static const String _assignedForTriageLabel = 'status: assigned-for-triage';
  static const List<String> _priorities = ['P0', 'P1', 'P2', 'P3'];
  static const String _closed = 'Closed';
  static const String _assignedForTriage = 'Assigned for triage';
  static const String _updated = 'Updated';
  static final List<String> _groupOrder = [
    _closed,
    for (final p in _priorities) 'Assigned $p',
    _assignedForTriage,
    _updated,
  ];

  static String _group(TriageSuggestion s) {
    if (s.closeAs != null) return _closed;
    for (final String p in _priorities) {
      if (s.addedLabels.contains(p)) return 'Assigned $p';
    }
    if (s.addedLabels.contains(_assignedForTriageLabel)) {
      return _assignedForTriage;
    }
    return _updated;
  }

  /// What was applied, such as "added P1, assigned octocat".
  static String _describe(AppliedItem applied) {
    final TriageSuggestion s = applied.suggestion;
    return [
      if (s.closeAs != null) 'closed ${closeReason(applied.item, s)}'.trim(),
      if (s.addedLabels.isNotEmpty) 'added ${_and(s.addedLabels)}',
      if (s.removedLabels.isNotEmpty) 'removed ${_and(s.removedLabels)}',
      if (s.newAssignees.isNotEmpty) 'assigned ${_and(s.newAssignees)}',
      if (s.removedAssignees.isNotEmpty)
        'unassigned ${_and(s.removedAssignees)}',
      if (s.reply != null) 'replied',
    ].join(', ');
  }

  static String _countByType(List<AppliedItem> items) {
    final int prs = items.where((a) => a.item.isPullRequest).length;
    final int issues = items.length - prs;
    return [
      if (issues > 0) _plural(issues, 'issue'),
      if (prs > 0) _plural(prs, 'PR'),
    ].join(' and ');
  }

  static String _plural(int count, String noun) =>
      '$count $noun${count == 1 ? '' : 's'}';

  static String _and(List<String> words) => words.length < 3
      ? words.join(' and ')
      : '${words.sublist(0, words.length - 1).join(', ')} and ${words.last}';
}
