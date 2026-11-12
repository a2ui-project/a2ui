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

import 'milestone_change.dart';
import 'suggestion_draft.dart';
import 'triage_controller.dart';
import 'triage_item.dart';

/// Everything the triage UI knows about [items], as Markdown that the
/// triager pastes at the start of a prompt to an agent: for each item, its
/// state, description and comments, the triage bot's suggestion, and the
/// changes that **Apply** would make.
///
/// [items] are the items in the details' tabs: the selected item first, and
/// then the items linked to it.
String itemContext(TriageController controller, List<TriageItem> items) {
  final TriageItem first = items.first;
  final List<TriageItem> linked = items.skip(1).toList();
  final out = StringBuffer(
    'Context: I am triaging ${first.name} in ${first.repository}'
    '${linked.isEmpty ? '' : ', with ${_names(linked)} linked to it'}. '
    'This is what the A2UI triage tool knows about '
    '${linked.isEmpty ? 'it' : 'them'}.\n',
  );
  for (final item in items) {
    out.write('\n');
    _writeItem(out, controller, item);
  }
  return out.toString();
}

String _names(List<TriageItem> items) => switch (items) {
  [final TriageItem one] => one.name,
  _ =>
    '${items.take(items.length - 1).map((i) => i.name).join(', ')} and '
        '${items.last.name}',
};

void _writeItem(StringBuffer out, TriageController controller, TriageItem i) {
  String list(Iterable<String> names) =>
      names.isEmpty ? 'none' : names.join(', ');
  String numbers(Iterable<int> ns) => list(ns.map((n) => '#$n'));

  out
    ..writeln('# ${i.name}: ${i.title}')
    ..writeln()
    ..writeln('- URL: ${i.url}')
    ..writeln(
      '- State: ${i.isMerged
          ? 'merged'
          : i.isOpen
          ? 'open'
          : 'closed'}',
    )
    ..writeln('- Author: ${_user(i.author)}')
    ..writeln('- Created: ${_date(i.createdAt)}')
    ..writeln('- Updated: ${_date(i.updatedAt)}')
    ..writeln('- Labels: ${list(i.labels)}')
    ..writeln('- Assignees: ${list(i.assignees)}')
    ..writeln('- Milestone: ${i.milestone ?? 'none'}')
    ..writeln(
      i.isPullRequest
          ? '- Fixes issues: ${numbers(i.linkedItems)}'
          : '- Fixed by open PRs: ${numbers(i.linkedItems)}',
    );
  if (controller.session.isSentToTeam(i.ref)) {
    out.writeln('- In this session: I sent it to the team.');
  } else if (controller.session.isApplied(i.ref)) {
    out.writeln('- In this session: I applied a suggestion to it.');
  }

  out
    ..writeln()
    ..writeln('## Description')
    ..writeln()
    ..writeln(i.body.trim().isEmpty ? 'No description.' : i.body.trim());

  out
    ..writeln()
    ..writeln('## Comments');
  if (i.comments.isEmpty) {
    out
      ..writeln()
      ..writeln('No comments.');
  }
  for (final ItemComment c in i.comments) {
    out
      ..writeln()
      ..writeln('### ${_user(c.author)}, ${_date(c.createdAt)}, ${c.url}')
      ..writeln()
      ..writeln(c.body.trim());
  }

  out
    ..writeln()
    ..writeln(
      '## Triage bot suggestion'
      '${i.suggestionStatus == SuggestionStatus.outdated ? ' (outdated: '
                'the item changed after the triage bot commented)' : ''}',
    )
    ..writeln();
  final SuggestionDraft draft = controller.draftFor(i);
  switch (i.suggestionStatus) {
    case SuggestionStatus.none:
      out.writeln('None.');
    case SuggestionStatus.invalid:
      out.writeln(
        'The suggestion comment does not hold a valid suggestion: '
        '${i.suggestionError}',
      );
    case SuggestionStatus.current || SuggestionStatus.outdated:
      out.writeln('- Comment: ${i.suggestionUrl}');
      for (final (String title, String? text) in [
        ('Summary', draft.summary),
        ('Why flagged for triage', draft.reason),
        ('Suggestion', draft.suggestion),
      ]) {
        if (text != null) out.writeln('- $title: $text');
      }
      if (draft.relatedIssues.isNotEmpty) {
        out.writeln('- Related issues: ${numbers(draft.relatedIssues)}');
      }
      if (draft.relatedPrs.isNotEmpty) {
        out.writeln('- Related PRs: ${numbers(draft.relatedPrs)}');
      }
  }

  out
    ..writeln()
    ..writeln(
      '## Changes that Apply would make'
      '${draft.isEdited ? ', as I edited them' : ''}',
    )
    ..writeln();
  final List<String> changes = _changes(
    draft.toSuggestion(),
    draft.milestoneChange,
  );
  out.writeln(changes.isEmpty ? 'None.' : changes.join('\n'));
}

List<String> _changes(TriageSuggestion s, MilestoneChange milestone) {
  return [
    if (s.closeAs case final String reason)
      '- Close as ${reason.replaceAll('_', ' ')}'
          '${s.duplicateOf == null ? '' : ' of #${s.duplicateOf}'}',
    if (s.addedLabels.isNotEmpty) '- Add labels: ${s.addedLabels.join(', ')}',
    if (s.removedLabels.isNotEmpty)
      '- Remove labels: ${s.removedLabels.join(', ')}',
    if (s.newAssignees.isNotEmpty) '- Assign: ${s.newAssignees.join(', ')}',
    if (s.removedAssignees.isNotEmpty)
      '- Unassign: ${s.removedAssignees.join(', ')}',
    if (milestone.set case final String title) '- Set milestone: $title',
    if (milestone.set == null && milestone.remove != null)
      '- Remove milestone: ${milestone.remove}',
    if (s.reply case final String reply) '- Post this reply:\n\n$reply',
  ];
}

String _user(String? login) => login == null ? 'a deleted account' : '@$login';

/// [date] as YYYY-MM-DD, in UTC.
String _date(DateTime date) {
  final DateTime d = date.toUtc();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)}';
}
